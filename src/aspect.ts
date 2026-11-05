/**
 * 分镜画幅（画面比例）。短剧以竖屏为主，故默认 portrait（9:16）。
 *
 * 尺寸按逻辑分辨率给出，画布按此渲染节点；用户可显式覆盖 width/height。
 */
export type AspectType = 'portrait' | 'landscape' | 'square' | 'free'

export interface AspectSize {
  width: number
  height: number
}

const SIZES: Record<Exclude<AspectType, 'free'>, AspectSize> = {
  portrait: { width: 405, height: 720 },
  landscape: { width: 720, height: 405 },
  square: { width: 540, height: 540 },
}

export const DEFAULT_ASPECT: AspectType = 'portrait'

const ASPECTS: readonly AspectType[] = ['portrait', 'landscape', 'square', 'free']

export function isAspectType(v: unknown): v is AspectType {
  return typeof v === 'string' && (ASPECTS as readonly string[]).includes(v)
}

export function aspectLabel(a: AspectType): string {
  switch (a) {
    case 'portrait':
      return '竖屏 9:16'
    case 'landscape':
      return '横屏 16:9'
    case 'square':
      return '方形 1:1'
    default:
      return '自由'
  }
}

/** 解析画幅对应的逻辑尺寸；free 回退到默认竖屏尺寸。 */
export function resolveSize(aspect: AspectType): AspectSize {
  if (aspect === 'free') return { ...SIZES.portrait }
  return { ...SIZES[aspect] }
}
