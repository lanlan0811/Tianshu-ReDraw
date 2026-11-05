/**
 * 任务注册表（内存单例）。
 *
 * 为什么是内存：宿主不给插件进度回调/中断信号，长任务（生成图/视频、抽帧）
 * 必须做成「立即返回 jobId + 轮询」。job 不入 project.json（保持单一项目文件），
 * 完成时把结果回写 project.json。
 *
 * 生命周期：模块级单例，跨工具调用存活；每次状态变化 emit 事件供 SSE 广播。
 * 宿主/进程崩溃会丢失运行中的 job（已知取舍）。
 */
import { EventEmitter } from 'node:events'
import { newJobId } from './ids.js'

export type JobKind = 'frames_extract' | 'assets_generate' | 'assets_variant' | 'boards_generate' | 'video_generate'
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface JobResultItem {
  id: string
  path: string
}

export interface Job {
  id: string
  cwd: string
  kind: JobKind
  label: string
  status: JobStatus
  progress: number
  message: string
  startedAt: number
  finishedAt?: number
  error?: string
  result?: { paths: string[]; items?: JobResultItem[] }
  abort: AbortController
}

export const jobEvents = new EventEmitter()
jobEvents.setMaxListeners(0)

const jobs = new Map<string, Job>()
/** 并发上限（防供应商限流）。 */
let concurrency = 2
let running = 0
const queue: Array<() => void> = []

export function setConcurrency(n: number): void {
  concurrency = Math.max(1, Math.round(n))
}

export function createJob(cwd: string, kind: JobKind, label: string): Job {
  const job: Job = {
    id: newJobId(),
    cwd,
    kind,
    label,
    status: 'queued',
    progress: 0,
    message: '排队中',
    startedAt: Date.now(),
    abort: new AbortController(),
  }
  jobs.set(job.id, job)
  emit(cwd)
  return job
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id)
}

export function listJobs(cwd: string): Job[] {
  return [...jobs.values()].filter((j) => j.cwd === cwd).sort((a, b) => b.startedAt - a.startedAt)
}

export function activeJobs(cwd: string): Job[] {
  return listJobs(cwd).filter((j) => j.status === 'queued' || j.status === 'running')
}

function emit(cwd: string): void {
  jobEvents.emit('job', { cwd })
}

export function updateJob(job: Job, patch: Partial<Pick<Job, 'status' | 'progress' | 'message' | 'error' | 'result'>>): void {
  Object.assign(job, patch)
  if (patch.status === 'done' || patch.status === 'error' || patch.status === 'cancelled') {
    job.finishedAt = Date.now()
  }
  emit(job.cwd)
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id)
  if (!job) return false
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return false
  job.abort.abort()
  updateJob(job, { status: 'cancelled', message: '已取消' })
  return true
}

/** 在并发闸门内运行一个任务体；返回 job（状态由 body 负责更新）。 */
export async function runJob(
  job: Job,
  body: (signal: AbortSignal, report: (progress: number, message: string) => void) => Promise<{ paths: string[]; items?: JobResultItem[] }>,
): Promise<void> {
  await acquire()
  if (job.status === 'cancelled') {
    release()
    return
  }
  updateJob(job, { status: 'running', progress: 0, message: '开始' })
  const report = (progress: number, message: string) => {
    if (job.abort.signal.aborted) return
    updateJob(job, { progress: Math.max(0, Math.min(1, progress)), message })
  }
  try {
    const result = await body(job.abort.signal, report)
    if (job.abort.signal.aborted) return
    updateJob(job, { status: 'done', progress: 1, message: '完成', result })
  } catch (err) {
    if (job.abort.signal.aborted) return
    const aborted = job.abort.signal.aborted || (err as Error)?.name === 'AbortError'
    updateJob(job, {
      status: aborted ? 'cancelled' : 'error',
      message: aborted ? '已取消' : '失败',
      error: aborted ? undefined : (err as Error)?.message ?? String(err),
    })
  } finally {
    release()
  }
}

function acquire(): Promise<void> {
  if (running < concurrency) {
    running++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      running++
      resolve()
    })
  })
}

function release(): void {
  running = Math.max(0, running - 1)
  const next = queue.shift()
  if (next) next()
}

/** 仅供测试：清空注册表并复位并发。 */
export function resetJobsForTests(): void {
  jobs.clear()
  queue.length = 0
  running = 0
  concurrency = 2
}
