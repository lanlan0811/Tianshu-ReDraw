/**
 * 转绘短剧工厂项目模型（v2）。
 *
 * 存储位置（工作区内，用户可见、可版本化）：
 *   <cwd>/.tianshu-redraw/project.json     画布模型（单一文件）
 *   <cwd>/.tianshu-redraw/frames/*.png     抽帧
 *   <cwd>/.tianshu-redraw/assets/<id>/*    资产图
 *   <cwd>/.tianshu-redraw/boards/<shot>/*  分镜图
 *   <cwd>/.tianshu-redraw/videos/<shot>/*  视频段
 *   <cwd>/.tianshu-redraw/vendors/*.ts     供应商适配文件
 *   <cwd>/.tianshu-redraw/config.json      供应商/模型/全局偏好配置
 *
 * 写入用「临时文件 + rename」保证原子性；损坏文件覆盖前先备份。
 * 变更后 emit 事件，供本地服务广播 SSE。
 */
import { EventEmitter } from 'node:events'
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertSafeId, InvalidInputError, isSafeId, newShotId } from './ids.js'
import { DEFAULT_ASPECT, isAspectType, type AspectType } from './aspect.js'

export const PROJECT_DIR_NAME = '.tianshu-redraw'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type StepId = 'frames' | 'localize' | 'script' | 'shotlist' | 'assets' | 'generate'
export const STEP_IDS: readonly StepId[] = ['frames', 'localize', 'script', 'shotlist', 'assets', 'generate']

export type AssetKind = 'character' | 'prop' | 'scene'
export type BoardKind = 'single' | 'firstLast' | 'grid'
export type GridMode = 'multiShot' | 'subPanels'

/** 生成物的引用（路径为工作区相对路径）。 */
export interface MediaRef {
  path: string
  rev: number
  generatedAt: number
  vendorId: string
  modelName: string
  mime: string
}

export interface ProjectMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  aspect: AspectType
  episodeCount: number
  region?: string
  notes?: string
}

export interface SourceState {
  mode: 'video' | 'story'
  /** 工作区相对路径，如 `assets/source/ep1.mp4`。 */
  videoPath?: string
  story?: string
  durationSec?: number
  width?: number
  height?: number
  fps?: number
  ingestAt?: number
}

export interface FrameItem {
  id: string
  index: number
  tSec: number
  /** 工作区相对路径，如 `frames/frame-3f2a91c4.png`。 */
  path: string
  width: number
  height: number
  selected: boolean
  tags?: string[]
}

export interface StyleState {
  styleId: string
  promptFragment?: string
  referenceImage?: string
  appliedAt?: number
}

export interface LocalizationReport {
  region: string
  checklist: {
    costume: string
    architecture: string
    festival: string
    taboos: string
    colorPreference: string
    notes?: string
  }
  updatedAt: number
}

export interface LocalizationState {
  region: string
  templateId: string
  report?: LocalizationReport
  appliedAt?: number
}

export interface SceneScript {
  id: string
  index: number
  slug: string
  location: string
  timeOfDay: string
  summary: string
  beats: string[]
}

export interface EpisodeScript {
  id: string
  index: number
  title: string
  logline: string
  synopsis: string
  scenes: SceneScript[]
  status: 'draft' | 'approved'
  updatedAt: number
}

export interface ScriptState {
  status: 'none' | 'draft' | 'approved'
  episodes: EpisodeScript[]
  approvedAt?: number
  revisions: number
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
  sourceFrameId?: string
  boardIds: string[]
  videoIds: string[]
  status: 'draft' | 'approved'
  updatedAt: number
}

export interface AssetVariant {
  id: string
  name: string
  prompt: string
  image?: MediaRef
  status: 'spec' | 'generating' | 'ready' | 'error'
}

export interface AssetItem {
  id: string
  kind: AssetKind
  name: string
  spec: string
  prompt: string
  baseImage?: MediaRef
  variants: AssetVariant[]
  shotIds: string[]
  status: 'spec' | 'generating' | 'ready' | 'error'
  updatedAt: number
}

