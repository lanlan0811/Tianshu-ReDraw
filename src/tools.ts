/**
 * 工具实现（26 个，按 6 步流程分组）。与宿主解耦：只依赖 node 内置模块，可脱离天枢直接单测。
 *
 * execute 收到宿主传入的 { args, cwd, sessionId }（cwd = 会话工作区根）。
 * 返回值约定：{ content: string, isError?: boolean } —— 宿主只透传这两个字段，
 * 其它字段一律丢弃，因此 URL / id / 路径都必须写进 content 文本。
 *
 * 关键约束：**图片/视频无法返回给模型**，只返回工作区路径。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSafeId, newAssetId, newEpisodeId, newSceneId, newShotId, newVariantId } from './ids.js'
import { readConfig, redactConfig, updateConfig } from './config.js'
import { activeJobs, cancelJob, getJob, listJobs } from './jobs.js'
import { formatStyleList, localizationTemplate, resolveStyle } from './styles/library.js'
import { listVendorFiles, loadVendorSummary } from './vendor/runner.js'
import { startAssetGeneration } from './generate/image.js'
import { startBoardGeneration, type BoardGenOptions } from './generate/image.js'
import { startVideoGeneration } from './generate/video.js'
import {
  PROJECT_DIR_NAME,
  STEP_IDS,
  addEdge,
  framesDir,
  mutateProject,
  pendingGate,
  projectFile,
  projectIssue,
  readProject,
  readSelection,
  setGate,
  setStep,
  type AssetItem,
  type EpisodeScript,
  type Project,
  type ShotItem,
  type StepId,
} from './project.js'
import { currentUrl, ensureServer } from './server.js'

export interface ToolCall {
  args: Record<string, unknown>
  cwd: string
  sessionId: string
}

export interface ToolResult {
  content: string
  isError?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface TpiTool {
  definition: ToolDefinition
  pathParams?: Record<string, 'read' | 'write'>
  requiresApproval?: () => boolean
  isConcurrencySafe?: () => boolean
  isEnabled?: () => boolean
  execute: (call: ToolCall) => Promise<ToolResult>
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}
function ok(content: string): ToolResult {
  return { content }
}
function err(content: string): ToolResult {
  return { content, isError: true }
}
function projectHint(cwd: string): string {
  return `${PROJECT_DIR_NAME}/（项目文件：${projectFile(cwd)}）`
}
function absPath(cwd: string, rel: string): string {
  return join(cwd, rel)
}

/** 把「当前待回答的门控」提示拼进工具输出，提醒模型停下问用户。 */
function gateNotice(cwd: string): string {
  const p = readProject(cwd)
  const gate = pendingGate(p)
  if (!gate) return ''
  return `\n\n⚠️ 当前有未回答的门控（步骤 ${gate.step}）：${gate.question ?? '等待用户确认'}。请先向用户提问并等待回答，再继续。`
}

// ---------------------------------------------------------------------------
// 通用 / 配置
// ---------------------------------------------------------------------------

async function redrawOpen(call: ToolCall): Promise<ToolResult> {
  const port = num(call.args.port)
  const { url } = await ensureServer(call.cwd, port ?? undefined)
  try {
    writeFileSync(join(call.cwd, PROJECT_DIR_NAME, 'url.txt'), url + '\n', 'utf8')
  } catch {
    /* 目录可能未建 */
  }
  const p = readProject(call.cwd)
  const steps = STEP_IDS.map((id) => `${id}:${p.pipeline.steps[id].status}`).join(' ')
  return ok(
    `画布服务已就绪。请立刻把下面这一行原样发给用户（单独一行，便于点击）：\n` +
      `${url}\n` +
      `工作区：${call.cwd}\n` +
      `项目文件：${projectFile(call.cwd)}\n` +
      `当前流程：${steps}\n` +
      `下一步：从「抽帧看片」开始（redraw_frames_ingest）。画布操作：空格/中键拖拽平移，Ctrl+滚轮缩放。`,
  )
}

async function redrawGetState(call: ToolCall): Promise<ToolResult> {
  const p = readProject(call.cwd)
  const selection = readSelection(call.cwd)
  const url = currentUrl(call.cwd)
  const sections: string[] = []

  const issue = projectIssue(call.cwd)
  if (issue) sections.push(`警告：${issue}`)

  sections.push(
    `流程进度（当前：${p.pipeline.currentStep}）：\n` +
      STEP_IDS.map((id) => {
        const s = p.pipeline.steps[id]
        const g = s.gate ? ` 门控[${s.gate.answered ? '已答' : s.gate.asked ? '待答' : '未问'}]` : ''
        return `- ${id}: ${s.status}${g}`
      }).join('\n'),
  )

  const gate = pendingGate(p)
  if (gate) sections.push(`⚠️ 未回答的门控（${gate.step}）：${gate.question ?? '等待用户确认'}`)

  sections.push(
    `计数：抽帧 ${p.frames.length}｜镜头 ${p.shots.length}｜资产 ${p.assets.length}｜分镜图 ${p.boards.length}｜视频 ${p.videos.length}`,
  )

  if (p.style.styleId) sections.push(`风格：${p.style.styleId}`)
  if (p.localization.region) sections.push(`本土化地区：${p.localization.region}`)
  if (p.source.mode === 'video' && p.source.videoPath) sections.push(`素材：视频 ${p.source.videoPath}`)
  else if (p.source.story) sections.push(`素材：文本剧情（${p.source.story.slice(0, 40)}…）`)

  const jobs = activeJobs(call.cwd)
  if (jobs.length) {
    sections.push(`活跃任务（${jobs.length}）：\n` + jobs.map((j) => `- ${j.id} ${j.kind} ${Math.round(j.progress * 100)}% ${j.message}`).join('\n'))
  }

  if (selection && selection.kind !== 'none') {
    sections.push(`当前选中：${selection.kind} ${selection.id ?? ''}`)
  }

  sections.push(url ? `画布 URL：${url}` : '提示：先调用 redraw_open 获取画布 URL。')
  return ok(sections.join('\n\n'))
}

