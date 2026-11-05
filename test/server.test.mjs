/**
 * 本地服务测试：健康检查、ffmpeg 资源 MIME、CSP、CSRF 头、媒体路由、源视频 Range。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const entry = pathToFileURL(join(root, 'dist', 'index.js')).href
const { tools } = await loadPlugin(entry)

const cwd = mkdtempSync(join(tmpdir(), 'tsr-srv-'))
try {
  const open = await tools.redraw_open.execute({ input: { port: 0 }, cwd })
  const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]+/)?.[0]
  assert.ok(url, '应返回画布 URL')
  const base = url.slice(0, url.indexOf('/?ws='))
  const ws = url.slice(url.indexOf('ws=') + 3)

  assert.equal((await fetch(`${base}/healthz`)).status, 200)

  // index.html CSP 应允许 wasm + worker
  const index = await fetch(`${base}/`)
  const csp = index.headers.get('content-security-policy') ?? ''
  assert.match(csp, /wasm-unsafe-eval/, 'CSP 应允许 wasm-unsafe-eval')
  assert.match(csp, /worker-src 'self' blob:/, 'CSP 应允许 worker-src blob:')

  // ffmpeg wasm 资源 MIME
  const wasm = await fetch(`${base}/ffmpeg/ffmpeg-core.wasm`)
  assert.equal(wasm.status, 200)
  assert.equal(wasm.headers.get('content-type'), 'application/wasm')

  // 变更路由缺 CSRF 头 → 403
  const noHeader = await fetch(`${base}/api/pipeline?ws=${ws}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'set_step', step: 'frames' }),
  })
  assert.equal(noHeader.status, 403, '缺 CSRF 头应被拒')

  // 源视频 Range 支持
  const srcDir = join(cwd, '.tianshu-redraw', 'assets', 'source')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'source.mp4'), Buffer.alloc(2048, 7))
  await tools.redraw_frames_ingest.execute({ input: { story: 'x' }, cwd })
  const projPath = join(cwd, '.tianshu-redraw', 'project.json')
  const proj = JSON.parse(readFileSync(projPath, 'utf8'))
  proj.source = { mode: 'video', videoPath: '.tianshu-redraw/assets/source/source.mp4' }
  writeFileSync(projPath, JSON.stringify(proj, null, 2), 'utf8')

  const ranged = await fetch(`${base}/api/source-video?ws=${ws}`, { headers: { Range: 'bytes=0-99' } })
  assert.equal(ranged.status, 206, '应支持 Range')
  assert.match(ranged.headers.get('content-range') ?? '', /bytes 0-99\/2048/)

  console.log('OK 服务: 健康检查 / CSP / wasm MIME / CSRF / 源视频 Range')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
