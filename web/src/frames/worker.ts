/**
 * 抽帧 Worker（浏览器内 ffmpeg.wasm，单线程核心）。
 *
 * 打包为独立模块 worker（dist/web/frames-worker.js），由 extract.ts 以 `new Worker(url,{type:'module'})` 启动。
 * 核心从本地服务加载（/ffmpeg/ffmpeg-core.js + .wasm，提交进仓库，离线可用）。
 *
 * 协议（主线程 → worker）：
 *   { type:'run', sourceUrl, intervalSec }
 * worker → 主线程：
 *   { type:'progress', progress, message }
 *   { type:'frame', index, tSec, data, width, height }
 *   { type:'done', count }
 *   { type:'error', message }
 */
import { FFmpeg } from '@ffmpeg/ffmpeg'

const post = (msg: Record<string, unknown>): void => {
  ;(self as unknown as Worker).postMessage(msg)
}

let ffmpeg: FFmpeg | null = null

async function ensureLoaded(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg
  const ff = new FFmpeg()
  ff.on('log', ({ message }) => {
    if (/frame=|fps=|error|Error/i.test(message)) post({ type: 'progress', progress: -1, message })
  })
  const origin = self.location.origin
  await ff.load({
    coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
    wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
  })
  ffmpeg = ff
  return ff
}

/** data:image/png;base64,... → 宽高（用 createImageBitmap） */
async function dimensions(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  try {
    const copy = new Uint8Array(bytes.length)
    copy.set(bytes)
    const blob = new Blob([copy], { type: 'image/png' })
    const bmp = await createImageBitmap(blob)
    const d = { width: bmp.width, height: bmp.height }
    bmp.close()
    return d
  } catch {
    return { width: 0, height: 0 }
  }
}

function bytesToDataUri(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

async function run(sourceUrl: string, intervalSec: number): Promise<void> {
  const ff = await ensureLoaded()
  post({ type: 'progress', progress: 0.05, message: '下载源视频…' })

  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`读取源视频失败：HTTP ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  post({ type: 'progress', progress: 0.2, message: '写入虚拟文件系统…' })
  await ff.writeFile('input.mp4', buf)

  const fps = 1 / Math.max(0.1, intervalSec)
  post({ type: 'progress', progress: 0.3, message: `抽帧中（每 ${intervalSec}s 一帧）…` })
  await ff.exec(['-i', 'input.mp4', '-vf', `fps=${fps}`, '-f', 'image2', 'frame_%05d.png'])

  // 列出产物
  const files = (await ff.listDir('/')).filter((f) => /^frame_\d+\.png$/.test(f.name)).map((f) => f.name).sort()
  post({ type: 'progress', progress: 0.85, message: `导出 ${files.length} 帧…` })

  let index = 0
  for (const name of files) {
    const data = (await ff.readFile(name)) as Uint8Array
    const dim = await dimensions(data)
    post({
      type: 'frame',
      index,
      tSec: index * intervalSec,
      data: bytesToDataUri(data),
      width: dim.width,
      height: dim.height,
    })
    index++
  }

  // 清理虚拟文件
  for (const name of files) {
    try {
      await ff.deleteFile(name)
    } catch {
      /* ignore */
    }
  }
  try {
    await ff.deleteFile('input.mp4')
  } catch {
    /* ignore */
  }

  post({ type: 'done', count: files.length })
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: string; sourceUrl?: string; intervalSec?: number }
  if (msg.type === 'run' && msg.sourceUrl) {
    run(msg.sourceUrl, msg.intervalSec ?? 2).catch((err: unknown) => {
      post({ type: 'error', message: (err as Error)?.message ?? String(err) })
    })
  }
}