async function redrawConfigGet(call: ToolCall): Promise<ToolResult> {
  const cfg = redactConfig(readConfig(call.cwd))
  const vendors = listVendorFiles(call.cwd)
  return ok(
    `配置（密钥已脱敏）：\n${JSON.stringify(cfg, null, 2)}\n\n` +
      `工作区适配文件（vendors/）：${vendors.length ? vendors.join(', ') : '（无）'}\n` +
      `供应商需在 config.json 的 vendors.<id>.trusted=true 才允许执行其代码。`,
  )
}

async function redrawConfigSet(call: ToolCall): Promise<ToolResult> {
  const patch: Record<string, unknown> = {}
  const imageVendor = str(call.args.image_vendor)
  const imageModel = str(call.args.image_model)
  const videoVendor = str(call.args.video_vendor)
  const videoModel = str(call.args.video_model)
  const active: { image?: { vendorId: string; modelName: string }; video?: { vendorId: string; modelName: string } } = {}
  if (imageVendor && imageModel) active.image = { vendorId: imageVendor, modelName: imageModel }
  if (videoVendor && videoModel) active.video = { vendorId: videoVendor, modelName: videoModel }
  if (Object.keys(active).length) patch.active = active

  const vendorId = str(call.args.vendor_id)
  const inputValues = call.args.input_values as Record<string, string> | undefined
  if (vendorId) {
    patch.vendors = { [vendorId]: { ...(typeof call.args.trusted === 'boolean' ? { trusted: call.args.trusted } : {}), ...(inputValues ? { inputValues } : {}) } }
  }
  if (Object.keys(patch).length === 0) return err('没有可设置的字段。可用：image_vendor/image_model、video_vendor/video_model、vendor_id+input_values+trusted。')
  const next = updateConfig(call.cwd, patch as Parameters<typeof updateConfig>[1])
  return ok(`已更新配置：\n${JSON.stringify(redactConfig(next), null, 2)}`)
}

async function redrawVendorList(call: ToolCall): Promise<ToolResult> {
  const files = listVendorFiles(call.cwd)
  if (files.length === 0) {
    return ok(`工作区没有适配文件。请在 ${PROJECT_DIR_NAME}/vendors/ 放入 <id>.ts（格式参考 Toonflow 供应商模板）。`)
  }
  const cfg = readConfig(call.cwd)
  const lines: string[] = []
  for (const id of files) {
    const entry = cfg.vendors[id]
    const summary = await loadVendorSummary(call.cwd, id, entry?.inputValues ?? {})
    if ('error' in summary) {
      lines.push(`- ${id}：❌ ${summary.error}`)
    } else {
      const imgs = summary.imageModels.map((m) => `${m.name}(${m.modelName})`).join('、') || '无'
      const vids = summary.videoModels.map((m) => `${m.name}(${m.modelName})`).join('、') || '无'
      lines.push(`- ${id}（${summary.vendor.name}，${entry?.trusted ? '已信任' : '未信任'}）\n  图像模型：${imgs}\n  视频模型：${vids}`)
    }
  }
  return ok(`工作区适配文件：\n${lines.join('\n')}`)
}

async function redrawVendorValidate(call: ToolCall): Promise<ToolResult> {
  const id = str(call.args.vendor_id)
  if (!id) return err('需要 vendor_id')
  const cfg = readConfig(call.cwd)
  const summary = await loadVendorSummary(call.cwd, id, cfg.vendors[id]?.inputValues ?? {})
  if ('error' in summary) return err(`校验失败：${summary.error}`)
  return ok(
    `适配文件 ${id} 校验通过。\n` +
      `供应商：${summary.vendor.name} v${summary.vendor.version}\n` +
      `图像模型：${summary.imageModels.map((m) => m.modelName).join(', ') || '无'}\n` +
      `视频模型：${summary.videoModels.map((m) => m.modelName).join(', ') || '无'}`,
  )
}

async function redrawStyleList(call: ToolCall): Promise<ToolResult> {
  return ok(formatStyleList(call.cwd))
}

async function redrawStyleSet(call: ToolCall): Promise<ToolResult> {
  const id = str(call.args.style_id)
  if (!id) return err('需要 style_id')
  const style = resolveStyle(call.cwd, id)
  if (!style) return err(`未知风格：${id}。用 redraw_style_list 查看可选风格。`)
  mutateProject(call.cwd, (p) => {
    p.style = { styleId: style.id, promptFragment: style.promptFragment, appliedAt: Date.now() }
    if (!p.meta.region) p.meta.region = p.localization.region || undefined
  })
  return ok(`已锁定风格「${style.name}」（${style.id}）。提示词片段：${style.promptFragment}`)
}

// ---------------------------------------------------------------------------
// 步骤 1 · 抽帧
// ---------------------------------------------------------------------------

