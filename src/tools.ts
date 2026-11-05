/**
 * 工具实现。与宿主解耦：只依赖 node 内置模块，可脱离天枢直接单测。
 *
 * execute 收到宿主传入的 { args, cwd, sessionId }（cwd = 会话工作区根）。
 * 返回值约定：{ content: string, isError?: boolean } —— 宿主只透传这两个字段，
 * 其它字段一律丢弃，因此 URL / id / 路径都必须写进 content 文本。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_ASPECT, isAspectType, resolveSize, type AspectType } from './aspect.js'
import { isSafeId, newShotId } from './ids.js'
import {
  addEdge,
  autoLayoutPosition,
  duplicateShot,
  nextLayoutIndex,
  PROJECT_DIR_NAME,
  projectFile,
  projectIssue,
  readProject,
  readSelection,
  removeEdge,
  removeShot,
  takeProjectBackup,
  upsertShot,
  writeShotHtml,
  type Project,
  type Selection,
  type ShotNode,
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

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function positive(v: number | undefined): number | undefined {
  return v !== undefined && v > 0 ? Math.round(v) : undefined
}

/** 写入前若备份过有问题的项目文件，把备份路径告诉调用方（宿主只透传 content）。 */
function withBackupNotice(run: (call: ToolCall) => Promise<ToolResult>): (call: ToolCall) => Promise<ToolResult> {
  return async (call) => {
    const result = await run(call)
    const backup = takeProjectBackup(call.cwd)
    if (!backup) return result
    return { ...result, content: `${result.content}\n注意：project.json 曾损坏或含无效条目，覆盖前已备份到 ${backup}` }
  }
}

function projectHint(cwd: string): string {
  return `${PROJECT_DIR_NAME}/（项目文件：${projectFile(cwd)}）`
}

// ---------------------------------------------------------------------------
// redraw_open
// ---------------------------------------------------------------------------

async function redrawOpen(call: ToolCall): Promise<ToolResult> {
  const port = num(call.args.port)
  const { url } = await ensureServer(call.cwd, port ?? undefined)
  writeUrlHint(call.cwd, url)
  if (call.args.open === true) openBrowser(url)
  return {
    content:
      `画布服务已就绪。请立刻把下面这一行原样发给用户（单独一行，便于点击）：\n` +
      `${url}\n` +
      `在用户拿到链接后，再开始写入分镜镜头（redraw_upsert_shot）。\n` +
      `工作区：${call.cwd}\n` +
      `项目文件：${projectFile(call.cwd)}\n` +
      `操作提示：空格+拖拽 或 中键拖拽 平移；Ctrl+滚轮 缩放；普通滚轮 平移。`,
  }
}

function writeUrlHint(cwd: string, url: string): void {
  try {
    writeFileSync(join(cwd, PROJECT_DIR_NAME, 'url.txt'), url + '\n', 'utf8')
  } catch {
    /* 目录可能尚未创建；忽略 */
  }
}

