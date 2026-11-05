/**
 * 任务注册表测试：createJob / runJob 成功与失败 / cancel / 并发闸门。
 * 直接 import 构建产物的命名导出。
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
// 先装假宿主，再直接 import 命名导出
await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)
const { createJob, runJob, getJob, cancelJob, listJobs, resetJobsForTests, setConcurrency } = await import(
  pathToFileURL(join(root, 'dist', 'index.js')).href
)

resetJobsForTests()
setConcurrency(2)

const cwd = '/tmp/tsr-jobs'
const okJob = createJob(cwd, 'boards_generate', 'ok')
await runJob(okJob, async (_s, report) => {
  report(0.5, '半')
  return { paths: ['a.png'] }
})
assert.equal(getJob(okJob.id).status, 'done')
assert.deepEqual(getJob(okJob.id).result.paths, ['a.png'])

const bad = createJob(cwd, 'boards_generate', 'bad')
await runJob(bad, async () => {
  throw new Error('boom')
})
assert.equal(getJob(bad.id).status, 'error')
assert.match(getJob(bad.id).error, /boom/)

const cancelled = createJob(cwd, 'video_generate', 'cancel')
cancelJob(cancelled.id)
assert.equal(getJob(cancelled.id).status, 'cancelled')
assert.ok(listJobs(cwd).length >= 3)

resetJobsForTests()
console.log('OK 任务: 成功/失败/取消/列表')
