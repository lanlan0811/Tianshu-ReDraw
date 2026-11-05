/**
 * Toonflow 供应商适配格式的类型（与 .claude/null.ts 模板一致）。
 * 只用于图像/视频；文本推理走天枢对话模型，不使用适配文件的 textRequest。
 */

export type VideoMode =
  | 'singleImage'
  | 'startEndRequired'
  | 'endFrameOptional'
  | 'startFrameOptional'
  | 'text'
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[]

export interface TextModel {
  name: string
  modelName: string
  type: 'text'
  think: boolean
}

export interface ImageModel {
  name: string
  modelName: string
  type: 'image'
  mode: ('text' | 'singleImage' | 'multiReference')[]
  associationSkills?: string
}

export interface VideoModel {
  name: string
  modelName: string
  type: 'video'
  mode: VideoMode[]
  associationSkills?: string
  audio: 'optional' | false | true
  durationResolutionMap: { duration: number[]; resolution: string[] }[]
}

export interface TTSModel {
  name: string
  modelName: string
  type: 'tts'
  voices: { title: string; voice: string }[]
}

export type VendorModel = TextModel | ImageModel | VideoModel | TTSModel

export interface VendorInput {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  required: boolean
  placeholder?: string
}

export interface VendorConfig {
  id: string
  version: string
  name: string
  author: string
  description?: string
  icon?: string
  inputs: VendorInput[]
  inputValues: Record<string, string>
  models: VendorModel[]
}

export type ReferenceList =
  | { type: 'image'; sourceType: 'base64'; base64: string }
  | { type: 'audio'; sourceType: 'base64'; base64: string }
  | { type: 'video'; sourceType: 'base64'; base64: string }

export interface ImageConfig {
  prompt: string
  referenceList?: Extract<ReferenceList, { type: 'image' }>[]
  size: '1K' | '2K' | '4K'
  aspectRatio: `${number}:${number}`
}

export interface VideoConfig {
  duration: number
  resolution: string
  aspectRatio: '16:9' | '9:16'
  prompt: string
  referenceList?: ReferenceList[]
  audio?: boolean
  mode: VideoMode[]
}

export interface PollResult {
  completed: boolean
  data?: string
  error?: string
}

/** 校验后的适配器句柄（在子进程内构造，主进程通过 RPC 调用）。 */
export interface VendorHandle {
  vendor: VendorConfig
  imageModels: ImageModel[]
  videoModels: VideoModel[]
}

export function isImageModel(m: VendorModel): m is ImageModel {
  return m.type === 'image'
}

export function isVideoModel(m: VendorModel): m is VideoModel {
  return m.type === 'video'
}