async function redrawFramesIngest(call: ToolCall): Promise<ToolResult> {
  const videoPath = str(call.args.video_path)
  const story = str(call.args.story)
  if (!videoPath && !story) return err('需要 video_path（本地视频文件）或 story（纯文本剧情）之一。')

  if (videoPath) {
    if (!existsSync(videoPath)) return err(`视频文件不存在：${videoPath}`)
    // 复制到工作区 assets/source/ 以便流式提供与版本化
    const ext = (videoPath.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? 'mp4').toLowerCase()
    const destRel = `${PROJECT_DIR_NAME}/assets/source/source.${ext}`
    mkdirSync(join(call.cwd, PROJECT_DIR_NAME, 'assets', 'source'), { recursive: true })
    const dest = join(call.cwd, destRel)
    try {
      writeFileSync(dest, readFileSync(videoPath))
    } catch (e) {
      return err(`复制视频失败：${(e as Error).message}`)
    }
    mutateProject(call.cwd, (p) => {
      p.source = { ...p.source, mode: 'video', videoPath: destRel, ingestAt: Date.now() }
    })
    setStep(call.cwd, 'frames', 'active')
    return ok(
      `已接收视频素材：${destRel}（原路径 ${videoPath}）\n` +
        `下一步：redraw_frames_extract（interval_sec 指定抽帧间隔秒）。` +
        `\n注意：抽帧在浏览器内用 ffmpeg.wasm 执行，需用户打开画布。`,
    )
  }

  mutateProject(call.cwd, (p) => {
    p.source = { mode: 'story', story, ingestAt: Date.now() }
  })
  setStep(call.cwd, 'frames', 'done')
  return ok(`已接收文本剧情（${story!.length} 字）。无视频素材，跳过抽帧，可直接进入本土化（redraw_localize_set）。`)
}

async function redrawFramesExtract(call: ToolCall): Promise<ToolResult> {
  const interval = num(call.args.interval_sec) ?? 2
  if (interval <= 0) return err('interval_sec 必须为正数')
  const p = readProject(call.cwd)
  if (p.source.mode !== 'video' || !p.source.videoPath) return err('当前素材不是视频，无需抽帧。')
  const { url } = await ensureServer(call.cwd)
  mutateProject(call.cwd, (proj) => {
    proj.extractRequest = { intervalSec: interval, status: 'requested', at: Date.now() }
    proj.pipeline.steps.frames.status = 'active'
  })
  return ok(
    `已提交抽帧请求：每 ${interval} 秒一帧。\n` +
      `**抽帧在浏览器内执行**，请把画布链接发给用户并让其保持打开：\n${url}\n` +
      `随后用 redraw_job_status / redraw_frames_list 轮询结果。`,
  )
}

async function redrawFramesList(call: ToolCall): Promise<ToolResult> {
  const p = readProject(call.cwd)
  if (p.frames.length === 0) {
    const req = p.extractRequest
    return ok(
      `暂无抽帧结果。` +
        (req ? `抽帧请求状态：${req.status}${req.message ? '（' + req.message + '）' : ''}。` : '') +
        `\n请确认用户已打开画布并完成抽帧。`,
    )
  }
  const contact = p.frames.find((f) => f.path.includes('_contact'))
  const lines = p.frames
    .filter((f) => !f.path.includes('_contact'))
    .map((f) => `- [${f.index}] ${f.tSec}s ${absPath(call.cwd, f.path)}`)
  return ok(
    `共 ${p.frames.length} 帧（路径供你引用，你无法直接看到图像内容，需用户查看）：\n${lines.join('\n')}\n` +
      (contact ? `宫格总览图：${absPath(call.cwd, contact.path)}\n` : '') +
      `提示：请用户逐帧查看或参考宫格图，据此理解剧情。`,
  )
}

// ---------------------------------------------------------------------------
// 步骤 2 · 本土化
// ---------------------------------------------------------------------------

async function redrawLocalizeSet(call: ToolCall): Promise<ToolResult> {
  const region = str(call.args.region)
  if (!region) return err('需要 region（目标地区）')
  const templateId = str(call.args.template_id) ?? 'default'
  const template = localizationTemplate(templateId)
  const c = (call.args.checklist ?? {}) as Record<string, unknown>
  mutateProject(call.cwd, (p) => {
    p.localization = {
      region,
      templateId,
      report: {
        region,
        checklist: {
          costume: str(c.costume) ?? '',
          architecture: str(c.architecture) ?? '',
          festival: str(c.festival) ?? '',
          taboos: str(c.taboos) ?? '',
          colorPreference: str(c.colorPreference) ?? '',
          ...(str(c.notes) ? { notes: str(c.notes)! } : {}),
        },
        updatedAt: Date.now(),
      },
      appliedAt: Date.now(),
    }
    p.meta.region = region
  })
  setStep(call.cwd, 'localize', 'done')
  return ok(
    `已记录本土化报告（地区：${region}，模板：${template.name}）。\n` +
      `调研提示：${template.prompt}\n` +
      `下一步：写剧本（redraw_script_upsert）。`,
  )
}

async function redrawLocalizeGet(call: ToolCall): Promise<ToolResult> {
  const p = readProject(call.cwd)
  if (!p.localization.region) return ok('尚未设置本土化。用 redraw_localize_set 设置地区与结构化报告。')
  const r = p.localization.report
  return ok(
    `地区：${p.localization.region}（模板 ${p.localization.templateId}）\n` +
      (r
        ? `服饰：${r.checklist.costume}\n建筑：${r.checklist.architecture}\n节日：${r.checklist.festival}\n禁忌：${r.checklist.taboos}\n色彩偏好：${r.checklist.colorPreference}` +
          (r.checklist.notes ? `\n备注：${r.checklist.notes}` : '')
        : '（无结构化报告）'),
  )
}