export interface BoardPanel {
  index: number
  image?: MediaRef
}

export interface BoardItem {
  id: string
  shotId: string
  kind: BoardKind
  gridMode?: GridMode
  image?: MediaRef
  panels?: BoardPanel[]
  status: 'planned' | 'generating' | 'ready' | 'error'
  updatedAt: number
}

export interface VideoSegment {
  id: string
  shotId: string
  prompt: string
  vendorId: string
  modelName: string
  durationSec: number
  resolution: string
  aspectRatio: '16:9' | '9:16'
  /** VideoMode[] 快照（来自 vendor 模型声明）。 */
  mode: unknown
  audio: boolean
  referenceFrameIds?: string[]
  output?: MediaRef
  status: 'planned' | 'generating' | 'ready' | 'error'
  jobId?: string
  updatedAt: number
}

export interface Gate {
  asked: boolean
  answered: boolean
  question?: string
  answer?: string
}

export interface PipelineState {
  currentStep: StepId
  steps: Record<StepId, { status: 'pending' | 'active' | 'done'; updatedAt: number; gate?: Gate }>
  globalPrefs: {
    boardType?: BoardKind
    gridMode?: GridMode
    videoModel?: { vendorId: string; modelName: string }
    videoSeconds?: number
  }
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** 画布上的连线（镜头顺序 / 关系）。 */
export interface Edge {
  id: string
  source: string
  target: string
  label?: string
}

/** 画布上的选中项（回传给 AI 的上下文）。 */
export interface Selection {
  kind: 'shot' | 'asset' | 'board' | 'video' | 'frame' | 'none'
  id?: string
  at: number
}

export interface Project {
  version: 2
  meta: ProjectMeta
  source: SourceState
  frames: FrameItem[]
  style: StyleState
  localization: LocalizationState
  script: ScriptState
  shots: ShotItem[]
  assets: AssetItem[]
  boards: BoardItem[]
  videos: VideoSegment[]
  pipeline: PipelineState
  viewport: Viewport
  edges: Edge[]
  layout: Record<string, { x: number; y: number }>
  /** 抽帧请求（由工具写入，浏览器轮询执行）。 */
  extractRequest?: { intervalSec: number; status: 'requested' | 'running' | 'done' | 'error'; at: number; message?: string }
}

/** 项目变更事件总线；服务端订阅后向浏览器广播。 */
export const projectEvents = new EventEmitter()
projectEvents.setMaxListeners(0)

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

export function projectDir(cwd: string): string {
  return join(cwd, PROJECT_DIR_NAME)
}

export function projectFile(cwd: string): string {
  return join(projectDir(cwd), 'project.json')
}

export function framesDir(cwd: string): string {
  return join(projectDir(cwd), 'frames')
}

export function contactDir(cwd: string): string {
  return join(projectDir(cwd), 'frames', '_contact')
}

export function assetsDir(cwd: string): string {
  return join(projectDir(cwd), 'assets')
}

export function boardsDir(cwd: string): string {
  return join(projectDir(cwd), 'boards')
}

export function videosDir(cwd: string): string {
  return join(projectDir(cwd), 'videos')
}

export function vendorsDir(cwd: string): string {
  return join(projectDir(cwd), 'vendors')
}

export function configFile(cwd: string): string {
  return join(projectDir(cwd), 'config.json')
}

// ---------------------------------------------------------------------------
// 空项目 / 归一化
// ---------------------------------------------------------------------------

function emptyPipeline(): PipelineState {
  const steps = {} as PipelineState['steps']
  const now = Date.now()
  for (const id of STEP_IDS) steps[id] = { status: 'pending', updatedAt: now }
  return { currentStep: 'frames', steps, globalPrefs: {} }
}

export function emptyProject(): Project {
  const now = Date.now()
  return {
    version: 2,
    meta: { id: 'project', title: '未命名短剧', createdAt: now, updatedAt: now, aspect: DEFAULT_ASPECT, episodeCount: 1 },
    source: { mode: 'story' },
    frames: [],
    style: { styleId: '' },
    localization: { region: '', templateId: 'default' },
    script: { status: 'none', episodes: [], revisions: 0 },
    shots: [],
    assets: [],
    boards: [],
    videos: [],
    pipeline: emptyPipeline(),
    viewport: { x: 0, y: 0, zoom: 1 },
    edges: [],
    layout: {},
  }
}

function normalizeViewport(v: unknown): Viewport {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const x = typeof o.x === 'number' && Number.isFinite(o.x) ? o.x : 0
    const y = typeof o.y === 'number' && Number.isFinite(o.y) ? o.y : 0
    const zoom = typeof o.zoom === 'number' && Number.isFinite(o.zoom) && o.zoom > 0 ? o.zoom : 1
    return { x, y, zoom }
  }
  return { x: 0, y: 0, zoom: 1 }
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
function mediaRef(v: unknown): MediaRef | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.path !== 'string' || o.path.length === 0) return undefined
  return {
    path: o.path,
    rev: num(o.rev, 0),
    generatedAt: num(o.generatedAt, 0),
    vendorId: str(o.vendorId),
    modelName: str(o.modelName),
    mime: str(o.mime, 'application/octet-stream'),
  }
}

