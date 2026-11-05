/**
 * 本地画布服务（127.0.0.1 单例）。
 *
 * 为什么是本地服务：天枢 TPI 插件是 headless 的，无法内嵌窗口，因此画布前端以
 * 「本地 HTTP 服务 + 浏览器打开」的方式呈现。
 *
 * 生命周期：模块级单例，跨工具调用存活；`unref()` 使其不阻塞宿主退出；
 * dispose 时**不关闭**服务（浏览器标签可能仍开着）。
 *
 * 安全：
 *  - 只绑定 127.0.0.1；校验 Host 头。
 *  - 静态资源白名单（非目录遍历）。
 *  - 变更路由要求自定义头 `X-Tianshu-Redraw: 1`（跨源无法带自定义头 → 天然防 CSRF）。
 *  - 源视频流式 + Range 支持（ffmpeg 需 seek）。
 */
import http from 'node:http'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeId, InvalidInputError, newFrameId } from './ids.js'
import { readConfig, redactConfig, updateConfig } from './config.js'
import { activeJobs, jobEvents } from './jobs.js'
import {
  STEP_IDS,
  addEdge,
  contactDir,
  framesDir,
  mediaAbs,
  mimeFromExt,
  mutateProject,
  pendingGate,
  projectEvents,
  projectIssue,
  readProject,
  readSelection,
  removeEdge,
  setViewport,
  writeMedia,
  writeSelection,
  type FrameItem,
  type Selection,
  type StepId,
} from './project.js'

const WEB_DIR = fileURLToPath(new URL('./web/', import.meta.url))
const FFMPEG_DIR = fileURLToPath(new URL('./ffmpeg/', import.meta.url))

const DEFAULT_PORT = 43187
const MUTATION_HEADER = 'x-tianshu-redraw'
const MAX_BODY = 8 * 1024 * 1024
const MAX_VIEWPORT_BODY = 4096
const BODY_DRAIN_MS = 2000

interface ServerState {
  server: http.Server
  port: number
  tokens: Map<string, string>
  sse: Map<string, Set<http.ServerResponse>>
}

let state: ServerState | null = null

export function tokenFor(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16)
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

async function listenWithFallback(server: http.Server, preferred: number): Promise<number> {
  if (preferred === 0) return listen(server, 0)
  for (let i = 0; i < 21; i++) {
    try {
      return await listen(server, preferred + i)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
    }
  }
  return listen(server, 0)
}

export interface ServerHandle {
  token: string
  port: number
  url: string
}

export async function ensureServer(cwd: string, preferredPort = DEFAULT_PORT): Promise<ServerHandle> {
  if (!state) {
    const server = http.createServer(handleRequest)
    server.on('clientError', (_err, socket) => socket.destroy())
    const port = await listenWithFallback(server, preferredPort)
    server.unref()
    const created: ServerState = { server, port, tokens: new Map(), sse: new Map() }
    state = created
    for (const evt of ['change', 'selection', 'job', 'pipeline', 'frames', 'config']) {
      const name = evt === 'change' ? 'project' : evt
      projectEvents.on(evt, ({ cwd: changed }: { cwd: string }) => broadcast(created, tokenFor(changed), name))
    }
    jobEvents.on('job', ({ cwd: changed }: { cwd: string }) => broadcast(created, tokenFor(changed), 'job'))
  }
  const token = tokenFor(cwd)
  state.tokens.set(token, cwd)
  return { token, port: state.port, url: `http://127.0.0.1:${state.port}/?ws=${token}` }
}

export function currentUrl(cwd: string): string | null {
  if (!state) return null
  const token = tokenFor(cwd)
  if (!state.tokens.has(token)) return null
  return `http://127.0.0.1:${state.port}/?ws=${token}`
}