function openBrowser(url: string): void {
  try {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// redraw_upsert_shot（新增 / 更新内容 / 重命名 / 移动 / 改尺寸）
// ---------------------------------------------------------------------------

async function redrawUpsertShot(call: ToolCall): Promise<ToolResult> {
  const args = call.args
  const htmlPath = str(args.html_path)
  let html: string | undefined
  if (htmlPath) {
    if (!existsSync(htmlPath)) {
      return { content: `读取失败：文件不存在 ${htmlPath}`, isError: true }
    }
    try {
      html = readFileSync(htmlPath, 'utf8')
    } catch (err) {
      return { content: `读取失败：${(err as Error).message}`, isError: true }
    }
  } else {
    html = str(args.html)
  }

  const requestedId = str(args.id)
  if (requestedId && !isSafeId(requestedId)) {
    return { content: `非法 id：${requestedId}（仅允许字母数字、下划线、连字符，1–64 位）`, isError: true }
  }

  const project = readProject(call.cwd)
  const existing = requestedId ? project.shots.find((n) => n.id === requestedId) : undefined
  if (!html && !existing) {
    return {
      content:
        '缺少内容：请提供 html_path（工作区内的 HTML 文件）或 html（内联 HTML）。' +
        '仅更新已有镜头的标题/位置/尺寸时，需传已存在的 id。',
      isError: true,
    }
  }
  const id = requestedId ?? newShotId()

  // 已存在的节点：未显式指定画幅/尺寸时沿用原值，避免只改标题就把尺寸重置。
  const aspectProvided = isAspectType(args.aspect)
  const aspect: AspectType = isAspectType(args.aspect)
    ? args.aspect
    : (existing?.aspect ?? DEFAULT_ASPECT)
  const base = existing && !aspectProvided ? { width: existing.width, height: existing.height } : resolveSize(aspect)
  const size = {
    width: positive(num(args.width)) ?? base.width,
    height: positive(num(args.height)) ?? base.height,
  }

  let x = num(args.x)
  let y = num(args.y)
  if (x === undefined || y === undefined) {
    if (existing) {
      x = x ?? existing.x
      y = y ?? existing.y
    } else {
      const pos = autoLayoutPosition(nextLayoutIndex(call.cwd), size)
      x = x ?? pos.x
      y = y ?? pos.y
    }
  }

  const rel = html !== undefined ? writeShotHtml(call.cwd, id, html) : (existing?.contentPath ?? '')
  const now = Date.now()
  const shot: ShotNode = {
    id,
    type: 'shot',
    title: str(args.title) ?? existing?.title ?? id,
    x,
    y,
    width: size.width,
    height: size.height,
    aspect,
    contentPath: rel,
    contentRev: html !== undefined ? now : existing?.contentRev,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  upsertShot(call.cwd, shot)

  // 确保画布服务在跑，这样返回里一定带可点击的画布 URL（用户能看到）。
  const { url } = await ensureServer(call.cwd)
  return {
    content:
      `${existing ? '已更新' : '已添加'}镜头节点「${shot.title}」（id=${id}）。\n` +
      `位置：x=${shot.x}, y=${shot.y}；尺寸：${shot.width}×${shot.height}（${aspect}）\n` +
      (html !== undefined ? `分镜文件：${join(call.cwd, rel)}\n` : `分镜内容未改动（仅更新了节点信息）。\n`) +
      `画布 URL：${url}\n` +
      `项目：${projectHint(call.cwd)}`,
  }
}

// ---------------------------------------------------------------------------
// redraw_get_state（镜头列表 + 连线 + 选中项 + URL）
// ---------------------------------------------------------------------------

function formatSelection(selection: Selection, project: Project): string[] {
  const shot = project.shots.find((n) => n.id === selection.shotId)
  const shotTitle = shot ? shot.title : selection.shotId
  const lines: string[] = [
    `选中类型：${selection.kind === 'element' ? '镜头内元素' : '整个镜头节点'}`,
    `所属镜头：${shotTitle}（id=${selection.shotId}）`,
  ]
  if (selection.kind === 'element' && selection.element) {
    const el = selection.element
    lines.push(`元素：<${el.tagName}> xpath=${el.xpath}`)
    if (el.textContent) lines.push(`文本：${el.textContent}`)
    if (el.computedStyles) {
      const keys = ['color', 'background-color', 'font-size', 'font-weight', 'padding', 'margin', 'border-radius']
      const picked = keys
        .filter((k) => el.computedStyles?.[k])
        .map((k) => `${k}: ${el.computedStyles?.[k]}`)
      if (picked.length) lines.push(`关键样式：${picked.join('；')}`)
    }
  }
  return lines
}

async function redrawGetState(call: ToolCall): Promise<ToolResult> {
  const project = readProject(call.cwd)
  const selection = readSelection(call.cwd)
  const url = currentUrl(call.cwd)
  const sections: string[] = []

  const issue = projectIssue(call.cwd)
  if (issue) sections.push(`警告：${issue}`)

  if (project.shots.length === 0) {
    sections.push('画布上暂无镜头节点。\n用 redraw_upsert_shot 添加一个分镜。')
  } else {
    const lines = project.shots.map((n, i) => {
      return (
        `${i + 1}. ${n.title} (id=${n.id})\n` +
        `   位置 x=${n.x}, y=${n.y}；尺寸 ${n.width}×${n.height}（${n.aspect}）`
      )
    })
    sections.push(`画布上有 ${project.shots.length} 个镜头节点：\n${lines.join('\n')}`)
  }

  if (project.edges.length > 0) {
    const titleOf = (id: string): string => project.shots.find((n) => n.id === id)?.title ?? id
    const lines = project.edges.map(
      (e) => `- ${titleOf(e.source)}（${e.source}） → ${titleOf(e.target)}（${e.target}）${e.label ? `：${e.label}` : ''}`,
    )
    sections.push(`镜头连线（${project.edges.length} 条）：\n${lines.join('\n')}`)
  }

  if (selection) {
    sections.push(`当前选中：\n${formatSelection(selection, project).join('\n')}`)
  } else {
    sections.push(
      '当前画布没有选中项。\n' +
        '请在浏览器打开画布，点击某个镜头节点后再试。',
    )
  }

  sections.push(url ? `画布 URL：${url}` : '提示：先调用 redraw_open 获取画布 URL。')
  return { content: sections.join('\n\n') }
}

// ---------------------------------------------------------------------------
// redraw_arrange（remove / duplicate / link / unlink）
// ---------------------------------------------------------------------------

async function redrawArrange(call: ToolCall): Promise<ToolResult> {
  const action = str(call.args.action)
  switch (action) {
    case 'remove': {
      const id = str(call.args.id)
      if (!id) return { content: 'remove 需要 id。', isError: true }
      const project = readProject(call.cwd)
      if (!project.shots.some((n) => n.id === id)) return { content: `镜头不存在：${id}`, isError: true }
      const next = removeShot(call.cwd, id)
      return { content: `已删除镜头节点 ${id}（连带其连线与分镜文件）。剩余 ${next.shots.length} 个节点。` }
    }
    case 'duplicate': {
      const id = str(call.args.id)
      if (!id) return { content: 'duplicate 需要 id。', isError: true }
      try {
        const shot = duplicateShot(call.cwd, id, str(call.args.title))
        const { url } = await ensureServer(call.cwd)
        return {
          content:
            `已复制镜头节点，新 id=${shot.id}，标题「${shot.title}」。\n` +
            `位置：x=${shot.x}, y=${shot.y}\n画布 URL：${url}`,
        }
      } catch (err) {
        return { content: (err as Error).message, isError: true }
      }
    }
    case 'link': {
      const source = str(call.args.source)
      const target = str(call.args.target)
      if (!source || !target) return { content: 'link 需要 source 和 target。', isError: true }
      try {
        const edge = addEdge(call.cwd, source, target, str(call.args.label))
        return { content: `已连线 ${edge.source} → ${edge.target}${edge.label ? `（${edge.label}）` : ''}。` }
      } catch (err) {
        return { content: (err as Error).message, isError: true }
      }
    }
    case 'unlink': {
      const source = str(call.args.source)
      const target = str(call.args.target)
      if (!source || !target) return { content: 'unlink 需要 source 和 target。', isError: true }
      const before = readProject(call.cwd).edges.length
      const next = removeEdge(call.cwd, source, target)
      if (next.edges.length === before) return { content: `没有匹配的连线 ${source} → ${target}，未作改动。` }
      return { content: `已取消连线 ${source} → ${target}。` }
    }
    default:
      return {
        content: `未知或缺失的 action：${action ?? '(空)'}。可选：remove / duplicate / link / unlink。`,
        isError: true,
      }
  }
}

// ---------------------------------------------------------------------------
// 工具清单（名称必须与 tianshu.plugin.json 的 contributes.tools 完全一致）
// ---------------------------------------------------------------------------

export const tools: TpiTool[] = [
  {
    definition: {
      name: 'redraw_open',
      description:
        '启动/复用本工作区的本地画布服务，返回可在浏览器打开的 URL（127.0.0.1）。' +
        '**这是转绘短剧工厂的第一步：先调用本工具把画布链接给用户，再开始写入分镜。**',
      input_schema: {
        type: 'object',
        properties: {
          port: { type: 'integer', description: '可选首选端口；0=自动分配（默认 43187，被占用则递增）' },
          open: { type: 'boolean', description: '可选：尝试用系统默认浏览器打开（默认 false）' },
        },
        required: [],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: redrawOpen,
  },
  {
    definition: {
      name: 'redraw_upsert_shot',
      description:
        '新增或更新画布上的镜头节点。优先传 html（内联）写入分镜卡内容（自动保存到 .tianshu-redraw/shots/，无需也不要在工作区另建文件夹），html_path 仅用于导入已有文件。' +
        '对已有 id 可省略 html，仅更新标题/位置/尺寸/画幅（即重命名、移动、调整尺寸，未指定的字段保持原值）。' +
        '返回里会带上画布 URL（若画布服务尚未启动会自动启动）。',
      input_schema: {
        type: 'object',
        properties: {
          html_path: { type: 'string', description: '已有 HTML 文件路径（工作区内，优先于 html）；一般不要用，请直接用 html 内联' },
          html: { type: 'string', description: '内联 HTML（推荐方式：分镜只存放在 .tianshu-redraw/shots/）；更新已有镜头的元数据时可省略' },
          title: { type: 'string', description: '镜头标题（如「第1集 · 镜头03」）' },
          id: { type: 'string', description: '镜头 id（字母数字/_/-）。缺省则新建并自动生成；传已存在的 id 则更新该镜头' },
          x: { type: 'number', description: '画布 X 坐标（新建缺省按网格自动排布；更新缺省保持原位）' },
          y: { type: 'number', description: '画布 Y 坐标（新建缺省按网格自动排布；更新缺省保持原位）' },
          width: { type: 'number', description: '逻辑宽度 px（覆盖画幅预设）' },
          height: { type: 'number', description: '逻辑高度 px（覆盖画幅预设）' },
          aspect: {
            type: 'string',
            enum: ['portrait', 'landscape', 'square', 'free'],
            description: '画幅预设（新建默认 portrait 竖屏 9:16；更新缺省保持原画幅与尺寸）',
          },
        },
        required: [],
      },
    },
    pathParams: { html_path: 'read' },
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(redrawUpsertShot),
  },
  {
    definition: {
      name: 'redraw_get_state',
      description:
        '读取画布当前状态：所有镜头节点（id/标题/位置/尺寸/画幅）、镜头连线、' +
        '用户在画布上的选中项（整个镜头或镜头内元素，含 xpath/标签/文案/关键样式）以及画布 URL。' +
        '修改分镜前先调用，据此定位用户指的是哪个镜头。',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: withBackupNotice(redrawGetState),
  },
  {
    definition: {
      name: 'redraw_arrange',
      description:
        '编排画布：按 action 删除镜头（remove，连带其连线与分镜文件）、复制镜头（duplicate）、' +
        '在两个镜头间连线（link）或取消连线（unlink）。重命名/移动请用 redraw_upsert_shot。',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['remove', 'duplicate', 'link', 'unlink'],
            description: '操作类型',
          },
          id: { type: 'string', description: 'remove / duplicate 使用：镜头节点 id' },
          title: { type: 'string', description: 'duplicate 可选：新标题（默认「原标题 副本」）' },
          source: { type: 'string', description: 'link / unlink 使用：源镜头 id' },
          target: { type: 'string', description: 'link / unlink 使用：目标镜头 id' },
          label: { type: 'string', description: 'link 可选：连线标签' },
        },
        required: ['action'],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(redrawArrange),
  },
]