// ---------------------------------------------------------------------------
// 类型守卫（逐条过滤无效条目）
// ---------------------------------------------------------------------------

function isFrame(v: unknown): v is FrameItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && isSafeId(o.id) && typeof o.path === 'string'
}

function isShot(v: unknown): v is ShotItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && isSafeId(o.id)
}

function isAsset(v: unknown): v is AssetItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && isSafeId(o.id) && typeof o.kind === 'string'
}

function isBoard(v: unknown): v is BoardItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && isSafeId(o.id) && typeof o.shotId === 'string'
}

function isVideo(v: unknown): v is VideoSegment {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && isSafeId(o.id) && typeof o.shotId === 'string'
}

function isEdge(v: unknown): v is Edge {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.source === 'string' && typeof o.target === 'string'
}

// ---------------------------------------------------------------------------
// v1 → v2 迁移
// ---------------------------------------------------------------------------

interface V1Node {
  id?: unknown
  title?: unknown
  x?: unknown
  y?: unknown
  width?: unknown
  height?: unknown
  deviceType?: unknown
}

/** 把 v1（shots 数组、type:'shot' 节点）迁移为 v2 结构。 */
function migrateV1(raw: Record<string, unknown>): { project: Project; migrated: boolean } {
  const project = emptyProject()
  const nodes = Array.isArray(raw.shots) ? raw.shots : Array.isArray(raw.nodes) ? raw.nodes : []
  const now = Date.now()
  let i = 0
  for (const n of nodes as V1Node[]) {
    if (!n || typeof n.id !== 'string' || !isSafeId(n.id)) continue
    project.shots.push({
      id: n.id,
      index: i++,
      episodeId: '',
      durationSec: 3,
      shotSize: '',
      cameraMove: '',
      scene: '',
      characters: [],
      props: [],
      description: str(n.title),
      boardIds: [],
      videoIds: [],
      status: 'draft',
      updatedAt: now,
    })
    project.layout[n.id] = { x: num(n.x), y: num(n.y) }
  }
  if (Array.isArray(raw.edges)) {
    project.edges = (raw.edges as unknown[]).filter(isEdge)
  }
  project.viewport = normalizeViewport(raw.viewport)
  return { project, migrated: nodes.length > 0 || raw.version !== 2 }
}

// ---------------------------------------------------------------------------
// 读取 / 检查
// ---------------------------------------------------------------------------

interface ProjectInspection {
  project: Project
  problem?: string
  dropped: number
  migrated: boolean
}

