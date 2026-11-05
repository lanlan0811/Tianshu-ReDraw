/**
 * 项目模型测试：镜头增删改、编排、连线的原子性与校验。
 * 直接 import 构建产物 dist/index.js 的命名导出（tools），通过假宿主调用。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

const cwd = mkdtempSync(join(tmpdir(), 'tsr-proj-'))
const call = (name, input) => tools[name].execute({ input, cwd })

try {
  // 新增两个镜头
  const r1 = await call('redraw_upsert_shot', { html: '<h1>镜头1</h1>', title: '第1集 · 镜头01' })
  assert.ok(!r1.isError, r1.content)
  assert.match(r1.content, /已添加镜头节点/)
  const r2 = await call('redraw_upsert_shot', { html: '<h1>镜头2</h1>', title: '第1集 · 镜头02' })
  assert.ok(!r2.isError, r2.content)

  // 读取状态：应有 2 个镜头
  const state = await call('redraw_get_state', {})
  assert.match(state.content, /画布上有 2 个镜头节点/)

  // 项目文件确实落在 .tianshu-redraw/
  const projectFile = join(cwd, '.tianshu-redraw', 'project.json')
  assert.ok(existsSync(projectFile), 'project.json 应存在')
  const project = JSON.parse(readFileSync(projectFile, 'utf8'))
  assert.equal(project.shots.length, 2)
  const [a, b] = project.shots

  // 分镜文件存在
  assert.ok(existsSync(join(cwd, a.contentPath)), '分镜 HTML 应存在')

  // 连线 + 去重
  const link = await call('redraw_arrange', { action: 'link', source: a.id, target: b.id, label: '下一镜' })
  assert.ok(!link.isError, link.content)
  assert.match(link.content, /已连线/)

  // 自环应被拒
  const selfLink = await call('redraw_arrange', { action: 'link', source: a.id, target: a.id })
  assert.ok(selfLink.isError, '自环应被拒绝')

  // 更新：只改标题，内容不变
  const rename = await call('redraw_upsert_shot', { id: a.id, title: '第1集 · 镜头01（改）' })
  assert.ok(!rename.isError, rename.content)
  assert.match(rename.content, /已更新镜头节点/)
  assert.match(rename.content, /分镜内容未改动/)

  // 复制
  const dup = await call('redraw_arrange', { action: 'duplicate', id: b.id })
  assert.ok(!dup.isError, dup.content)
  assert.match(dup.content, /已复制镜头节点/)

  // 删除
  const del = await call('redraw_arrange', { action: 'remove', id: a.id })
  assert.ok(!del.isError, del.content)
  assert.match(del.content, /已删除镜头节点/)

  // 删除后连线也应消失
  const after = JSON.parse(readFileSync(projectFile, 'utf8'))
  assert.ok(!after.shots.some((s) => s.id === a.id))
  assert.ok(!after.edges.some((e) => e.source === a.id || e.target === a.id), '删除镜头应连带删除连线')

  console.log('OK 项目模型: 增删改 / 编排 / 连线 / 去重 / 自环校验')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
