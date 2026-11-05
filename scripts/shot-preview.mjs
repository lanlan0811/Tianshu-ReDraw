/** 本地预览截图（开发用）：起服务、写 3 个示例镜头、无头浏览器截整张画布。 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installFakeSdk, wrapTool } from '../test/helpers/host.mjs'

const exe = process.argv[2] ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const root = resolve(import.meta.dirname, '..')
const brand = installFakeSdk()
const mod = await import(pathToFileURL(join(root, 'dist', 'index.js')).href)
const api = await mod.default.activate({ log: { debug() {}, warn() {} } })
const tools = Object.fromEntries((api.tools ?? []).map((t) => [t.name, wrapTool('tianshu-redraw', t)]))

const cwd = mkdtempSync(join(tmpdir(), 'tsr-shot-'))
const open = await tools.redraw_open.execute({ input: { port: 0 }, cwd })
const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]+/)[0]

const card = (t, sc, lines) => ({
  html:
    `<div style="font-family:system-ui;height:100%;padding:16px;color:#e8e8ea;background:linear-gradient(160deg,#141821,#0b0d12)">` +
    `<div style="font-size:11px;color:#ff6a3d;letter-spacing:.1em">${sc}</div>` +
    `<h2 style="margin:6px 0 10px;font-size:17px">${t}</h2>` +
    `<div style="font-size:12px;line-height:1.7;color:#aab">${lines}</div></div>`,
  title: t,
  aspect: 'portrait',
})

await tools.redraw_upsert_shot.execute({ input: card('镜头01 · 天台', 'SCENE 01', '<b>画面</b>：夜景天台，主角背身而立<br><b>台词</b>：「这一次，我不会再退。」<br><b>运镜</b>：缓推 + 轻微手持'), cwd })
await tools.redraw_upsert_shot.execute({ input: card('镜头02 · 回望', 'SCENE 02', '<b>画面</b>：主角侧脸回望，霓虹映在眼底<br><b>台词</b>：「你还在等吗？」<br><b>运镜</b>：环绕半圈'), cwd })
await tools.redraw_upsert_shot.execute({ input: card('镜头03 · 独白', 'SCENE 03', '<b>画面</b>：空旷街道，雨丝落下<br><b>旁白</b>：有些话，说出口就回不去了。<br><b>运镜</b>：静止 + 微俯'), cwd })

const puppeteer = (await import('puppeteer-core')).default
const udd = mkdtempSync(join(tmpdir(), 'tsr-shot-prof-'))
const proc = spawn(exe, ['--remote-debugging-port=0', '--no-sandbox', '--headless=new', '--hide-scrollbars', `--user-data-dir=${udd}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
const pf = join(udd, 'DevToolsActivePort')
let ws = ''
const dl = Date.now() + 30000
while (Date.now() < dl && !ws) {
  if (existsSync(pf)) {
    const l = readFileSync(pf, 'utf8').split('\n')
    if (l[0] && l[1]) ws = `ws://127.0.0.1:${l[0].trim()}${l[1].trim()}`
  }
  if (!ws) await new Promise((r) => setTimeout(r, 100))
}
const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
await page.waitForSelector('.shot-node', { timeout: 15000 })
await new Promise((r) => setTimeout(r, 1500))
const out = join(root, '.claude', 'redraw-canvas.png')
await page.screenshot({ path: out })
console.log('shot ->', out)
await browser.close().catch(() => {})
spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
rmSync(cwd, { recursive: true, force: true })