/** 仅供测试：关闭服务并复位单例。 */
export async function shutdownForTests(): Promise<void> {
  if (!state) return
  const s = state
  state = null
  for (const set of s.sse.values()) {
    for (const res of set) {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
  }
  await new Promise<void>((resolve) => s.server.close(() => resolve()))
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

const ASSET_TYPES: Record<string, string> = {
  'canvas.js': 'application/javascript; charset=utf-8',
  'canvas.css': 'text/css; charset=utf-8',
  'frames-worker.js': 'application/javascript; charset=utf-8',
  'canvas.js.map': 'application/json; charset=utf-8',
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    routeRequest(req, res)
  } catch (err) {
    console.error('[tianshu-redraw] 请求处理失败：', err)
    if (res.headersSent) res.destroy()
    else send(res, 500, 'text/plain; charset=utf-8', 'internal error')
  }
}

function routeRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const host = req.headers.host
  if (!host || !isLocalHost(host)) return send(res, 403, 'text/plain; charset=utf-8', 'forbidden host')
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://127.0.0.1')
  } catch {
    return send(res, 400, 'text/plain; charset=utf-8', 'bad request')
  }
  const path = url.pathname

  if (req.method === 'GET' && path === '/healthz') return send(res, 200, 'text/plain; charset=utf-8', 'ok')
  if (req.method === 'GET' && path === '/') return serveStatic(res, 'index.html')

  if (req.method === 'GET' && path.startsWith('/assets/')) {
    const name = path.slice('/assets/'.length)
    if (name in ASSET_TYPES) return serveStatic(res, name, ASSET_TYPES[name])
    return send(res, 404, 'text/plain; charset=utf-8', 'not found')
  }

  // ffmpeg wasm 核心（提交进仓库，离线可用）
  if (req.method === 'GET' && path.startsWith('/ffmpeg/')) {
    const name = path.slice('/ffmpeg/'.length)
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return send(res, 400, 'text/plain; charset=utf-8', 'bad name')
    const type = name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'application/octet-stream'
    return serveFile(res, join(FFMPEG_DIR, name), type)
  }

  if (req.method === 'GET' && path === '/api/project') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'unknown workspace' }))
    const issue = projectIssue(cwd)
    const p = readProject(cwd)
    return sendJson(res, { ...p, jobs: activeJobs(cwd).map(jobView), ...(issue ? { issue } : {}), gate: pendingGate(p) })
  }

  if (req.method === 'GET' && path === '/api/config') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'unknown workspace' }))
    return sendJson(res, redactConfig(readConfig(cwd)))
  }

  if (req.method === 'GET' && path === '/api/events') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'text/plain; charset=utf-8', 'unknown workspace')
    return handleSse(res, tokenFor(cwd))
  }

  // 帧图片（抽帧结果 / 宫格总览）
  if (req.method === 'GET' && path === '/api/media') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'text/plain; charset=utf-8', 'unknown workspace')
    const rel = url.searchParams.get('path') ?? ''
    // 只允许 .tianshu-redraw/ 下的相对路径，且无 ..
    if (!rel.startsWith('.tianshu-redraw/') || rel.includes('..')) return send(res, 400, 'text/plain; charset=utf-8', 'bad path')
    const abs = mediaAbs(cwd, rel)
    if (!existsSync(abs)) return send(res, 404, 'text/plain; charset=utf-8', 'not found')
    const ext = rel.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? ''
    return serveFile(res, abs, mimeFromExt(ext))
  }

  // 源视频流（Range 支持）
  if (req.method === 'GET' && path === '/api/source-video') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'text/plain; charset=utf-8', 'unknown workspace')
    const p = readProject(cwd)
    if (p.source.mode !== 'video' || !p.source.videoPath) return send(res, 404, 'text/plain; charset=utf-8', 'no source video')
    return streamVideo(req, res, mediaAbs(cwd, p.source.videoPath))
  }

  if (req.method === 'GET' && path === '/api/selection') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'unknown workspace' }))
    return sendJson(res, { selection: readSelection(cwd) })
  }

  if (req.method === 'POST') {
    if (String(req.headers[MUTATION_HEADER] ?? '') !== '1') return send(res, 403, 'text/plain; charset=utf-8', 'missing header')
    if (path === '/api/viewport') return handleViewport(req, res)
    if (path === '/api/selection') return handleSelection(req, res)
    if (path === '/api/pipeline') return handlePipeline(req, res)
    if (path === '/api/config') return handleConfig(req, res)
    if (path === '/api/frames') return handleFrames(req, res)
    if (path === '/api/frames/contact') return handleContactSheet(req, res)
    if (path === '/api/frames/status') return handleFramesStatus(req, res)
    if (path === '/api/edges') return handleEdges(req, res)
  }

  return send(res, 404, 'text/plain; charset=utf-8', 'not found')
}

// ---------------------------------------------------------------------------
// 变更路由
// ---------------------------------------------------------------------------

function readJsonBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  onBody: (body: Record<string, unknown>) => void,
  maxBytes = MAX_BODY,
): void {
  let raw = ''
  let rejected = false
  req.setEncoding('utf8')
  req.on('error', () => {})
  req.on('data', (chunk: string) => {
    if (rejected) return
    raw += chunk
    if (raw.length > maxBytes) {
      rejected = true
      raw = ''
      const drain = setTimeout(() => req.destroy(), BODY_DRAIN_MS)
      drain.unref()
      req.once('close', () => clearTimeout(drain))
      send(res, 413, 'application/json; charset=utf-8', JSON.stringify({ error: 'body too large' }))
    }
  })
  req.on('end', () => {
    if (rejected || res.writableEnded || res.headersSent) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw || '{}')
    } catch {
      return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'bad json' }))
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'bad json' }))
    }
    const body = parsed as Record<string, unknown>
    try {
      const cwd = resolveCwd(typeof body.ws === 'string' ? body.ws : null)
      if (!cwd) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'unknown workspace' }))
      onBody({ ...body, __cwd: cwd })
    } catch (err) {
      if (err instanceof InvalidInputError) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: err.message }))
      console.error('[tianshu-redraw] 请求处理失败：', err)
      if (res.headersSent) res.destroy()
      else send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'internal error' }))
    }
  })
}

function handleSelection(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const kind = String(body.kind ?? 'none')
    const id = typeof body.id === 'string' ? body.id : undefined
    if (id) assertSafeId(id)
    const selection: Selection = { kind: (['shot', 'asset', 'board', 'video', 'frame'] as const).includes(kind as never) ? (kind as Selection['kind']) : 'none', ...(id ? { id } : {}), at: Date.now() }
    writeSelection(cwd, selection)
    return sendJson(res, { ok: true })
  })
}

function handlePipeline(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const op = String(body.op ?? '')
    if (op === 'set_step') {
      const step = String(body.step ?? '')
      if (!STEP_IDS.includes(step as StepId)) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'bad step' }))
      mutateProject(cwd, (p) => {
        p.pipeline.currentStep = step as StepId
      })
      return sendJson(res, { ok: true })
    }
    if (op === 'answer_gate') {
      const step = String(body.step ?? '')
      if (!STEP_IDS.includes(step as StepId)) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'bad step' }))
      mutateProject(cwd, (p) => {
        const g = p.pipeline.steps[step as StepId].gate ?? { asked: true, answered: false }
        p.pipeline.steps[step as StepId].gate = { ...g, asked: true, answered: true, answer: typeof body.answer === 'string' ? body.answer : 'approved' }
      })
      return sendJson(res, { ok: true })
    }
    return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: `unknown op: ${op}` }))
  })
}

function handleConfig(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const patch = (body.patch ?? {}) as Record<string, unknown>
    const next = updateConfig(cwd, patch as Parameters<typeof updateConfig>[1])
    return sendJson(res, redactConfig(next))
  })
}

function handleFrames(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const op = String(body.op ?? 'add')
    if (op === 'add') {
      const index = Number(body.index)
      const tSec = Number(body.tSec)
      const dataUri = String(body.data ?? '')
      const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUri)
      if (!m) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'bad image data' }))
      const id = newFrameId()
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
      const path = writeMedia(cwd, `frames/${id}.${ext}`, Buffer.from(m[2]!, 'base64'))
      mutateProject(cwd, (p) => {
        const frame: FrameItem = { id, index: Number.isFinite(index) ? index : p.frames.length, tSec: Number.isFinite(tSec) ? tSec : 0, path, width: Number(body.width) || 0, height: Number(body.height) || 0, selected: false }
        p.frames.push(frame)
      })
      projectEvents.emit('frames', { cwd })
      return sendJson(res, { ok: true, id, path })
    }
    if (op === 'select') {
      const id = String(body.id ?? '')
      if (id) assertSafeId(id)
      mutateProject(cwd, (p) => {
        const f = p.frames.find((x) => x.id === id)
        if (f) f.selected = body.selected === true
      })
      return sendJson(res, { ok: true })
    }
    if (op === 'clear') {
      mutateProject(cwd, (p) => {
        p.frames = []
        p.extractRequest = undefined
      })
      projectEvents.emit('frames', { cwd })
      return sendJson(res, { ok: true })
    }
    return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: `unknown op: ${op}` }))
  })
}

function handleContactSheet(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const dataUri = String(body.data ?? '')
    const m = /^data:image\/(\w+);base64,(.*)$/s.exec(dataUri)
    if (!m) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'bad image data' }))
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
    const path = writeMedia(cwd, `frames/_contact/sheet-${Date.now()}.${ext}`, Buffer.from(m[2]!, 'base64'))
    mutateProject(cwd, (p) => {
      p.frames.push({ id: `sheet-${Date.now().toString(36)}`, index: -1, tSec: 0, path, width: Number(body.width) || 0, height: Number(body.height) || 0, selected: false })
      if (p.extractRequest) p.extractRequest = { ...p.extractRequest, status: 'done', message: '抽帧完成' }
      p.pipeline.steps.frames.status = 'done'
    })
    projectEvents.emit('frames', { cwd })
    return sendJson(res, { ok: true, path })
  })
}

