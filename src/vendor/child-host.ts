/**
 * vendor 子进程宿主（独立构建入口 → dist/vendor-host.js）。
 *
 * 为什么独立进程：第三方 vendor 适配代码不可信。用 `node --permission` 启动本进程
 * （fs 被限制、网络放行——适配器必须联网），把「执行 vendor 代码」与主进程隔离。
 * 通信走 stdin/stdout 的行分隔 JSON（stdio 在权限模型下可用）。
 *
 * 协议：
 *   ← {type:'load', code, vendorId, inputValues}
 *   → {type:'loaded', vendor, imageModels, videoModels} | {type:'error', error}
 *   ← {type:'call', id, method, config, modelName}
 *   → {type:'result', id, value} | {type:'error', id, error}
 *   → {type:'log', msg}
 *   ← {type:'shutdown'}
 */
import vm from 'node:vm'
import { buildGlobals } from './globals.js'
import type { ImageModel, VendorConfig, VendorModel, VideoModel } from './types.js'

interface LoadMsg {
  type: 'load'
  code: string
  vendorId: string
  inputValues: Record<string, string>
}
interface CallMsg {
  type: 'call'
  id: number
  method: 'imageRequest' | 'videoRequest'
  config: unknown
  modelName: string
}
type Inbound = LoadMsg | CallMsg | { type: 'shutdown' }

let exportsRef: Record<string, unknown> | null = null
let vendorRef: VendorConfig | null = null

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function log(msg: string): void {
  send({ type: 'log', msg })
}

function isImageModel(m: VendorModel): m is ImageModel {
  return m.type === 'image'
}
function isVideoModel(m: VendorModel): m is VideoModel {
  return m.type === 'video'
}

function validateVendor(v: unknown): VendorConfig {
  if (!v || typeof v !== 'object') throw new Error('vendor 不是对象')
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id.length === 0) throw new Error('vendor.id 缺失')
  if (typeof o.name !== 'string') throw new Error('vendor.name 缺失')
  if (!Array.isArray(o.models)) throw new Error('vendor.models 必须是数组')
  const inputValues = typeof o.inputValues === 'object' && o.inputValues ? (o.inputValues as Record<string, string>) : {}
  return {
    id: o.id,
    version: typeof o.version === 'string' ? o.version : '1.0',
    name: o.name,
    author: typeof o.author === 'string' ? o.author : '',
    ...(typeof o.description === 'string' ? { description: o.description } : {}),
    ...(typeof o.icon === 'string' ? { icon: o.icon } : {}),
    inputs: Array.isArray(o.inputs) ? (o.inputs as VendorConfig['inputs']) : [],
    inputValues,
    models: o.models as VendorModel[],
  }
}

function handleLoad(msg: LoadMsg): void {
  try {
    const globals = buildGlobals(log)
    const context: Record<string, unknown> = { ...globals, exports: {}, module: { exports: {} } }
    vm.createContext(context)
    const script = new vm.Script(msg.code, { filename: `${msg.vendorId}.ts` })
    script.runInContext(context, { timeout: 5000 })
    const ex = (context.exports as Record<string, unknown>) ?? {}
    exportsRef = ex
    const vendor = validateVendor(ex.vendor)
    // 用户配置覆盖 vendor 默认 inputValues（同一对象引用，vendor 闭包可见）
    Object.assign(vendor.inputValues, msg.inputValues ?? {})
    vendorRef = vendor
    const imageModels = vendor.models.filter(isImageModel)
    const videoModels = vendor.models.filter(isVideoModel)
    send({ type: 'loaded', vendor, imageModels, videoModels })
  } catch (err) {
    send({ type: 'error', error: (err as Error)?.message ?? String(err) })
  }
}

async function handleCall(msg: CallMsg): Promise<void> {
  try {
    if (!exportsRef || !vendorRef) throw new Error('尚未加载 vendor')
    const fn = exportsRef[msg.method]
    if (typeof fn !== 'function') throw new Error(`vendor 未实现 ${msg.method}`)
    const model = vendorRef.models.find((m) => m.modelName === msg.modelName)
    if (!model) throw new Error(`未找到模型 ${msg.modelName}`)
    const value = await (fn as (c: unknown, m: unknown) => Promise<unknown>)(msg.config, model)
    if (typeof value !== 'string') throw new Error(`${msg.method} 未返回字符串（有头 base64）`)
    send({ type: 'result', id: msg.id, value })
  } catch (err) {
    send({ type: 'error', id: msg.id, error: (err as Error)?.message ?? String(err) })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  let idx: number
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 1)
    if (!line.trim()) continue
    let msg: Inbound
    try {
      msg = JSON.parse(line) as Inbound
    } catch {
      continue
    }
    if (msg.type === 'load') handleLoad(msg)
    else if (msg.type === 'call') void handleCall(msg)
    else if (msg.type === 'shutdown') process.exit(0)
  }
})

process.stdin.on('end', () => process.exit(0))
