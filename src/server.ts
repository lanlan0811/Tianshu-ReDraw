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
 *  - 分镜 HTML 视为不可信：iframe 无 allow-same-origin + `/shot/:id` 严格 CSP + nosniff。
 *  - 变更路由要求自定义头 `X-Tianshu-Redraw: 1`（跨源无法带自定义头 → 天然防 CSRF）。
 */
import http from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeId, InvalidInputError } from './ids.js'
import {
  addEdge,
  duplicateShot,
  moveShot,
  projectEvents,
  projectIssue,
  readProject,
  readSelection,
  readShotHtml,
  removeEdge,
  removeShot,
  renameShot,
  setViewport,
  writeSelection,
  type Selection,
} from './project.js'

const WEB_DIR = fileURLToPath(new URL('./web/', import.meta.url))

const DEFAULT_PORT = 43187
const MUTATION_HEADER = 'x-tianshu-redraw'
const MAX_BODY = 4 * 1024 * 1024
/** 视口请求体很小，沿用比通用 JSON 更紧的上限。 */
const MAX_VIEWPORT_BODY = 4096
/** 超限响应发出后，最多再等这么久让客户端发完请求体。 */
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
    projectEvents.on('change', ({ cwd: changed }: { cwd: string }) => {
      broadcast(created, tokenFor(changed), 'project')
    })
    projectEvents.on('selection', ({ cwd: changed }: { cwd: string }) => {
      broadcast(created, tokenFor(changed), 'selection')
    })
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
  'canvas.js.map': 'application/json; charset=utf-8',
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    routeRequest(req, res)
  } catch (err) {
    // 同步异常（例如读分镜文件失败）不能打垮进程。
    console.error('[tianshu-redraw] 请求处理失败：', err)
    // 响应头已发出时无法再改状态码，只能断开，否则客户端会一直挂起。
    if (res.headersSent) res.destroy()
    else send(res, 500, 'text/plain; charset=utf-8', 'internal error')
  }
}

function routeRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const host = req.headers.host
  if (!host || !isLocalHost(host)) {
    return send(res, 403, 'text/plain; charset=utf-8', 'forbidden host')
  }
  // 基址只用于解析路径和查询串。'//' 这样的请求路径会让 new URL 抛错。
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://127.0.0.1')
  } catch {
    return send(res, 400, 'text/plain; charset=utf-8', 'bad request')
  }
  const path = url.pathname

  if (req.method === 'GET' && path === '/healthz') {
    return send(res, 200, 'text/plain; charset=utf-8', 'ok')
  }

  if (req.method === 'GET' && path === '/') {
    return serveStatic(res, 'index.html')
  }

  if (req.method === 'GET' && path.startsWith('/assets/')) {
    const name = path.slice('/assets/'.length)
    if (name in ASSET_TYPES) return serveStatic(res, name, ASSET_TYPES[name])
    return send(res, 404, 'text/plain; charset=utf-8', 'not found')
  }

  if (req.method === 'GET' && path === '/api/project') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'unknown workspace' }))
    const issue = projectIssue(cwd)
    return sendJson(res, { ...readProject(cwd), ...(issue ? { issue } : {}) })
  }

  if (req.method === 'GET' && path === '/api/events') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'text/plain; charset=utf-8', 'unknown workspace')
    return handleSse(res, tokenFor(cwd))
  }

  if (req.method === 'GET' && path.startsWith('/shot/')) {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'text/plain; charset=utf-8', 'unknown workspace')
    let id: string
    try {
      id = decodeURIComponent(path.slice('/shot/'.length))
    } catch (err) {
      // 畸形百分号编码会抛 URIError；不能让它变成未捕获异常。
      if (err instanceof URIError) return send(res, 400, 'text/plain; charset=utf-8', 'bad shot id')
      throw err
    }
    const html = readShotHtml(cwd, id)
    if (html === null) return send(res, 404, 'text/plain; charset=utf-8', 'shot not found')
    return sendUntrustedHtml(res, decorateShotHtml(html))
  }

  if (req.method === 'GET' && path === '/api/selection') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'unknown workspace' }))
    return sendJson(res, { selection: readSelection(cwd) })
  }

  if (req.method === 'GET' && path === '/api/shot-html') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'text/plain; charset=utf-8', 'unknown workspace')
    const html = readShotHtml(cwd, url.searchParams.get('id') ?? '')
    if (html === null) return send(res, 404, 'text/plain; charset=utf-8', 'shot not found')
    return send(res, 200, 'text/plain; charset=utf-8', html)
  }

  if (req.method === 'POST') {
    if (String(req.headers[MUTATION_HEADER] ?? '') !== '1') {
      return send(res, 403, 'text/plain; charset=utf-8', 'missing header')
    }
    if (path === '/api/viewport') return handleViewport(req, res)
    if (path === '/api/selection') return handleSelection(req, res)
    if (path === '/api/shots') return handleShots(req, res)
    if (path === '/api/edges') return handleEdges(req, res)
  }

  return send(res, 404, 'text/plain; charset=utf-8', 'not found')
}

