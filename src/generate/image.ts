/**
 * 图像生成编排：资产图（基础/变体）、分镜图（单帧/首尾帧/宫格）。
 *
 * 全部走 job：工具立即返回 jobId，实际调用在后台，完成时回写 project.json。
 * vendor 返回有头 base64 → media.persistMedia 落盘 → 更新 MediaRef。
 */
import { relative } from 'node:path'
import { createJob, runJob, type Job } from '../jobs.js'
import { persistMedia } from '../media.js'
import { readConfig } from '../config.js'
import { getVendorSession, type VendorSession } from '../vendor/runner.js'
import type { ImageConfig, ImageModel } from '../vendor/types.js'
import { newBoardId, newVideoId } from '../ids.js'
import {
  assetsDir,
  boardsDir,
  mutateProject,
  projectDir,
  readMediaBuffer,
  readProject,
  type BoardItem,
  type GridMode,
  type MediaRef,
  type Project,
  type ShotItem,
} from '../project.js'

export interface ActiveImageVendor {
  vendorId: string
  modelName: string
  model: ImageModel
  session: VendorSession
}

/** 解析当前启用的图像供应商（config.active.image + vendor 校验）。 */
export async function resolveImageVendor(cwd: string): Promise<ActiveImageVendor> {
  const cfg = readConfig(cwd)
  const active = cfg.active.image
  if (!active) throw new Error('未配置图像模型：请先在 config.json 的 active.image 指定 vendorId 与 modelName')
  const entry = cfg.vendors[active.vendorId]
  if (!entry?.trusted) throw new Error(`供应商 ${active.vendorId} 未标记为可信：请在 config.json 的 vendors.${active.vendorId}.trusted 设为 true`)
  const session = await getVendorSession(cwd, active.vendorId, entry.inputValues ?? {})
  const model = session.imageModels.find((m) => m.modelName === active.modelName)
  if (!model) {
    const names = session.imageModels.map((m) => m.modelName).join(', ') || '（无）'
    throw new Error(`供应商 ${active.vendorId} 没有图像模型 ${active.modelName}；可用：${names}`)
  }
  return { vendorId: active.vendorId, modelName: active.modelName, model, session }
}

function relDirFrom(cwd: string, abs: string): string {
  return relative(projectDir(cwd), abs).split('\\').join('/')
}

/** 读取参考图为有头 base64。 */
export function refsToBase64(cwd: string, paths: string[]): { type: 'image'; sourceType: 'base64'; base64: string }[] {
  const out: { type: 'image'; sourceType: 'base64'; base64: string }[] = []
  for (const p of paths) {
    const buf = readMediaBuffer(cwd, p)
    if (!buf) continue
    const mime = /\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.webp$/i.test(p) ? 'image/webp' : 'image/png'
    out.push({ type: 'image', sourceType: 'base64', base64: `data:${mime};base64,${buf.toString('base64')}` })
  }
  return out
}

function styleLine(p: Project): string | undefined {
  return p.style.promptFragment || undefined
}

// ---------------------------------------------------------------------------
// 资产图
// ---------------------------------------------------------------------------

/** 生成一个资产的基础图（或某个变体）。返回 job。 */
export function startAssetGeneration(cwd: string, assetId: string, variantId?: string): Job {
  const label = variantId ? `资产变体 ${assetId}/${variantId}` : `资产基础图 ${assetId}`
  const job = createJob(cwd, variantId ? 'assets_variant' : 'assets_generate', label)
  void runJob(job, async (signal, report) => {
    const vendor = await resolveImageVendor(cwd)
    const project = readProject(cwd)
    const asset = project.assets.find((a) => a.id === assetId)
    if (!asset) throw new Error(`资产不存在：${assetId}`)

    report(0.1, '构造提示词')
    let prompt: string
    let refPaths: string[] = []
    if (variantId) {
      const variant = asset.variants.find((v) => v.id === variantId)
      if (!variant) throw new Error(`变体不存在：${variantId}`)
      if (!asset.baseImage) throw new Error('变体需要基础图作参考：请先生成基础图')
      prompt = [styleLine(project), asset.prompt, variant.prompt].filter(Boolean).join('，')
      refPaths = [asset.baseImage.path]
    } else {
      prompt = [styleLine(project), asset.prompt || asset.spec].filter(Boolean).join('，')
    }

    const config: ImageConfig = {
      prompt,
      size: '2K',
      aspectRatio: asset.kind === 'scene' ? '16:9' : '3:4',
      ...(refPaths.length ? { referenceList: refsToBase64(cwd, refPaths) } : {}),
    }

    report(0.25, `调用 ${vendor.vendorId}/${vendor.modelName}`)
    const b64 = await vendor.session.imageRequest(config, vendor.modelName, 180000)
    if (signal.aborted) throw new Error('已取消')

    report(0.85, '写入文件')
    const baseName = variantId ?? 'base'
    const ref = persistMedia(cwd, b64, {
      relDirFromProjectDir: relDirFrom(cwd, `${assetsDir(cwd)}/${assetId}`),
      baseName,
      vendorId: vendor.vendorId,
      modelName: vendor.modelName,
    })
    if (!ref) throw new Error('供应商返回的不是有效的有头 base64 图像')

    mutateProject(cwd, (p) => {
      const a = p.assets.find((x) => x.id === assetId)
      if (!a) return
      if (variantId) {
        const v = a.variants.find((x) => x.id === variantId)
        if (v) {
          v.image = ref
          v.status = 'ready'
        }
      } else {
        a.baseImage = ref
        a.status = 'ready'
      }
      a.updatedAt = Date.now()
    })

    return { paths: [ref.path], items: [{ id: variantId ?? assetId, path: ref.path }] }
  })
  return job
}