// ---------------------------------------------------------------------------
// 步骤 3 · 剧本
// ---------------------------------------------------------------------------

function parseEpisodes(raw: unknown): EpisodeScript[] {
  if (!Array.isArray(raw)) return []
  const out: EpisodeScript[] = []
  let i = 0
  for (const e of raw as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object') continue
    const scenes = Array.isArray(e.scenes)
      ? (e.scenes as Record<string, unknown>[]).map((s, si) => ({
          id: typeof s.id === 'string' && isSafeId(s.id) ? s.id : newSceneId(),
          index: num(s.index) ?? si,
          slug: str(s.slug) ?? '',
          location: str(s.location) ?? '',
          timeOfDay: str(s.timeOfDay) ?? '',
          summary: str(s.summary) ?? '',
          beats: strArr(s.beats),
        }))
      : []
    out.push({
      id: typeof e.id === 'string' && isSafeId(e.id) ? e.id : newEpisodeId(),
      index: num(e.index) ?? i,
      title: str(e.title) ?? `第 ${i + 1} 集`,
      logline: str(e.logline) ?? '',
      synopsis: str(e.synopsis) ?? '',
      scenes,
      status: 'draft',
      updatedAt: Date.now(),
    })
    i++
  }
  return out
}

async function redrawScriptUpsert(call: ToolCall): Promise<ToolResult> {
  const episodes = parseEpisodes(call.args.episodes)
  if (episodes.length === 0) return err('需要 episodes 数组（每集含 title/logline/synopsis/scenes）。')
  const revise = call.args.revise === true
  mutateProject(call.cwd, (p) => {
    if (revise) {
      // 按 index 合并到已有剧集
      for (const ep of episodes) {
        const idx = p.script.episodes.findIndex((x) => x.index === ep.index)
        if (idx >= 0) p.script.episodes[idx] = { ...ep, id: p.script.episodes[idx]!.id, status: 'draft' }
        else p.script.episodes.push(ep)
      }
      p.script.revisions++
    } else {
      p.script.episodes = episodes
      p.script.revisions = 1
    }
    p.script.status = 'draft'
    delete p.script.approvedAt
  })
  setStep(call.cwd, 'script', 'active')
  setGate(call.cwd, 'script', { asked: true, answered: false, question: '剧本已草拟，请确认是否批准（或提出修改）' })
  return ok(
    `已写入剧本草稿：${episodes.length} 集。\n` +
      `⚠️ 请先向用户展示剧本要点并**等待确认**，再调用 redraw_script_approve。` +
      gateNotice(call.cwd),
  )
}

async function redrawScriptGet(call: ToolCall): Promise<ToolResult> {
  const p = readProject(call.cwd)
  if (p.script.episodes.length === 0) return ok('尚无剧本。用 redraw_script_upsert 写入。')
  const lines = p.script.episodes.map(
    (e) =>
      `第 ${e.index + 1} 集《${e.title}》（${e.status}）\n  一句话：${e.logline}\n  梗概：${e.synopsis}\n  场次（${e.scenes.length}）：\n` +
      e.scenes.map((s) => `    ${s.index + 1}. ${s.slug || s.location}｜${s.timeOfDay}｜${s.summary}`).join('\n'),
  )
  return ok(`剧本状态：${p.script.status}（修订 ${p.script.revisions} 次）\n\n${lines.join('\n\n')}`)
}

async function redrawScriptApprove(call: ToolCall): Promise<ToolResult> {
  const p = readProject(call.cwd)
  if (p.script.status !== 'draft') return err('当前没有待批准的剧本草稿。')
  mutateProject(call.cwd, (proj) => {
    proj.script.status = 'approved'
    proj.script.approvedAt = Date.now()
    proj.script.episodes.forEach((e) => (e.status = 'approved'))
  })
  setGate(call.cwd, 'script', { answered: true, answer: str(call.args.answer) ?? 'approved' })
  setStep(call.cwd, 'script', 'done')
  return ok('剧本已批准。下一步：写分镜表（redraw_shotlist_upsert）。')
}

// ---------------------------------------------------------------------------
// 步骤 4 · 分镜表
// ---------------------------------------------------------------------------

function parseShots(raw: unknown, episodeId: string): ShotItem[] {
  if (!Array.isArray(raw)) return []
  const out: ShotItem[] = []
  let i = 0
  for (const s of raw as Record<string, unknown>[]) {
    if (!s || typeof s !== 'object') continue
    out.push({
      id: typeof s.id === 'string' && isSafeId(s.id) ? s.id : newShotId(),
      index: num(s.index) ?? i,
      episodeId: str(s.episodeId) ?? episodeId,
      durationSec: num(s.durationSec) ?? 3,
      shotSize: str(s.shotSize) ?? '',
      cameraMove: str(s.cameraMove) ?? '',
      scene: str(s.scene) ?? '',
      characters: strArr(s.characters),
      props: strArr(s.props),
      description: str(s.description) ?? '',
      ...(str(s.dialogue) ? { dialogue: str(s.dialogue)! } : {}),
      ...(str(s.voiceover) ? { voiceover: str(s.voiceover)! } : {}),
      ...(str(s.emotion) ? { emotion: str(s.emotion)! } : {}),
      ...(str(s.sourceFrameId) ? { sourceFrameId: str(s.sourceFrameId)! } : {}),
      boardIds: [],
      videoIds: [],
      status: 'draft',
      updatedAt: Date.now(),
    })
    i++
  }
  return out
}

