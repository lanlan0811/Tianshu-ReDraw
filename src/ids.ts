/**
 * id 生成与校验。
 *
 * id 同时用作：项目 JSON 的条目 id、媒体文件名、以及 URL 段（如 `/shot/:id`）。
 * 因此必须严格校验，防止路径穿越。
 */
import { randomUUID } from 'node:crypto'

/** 合法的 id：字母数字下划线连字符，1–64 位。 */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** 调用方输入不合法（HTTP 400）；其它异常都视为服务端故障（HTTP 500）。 */
export class InvalidInputError extends Error {}

export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

export function assertSafeId(id: unknown): asserts id is string {
  if (!isSafeId(id)) throw new InvalidInputError(`invalid id: ${String(id)}`)
}

function gen(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 8)}`
}

/** 镜头 id，形如 `shot-3f2a91c4`。 */
export function newShotId(): string {
  return gen('shot')
}

/** 抽帧帧 id，形如 `frame-3f2a91c4`。 */
export function newFrameId(): string {
  return gen('frame')
}

/** 资产 id，形如 `asset-3f2a91c4`。 */
export function newAssetId(): string {
  return gen('asset')
}

/** 资产变体 id，形如 `var-3f2a91c4`。 */
export function newVariantId(): string {
  return gen('var')
}

/** 分镜图 id，形如 `board-3f2a91c4`。 */
export function newBoardId(): string {
  return gen('board')
}

/** 视频段 id，形如 `vid-3f2a91c4`。 */
export function newVideoId(): string {
  return gen('vid')
}

/** 任务 id，形如 `job-3f2a91c4`。 */
export function newJobId(): string {
  return gen('job')
}

/** 剧本集 id，形如 `ep-3f2a91c4`。 */
export function newEpisodeId(): string {
  return gen('ep')
}

/** 剧本场 id，形如 `sc-3f2a91c4`。 */
export function newSceneId(): string {
  return gen('sc')
}

/** 宫格总览图 id，形如 `sheet-3f2a91c4`。 */
export function newSheetId(): string {
  return gen('sheet')
}
