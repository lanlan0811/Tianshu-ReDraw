/**
 * 页面侧抽帧驱动：收到抽帧请求后启动 worker，逐帧回传服务端，最后拼宫格总览图。
 *
 * 为什么在浏览器：ffmpeg.wasm 跑在浏览器（单线程核心，无需 SharedArrayBuffer），
 * 源视频由本地服务流式提供，帧回传落盘。工具无法推流进度，AI 侧靠轮询。
 */
import { postContactSheet, postFrame, postFramesStatus, sourceVideoUrl } from '../api'

let running = false

export function isExtracting(): boolean {
  return running
}

/** 在浏览器 canvas 上拼宫格总览图（每行 N 张缩略图）。 */
async function buildContactSheet(
  frames: { data: string; width: number; height: number }[],
  cols = 5,
  thumbW = 240,
): Promise<{ data: string; width: number; height: number } | null> {
  if (frames.length === 0) return null
  const first = frames[0]!
  const ratio = first.height > 0 && first.width > 0 ? first.height / first.width : 9 / 16
  const thumbH = Math.round(thumbW * ratio)
  const rows = Math.ceil(frames.length / cols)
  const gap = 6
  const canvas = document.createElement('canvas')
  canvas.width = cols * thumbW + (cols + 1) * gap
  canvas.height = rows * thumbH + (rows + 1) * gap
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#0b0d10'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!
    const img = new Image()
    img.src = f.data
    await new Promise<void>((resolve) => {
      img.onload = () => resolve()
      img.onerror = () => resolve()
    })
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = gap + col * (thumbW + gap)
    const y = gap + row * (thumbH + gap)
    ctx.drawImage(img, x, y, thumbW, thumbH)
    ctx.fillStyle = 'rgba(255,106,61,0.9)'
    ctx.font = '12px system-ui'
    ctx.fillText(String(i), x + 4, y + 14)
  }
  return { data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}

/** 启动抽帧。onProgress 用于 UI 进度显示。 */
export async function runExtraction(
  ws: string,
  intervalSec: number,
  onProgress: (p: number, message: string) => void,
): Promise<void> {
  if (running) return
  running = true
  const collected: { data: string; width: number; height: number }[] = []
  try {
    onProgress(0.02, '启动 ffmpeg…')
    await postFramesStatus(ws, 'running', '浏览器开始抽帧')

    const worker = new Worker(new URL('./frames-worker.js', import.meta.url), { type: 'module' })

    await new Promise<void>((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(e.message || 'worker 错误'))
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as { type: string; progress?: number; message?: string; index?: number; tSec?: number; data?: string; width?: number; height?: number; count?: number }
        if (msg.type === 'progress') {
          if (typeof msg.progress === 'number' && msg.progress >= 0) onProgress(msg.progress, msg.message ?? '')
          else onProgress(-1, msg.message ?? '')
        } else if (msg.type === 'frame' && msg.data) {
          collected.push({ data: msg.data, width: msg.width ?? 0, height: msg.height ?? 0 })
          void postFrame(ws, { index: msg.index ?? 0, tSec: msg.tSec ?? 0, data: msg.data, width: msg.width ?? 0, height: msg.height ?? 0 })
          onProgress(0.85, `已回传 ${collected.length} 帧…`)
        } else if (msg.type === 'done') {
          resolve()
        } else if (msg.type === 'error') {
          reject(new Error(msg.message ?? '抽帧失败'))
        }
      }
      worker.postMessage({ type: 'run', sourceUrl: sourceVideoUrl(ws), intervalSec })
    })

    worker.terminate()

    if (collected.length > 0) {
      onProgress(0.95, '拼宫格总览图…')
      const sheet = await buildContactSheet(collected)
      if (sheet) await postContactSheet(ws, sheet.data, sheet.width, sheet.height)
    }
    await postFramesStatus(ws, 'done', `完成，共 ${collected.length} 帧`)
    onProgress(1, `完成，共 ${collected.length} 帧`)
  } catch (err) {
    await postFramesStatus(ws, 'error', (err as Error)?.message ?? '抽帧失败')
    throw err
  } finally {
    running = false
  }
}