// ---------------------------------------------------------------------------
// 变更路由（body 读取 + 分发）
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
  req.on('error', () => {
    /* 客户端断开，或超限后 destroy */
  })
  req.on('data', (chunk: string) => {
    if (rejected) return
    raw += chunk
    if (raw.length > maxBytes) {
      rejected = true
      raw = ''
      // 带着未读数据断开时系统会发 RST，客户端读不到 413（Windows 上必现）。
      // 所以继续读取并丢弃剩余数据；对方迟迟发不完才断开，避免连接被无限占用。
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
    // JSON 合法不代表是对象：字面量 null 会让后面的属性读取抛错。
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'bad json' }))
    }
    const body = parsed as Record<string, unknown>
    // 这里运行在 end 事件回调内，handleRequest 的 try/catch 接不住，所有变更路由在此统一兜底。
    try {
      const cwd = resolveCwd(typeof body.ws === 'string' ? body.ws : null)
      if (!cwd) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'unknown workspace' }))
      onBody({ ...body, __cwd: cwd })
    } catch (err) {
      if (err instanceof InvalidInputError) {
        return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: err.message }))
      }
      console.error('[tianshu-redraw] 请求处理失败：', err)
      if (res.headersSent) res.destroy()
      else send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'internal error' }))
    }
  })
}

function handleSelection(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const shotId = typeof body.shotId === 'string' ? body.shotId : ''
    const kind = body.kind === 'shot' ? 'shot' : 'element'
    if (!shotId) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'missing shotId' }))
    assertSafeId(shotId)
    const raw = body.payload as Record<string, unknown> | undefined
    const selection: Selection = {
      shotId,
      kind,
      at: Date.now(),
      ...(kind === 'element' && raw
        ? {
            element: {
              xpath: String(raw.xpath ?? ''),
              tagName: String(raw.tagName ?? ''),
              textContent: typeof raw.textContent === 'string' ? raw.textContent : undefined,
              computedStyles:
                raw.computedStyles && typeof raw.computedStyles === 'object'
                  ? (raw.computedStyles as Record<string, string>)
                  : undefined,
            },
          }
        : {}),
    }
    writeSelection(cwd, selection)
    return sendJson(res, { ok: true })
  })
}

function handleShots(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const op = String(body.op ?? '')
    const id = typeof body.id === 'string' ? body.id : ''
    if (op === 'remove') {
      if (!id) throw new InvalidInputError('missing id')
      removeShot(cwd, id)
      return sendJson(res, { ok: true, id })
    }
    if (op === 'rename') {
      if (!id || typeof body.title !== 'string') throw new InvalidInputError('missing id or title')
      renameShot(cwd, id, body.title)
      return sendJson(res, { ok: true, id, title: body.title })
    }
    if (op === 'move') {
      if (!id) throw new InvalidInputError('missing id')
      moveShot(cwd, id, Number(body.x) || 0, Number(body.y) || 0)
      return sendJson(res, { ok: true, id })
    }
    if (op === 'duplicate') {
      if (!id) throw new InvalidInputError('missing id')
      const shot = duplicateShot(cwd, id, typeof body.title === 'string' ? body.title : undefined)
      return sendJson(res, { ok: true, shot })
    }
    return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: `unknown op: ${op}` }))
  })
}

function handleEdges(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const op = String(body.op ?? '')
    const source = typeof body.source === 'string' ? body.source : ''
    const target = typeof body.target === 'string' ? body.target : ''
    if (!source || !target) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'missing source or target' }))
    if (op === 'add') {
      const edge = addEdge(cwd, source, target, typeof body.label === 'string' ? body.label : undefined)
      return sendJson(res, { ok: true, edge })
    }
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
      const x = Number(body.x)
      const y = Number(body.y)
      const zoom = Number(body.zoom)
      setViewport(cwd, {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
      })
      return sendJson(res, { ok: true })
    },
    MAX_VIEWPORT_BODY,
  )
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
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'"
  }
  res.writeHead(200, headers)
  res.end(readFileSync(file))
}

/**
 * 为分镜卡注入一层基础样式：深黑底 + 去边距，使未显式设置背景的卡片融入画布深黑主题。
 * 仅作为默认值——作者样式（更具体的选择器）仍可覆盖。
 */
const SHOT_BASE_STYLE =
  '<style>html,body{margin:0;background:#0b0d10;color:#e6e8ec;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}</style>'

function decorateShotHtml(html: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${SHOT_BASE_STYLE}</head>`)
  const bodyOpen = html.match(/<body[^>]*>/i)
  if (bodyOpen) return html.replace(bodyOpen[0], `${bodyOpen[0]}${SHOT_BASE_STYLE}`)
  return SHOT_BASE_STYLE + html
}

function sendUntrustedHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; " +
      "script-src 'unsafe-inline' 'unsafe-eval'; font-src data:; connect-src 'none'; form-action 'none'",
  })
  res.end(html)
}

function sendJson(res: http.ServerResponse, body: unknown): void {
  send(res, 200, 'application/json; charset=utf-8', JSON.stringify(body))
}

function send(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' })
  res.end(body)
}
