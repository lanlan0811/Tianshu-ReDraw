/** 本地预览截图（开发用）：起服务、写示例数据、无头浏览器截图各步骤。 */
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

await tools.redraw_frames_ingest.execute({ input: { story: '雨夜。男主独自站在天台，霓虹在雨中晕开。他等的人始终没有出现。' }, cwd })
await tools.redraw_style_set.execute({ input: { style_id: 'anime-jp' }, cwd })
await tools.redraw_localize_set.execute({ input: { region: '日本', checklist: { costume: '现代都市便服，冷色调', architecture: '高层公寓、天台护栏', festival: '无', taboos: '避免特定宗教符号', colorPreference: '霓虹蓝紫 + 冷白' } }, cwd })
await tools.redraw_script_upsert.execute({
  input: {
    episodes: [{ title: '雨夜', logline: '一次没有结果的等待', synopsis: '男主在雨夜的天台等待一个不会来的人。', scenes: [{ slug: '天台 · 夜', location: '天台', timeOfDay: '夜', summary: '男主背身而立，雨落', beats: ['站立', '回望', '独白'] }] }],
  },
  cwd,
})
await tools.redraw_shotlist_upsert.execute({
  input: {
    shots: [
      { index: 0, durationSec: 3, shotSize: '远景', cameraMove: '缓推', scene: '天台', characters: ['男主'], props: ['伞'], description: '雨夜天台，男主背身而立', dialogue: '这一次，我不会再退。', emotion: '决绝' },
      { index: 1, durationSec: 4, shotSize: '特写', cameraMove: '固定', scene: '天台', characters: ['男主'], props: [], description: '雨水顺着下颌滑落，眼神坚定', emotion: '坚定' },
    ],
  },
  cwd,
})
await tools.redraw_assets_upsert.execute({
  input: {
    assets: [
      { kind: 'character', name: '男主', spec: '27岁，冷峻寡言，黑色风衣', prompt: 'young man, cold gaze, black trench coat, anime style', variants: [{ name: '湿发', prompt: 'wet hair, rain' }, { name: '微笑', prompt: 'faint smile' }] },
      { kind: 'prop', name: '黑伞', spec: '长柄黑伞', prompt: 'black long umbrella' },
      { kind: 'scene', name: '天台', spec: '夜色，霓虹，雨', prompt: 'rooftop at night, neon lights, rain' },
    ],
  },
  cwd,
})

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
await page.waitForSelector('.rd-nav__item', { timeout: 15000 })
await new Promise((r) => setTimeout(r, 800))

// 依次点击步骤截图
const steps = ['抽帧看片', '风格本土化', '剧本', '分镜表', '资产', '出图出片']
for (let i = 0; i < steps.length; i++) {
  await page.evaluate((label) => {
    const items = [...document.querySelectorAll('.rd-nav__item')]
    const el = items.find((e) => e.textContent?.includes(label))
    if (el) el.click()
  }, steps[i])
  await new Promise((r) => setTimeout(r, 400))
  await page.screenshot({ path: join(root, '.claude', `redraw-step${i + 1}.png`) })
}
console.log('shots ->', join(root, '.claude', 'redraw-step1..6.png'))
await browser.close().catch(() => {})
spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
rmSync(cwd, { recursive: true, force: true })
