/**
 * v2 项目模型测试：抽帧→本土化→剧本→分镜→资产 的写入、门控、v1→v2 迁移。
 * 直接 import 构建产物的命名导出（tools / buildStateBlock）。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools, lifecycle } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href, { cwd: undefined })

const cwd = mkdtempSync(join(tmpdir(), 'tsr-v2-'))
const call = (name, input) => tools[name].execute({ input, cwd })

try {
  // 素材：文本剧情
  const ingest = await call('redraw_frames_ingest', { story: '雨夜，男主在天台独自等待。' })
  assert.ok(!ingest.isError, ingest.content)
  assert.match(ingest.content, /文本剧情/)

  // 风格
  const styleList = await call('redraw_style_list', {})
  assert.match(styleList.content, /日系动漫/)
  const styleSet = await call('redraw_style_set', { style_id: 'anime-jp' })
  assert.ok(!styleSet.isError, styleSet.content)

  // 本土化
  const loc = await call('redraw_localize_set', { region: '日本', checklist: { costume: '和服', colorPreference: '低饱和' } })
  assert.ok(!loc.isError, loc.content)

  // 剧本：草稿 → 门控待答
  const script = await call('redraw_script_upsert', {
    episodes: [{ title: '第1集', logline: '等待', synopsis: '雨夜独白', scenes: [{ slug: '天台', location: '天台', timeOfDay: '夜', summary: '独白', beats: ['站立', '回望'] }] }],
  })
  assert.ok(!script.isError, script.content)
  assert.match(script.content, /等待确认/)

  let state = await call('redraw_get_state', {})
  assert.match(state.content, /未回答的门控（script）/)

  // 批准剧本
  const approve = await call('redraw_script_approve', {})
  assert.ok(!approve.isError, approve.content)

  // 分镜表
  const shotlist = await call('redraw_shotlist_upsert', {
    shots: [
      { index: 0, durationSec: 3, shotSize: '近景', cameraMove: '缓推', scene: '天台', characters: ['男主'], props: ['伞'], description: '男主背身而立', dialogue: '这一次，我不会再退。', emotion: '决绝' },
      { index: 1, durationSec: 4, shotSize: '特写', cameraMove: '固定', scene: '天台', characters: ['男主'], props: [], description: '眼神特写', emotion: '坚定' },
    ],
  })
  assert.ok(!shotlist.isError, shotlist.content)
  await call('redraw_shotlist_approve', {})

  // 资产
  const assets = await call('redraw_assets_upsert', {
    assets: [
      { kind: 'character', name: '男主', spec: '27岁，冷峻', prompt: 'young man, cold gaze', variants: [{ name: '湿发', prompt: 'wet hair' }] },
      { kind: 'scene', name: '天台', spec: '夜色，霓虹', prompt: 'rooftop at night, neon' },
    ],
  })
  assert.ok(!assets.isError, assets.content)
  const assetList = await call('redraw_assets_list', {})
  assert.match(assetList.content, /男主/)
  assert.match(assetList.content, /湿发/)

  // 项目文件结构
  const pf = join(cwd, '.tianshu-redraw', 'project.json')
  assert.ok(existsSync(pf), 'project.json 应存在')
  const proj = JSON.parse(readFileSync(pf, 'utf8'))
  assert.equal(proj.version, 2)
  assert.equal(proj.shots.length, 2)
  assert.equal(proj.assets.length, 2)
  assert.equal(proj.script.status, 'approved')
  assert.equal(proj.pipeline.steps.shotlist.status, 'done')

  // lifecycle 状态块
  const blocks = []
  const host = { cwd, promptContext: { setBlock: (b) => blocks.push(b) }, log: { debug() {}, warn() {} } }
  const { makeLifecycle } = await import(pathToFileURL(join(root, 'dist', 'index.js')).href)
  // 直接调用 buildStateBlock
  const { buildStateBlock } = await import(pathToFileURL(join(root, 'dist', 'index.js')).href)
  const block = buildStateBlock(cwd)
  assert.match(block, /^<tianshu-redraw-state>/, '状态块根标签必须正确')
  assert.match(block, /shots="2"/)
  assert.match(block, /<\/tianshu-redraw-state>$/)
  void makeLifecycle
  void host

  console.log('OK v2 项目: 素材/风格/本土化/剧本门控/分镜/资产 + 状态块')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}

// ---- v1 → v2 迁移 ----
{
  const cwd1 = mkdtempSync(join(tmpdir(), 'tsr-v1-'))
  try {
    const dir = join(cwd1, '.tianshu-redraw')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'project.json'),
      JSON.stringify({ version: 1, viewport: { x: 5, y: 6, zoom: 1.5 }, shots: [{ id: 'shot-aaaaaaaa', title: '旧镜头', x: 10, y: 20 }], edges: [] }),
      'utf8',
    )
    const st = await tools.redraw_get_state.execute({ input: {}, cwd: cwd1 })
    assert.match(st.content, /镜头 1/, '应读到迁移后的 1 个镜头')
    // 触发一次写入 → 应产生 v1 备份
    await tools.redraw_style_set.execute({ input: { style_id: 'anime-cn' }, cwd: cwd1 })
    const { readdirSync } = await import('node:fs')
    const backups = readdirSync(dir).filter((f) => f.includes('.v1-'))
    assert.ok(backups.length > 0, '应产生 .v1-* 备份')
    const migrated = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
    assert.equal(migrated.version, 2)
    assert.equal(migrated.shots[0].id, 'shot-aaaaaaaa')
    assert.equal(migrated.viewport.zoom, 1.5)
    console.log('OK 迁移: v1 → v2 + 备份 + 保留视口')
  } finally {
    rmSync(cwd1, { recursive: true, force: true })
  }
}

// 显式退出：插件按设计持有长生命周期句柄（本地服务单例 / vendor 子进程），
// node --test 每个文件独立进程，这里主动结束以避免测试进程挂住。
process.exit(0)