async function redrawShotlistUpsert(call: ToolCall): Promise<ToolResult> {
  const shots = parseShots(call.args.shots, str(call.args.episode_id) ?? '')
  if (shots.length === 0) return err('需要 shots 数组（标准字段：shotSize/cameraMove/scene/characters/props/description/dialogue/emotion/durationSec）。')
  const revise = call.args.revise === true
  mutateProject(call.cwd, (p) => {
    if (revise) {
      for (const s of shots) {
        const idx = p.shots.findIndex((x) => x.index === s.index)
        if (idx >= 0) p.shots[idx] = { ...s, id: p.shots[idx]!.id, boardIds: p.shots[idx]!.boardIds, videoIds: p.shots[idx]!.videoIds }
        else p.shots.push(s)
      }
      p.shots.sort((a, b) => a.index - b.index)
      p.shots.forEach((s, i) => (s.index = i))
    } else {
      p.shots = shots
    }
  })
  setStep(call.cwd, 'shotlist', 'active')
  setGate(call.cwd, 'shotlist', { asked: true, answered: false, question: '分镜表已草拟，请确认是否批准（或提出修改）' })
  return ok(
    `已写入分镜表：${shots.length} 个镜头。\n` +
      `⚠️ 请先向用户展示分镜要点并**等待确认**，再调用 redraw_shotlist_approve。` +
      gateNotice(call.cwd),
  )
}

async function redrawShotlistGet(call: ToolCall): Promise<ToolResult> {
  const p = readProject(call.cwd)
  if (p.shots.length === 0) return ok('尚无分镜表。用 redraw_shotlist_upsert 写入。')
  const lines = p.shots.map(
    (s) =>
      `${s.index + 1}. [${s.shotSize}] ${s.durationSec}s｜${s.scene}｜${s.cameraMove}\n` +
      `   人物：${s.characters.join('、') || '—'}｜道具：${s.props.join('、') || '—'}\n` +
      `   画面：${s.description}\n` +
      (s.dialogue ? `   对白：${s.dialogue}\n` : '') +
      (s.voiceover ? `   旁白：${s.voiceover}\n` : '') +
      (s.emotion ? `   情绪：${s.emotion}` : ''),
  )
  return ok(`分镜表（${p.shots.length} 个镜头，状态 ${p.script.status}）：\n${lines.join('\n')}`)
}

async function redrawShotlistApprove(call: ToolCall): Promise<ToolResult> {
  const p = readProject(call.cwd)
  if (p.shots.length === 0) return err('尚无分镜表可批准。')
  mutateProject(call.cwd, (proj) => {
    proj.shots.forEach((s) => (s.status = 'approved'))
  })
  setGate(call.cwd, 'shotlist', { answered: true, answer: str(call.args.answer) ?? 'approved' })
  setStep(call.cwd, 'shotlist', 'done')
  return ok('分镜表已批准。下一步：分配资产（redraw_assets_upsert）。')
}

// ---------------------------------------------------------------------------
// 步骤 5 · 资产
// ---------------------------------------------------------------------------

async function redrawAssetsUpsert(call: ToolCall): Promise<ToolResult> {
  const raw = call.args.assets
  if (!Array.isArray(raw) || raw.length === 0) return err('需要 assets 数组（kind/name/spec/prompt，可选 variants）。')
  let count = 0
  mutateProject(call.cwd, (p) => {
    for (const a of raw as Record<string, unknown>[]) {
      if (!a || typeof a !== 'object') continue
      const kind = a.kind === 'prop' || a.kind === 'scene' ? a.kind : 'character'
      const name = str(a.name)
      if (!name) continue
      const variantsRaw = Array.isArray(a.variants) ? (a.variants as Record<string, unknown>[]) : []
      const existing = p.assets.find((x) => x.name === name && x.kind === kind)
      const variants = variantsRaw.map((v) => ({
        id: typeof v.id === 'string' && isSafeId(v.id) ? v.id : newVariantId(),
        name: str(v.name) ?? '变体',
        prompt: str(v.prompt) ?? '',
        status: 'spec' as const,
      }))
      if (existing) {
        existing.spec = str(a.spec) ?? existing.spec
        existing.prompt = str(a.prompt) ?? existing.prompt
        // 合并变体（按 name 去重）
        for (const v of variants) {
          if (!existing.variants.some((x) => x.name === v.name)) existing.variants.push(v)
        }
        existing.updatedAt = Date.now()
      } else {
        p.assets.push({
          id: newAssetId(),
          kind,
          name,
          spec: str(a.spec) ?? '',
          prompt: str(a.prompt) ?? '',
          variants,
          shotIds: [],
          status: 'spec',
          updatedAt: Date.now(),
        })
      }
      count++
    }
  })
  setStep(call.cwd, 'assets', 'active')
  return ok(
    `已写入 ${count} 个资产（文字设定 + 提示词）。\n` +
      `注意：**先文字设定+提示词，再生成资产图**（redraw_assets_generate kind=base）；` +
      `衍生变体用基础图作参考（kind=variant）。`,
  )
}

