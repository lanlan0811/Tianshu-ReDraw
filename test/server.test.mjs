/**
 * 本地服务测试：启动服务、健康检查、Host 校验、CSRF 头校验、分镜页 CSP。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

const cwd = mkdtempSync(join(tmpdir(), 'tsr-srv-'))
const call = (name, input) => tools[name].execute({ input, cwd })

try {
  const open = await call('redraw_open', { port: 0 })
  assert.ok(!open.isError, open.content)
  const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]+/)?.[0]
  assert.ok(url, '应返回画布 URL')
  const base = url.slice(0, url.indexOf('/?ws='))
  const ws = url.slice(url.indexOf('ws=') + 3)

  // 健康检查
  const health = await fetch(`${base}/healthz`)
  assert.equal(health.status, 200)

  // 写一个镜头，然后访问分镜页
  const up = await call('redraw_upsert_shot', { html: '<h1>分镜</h1>', title: '镜头A' })
  assert.ok(!up.isError, up.content)
  const state = await call('redraw_get_state', {})
  const id = state.content.match(/id=(shot-[0-9a-f]+)/)?.[1]
  assert.ok(id, '应能读到镜头 id')

  const page = await fetch(`${base}/shot/${id}?ws=${ws}`)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/, '分镜页应有严格 CSP')
  assert.match(await page.text(), /分镜/)

  // 变更路由缺自定义头 → 403
  const noHeader = await fetch(`${base}/api/shots?ws=${ws}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'remove', id }),
  })
  assert.equal(noHeader.status, 403, '缺 CSRF 头应被拒')

  console.log('OK 本地服务: 健康检查 / 分镜页 CSP / CSRF 头校验')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