function normalizeProject(raw: unknown): ProjectInspection {
  if (!raw || typeof raw !== 'object') return { project: emptyProject(), problem: '项目文件不是对象', dropped: 0, migrated: false }
  const o = raw as Record<string, unknown>

  if (o.version !== 2) {
    const { project, migrated } = migrateV1(o)
    return { project, dropped: 0, migrated }
  }

  const p = emptyProject()
  p.meta = { ...p.meta, ...(typeof o.meta === 'object' && o.meta ? (o.meta as object) : {}) } as ProjectMeta
  if (typeof o.meta === 'object' && o.meta) {
    const m = o.meta as Record<string, unknown>
    p.meta.id = str(m.id, 'project')
    p.meta.title = str(m.title, '未命名短剧')
    p.meta.createdAt = num(m.createdAt, Date.now())
    p.meta.updatedAt = num(m.updatedAt, Date.now())
    p.meta.aspect = isAspectType(m.aspect) ? m.aspect : DEFAULT_ASPECT
    p.meta.episodeCount = Math.max(1, Math.round(num(m.episodeCount, 1)))
    if (typeof m.region === 'string') p.meta.region = m.region
    if (typeof m.notes === 'string') p.meta.notes = m.notes
  }

  if (typeof o.source === 'object' && o.source) {
    const s = o.source as Record<string, unknown>
    p.source.mode = s.mode === 'video' ? 'video' : 'story'
    if (typeof s.videoPath === 'string') p.source.videoPath = s.videoPath
    if (typeof s.story === 'string') p.source.story = s.story
    if (typeof s.durationSec === 'number') p.source.durationSec = s.durationSec
    if (typeof s.width === 'number') p.source.width = s.width
    if (typeof s.height === 'number') p.source.height = s.height
    if (typeof s.fps === 'number') p.source.fps = s.fps
    if (typeof s.ingestAt === 'number') p.source.ingestAt = s.ingestAt
  }

  const rawFrames = Array.isArray(o.frames) ? o.frames : []
  p.frames = rawFrames.filter(isFrame)
  const rawShots = Array.isArray(o.shots) ? o.shots : []
  p.shots = rawShots.filter(isShot)
  const rawAssets = Array.isArray(o.assets) ? o.assets : []
  p.assets = rawAssets.filter(isAsset)
  const rawBoards = Array.isArray(o.boards) ? o.boards : []
  p.boards = rawBoards.filter(isBoard)
  const rawVideos = Array.isArray(o.videos) ? o.videos : []
  p.videos = rawVideos.filter(isVideo)
  const rawEdges = Array.isArray(o.edges) ? o.edges : []
  p.edges = rawEdges.filter(isEdge)

  if (typeof o.style === 'object' && o.style) {
    const s = o.style as Record<string, unknown>
    p.style = { styleId: str(s.styleId), ...(typeof s.promptFragment === 'string' ? { promptFragment: s.promptFragment } : {}), ...(typeof s.referenceImage === 'string' ? { referenceImage: s.referenceImage } : {}), ...(typeof s.appliedAt === 'number' ? { appliedAt: s.appliedAt } : {}) }
  }
  if (typeof o.localization === 'object' && o.localization) {
    const l = o.localization as Record<string, unknown>
    p.localization = { region: str(l.region), templateId: str(l.templateId, 'default') }
    if (l.report && typeof l.report === 'object') {
      const r = l.report as Record<string, unknown>
      const c = (r.checklist ?? {}) as Record<string, unknown>
      p.localization.report = {
        region: str(r.region),
        checklist: {
          costume: str(c.costume),
          architecture: str(c.architecture),
          festival: str(c.festival),
          taboos: str(c.taboos),
          colorPreference: str(c.colorPreference),
          ...(typeof c.notes === 'string' ? { notes: c.notes } : {}),
        },
        updatedAt: num(r.updatedAt, Date.now()),
      }
    }
    if (typeof l.appliedAt === 'number') p.localization.appliedAt = l.appliedAt
  }
  if (typeof o.script === 'object' && o.script) {
    const s = o.script as Record<string, unknown>
    p.script = {
      status: s.status === 'draft' || s.status === 'approved' ? s.status : 'none',
      episodes: Array.isArray(s.episodes) ? (s.episodes as EpisodeScript[]).filter((e) => e && typeof e.id === 'string') : [],
      revisions: num(s.revisions, 0),
      ...(typeof s.approvedAt === 'number' ? { approvedAt: s.approvedAt } : {}),
    }
  }
  if (typeof o.pipeline === 'object' && o.pipeline) {
    const pl = o.pipeline as Record<string, unknown>
    const steps = emptyPipeline().steps
    if (typeof pl.steps === 'object' && pl.steps) {
      for (const id of STEP_IDS) {
        const s = (pl.steps as Record<string, unknown>)[id]
        if (s && typeof s === 'object') {
          const so = s as Record<string, unknown>
          const status = so.status === 'active' || so.status === 'done' ? so.status : 'pending'
          const gate = so.gate && typeof so.gate === 'object' ? (so.gate as Gate) : undefined
          steps[id] = { status, updatedAt: num(so.updatedAt, Date.now()), ...(gate ? { gate } : {}) }
        }
      }
    }
    const prefsRaw = typeof pl.globalPrefs === 'object' && pl.globalPrefs ? (pl.globalPrefs as Record<string, unknown>) : {}
    const prefs: PipelineState['globalPrefs'] = {}
    if (prefsRaw.boardType === 'single' || prefsRaw.boardType === 'firstLast' || prefsRaw.boardType === 'grid') prefs.boardType = prefsRaw.boardType
    if (prefsRaw.gridMode === 'multiShot' || prefsRaw.gridMode === 'subPanels') prefs.gridMode = prefsRaw.gridMode
    if (prefsRaw.videoModel && typeof prefsRaw.videoModel === 'object') {
      const vm = prefsRaw.videoModel as Record<string, unknown>
      if (typeof vm.vendorId === 'string' && typeof vm.modelName === 'string') prefs.videoModel = { vendorId: vm.vendorId, modelName: vm.modelName }
    }
    if (typeof prefsRaw.videoSeconds === 'number') prefs.videoSeconds = prefsRaw.videoSeconds
    p.pipeline = {
      currentStep: STEP_IDS.includes(pl.currentStep as StepId) ? (pl.currentStep as StepId) : 'frames',
      steps,
      globalPrefs: prefs,
    }
  }

  p.viewport = normalizeViewport(o.viewport)

  if (typeof o.layout === 'object' && o.layout) {
    for (const [k, v] of Object.entries(o.layout as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const lv = v as Record<string, unknown>
        p.layout[k] = { x: num(lv.x), y: num(lv.y) }
      }
    }
  }

  if (o.extractRequest && typeof o.extractRequest === 'object') {
    const e = o.extractRequest as Record<string, unknown>
    const st = e.status
    p.extractRequest = {
      intervalSec: num(e.intervalSec, 2),
      status: st === 'running' || st === 'done' || st === 'error' ? st : 'requested',
      at: num(e.at, Date.now()),
      ...(typeof e.message === 'string' ? { message: e.message } : {}),
    }
  }

  const dropped =
    rawFrames.length - p.frames.length +
    rawShots.length - p.shots.length +
    rawAssets.length - p.assets.length +
    rawBoards.length - p.boards.length +
    rawVideos.length - p.videos.length +
    rawEdges.length - p.edges.length

  return { project: p, dropped, migrated: false }
}

