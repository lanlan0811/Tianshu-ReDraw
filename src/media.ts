/**
 * 媒体落盘：把 vendor 返回的有头 base64（data:<mime>;base64,<payload>）
 * 解码为 Buffer 并原子写入工作区，返回 MediaRef。
 */
import { extFromMime, writeMedia } from './project.js'
import type { MediaRef } from './project.js'

export interface DecodedMedia {
  mime: string
  data: Buffer
  ext: string
}

const DATA_URI_RE = /^data:([^;,]+)?(;base64)?,(.*)$/s

/** 解析有头 base64；也接受裸 base64（默认 image/png）。 */
export function decodeDataUri(input: string, fallbackMime = 'image/png'): DecodedMedia | null {
  const trimmed = input.trim()
  const m = DATA_URI_RE.exec(trimmed)
  if (m) {
    const mime = m[1] || fallbackMime
    const isB64 = m[2] === ';base64'
    const payload = m[3] ?? ''
    if (!isB64) return null
    const data = Buffer.from(payload, 'base64')
    if (data.length === 0) return null
    return { mime, data, ext: extFromMime(mime) }
  }
  // 裸 base64
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 32) {
    const data = Buffer.from(trimmed, 'base64')
    if (data.length === 0) return null
    return { mime: fallbackMime, data, ext: extFromMime(fallbackMime) }
  }
  return null
}

/**
 * 落盘一个生成物。
 * @param relDirFromProjectDir 相对 projectDir 的目录，如 `assets/asset-xx`
 * @param baseName 文件名（不含扩展名），如 `base` 或变体 id
 */
export function persistMedia(
  cwd: string,
  input: string,
  opts: { relDirFromProjectDir: string; baseName: string; vendorId: string; modelName: string; fallbackMime?: string },
): MediaRef | null {
  const decoded = decodeDataUri(input, opts.fallbackMime ?? 'image/png')
  if (!decoded) return null
  const rel = `${opts.relDirFromProjectDir}/${opts.baseName}.${decoded.ext}`
  const path = writeMedia(cwd, rel, decoded.data)
  return {
    path,
    rev: Date.now(),
    generatedAt: Date.now(),
    vendorId: opts.vendorId,
    modelName: opts.modelName,
    mime: decoded.mime,
  }
}
