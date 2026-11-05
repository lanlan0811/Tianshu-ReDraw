/**
 * lifecycle 测试：turnStart 注入状态块（根标签前缀正确），无项目/无触发词时不注入。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const entry = pathToFileURL(join(root, 'dist', 'index.js')).href

// 有项目：注入完整状态块
{
  const cwd = mkdtempSync(join(tmpdir(), 'tsr-lc-'))
  try {
    const { lifecycle, blocks, tools } = await loadPlugin(entry, { cwd })
    await tools.redraw_frames_ingest.execute({ input: { story: '测试剧情' }, cwd })
    lifecycle.turnStart({ userInput: '继续转绘短剧' })
    const block = blocks[blocks.length - 1]
    assert.ok(block, '应注入状态块')
    assert.match(block, /^<tianshu-redraw-state>/)
    assert.match(block, /<\/tianshu-redraw-state>$/)
    assert.match(block, /<pipeline>/)
    console.log('OK lifecycle: turnStart 注入 <tianshu-redraw-state>')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

// 无项目 + 无触发词：清除块
{
  const cwd = mkdtempSync(join(tmpdir(), 'tsr-lc2-'))
  try {
    const { lifecycle, blocks } = await loadPlugin(entry, { cwd })
    lifecycle.turnStart({ userInput: '今天天气不错' })
    assert.equal(blocks[blocks.length - 1], null, '无关输入应清除块')
    console.log('OK lifecycle: 无关输入不注入')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}
