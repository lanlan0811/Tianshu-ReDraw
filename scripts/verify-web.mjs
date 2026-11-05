/**
 * 端到端验证（真实浏览器）：启动本地服务、写入一个镜头，用无头浏览器打开画布，
 * 断言 React Flow 真正渲染、镜头节点出现、iframe 指向分镜页、背景为深黑、无 JS 报错。
 *
 * 用法：
 *   node scripts/verify-web.mjs                 # 自动探测 Chrome/Edge
 *   node scripts/verify-web.mjs <chrome.exe>    # 指定浏览器
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installFakeSdk, wrapTool } from '../test/helpers/host.mjs'

const CANDIDATES = [
  process.argv[2],
  process.env.TIANSHU_REDRAW_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

const exe = CANDIDATES.find((p) => existsSync(p))
if (!exe) {
  console.error('未找到 Chrome/Edge。用法：node scripts/verify-web.mjs <chrome.exe>')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
const brand = installFakeSdk()
const mod = await import(pathToFileURL(join(root, 'dist', 'index.js')).href)
const def = mod.default
if (!def || !def[brand]) throw new Error('入口未通过 TPI 品牌校验')
const api = await def.activate({ log: { debug() {}, warn() {} } })
const tools = Object.fromEntries((api.tools ?? []).map((t) => [t.name, wrapTool(def.id, t)]))

const cwd = mkdtempSync(join(tmpdir(), 'tsr-e2e-'))
let proc
try {
  const open = await tools.redraw_open.execute({ input: { port: 0 }, cwd })
  const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]+/)?.[0]
  if (!url) throw new Error('未拿到画布 URL')

  await tools.redraw_upsert_shot.execute({
    input: { html: '<h1 style="color:#fff">分镜 E2E</h1>', title: '镜头 E2E', aspect: 'portrait' },
    cwd,
  })

  const puppeteer = (await import('puppeteer-core')).default
  const userDataDir = mkdtempSync(join(tmpdir(), 'tsr-e2e-prof-'))
  proc = spawn(
    exe,
    ['--remote-debugging-port=0', '--no-sandbox', '--headless=new', '--hide-scrollbars', `--user-data-dir=${userDataDir}`, 'about:blank'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )
  const portFile = join(userDataDir, 'DevToolsActivePort')
  const deadline = Date.now() + 30000
  let wsEndpoint = ''
  while (Date.now() < deadline && !wsEndpoint) {
    if (existsSync(portFile)) {
      const lines = readFileSync(portFile, 'utf8').split('\n')
      if (lines[0] && lines[1]) wsEndpoint = `ws://127.0.0.1:${lines[0].trim()}${lines[1].trim()}`
    }
    if (!wsEndpoint) await new Promise((r) => setTimeout(r, 100))
  }
  if (!wsEndpoint) throw new Error('等待浏览器调试端口超时')

  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.waitForSelector('.shot-node', { timeout: 15000 })
    await page.waitForSelector('.react-flow__viewport', { timeout: 10000 })

    const info = await page.evaluate(() => {
      const node = document.querySelector('.shot-node')
      const iframe = document.querySelector('.shot-node__iframe')
      const bodyBg = getComputedStyle(document.body).backgroundColor
      const canvasBg = getComputedStyle(document.querySelector('.rd-canvas') || document.body).backgroundColor
      return {
        hasNode: !!node,
        iframeSrc: iframe ? iframe.getAttribute('src') : null,
        bodyBg,
        canvasBg,
        minimap: !!document.querySelector('.rd-minimap'),
        title: document.querySelector('.shot-node__title')?.textContent ?? '',
      }
    })

    const fail = (m) => {
      console.error('E2E 失败：' + m)
      process.exitCode = 1
    }
    if (!info.hasNode) fail('未渲染镜头节点')
    if (!info.iframeSrc?.startsWith('/shot/')) fail('iframe 未指向分镜页：' + info.iframeSrc)
    if (!info.minimap) fail('未渲染 MiniMap')
    // 深黑背景：rgb 分量都应很低
    const dark = (c) => {
      const m = c.match(/(\d+),\s*(\d+),\s*(\d+)/)
      return m && Number(m[1]) < 40 && Number(m[2]) < 40 && Number(m[3]) < 40
    }
    if (!dark(info.bodyBg)) fail('body 背景不是深黑：' + info.bodyBg)
    if (errors.length) fail('页面有 JS 报错：\n' + errors.join('\n'))

    if (!process.exitCode) {
      console.log('OK E2E: React Flow 渲染 / 镜头节点 / iframe 指向分镜页 / 深黑背景（body ' + info.bodyBg + '）/ 无 JS 报错')
    }
  } finally {
    await browser.close().catch(() => {})
  }
} finally {
  try {
    if (proc && proc.pid) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } catch {
    /* ignore */
  }
  rmSync(cwd, { recursive: true, force: true })
}
