/**
 * 视频生成编排：逐段生成，不拼接。
 *
 * 用户选定：视频模型 + 每段秒数。mode（图生视频输入模式）由用户/模型能力决定，
 * referenceList 从分镜图/首尾帧/资产图装配。
 */
import { relative } from 'node:path'
import { createJob, runJob, type Job } from '../jobs.js'
import { persistMedia } from '../media.js'
import { readConfig } from '../config.js'
import { getVendorSession, type VendorSession } from '../vendor/runner.js'
import type { VideoConfig, VideoMode, VideoModel } from '../vendor/types.js'
import { newVideoId } from '../ids.js'
import {
  boardsDir,
  mutateProject,
  projectDir,
  readMediaBuffer,
  readProject,
  videosDir,
  type MediaRef,
  type Project,
  type ShotItem,
} from '../project.js'

export interface ActiveVideoVendor {
  vendorId: string
  modelName: string
  model: VideoModel
  session: VendorSession
}

export async function resolveVideoVendor(cwd: string, vendorId?: string, modelName?: string): Promise<ActiveVideoVendor> {
  const cfg = readConfig(cwd)
  const active = vendorId && modelName ? { vendorId, modelName } : cfg.active.video
  if (!active) throw new Error('未配置视频模型：请在 config.json 的 active.video 指定 vendorId 与 modelName，或在调用时传入')
  const entry = cfg.vendors[active.vendorId]
  if (!entry?.trusted) throw new Error(`供应商 ${active.vendorId} 未标记为可信：请在 config.json 的 vendors.${active.vendorId}.trusted 设为 true`)
  const session = await getVendorSession(cwd, active.vendorId, entry.inputValues ?? {})
  const model = session.videoModels.find((m) => m.modelName === active.modelName)
  if (!model) {
    const names = session.videoModels.map((m) => m.modelName).join(', ') || '（无）'
    throw new Error(`供应商 ${active.vendorId} 没有视频模型 ${active.modelName}；可用：${names}`)
  }
  return { vendorId: active.vendorId, modelName: active.modelName, model, session }
}

function refs(cwd: string, paths: string[]): { type: 'image'; sourceType: 'base64'; base64: string }[] {
  const out: { type: 'image'; sourceType: 'base64'; base64: string }[] = []
  for (const p of paths) {
    const buf = readMediaBuffer(cwd, p)
    if (!buf) continue
    const mime = /\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.webp$/i.test(p) ? 'image/webp' : 'image/png'
    out.push({ type: 'image', sourceType: 'base64', base64: `data:${mime};base64,${buf.toString('base64')}` })
  }
  return out
}

function relDirFrom(cwd: string, abs: string): string {
  return relative(projectDir(cwd), abs).split('\\').join('/')
}

/** 从镜头关联的分镜图/首尾帧里挑参考图路径。 */
function pickReferencePaths(project: Project, shot: ShotItem, mode: VideoMode[]): string[] {
  const paths: string[] = []
  const boards = project.boards.filter((b) => b.shotId === shot.id)
  const hasFirstLast = mode.some((m) => m === 'startEndRequired' || m === 'endFrameOptional' || m === 'startFrameOptional')
  for (const b of boards) {
    if (b.kind === 'firstLast' && b.panels) {
      for (const panel of b.panels) if (panel.image) paths.push(panel.image.path)
    } else if (b.kind === 'single' && b.image) {
      paths.push(b.image.path)
    }
  }
  if (hasFirstLast && paths.length > 2) return paths.slice(0, 2)
  if (mode.includes('singleImage')) return paths.slice(0, 1)
  return paths
}

export interface VideoGenOptions {
  prompt?: string
  durationSec?: number
  resolution?: string
  vendorId?: string
  modelName?: string
  /** 覆盖自动挑选的参考图（工作区相对路径）。 */
  referencePaths?: string[]
}

/** 为一个镜头生成一段视频。返回 job。 */
export function startVideoGeneration(cwd: string, shotId: string, opts: VideoGenOptions): Job {
  const job = createJob(cwd, 'video_generate', `视频段 ${shotId}`)
  void runJob(job, async (signal, report) => {
    const vendor = await resolveVideoVendor(cwd, opts.vendorId, opts.modelName)
    const project = readProject(cwd)
    const shot = project.shots.find((s) => s.id === shotId)
    if (!shot) throw new Error(`镜头不存在：${shotId}`)

    const mode = (Array.isArray(vendor.model.mode) ? vendor.model.mode : ['text']) as VideoMode[]
    const duration = opts.durationSec ?? project.pipeline.globalPrefs.videoSeconds ?? pickDuration(vendor.model)
    const resolution = opts.resolution ?? pickResolution(vendor.model, duration)
    const aspectRatio = project.meta.aspect === 'landscape' ? '16:9' : '9:16'
    const prompt =
      opts.prompt ??
      [project.style.promptFragment, shot.description, shot.cameraMove ? `运镜：${shot.cameraMove}` : '', shot.dialogue ? `台词：${shot.dialogue}` : '']
        .filter(Boolean)
        .join('，')

    const refPaths = opts.referencePaths ?? pickReferencePaths(project, shot, mode)
    const referenceList = refPaths.length ? refs(cwd, refPaths) : []

    const config: VideoConfig = {
      duration,
      resolution,
      aspectRatio,
      prompt,
      mode,
      ...(referenceList.length ? { referenceList } : {}),
      ...(typeof vendor.model.audio === 'boolean' ? { audio: vendor.model.audio } : {}),
    }

    const videoId = newVideoId()
    const dir = relDirFrom(cwd, `${videosDir(cwd)}/${shotId}`)

    report(0.1, `提交 ${vendor.vendorId}/${vendor.modelName}（${duration}s ${resolution}）`)
    const b64 = await vendor.session.videoRequest(config, vendor.modelName, 900000)
    if (signal.aborted) throw new Error('已取消')

    report(0.9, '写入视频')
    const ref = persistMedia(cwd, b64, {
      relDirFromProjectDir: dir,
      baseName: videoId,
      vendorId: vendor.vendorId,
      modelName: vendor.modelName,
      fallbackMime: 'video/mp4',
    })
    if (!ref) throw new Error('供应商返回的不是有效的有头 base64 视频')

    mutateProject(cwd, (p) => {
      p.videos.push({
        id: videoId,
        shotId,
        prompt,
        vendorId: vendor.vendorId,
        modelName: vendor.modelName,
        durationSec: duration,
        resolution,
        aspectRatio,
        mode,
        audio: typeof vendor.model.audio === 'boolean' ? vendor.model.audio : false,
        ...(refPaths.length ? { referenceFrameIds: refPaths } : {}),
        output: ref,
        status: 'ready',
        jobId: job.id,
        updatedAt: Date.now(),
      })
      const s = p.shots.find((x) => x.id === shotId)
      if (s) s.videoIds.push(videoId)
    })

    return { paths: [ref.path], items: [{ id: videoId, path: ref.path }] }
  })
  return job
}

function pickDuration(model: VideoModel): number {
  const map = model.durationResolutionMap?.[0]
  return map?.duration?.[0] ?? 5
}

function pickResolution(model: VideoModel, duration: number): string {
  const entry = model.durationResolutionMap?.find((m) => m.duration.includes(duration))
  return entry?.resolution?.[0] ?? model.durationResolutionMap?.[0]?.resolution?.[0] ?? '720p'
}

export { boardsDir, type MediaRef }
