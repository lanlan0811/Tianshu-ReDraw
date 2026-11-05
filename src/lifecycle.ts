/**
 * 生命周期钩子。
 *
 * turnStart：把当前流水线状态以 XML 块注入模型上下文（promptContext.setBlock 仅在此刻生效）。
 * 根标签必须以「插件 id 归一化前缀」开头 → id `tianshu-redraw` → `<tianshu-redraw-state>`。
 *
 * toolEnd / turnEnd：维护内存镜像（当前无额外逻辑，保留钩子以便后续扩展）。
 * sessionEnd：刷新任务快照到插件数据目录（宿主崩溃时可诊断），取消孤儿任务。
 */
import { existsSync, writeFileSync } from 'node:fs'
import { activeJobs, cancelJob, listJobs } from './jobs.js'
import { pendingGate, readProject, readSelection, STEP_IDS } from './project.js'
import { readConfig, redactConfig } from './config.js'
import type { Project } from './project.js'

export interface TurnStartEvent {
  userInput?: string
  turnMode?: string
  turn?: number
  signal?: AbortSignal
}

const TRIGGER_RE = /转绘|短剧|分镜|镜头|抽帧|redraw|storyboard|drama/i

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/** 组装状态块。 */
export function buildStateBlock(cwd: string): string {
  const p = readProject(cwd)
  const jobs = activeJobs(cwd)
  const gate = pendingGate(p)
  const sel = readSelection(cwd)
  const cfg = redactConfig(readConfig(cwd))

  const lines: string[] = ['<tianshu-redraw-state>']
  lines.push(`  <project exists="true" step="${p.pipeline.currentStep}" title="${esc(p.meta.title)}" />`)
  lines.push('  <pipeline>')
  for (const id of STEP_IDS) {
    const s = p.pipeline.steps[id]
    const gateAttr = s.gate ? ` gate="${s.gate.answered ? 'answered' : s.gate.asked ? 'pending' : 'unasked'}"` : ''
    lines.push(`    <step id="${id}" status="${s.status}"${gateAttr} />`)
  }
  lines.push('  </pipeline>')
  if (gate) lines.push(`  <gate pending="true" step="${gate.step}" question="${esc(gate.question ?? '等待用户确认')}" />`)
  lines.push(
    `  <counts frames="${p.frames.length}" shots="${p.shots.length}" assets="${p.assets.length}" boards="${p.boards.length}" videos="${p.videos.length}" />`,
  )
  if (jobs.length) {
    const j = jobs[0]!
    lines.push(`  <jobs active="${jobs.length}" latest="${j.id}" kind="${j.kind}" status="${j.status}" progress="${j.progress.toFixed(2)}" />`)
  }
  const prefs = p.pipeline.globalPrefs
  const prefParts: string[] = []
  if (prefs.boardType) prefParts.push(`boardType="${prefs.boardType}"`)
  if (prefs.gridMode) prefParts.push(`gridMode="${prefs.gridMode}"`)
  if (prefs.videoModel) prefParts.push(`videoModel="${esc(prefs.videoModel.modelName)}"`)
  if (prefs.videoSeconds) prefParts.push(`videoSeconds="${prefs.videoSeconds}"`)
  if (prefParts.length) lines.push(`  <prefs ${prefParts.join(' ')} />`)
  if (p.style.styleId) lines.push(`  <style id="${p.style.styleId}" />`)
  if (cfg.active.image) lines.push(`  <imageModel vendor="${cfg.active.image.vendorId}" model="${cfg.active.image.modelName}" />`)
  if (cfg.active.video) lines.push(`  <videoModel vendor="${cfg.active.video.vendorId}" model="${cfg.active.video.modelName}" />`)
  if (sel && sel.kind !== 'none') lines.push(`  <selection kind="${sel.kind}" id="${sel.id ?? ''}" />`)
  if (p.source.mode === 'video' && p.source.videoPath) lines.push(`  <source mode="video" videoPath="${esc(p.source.videoPath)}" />`)
  else if (p.source.story) lines.push(`  <source mode="story" />`)
  lines.push('</tianshu-redraw-state>')
  return lines.join('\n')
}

/** 最小状态块（无项目时引导第一步）。 */
function minimalBlock(): string {
  return [
    '<tianshu-redraw-state>',
    '  <project exists="false" />',
    '  <hint>尚无项目。第一步调用 redraw_open 拿到画布链接并单独一行发给用户，再 redraw_frames_ingest。</hint>',
    '</tianshu-redraw-state>',
  ].join('\n')
}

export interface LifecycleHost {
  cwd?: string
  promptContext?: { setBlock: (block: string | null) => void }
  storage?: { dataDir: () => string }
  log?: { debug: (m: string) => void; warn: (m: string) => void }
}

/** 构造 lifecycle 处理器（activate 内调用，捕获 host）。 */
export function makeLifecycle(host: LifecycleHost): {
  turnStart: (e: TurnStartEvent) => void
  toolEnd: (e: unknown) => void
  turnEnd: (e: unknown) => void
  sessionEnd: (e: unknown) => void
} {
  return {
    turnStart(e: TurnStartEvent) {
      const cwd = host.cwd
      if (!cwd || !host.promptContext) return
      try {
        const projectExists = existsSync(`${cwd}/.tianshu-redraw/project.json`)
        const triggered = TRIGGER_RE.test(e.userInput ?? '')
        if (!projectExists && !triggered) {
          host.promptContext.setBlock(null)
          return
        }
        host.promptContext.setBlock(projectExists ? buildStateBlock(cwd) : minimalBlock())
      } catch (err) {
        host.log?.warn(`turnStart 状态块注入失败：${(err as Error).message}`)
      }
    },
    toolEnd() {
      /* 预留：可在此维护内存镜像 */
    },
    turnEnd() {
      /* 预留 */
    },
    sessionEnd() {
      const cwd = host.cwd
      if (!cwd) return
      try {
        // 取消孤儿任务
        for (const j of listJobs(cwd)) {
          if (j.status === 'running' || j.status === 'queued') cancelJob(j.id)
        }
        // 快照到插件数据目录（便于诊断）
        const dir = host.storage?.dataDir()
        if (dir) {
          const snapshot = { at: Date.now(), jobs: listJobs(cwd).map((j) => ({ id: j.id, kind: j.kind, status: j.status })) }
          writeFileSync(`${dir}/jobs-${Date.now()}.json`, JSON.stringify(snapshot, null, 2), 'utf8')
        }
      } catch (err) {
        host.log?.warn(`sessionEnd 收尾失败：${(err as Error).message}`)
      }
    },
  }
}

export type { Project }