function inspectProject(cwd: string): ProjectInspection {
  const file = projectFile(cwd)
  if (!existsSync(file)) return { project: emptyProject(), dropped: 0, migrated: false }
  const raw = readFileSync(file, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { project: emptyProject(), problem: (err as Error).message, dropped: 0, migrated: false }
  }
  return normalizeProject(parsed)
}

export function readProject(cwd: string): Project {
  return inspectProject(cwd).project
}

/** 需要告知用户的项目文件问题；文件健康时返回 null。 */
export function projectIssue(cwd: string): string | null {
  const { problem, dropped, migrated } = inspectProject(cwd)
  if (problem) {
    return `project.json 已损坏（${problem}）。画布暂按空项目显示，原文件未改动，修复后会自动恢复；继续写入前会先备份为 project.json.corrupt-*。`
  }
  if (dropped > 0) {
    return `project.json 中有 ${dropped} 条无效条目，读取时已忽略。原文件未改动，下次写入前会先备份为 project.json.corrupt-*。`
  }
  if (migrated) {
    return `检测到旧版（v1）项目文件，已按 v2 结构读取；首次写入前会备份为 project.json.v1-*。`
  }
  return null
}

// ---------------------------------------------------------------------------
// 备份 / 写入
// ---------------------------------------------------------------------------