function handleFramesStatus(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const status = String(body.status ?? 'running')
    const message = typeof body.message === 'string' ? body.message : undefined
    mutateProject(cwd, (p) => {
      if (p.extractRequest) p.extractRequest = { ...p.extractRequest, status: (status === 'error' ? 'error' : status === 'done' ? 'done' : 'running'), ...(message ? { message } : {}) }
      if (status === 'error') p.pipeline.steps.frames.status = 'active'
    })
    projectEvents.emit('frames', { cwd })
    return sendJson(res, { ok: true })
  })
}

function handleEdges(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const op = String(body.op ?? '')
    const source = typeof body.source === 'string' ? body.source : ''
    const target = typeof body.target === 'string' ? body.target : ''
    if (!source || !target) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'missing source or target' }))
    if (op === 'add') return sendJson(res, { ok: true, edge: addEdge(cwd, source, target, typeof body.label === 'string' ? body.label : undefined) })
    if (op === 'remove') {
      removeEdge(cwd, source, target)
      return sendJson(res, { ok: true })
    }
    return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: `unknown op: ${op}` }))
  })
}

function handleViewport(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(
    req,
    res,
    (body) => {
      const cwd = String(body.__cwd)
      setViewport(cwd, { x: Number(body.x) || 0, y: Number(body.y) || 0, zoom: Number(body.zoom) > 0 ? Number(body.zoom) : 1 })
      return sendJson(res, { ok: true })
    },
    MAX_VIEWPORT_BODY,
  )
}

function jobView(j: { id: string; kind: string; status: string; progress: number; message: string; error?: string }): Record<string, unknown> {
  return { id: j.id, kind: j.kind, status: j.status, progress: j.progress, message: j.message, ...(j.error ? { error: j.error } : {}) }
}

// ---------------------------------------------------------------------------
// 流式 / 静态
// ---------------------------------------------------------------------------

function streamVideo(req: http.IncomingMessage, res: http.ServerResponse, abs: string): void {
  if (!existsSync(abs) || !statSync(abs).isFile()) return send(res, 404, 'text/plain; charset=utf-8', 'not found')
  const size = statSync(abs).size
  const ext = abs.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? 'mp4'
  const type = mimeFromExt(ext)
  const range = req.headers.range
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      const start = m[1] ? Number(m[1]) : 0
      const end = m[2] ? Number(m[2]) : size - 1
      if (start >= size || end >= size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` })
        res.end()
        return
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff',
      })
      createReadStream(abs, { start, end }).pipe(res)
      return
    }
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' })
  createReadStream(abs).pipe(res)
}

function serveFile(res: http.ServerResponse, abs: string, type: string): void {
  if (!existsSync(abs) || !statSync(abs).isFile()) return send(res, 404, 'text/plain; charset=utf-8', 'not found')
  res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
  createReadStream(abs).pipe(res)
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

function handleSse(res: http.ServerResponse, token: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 2000\n\n')
  const s = state
  if (!s) {
    res.end()
    return
  }
  const set = s.sse.get(token) ?? new Set<http.ServerResponse>()
  set.add(res)
  s.sse.set(token, set)
  const keepAlive = setInterval(() => {
    try {
      res.write(': ka\n\n')
    } catch {
      /* ignore */
    }
  }, 25000)
  keepAlive.unref()
  res.on('close', () => {
    clearInterval(keepAlive)
    set.delete(res)
  })
}

function broadcast(s: ServerState, token: string, event = 'project'): void {
  const set = s.sse.get(token)
  if (!set) return
  const frame = `event: ${event}\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`
  for (const res of set) {
    try {
      res.write(frame)
    } catch {
      /* client gone */
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resolveCwd(token: string | null): string | null {
  if (!token || !state) return null
  return state.tokens.get(token) ?? null
}

function isLocalHost(host: string): boolean {
  const name = host.split(':')[0]?.toLowerCase()
  return name === '127.0.0.1' || name === 'localhost'
}

function serveStatic(res: http.ServerResponse, name: string, type = 'text/html; charset=utf-8'): void {
  const file = join(WEB_DIR, name)
  if (!existsSync(file)) return send(res, 404, 'text/plain; charset=utf-8', 'asset not built')
  const headers: Record<string, string> = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' }
  if (name === 'index.html') {
    headers['Content-Security-Policy'] =
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; child-src 'self' blob:"
  }
  res.writeHead(200, headers)
  res.end(readFileSync(file))
}

function sendJson(res: http.ServerResponse, body: unknown): void {
  send(res, 200, 'application/json; charset=utf-8', JSON.stringify(body))
}

function send(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' })
  res.end(body)
}

export { contactDir, framesDir }
