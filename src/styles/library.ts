/**
 * 内置转绘风格库（可扩展：工作区 .tianshu-redraw/styles/*.json 追加/覆盖）。
 *
 * 每个风格提供：id / 名称 / 分类 / 提示词片段 / 描述。
 * 提示词片段会被拼进资产图、分镜图、视频提示词，保证全局视觉统一。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectDir } from '../project.js'
import { isSafeId } from '../ids.js'

export interface RedrawStyle {
  id: string
  name: string
  category: 'anime' | 'regional' | 'cinematic' | 'custom'
  tagline: string
  /** 拼进生成提示词的片段（英文/中文均可，供应商多接受英文）。 */
  promptFragment: string
  description?: string
  builtin: boolean
}

const BUILTIN: RedrawStyle[] = [
  {
    id: 'anime-jp',
    name: '日系动漫',
    category: 'anime',
    tagline: '赛璐璐上色、干净线稿、日式五官',
    promptFragment: 'Japanese anime style, cel shading, clean line art, expressive eyes, vibrant colors, studio-quality key visual',
    builtin: true,
  },
  {
    id: 'anime-cn',
    name: '国风动漫',
    category: 'anime',
    tagline: '水墨质感、东方配色、写意线条',
    promptFragment: 'Chinese guofeng anime style, ink-wash texture, oriental color palette, elegant flowing lines, traditional aesthetics',
    builtin: true,
  },
  {
    id: 'anime-us',
    name: '欧美卡通',
    category: 'anime',
    tagline: '厚涂、强对比、夸张造型',
    promptFragment: 'Western cartoon style, painterly rendering, bold shapes, strong contrast, Pixar-like appeal',
    builtin: true,
  },
  {
    id: 'anime-kr',
    name: '韩系条漫',
    category: 'anime',
    tagline: '柔和光影、精致五官、都市感',
    promptFragment: 'Korean webtoon style, soft lighting, delicate facial features, modern urban aesthetic, semi-realistic',
    builtin: true,
  },
  {
    id: 'real-cinematic',
    name: '电影写实',
    category: 'cinematic',
    tagline: '真实质感、电影级布光',
    promptFragment: 'cinematic photorealism, film-grade lighting, shallow depth of field, 35mm lens, natural skin texture',
    builtin: true,
  },
  {
    id: 'real-3d',
    name: '3D 渲染',
    category: 'cinematic',
    tagline: '三维质感、次世代渲染',
    promptFragment: 'high-quality 3D render, next-gen game cinematic, subsurface scattering, detailed materials, unreal engine look',
    builtin: true,
  },
]

function stylesDir(cwd: string): string {
  return join(projectDir(cwd), 'styles')
}

/** 读取工作区自定义风格（覆盖同 id 内置）。 */
function loadUserStyles(cwd: string): RedrawStyle[] {
  const dir = stylesDir(cwd)
  if (!existsSync(dir)) return []
  const out: RedrawStyle[] = []
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const id = f.replace(/\.json$/, '')
      if (!isSafeId(id)) continue
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>
        if (typeof raw.name !== 'string' || typeof raw.promptFragment !== 'string') continue
        out.push({
          id,
          name: raw.name,
          category: (['anime', 'regional', 'cinematic', 'custom'] as const).includes(raw.category as RedrawStyle['category'])
            ? (raw.category as RedrawStyle['category'])
            : 'custom',
          tagline: typeof raw.tagline === 'string' ? raw.tagline : '',
          promptFragment: raw.promptFragment,
          ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
          builtin: false,
        })
      } catch {
        /* 跳过非法文件 */
      }
    }
  } catch {
    /* 目录不可读 */
  }
  return out
}

/** 全部可用风格（内置 + 工作区，工作区同 id 覆盖）。 */
export function listStyles(cwd: string): RedrawStyle[] {
  const map = new Map<string, RedrawStyle>()
  for (const s of BUILTIN) map.set(s.id, s)
  for (const s of loadUserStyles(cwd)) map.set(s.id, s)
  return [...map.values()]
}

export function resolveStyle(cwd: string, id: string): RedrawStyle | null {
  return listStyles(cwd).find((s) => s.id === id) ?? null
}

/** 风格选项的展示文本（供工具输出/提问）。 */
export function formatStyleList(cwd: string): string {
  const styles = listStyles(cwd)
  const lines = styles.map((s) => `- ${s.name}（${s.id}）${s.builtin ? '' : ' [自定义]'}：${s.tagline}`)
  return `可选转绘风格（项目级锁定）：\n${lines.join('\n')}\n\n锁定：redraw_style_set style_id=<id>；也可在 .tianshu-redraw/styles/ 放自定义风格 JSON。`
}

/** 本土化模板（结构化文化调研清单）。 */
export interface LocalizationTemplate {
  id: string
  name: string
  region: string
  prompt: string
}

export const LOCALIZATION_TEMPLATES: LocalizationTemplate[] = [
  {
    id: 'default',
    name: '通用地区本土化',
    region: '',
    prompt:
      '请针对目标地区做本土化调研，输出结构化清单：服饰（日常/礼仪/阶层差异）、建筑（民居/公共空间/材质）、' +
      '节日与习俗、禁忌与敏感点、色彩偏好与象征。要求中性、客观、避免刻板印象，且完全可被用户编辑。',
  },
]

export function localizationTemplate(id: string): LocalizationTemplate {
  return LOCALIZATION_TEMPLATES.find((t) => t.id === id) ?? LOCALIZATION_TEMPLATES[0]!
}