async function redrawAssetsList(call: ToolCall): Promise<ToolResult> {
  const p = readProject(call.cwd)
  if (p.assets.length === 0) return ok('尚无资产。用 redraw_assets_upsert 写入。')
  const group = (kind: AssetItem['kind']): string => {
    const items = p.assets.filter((a) => a.kind === kind)
    if (items.length === 0) return `（无）`
    return items
      .map(
        (a) =>
          `- ${a.name}（${a.id}，${a.status}）\n  设定：${a.spec}\n  提示词：${a.prompt}\n  基础图：${a.baseImage ? absPath(call.cwd, a.baseImage.path) : '（未生成）'}\n  变体：${
            a.variants.length ? a.variants.map((v) => `${v.name}[${v.status}]${v.image ? ' ' + absPath(call.cwd, v.image.path) : ''}`).join('；') : '（无）'
          }`,
      )
      .join('\n')
  }
  return ok(`人物：\n${group('character')}\n\n道具：\n${group('prop')}\n\n场景：\n${group('scene')}`)
}

async function redrawAssetsGenerate(call: ToolCall): Promise<ToolResult> {
  const assetId = str(call.args.asset_id)
  if (!assetId) return err('需要 asset_id')
  const variantId = str(call.args.variant_id)
  const p = readProject(call.cwd)
  const asset = p.assets.find((a) => a.id === assetId)
  if (!asset) return err(`资产不存在：${assetId}`)
  try {
    const job = startAssetGeneration(call.cwd, assetId, variantId)
    return ok(`已提交生成任务：${job.id}（${job.label}）。用 redraw_job_status 轮询；完成后图片路径会写入项目。`)
  } catch (e) {
    return err((e as Error).message)
  }
}

// ---------------------------------------------------------------------------
// 步骤 6 · 分镜图 / 视频
// ---------------------------------------------------------------------------

async function redrawBoardsPlan(call: ToolCall): Promise<ToolResult> {
  const boardType = str(call.args.board_type)
  const gridMode = str(call.args.grid_mode)
  if (boardType && !['single', 'firstLast', 'grid'].includes(boardType)) return err('board_type 取 single/firstLast/grid')
  if (gridMode && !['multiShot', 'subPanels'].includes(gridMode)) return err('grid_mode 取 multiShot/subPanels')
  mutateProject(call.cwd, (p) => {
    if (boardType) p.pipeline.globalPrefs.boardType = boardType as BoardGenOptions['kind']
    if (gridMode) p.pipeline.globalPrefs.gridMode = gridMode as 'multiShot' | 'subPanels'
  })
  return ok(`已记录分镜图偏好：类型=${boardType ?? '（沿用）'}，宫格=${gridMode ?? '（沿用）'}。后续沿用该偏好。`)
}

async function redrawBoardsGenerate(call: ToolCall): Promise<ToolResult> {
  const shotId = str(call.args.shot_id)
  const p = readProject(call.cwd)
  const prefs = p.pipeline.globalPrefs
  const kind = (str(call.args.kind) as BoardGenOptions['kind']) ?? prefs.boardType ?? 'single'
  const gridMode = (str(call.args.grid_mode) as 'multiShot' | 'subPanels') ?? prefs.gridMode ?? 'multiShot'

  const targets = shotId ? [shotId] : p.shots.map((s) => s.id)
  if (targets.length === 0) return err('没有镜头可生成分镜图。')

  const jobIds: string[] = []
  try {
    for (const id of targets) {
      const job = startBoardGeneration(call.cwd, id, { kind, gridMode, panels: num(call.args.panels) })
      jobIds.push(job.id)
    }
  } catch (e) {
    return err((e as Error).message)
  }
  setStep(call.cwd, 'generate', 'active')
  return ok(`已提交 ${jobIds.length} 个分镜图任务（类型 ${kind}${kind === 'grid' ? '/' + gridMode : ''}）：${jobIds.join(', ')}。用 redraw_job_status 轮询。`)
}

async function redrawVideoGenerate(call: ToolCall): Promise<ToolResult> {
  const shotId = str(call.args.shot_id)
  if (!shotId) return err('需要 shot_id')
  const p = readProject(call.cwd)
  const seconds = num(call.args.duration_sec)
  if (seconds !== undefined) mutateProject(call.cwd, (proj) => { proj.pipeline.globalPrefs.videoSeconds = seconds })
  try {
    const job = startVideoGeneration(call.cwd, shotId, {
      ...(str(call.args.prompt) ? { prompt: str(call.args.prompt)! } : {}),
      ...(seconds !== undefined ? { durationSec: seconds } : {}),
      ...(str(call.args.resolution) ? { resolution: str(call.args.resolution)! } : {}),
      ...(str(call.args.vendor_id) ? { vendorId: str(call.args.vendor_id)! } : {}),
      ...(str(call.args.model_name) ? { modelName: str(call.args.model_name)! } : {}),
    })
    return ok(`已提交视频生成任务：${job.id}（镜头 ${shotId}）。逐段输出，不拼接。用 redraw_job_status 轮询。`)
  } catch (e) {
    return err((e as Error).message)
  }
}

async function redrawJobStatus(call: ToolCall): Promise<ToolResult> {
  const id = str(call.args.job_id)
  if (id) {
    const job = getJob(id)
    if (!job) return err(`任务不存在：${id}`)
    return ok(
      `任务 ${job.id}（${job.kind}，${job.label}）：${job.status} ${Math.round(job.progress * 100)}%\n` +
        `${job.message}` +
        (job.error ? `\n错误：${job.error}` : '') +
        (job.result ? `\n产出：\n${job.result.paths.map((p) => '  ' + absPath(call.cwd, p)).join('\n')}` : ''),
    )
  }
  const jobs = listJobs(call.cwd)
  if (jobs.length === 0) return ok('当前没有任务。')
  const lines = jobs.slice(0, 20).map((j) => `- ${j.id} ${j.kind} ${j.status} ${Math.round(j.progress * 100)}% ${j.message}`)
  return ok(`任务（最近 ${lines.length} 个）：\n${lines.join('\n')}`)
}