const pendingBackups = new Map<string, string>()

export function takeProjectBackup(cwd: string): string | null {
  const path = pendingBackups.get(cwd) ?? null
  pendingBackups.delete(cwd)
  return path
}

function backupDamagedProject(cwd: string): void {
  const file = projectFile(cwd)
  if (!existsSync(file)) return
  let reason: string | null = null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    if (parsed && typeof parsed === 'object' && parsed.version !== 2) reason = 'v1'
    else {
      const { problem, dropped } = inspectProject(cwd)
      if (problem || dropped > 0) reason = 'corrupt'
    }
  } catch {
    reason = 'corrupt'
  }
  if (!reason) return
  const stamp = Date.now()
  const suffix = reason === 'v1' ? `.v1-${stamp}` : `.corrupt-${stamp}`
  for (let n = 0; n < 1000; n++) {
    const dest = n === 0 ? `${file}${suffix}` : `${file}${suffix}-${n}`
    try {
      copyFileSync(file, dest, constants.COPYFILE_EXCL)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
    pendingBackups.set(cwd, dest)
    console.error(`[tianshu-redraw] 项目文件需备份（${reason}），已备份到 ${dest}`)
    return
  }
  throw new Error(`无法备份项目文件：${file}`)
}

function writeProjectAtomic(cwd: string, project: Project): void {
  mkdirSync(projectDir(cwd), { recursive: true })
  backupDamagedProject(cwd)
  project.meta.updatedAt = Date.now()
  const file = projectFile(cwd)
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(project, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  projectEvents.emit('change', { cwd })
}

export function writeProject(cwd: string, project: Project): void {
  writeProjectAtomic(cwd, project)
}

/** 只读修改 + 写回（读取当前项目 → 变更 → 原子写）。 */
export function mutateProject(cwd: string, fn: (p: Project) => void): Project {
  const project = readProject(cwd)
  fn(project)
  writeProjectAtomic(cwd, project)
  return project
}

// ---------------------------------------------------------------------------
// 媒体文件
// ---------------------------------------------------------------------------

/** 原子写入一个媒体文件（相对 projectDir 的路径），返回工作区相对路径。 */
export function writeMedia(cwd: string, relFromProjectDir: string, data: Buffer | string): string {
  const abs = join(projectDir(cwd), relFromProjectDir)
  mkdirSync(join(abs, '..'), { recursive: true })
  const tmp = abs + '.tmp'
  writeFileSync(tmp, data)
  renameSync(tmp, abs)
  return join(PROJECT_DIR_NAME, relFromProjectDir)
}

export function mediaAbs(cwd: string, relPath: string): string {
  return join(cwd, relPath)
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
}

/** MIME → 文件扩展名（未知回退 bin）。 */
export function extFromMime(mime: string): string {
  const bare = mime.split(';')[0]?.trim().toLowerCase() ?? ''
  return MIME_EXT[bare] ?? 'bin'
}

/** 文件扩展名 → MIME（用于本地服务流式响应）。 */
export function mimeFromExt(ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase()
  for (const [mime, mapped] of Object.entries(MIME_EXT)) {
    if (mapped === e) return mime
  }
  return 'application/octet-stream'
}

export function readMediaBuffer(cwd: string, relPath: string): Buffer | null {
  const abs = mediaAbs(cwd, relPath)
  return existsSync(abs) ? readFileSync(abs) : null
}

// ---------------------------------------------------------------------------
// 流水线 / 门控
// ---------------------------------------------------------------------------

export function setStep(cwd: string, step: StepId, status: 'pending' | 'active' | 'done'): Project {
  return mutateProject(cwd, (p) => {
    p.pipeline.steps[step].status = status
    p.pipeline.steps[step].updatedAt = Date.now()
    if (status === 'active') p.pipeline.currentStep = step
  })
}

export function setGate(cwd: string, step: StepId, gate: Partial<Gate>): Project {
  return mutateProject(cwd, (p) => {
    const cur = p.pipeline.steps[step].gate ?? { asked: false, answered: false }
    p.pipeline.steps[step].gate = { ...cur, ...gate }
  })
}

/** 找出当前待回答的门控（asked 且未 answered）。 */
export function pendingGate(p: Project): { step: StepId; question?: string } | null {
  for (const id of STEP_IDS) {
    const g = p.pipeline.steps[id].gate
    if (g?.asked && !g.answered) return { step: id, ...(g.question ? { question: g.question } : {}) }
  }
  return null
}

// ---------------------------------------------------------------------------
// 布局
// ---------------------------------------------------------------------------

/** 未显式给坐标时按 4 列网格排布，左侧留出侧栏。 */
export function autoLayoutPosition(index: number, size: { width: number; height: number }): { x: number; y: number } {
  const originX = 260
  const originY = 90
  const gapX = 120
  const gapY = 160
  const cols = 4
  const col = index % cols
  const row = Math.floor(index / cols)
  return { x: originX + col * (size.width + gapX), y: originY + row * (size.height + gapY) }
}

// ---------------------------------------------------------------------------
// 镜头编排
// ---------------------------------------------------------------------------

function isEdgeMatch(e: Edge, source: string, target: string): boolean {
  return e.source === source && e.target === target
}

export function addEdge(cwd: string, source: string, target: string, label?: string): Edge {
  assertSafeId(source)
  assertSafeId(target)
  if (source === target) throw new InvalidInputError(`不能将节点连接到自身：${source}`)
  const project = readProject(cwd)
  const exists = project.edges.find((e) => isEdgeMatch(e, source, target))
  if (exists) return exists
  const edge: Edge = { id: `edge-${source}-${target}`, source, target, ...(label ? { label } : {}) }
  project.edges.push(edge)
  writeProjectAtomic(cwd, project)
  return edge
}

export function removeEdge(cwd: string, source: string, target: string): Project {
  return mutateProject(cwd, (p) => {
    p.edges = p.edges.filter((e) => !isEdgeMatch(e, source, target))
  })
}

export function setViewport(cwd: string, viewport: Viewport): Project {
  const { project, problem, dropped, migrated } = inspectProject(cwd)
  // 平移画布不是用户的写入意图，不能因此备份并改写有问题的项目文件。
  if (problem || dropped > 0 || migrated) return project
  project.viewport = normalizeViewport(viewport)
  writeProjectAtomic(cwd, project)
  return project
}

// ---------------------------------------------------------------------------
// 选中项
// ---------------------------------------------------------------------------

export function selectionFile(cwd: string): string {
  return join(projectDir(cwd), 'selection.json')
}

export function readSelection(cwd: string): Selection | null {
  const file = selectionFile(cwd)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Selection
    if (!parsed || typeof parsed.kind !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function writeSelection(cwd: string, selection: Selection): void {
  mkdirSync(projectDir(cwd), { recursive: true })
  const file = selectionFile(cwd)
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(selection, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  projectEvents.emit('selection', { cwd })
}

export { newShotId }