// ---------------------------------------------------------------------------
// 分镜图
// ---------------------------------------------------------------------------

function shotPrompt(shot: ShotItem, styleFragment: string | undefined): string {
  return [
    styleFragment,
    `${shot.shotSize || ''}${shot.description}`,
    shot.scene ? `场景：${shot.scene}` : '',
    shot.characters.length ? `人物：${shot.characters.join('、')}` : '',
    shot.props.length ? `道具：${shot.props.join('、')}` : '',
    shot.emotion ? `情绪：${shot.emotion}` : '',
  ]
    .filter(Boolean)
    .join('，')
}

export interface BoardGenOptions {
  kind: 'single' | 'firstLast' | 'grid'
  gridMode?: GridMode
  /** 宫格分格数（subPanels 时用）。 */
  panels?: number
}

/** 为一个镜头生成分镜图。返回 job。 */
export function startBoardGeneration(cwd: string, shotId: string, opts: BoardGenOptions): Job {
  const job = createJob(cwd, 'boards_generate', `分镜图 ${shotId}（${opts.kind}${opts.gridMode ? '/' + opts.gridMode : ''}）`)
  void runJob(job, async (signal, report) => {
    const vendor = await resolveImageVendor(cwd)
    const project = readProject(cwd)
    const shot = project.shots.find((s) => s.id === shotId)
    if (!shot) throw new Error(`镜头不存在：${shotId}`)

    const dir = relDirFrom(cwd, `${boardsDir(cwd)}/${shotId}`)
    const base = shotPrompt(shot, styleLine(project))
    const items: { id: string; path: string }[] = []
    let seq = 0

    const callImage = async (prompt: string, aspect: string, refPaths: string[]): Promise<MediaRef | null> => {
      const config: ImageConfig = {
        prompt,
        size: '2K',
        aspectRatio: aspect as `${number}:${number}`,
        ...(refPaths.length ? { referenceList: refsToBase64(cwd, refPaths) } : {}),
      }
      const b64 = await vendor.session.imageRequest(config, vendor.modelName, 180000)
      if (signal.aborted) throw new Error('已取消')
      return persistMedia(cwd, b64, {
        relDirFromProjectDir: dir,
        baseName: `${shotId}-${seq++}`,
        vendorId: vendor.vendorId,
        modelName: vendor.modelName,
      })
    }

    const boardId = newBoardId()

    if (opts.kind === 'single') {
      report(0.3, '生成单帧分镜图')
      const ref = await callImage(base, '9:16', [])
      if (!ref) throw new Error('图像生成失败')
      items.push({ id: shotId, path: ref.path })
      appendBoard(cwd, { id: boardId, shotId, kind: 'single', image: ref })
    } else if (opts.kind === 'firstLast') {
      report(0.2, '生成首帧')
      const first = await callImage(`${base}，首帧画面`, '9:16', [])
      report(0.6, '生成尾帧')
      const last = await callImage(`${base}，尾帧画面（与首帧同一场景的后续状态）`, '9:16', first ? [first.path] : [])
      if (!first || !last) throw new Error('首尾帧生成失败')
      items.push({ id: `${shotId}-first`, path: first.path }, { id: `${shotId}-last`, path: last.path })
      appendBoard(cwd, { id: boardId, shotId, kind: 'firstLast', panels: [{ index: 0, image: first }, { index: 1, image: last }] })
    } else if (opts.gridMode === 'subPanels') {
      const n = Math.max(2, Math.min(9, opts.panels ?? 4))
      const panels: { index: number; image?: MediaRef }[] = []
      for (let i = 0; i < n; i++) {
        report(0.1 + (0.8 * i) / n, `生成第 ${i + 1}/${n} 格`)
        const ref = await callImage(`${base}，第 ${i + 1} 格（动作分解）`, '1:1', [])
        if (ref) {
          panels.push({ index: i, image: ref })
          items.push({ id: `${shotId}-p${i}`, path: ref.path })
        }
      }
      if (panels.length === 0) throw new Error('宫格生成失败')
      appendBoard(cwd, { id: boardId, shotId, kind: 'grid', gridMode: 'subPanels', panels })
    } else {
      report(0.3, '生成多镜总览宫格')
      const overviewPrompt = `${styleLine(project) ? styleLine(project) + '，' : ''}故事板总览，多镜头宫格：${shot.description}`
      const ref = await callImage(overviewPrompt, '1:1', [])
      if (!ref) throw new Error('宫格生成失败')
      items.push({ id: shotId, path: ref.path })
      appendBoard(cwd, { id: boardId, shotId, kind: 'grid', gridMode: 'multiShot', image: ref })
    }

    report(1, '完成')
    return { paths: items.map((i) => i.path), items }
  })
  return job
}

function appendBoard(
  cwd: string,
  board: {
    id: string
    shotId: string
    kind: BoardItem['kind']
    gridMode?: GridMode
    image?: MediaRef
    panels?: BoardItem['panels']
  },
): void {
  mutateProject(cwd, (p) => {
    const item: BoardItem = {
      id: board.id,
      shotId: board.shotId,
      kind: board.kind,
      ...(board.gridMode ? { gridMode: board.gridMode } : {}),
      ...(board.image ? { image: board.image } : {}),
      ...(board.panels ? { panels: board.panels } : {}),
      status: 'ready',
      updatedAt: Date.now(),
    }
    p.boards.push(item)
    const shot = p.shots.find((s) => s.id === board.shotId)
    if (shot) shot.boardIds.push(item.id)
  })
}

export { newVideoId }