async function redrawJobCancel(call: ToolCall): Promise<ToolResult> {
  const id = str(call.args.job_id)
  if (!id) return err('需要 job_id')
  return cancelJob(id) ? ok(`已取消任务 ${id}。`) : err(`无法取消：任务不存在或已结束（${id}）。`)
}

// ---------------------------------------------------------------------------
// 工具清单（名称必须与 tianshu.plugin.json 的 contributes.tools 完全一致）
// ---------------------------------------------------------------------------

function tool(
  name: string,
  description: string,
  input_schema: Record<string, unknown>,
  execute: (call: ToolCall) => Promise<ToolResult>,
  opts: { pathParams?: Record<string, 'read' | 'write'>; concurrencySafe?: boolean } = {},
): TpiTool {
  return {
    definition: { name, description, input_schema },
    pathParams: opts.pathParams ?? {},
    requiresApproval: () => false,
    isConcurrencySafe: () => opts.concurrencySafe === true,
    isEnabled: () => true,
    execute,
  }
}

export const tools: TpiTool[] = [
  // 通用
  tool('redraw_open', '启动/复用本工作区的本地画布服务并返回浏览器 URL（127.0.0.1）。**第一步永远先调用它。**', {
    type: 'object',
    properties: { port: { type: 'integer', description: '可选首选端口；0=自动分配（默认 43187）' } },
    required: [],
  }, redrawOpen, { concurrencySafe: true }),

  tool('redraw_get_state', '读取整体状态：流程进度与门控、计数、风格、本土化、素材、活跃任务、当前选中、画布 URL。修改任何东西前先调用。', {
    type: 'object', properties: {}, required: [],
  }, redrawGetState, { concurrencySafe: true }),

  tool('redraw_config_get', '读取工作区配置（密钥脱敏）与工作区适配文件列表。', {
    type: 'object', properties: {}, required: [],
  }, redrawConfigGet, { concurrencySafe: true }),

  tool('redraw_config_set', '写入配置：启用图像/视频供应商与模型（image_vendor/image_model/video_vendor/video_model）、设置某 vendor 的 input_values 与 trusted。', {
    type: 'object',
    properties: {
      image_vendor: { type: 'string' }, image_model: { type: 'string' },
      video_vendor: { type: 'string' }, video_model: { type: 'string' },
      vendor_id: { type: 'string', description: '要写入 input_values 的 vendor id' },
      input_values: { type: 'object', description: '如 {apiKey, baseUrl}' },
      trusted: { type: 'boolean', description: '是否信任该 vendor 的代码（需 true 才允许执行）' },
    },
    required: [],
  }, redrawConfigSet),

  tool('redraw_vendor_list', '列出工作区 vendors/*.ts 适配文件及其图像/视频模型与信任状态。', {
    type: 'object', properties: {}, required: [],
  }, redrawVendorList, { concurrencySafe: true }),

  tool('redraw_vendor_validate', '校验一个 vendor 适配文件能否加载（去类型 + 子进程执行 + vendor 形状）。', {
    type: 'object', properties: { vendor_id: { type: 'string' } }, required: ['vendor_id'],
  }, redrawVendorValidate, { concurrencySafe: true }),

  tool('redraw_style_list', '列出内置 + 工作区自定义转绘风格。', {
    type: 'object', properties: {}, required: [],
  }, redrawStyleList, { concurrencySafe: true }),

  tool('redraw_style_set', '锁定项目级转绘风格（其提示词片段会拼进所有生成提示词）。', {
    type: 'object', properties: { style_id: { type: 'string' } }, required: ['style_id'],
  }, redrawStyleSet),

  // 步骤 1
  tool('redraw_frames_ingest', '接收素材：本地视频文件路径（video_path）或纯文本剧情（story）。视频会复制进工作区。', {
    type: 'object',
    properties: { video_path: { type: 'string', description: '本地视频文件路径' }, story: { type: 'string', description: '纯文本剧情（无视频时）' } },
    required: [],
  }, redrawFramesIngest, { pathParams: { video_path: 'read' } }),

  tool('redraw_frames_extract', '提交抽帧请求（固定间隔）。**抽帧在浏览器内用 ffmpeg.wasm 执行**，需用户打开画布。', {
    type: 'object', properties: { interval_sec: { type: 'number', description: '抽帧间隔秒（默认 2）' } }, required: [],
  }, redrawFramesExtract),

  tool('redraw_frames_list', '列出抽帧结果路径与宫格总览图路径。**你无法直接看到图像**，请让用户查看。', {
    type: 'object', properties: {}, required: [],
  }, redrawFramesList, { concurrencySafe: true }),

  // 步骤 2
  tool('redraw_localize_set', '记录目标地区与结构化本土化报告（服饰/建筑/节日/禁忌/色彩偏好）。', {
    type: 'object',
    properties: {
      region: { type: 'string' }, template_id: { type: 'string' },
      checklist: { type: 'object', properties: { costume: { type: 'string' }, architecture: { type: 'string' }, festival: { type: 'string' }, taboos: { type: 'string' }, colorPreference: { type: 'string' }, notes: { type: 'string' } } },
    },
    required: ['region'],
  }, redrawLocalizeSet),

  tool('redraw_localize_get', '读取当前本土化报告。', { type: 'object', properties: {}, required: [] }, redrawLocalizeGet, { concurrencySafe: true }),

  // 步骤 3
  tool('redraw_script_upsert', '写入/修订剧本草稿（episodes 数组）。写完后必须**停下问用户确认**。', {
    type: 'object',
    properties: {
      episodes: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, logline: { type: 'string' }, synopsis: { type: 'string' }, scenes: { type: 'array', items: { type: 'object' } } } } },
      revise: { type: 'boolean', description: 'true=按集号合并修订，false=整体替换' },
    },
    required: ['episodes'],
  }, redrawScriptUpsert),

  tool('redraw_script_get', '读取当前剧本。', { type: 'object', properties: {}, required: [] }, redrawScriptGet, { concurrencySafe: true }),

  tool('redraw_script_approve', '批准剧本（需用户已确认）。', {
    type: 'object', properties: { answer: { type: 'string' } }, required: [],
  }, redrawScriptApprove),

  // 步骤 4
  tool('redraw_shotlist_upsert', '写入/修订分镜表（shots 数组，标准全套字段）。写完后必须**停下问用户确认**。', {
    type: 'object',
    properties: {
      shots: { type: 'array', items: { type: 'object', properties: { index: { type: 'number' }, durationSec: { type: 'number' }, shotSize: { type: 'string' }, cameraMove: { type: 'string' }, scene: { type: 'string' }, characters: { type: 'array', items: { type: 'string' } }, props: { type: 'array', items: { type: 'string' } }, description: { type: 'string' }, dialogue: { type: 'string' }, voiceover: { type: 'string' }, emotion: { type: 'string' } } } },
      episode_id: { type: 'string' },
      revise: { type: 'boolean' },
    },
    required: ['shots'],
  }, redrawShotlistUpsert),

  tool('redraw_shotlist_get', '读取当前分镜表。', { type: 'object', properties: {}, required: [] }, redrawShotlistGet, { concurrencySafe: true }),

  tool('redraw_shotlist_approve', '批准分镜表（需用户已确认）。', {
    type: 'object', properties: { answer: { type: 'string' } }, required: [],
  }, redrawShotlistApprove),

  // 步骤 5
  tool('redraw_assets_upsert', '写入资产（人物/道具/场景）的文字设定与提示词，及衍生变体。**先文字后生成图**。', {
    type: 'object',
    properties: {
      assets: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['character', 'prop', 'scene'] }, name: { type: 'string' }, spec: { type: 'string' }, prompt: { type: 'string' }, variants: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, prompt: { type: 'string' } } } } } } },
    },
    required: ['assets'],
  }, redrawAssetsUpsert),

  tool('redraw_assets_list', '列出资产、变体及其图片路径。', { type: 'object', properties: {}, required: [] }, redrawAssetsList, { concurrencySafe: true }),

  tool('redraw_assets_generate', '生成资产图：kind=base（基础图）或 kind=variant（变体，用基础图作参考）。', {
    type: 'object',
    properties: { asset_id: { type: 'string' }, variant_id: { type: 'string', description: 'kind=variant 时必填' } },
    required: ['asset_id'],
  }, redrawAssetsGenerate),

  // 步骤 6
  tool('redraw_boards_plan', '记录分镜图偏好（类型 single/firstLast/grid；宫格 multiShot/subPanels），后续沿用。', {
    type: 'object', properties: { board_type: { type: 'string', enum: ['single', 'firstLast', 'grid'] }, grid_mode: { type: 'string', enum: ['multiShot', 'subPanels'] } }, required: [],
  }, redrawBoardsPlan),

  tool('redraw_boards_generate', '生成分镜图（省略 shot_id 则对全部镜头）。类型/宫格沿用偏好或本次指定。', {
    type: 'object',
    properties: {
      shot_id: { type: 'string' }, kind: { type: 'string', enum: ['single', 'firstLast', 'grid'] },
      grid_mode: { type: 'string', enum: ['multiShot', 'subPanels'] }, panels: { type: 'number', description: 'subPanels 分格数' },
    },
    required: [],
  }, redrawBoardsGenerate),

  tool('redraw_video_generate', '为一个镜头生成一段视频（逐段，不拼接）。可指定秒数/分辨率/供应商/模型。', {
    type: 'object',
    properties: {
      shot_id: { type: 'string' }, prompt: { type: 'string' }, duration_sec: { type: 'number' },
      resolution: { type: 'string' }, vendor_id: { type: 'string' }, model_name: { type: 'string' },
    },
    required: ['shot_id'],
  }, redrawVideoGenerate),

  tool('redraw_job_status', '查询任务状态与产出路径（指定 job_id 或列出全部）。', {
    type: 'object', properties: { job_id: { type: 'string' } }, required: [],
  }, redrawJobStatus, { concurrencySafe: true }),

  tool('redraw_job_cancel', '取消一个进行中的任务。', {
    type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'],
  }, redrawJobCancel),

  tool('redraw_add_edge', '在画布上为两个节点（镜头/资产/分镜）连线。', {
    type: 'object', properties: { source: { type: 'string' }, target: { type: 'string' }, label: { type: 'string' } }, required: ['source', 'target'],
  }, async (call) => {
    const s = str(call.args.source)
    const t = str(call.args.target)
    if (!s || !t) return err('需要 source 与 target')
    try {
      const edge = addEdge(call.cwd, s, t, str(call.args.label))
      return ok(`已连线 ${edge.source} → ${edge.target}`)
    } catch (e) {
      return err((e as Error).message)
    }
  }),
]
