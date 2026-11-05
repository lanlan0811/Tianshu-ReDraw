/**
 * 与本地画布服务通信（v2）：项目/配置/流水线/帧/任务 + SSE。
 */
export type StepId = 'frames' | 'localize' | 'script' | 'shotlist' | 'assets' | 'generate'
export type AssetKind = 'character' | 'prop' | 'scene'
export type BoardKind = 'single' | 'firstLast' | 'grid'
export type GridMode = 'multiShot' | 'subPanels'

export interface MediaRef {
  path: string
  rev: number
  generatedAt: number
  vendorId: string
  modelName: string
  mime: string
}

export interface FrameItem {
  id: string
  index: number
  tSec: number
  path: string
  width: number
  height: number
  selected: boolean
  tags?: string[]
}

export interface ShotItem {
  id: string
  index: number
  episodeId: string
  durationSec: number
  shotSize: string
  cameraMove: string
  scene: string
  characters: string[]
  props: string[]
  description: string
  dialogue?: string
  voiceover?: string
  emotion?: string
  boardIds: string[]
  videoIds: string[]
  status: string
}

export interface AssetItem {
  id: string
  kind: AssetKind
  name: string
  spec: string
  prompt: string
  baseImage?: MediaRef
  variants: { id: string; name: string; prompt: string; image?: MediaRef; status: string }[]
  status: string
}

export interface BoardItem {
  id: string
  shotId: string
  kind: BoardKind
  gridMode?: GridMode
  image?: MediaRef
  panels?: { index: number; image?: MediaRef }[]
  status: string
}

export interface VideoSegment {
  id: string
  shotId: string
  prompt: string
  vendorId: string
  modelName: string
  durationSec: number
  resolution: string
  output?: MediaRef
  status: string
}

export interface Gate {
  asked: boolean
  answered: boolean
  question?: string
  answer?: string
}

export interface ApiProject {
  version: 2
  meta: { id: string; title: string; aspect: string; episodeCount: number; region?: string }
  source: { mode: 'video' | 'story'; videoPath?: string; story?: string; durationSec?: number }
  frames: FrameItem[]
  style: { styleId: string; promptFragment?: string }
  localization: { region: string; templateId: string; report?: { region: string; checklist: Record<string, string> } }
  script: { status: string; episodes: unknown[]; revisions: number }
  shots: ShotItem[]
  assets: AssetItem[]
  boards: BoardItem[]
  videos: VideoSegment[]
  pipeline: {
    currentStep: StepId
    steps: Record<StepId, { status: string; gate?: Gate }>
    globalPrefs: { boardType?: BoardKind; gridMode?: GridMode; videoModel?: { vendorId: string; modelName: string }; videoSeconds?: number }
  }
  viewport: { x: number; y: number; zoom: number }
  edges: { id: string; source: string; target: string; label?: string }[]
  layout: Record<string, { x: number; y: number }>
  extractRequest?: { intervalSec: number; status: string; at: number; message?: string }
  jobs?: JobView[]
  issue?: string
  gate?: { step: StepId; question?: string } | null
}

export interface JobView {
  id: string
  kind: string
  status: string
  progress: number
  message: string
  error?: string
}

const HDR = { 'Content-Type': 'application/json', 'X-Tianshu-Redraw': '1' }

export async function fetchProject(ws: string): Promise<ApiProject> {
  const res = await fetch(`/api/project?ws=${encodeURIComponent(ws)}`)
  if (!res.ok) throw new Error(`project ${res.status}`)
  return (await res.json()) as ApiProject
}

export async function fetchConfig(ws: string): Promise<unknown> {
  const res = await fetch(`/api/config?ws=${encodeURIComponent(ws)}`)
  return res.ok ? res.json() : null
}

let vpTimer: ReturnType<typeof setTimeout> | undefined
export function postViewport(ws: string, vp: { x: number; y: number; zoom: number }): void {
  clearTimeout(vpTimer)
  vpTimer = setTimeout(() => {
    void fetch('/api/viewport', { method: 'POST', headers: HDR, body: JSON.stringify({ ws, ...vp }) }).catch(() => {})
  }, 500)
}

export async function postSelection(ws: string, kind: string, id?: string): Promise<void> {
  await fetch('/api/selection', { method: 'POST', headers: HDR, body: JSON.stringify({ ws, kind, id }) }).catch(() => {})
}

export async function postPipeline(ws: string, op: 'set_step' | 'answer_gate', data: Record<string, unknown>): Promise<void> {
  await fetch('/api/pipeline', { method: 'POST', headers: HDR, body: JSON.stringify({ ws, op, ...data }) }).catch(() => {})
}

export async function postConfig(ws: string, patch: unknown): Promise<void> {
  await fetch('/api/config', { method: 'POST', headers: HDR, body: JSON.stringify({ ws, patch }) }).catch(() => {})
}

export async function postEdge(ws: string, op: 'add' | 'remove', source: string, target: string): Promise<void> {
  await fetch('/api/edges', { method: 'POST', headers: HDR, body: JSON.stringify({ ws, op, source, target }) }).catch(() => {})
}

/** 抽帧：逐帧上传（每帧一请求，避 body 上限）。 */
export async function postFrame(
  ws: string,
  frame: { index: number; tSec: number; data: string; width: number; height: number },
): Promise<void> {
  await fetch('/api/frames', { method: 'POST', headers: HDR, body: JSON.stringify({ ws, op: 'add', ...frame }) })
}

export async function postContactSheet(ws: string, data: string, width: number, height: number): Promise<void> {
  await fetch('/api/frames/contact', { method: 'POST', headers: HDR, body: JSON.stringify({ ws, data, width, height }) })
}

export async function postFramesStatus(ws: string, status: string, message?: string): Promise<void> {
  await fetch('/api/frames/status', { method: 'POST', headers: HDR, body: JSON.stringify({ ws, status, message }) }).catch(() => {})
}

export async function clearFrames(ws: string): Promise<void> {
  await fetch('/api/frames', { method: 'POST', headers: HDR, body: JSON.stringify({ ws, op: 'clear' }) }).catch(() => {})
}

export function mediaUrl(ws: string, relPath: string): string {
  return `/api/media?ws=${encodeURIComponent(ws)}&path=${encodeURIComponent(relPath)}`
}

export function sourceVideoUrl(ws: string): string {
  return `/api/source-video?ws=${encodeURIComponent(ws)}`
}

export interface EventHandlers {
  onProject?: () => void
  onFrames?: () => void
  onJob?: () => void
  onConfig?: () => void
  onSelection?: () => void
}

export function subscribeEvents(ws: string, handlers: EventHandlers): () => void {
  const es = new EventSource(`/api/events?ws=${encodeURIComponent(ws)}`)
  if (handlers.onProject) es.addEventListener('project', handlers.onProject)
  if (handlers.onFrames) es.addEventListener('frames', handlers.onFrames)
  if (handlers.onJob) es.addEventListener('job', handlers.onJob)
  if (handlers.onConfig) es.addEventListener('config', handlers.onConfig)
  if (handlers.onSelection) es.addEventListener('selection', handlers.onSelection)
  return () => es.close()
}
