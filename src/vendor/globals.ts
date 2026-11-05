/**
 * 注入给 vendor 适配文件的全局环境（在子进程内构造）。
 *
 * 对齐 .claude/null.ts 模板「全局声明」区：
 *   axios / logger / jsonwebtoken / zipImage / zipImageResolution / mergeImages /
 *   urlToBase64 / pollTask / createOpenAI 等工厂函数。
 *
 * 注意：Node 无图像编解码，zipImage/mergeImages 为占位实现（原样返回 + 警告）；
 * jsonwebtoken 仅支持 HS256；AI SDK 工厂为抛错 stub（本插件从不调用 textRequest）。
 */
import { createHmac } from 'node:crypto'
import type { PollResult } from './types.js'

export interface VendorSandboxGlobals {
  axios: unknown
  logger: (msg: string) => void
  jsonwebtoken: unknown
  zipImage: (base64: string, size: number) => Promise<string>
  zipImageResolution: (base64: string, w: number, h: number) => Promise<string>
  mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>
  urlToBase64: (url: string) => Promise<string>
  pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>
  createOpenAI: unknown
  createDeepSeek: unknown
  createZhipu: unknown
  createQwen: unknown
  createAnthropic: unknown
  createOpenAICompatible: unknown
  createXai: unknown
  createMinimax: unknown
  createGoogleGenerativeAI: unknown
  [k: string]: unknown
}

interface AxiosResponse {
  data: unknown
  status: number
  statusText: string
  headers: Record<string, string>
}

type AxiosConfig = {
  url?: string
  method?: string
  baseURL?: string
  headers?: Record<string, string>
  params?: Record<string, unknown>
  data?: unknown
  timeout?: number
  responseType?: string
  signal?: AbortSignal
}

function buildUrl(baseURL: string | undefined, url: string | undefined, params?: Record<string, unknown>): string {
  let full = url ?? ''
  if (baseURL && !/^https?:\/\//i.test(full)) {
    full = baseURL.replace(/\/+$/, '') + '/' + full.replace(/^\/+/, '')
  }
  if (params && Object.keys(params).length > 0) {
    const u = new URL(full)
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
    }
    full = u.toString()
  }
  return full
}

/** 极简 axios（基于 Node fetch），覆盖 vendor 常用用法。 */
function createAxios(defaults: AxiosConfig = {}): unknown {
  async function request(config: AxiosConfig): Promise<AxiosResponse> {
    const merged: AxiosConfig = { ...defaults, ...config, headers: { ...defaults.headers, ...config.headers } }
    const url = buildUrl(merged.baseURL, merged.url, merged.params)
    if (!url) throw new Error('axios: 缺少 url')
    const method = (merged.method ?? 'GET').toUpperCase()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutMs = merged.timeout ?? 0
    if (timeoutMs > 0) timer = setTimeout(() => controller.abort(), timeoutMs)
    if (merged.signal) merged.signal.addEventListener('abort', () => controller.abort(), { once: true })
    let body: string | undefined
    const headers: Record<string, string> = { ...(merged.headers ?? {}) }
    if (merged.data !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (typeof merged.data === 'string') body = merged.data
      else {
        body = JSON.stringify(merged.data)
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/json'
        }
      }
    }
    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal })
      const hdrs: Record<string, string> = {}
      res.headers.forEach((v, k) => {
        hdrs[k] = v
      })
      let data: unknown
      if (merged.responseType === 'arraybuffer') {
        data = Buffer.from(await res.arrayBuffer())
      } else if (merged.responseType === 'text') {
        data = await res.text()
      } else {
        const text = await res.text()
        try {
          data = text ? JSON.parse(text) : null
        } catch {
          data = text
        }
      }
      if (res.status >= 400) {
        const err = new Error(`axios: HTTP ${res.status}`) as Error & { response?: AxiosResponse }
        err.response = { data, status: res.status, statusText: res.statusText, headers: hdrs }
        throw err
      }
      return { data, status: res.status, statusText: res.statusText, headers: hdrs }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const instance = {
    request,
    get: (url: string, config?: AxiosConfig) => request({ ...config, url, method: 'GET' }),
    delete: (url: string, config?: AxiosConfig) => request({ ...config, url, method: 'DELETE' }),
    head: (url: string, config?: AxiosConfig) => request({ ...config, url, method: 'HEAD' }),
    post: (url: string, data?: unknown, config?: AxiosConfig) => request({ ...config, url, method: 'POST', data }),
    put: (url: string, data?: unknown, config?: AxiosConfig) => request({ ...config, url, method: 'PUT', data }),
    patch: (url: string, data?: unknown, config?: AxiosConfig) => request({ ...config, url, method: 'PATCH', data }),
    create: (config?: AxiosConfig) => createAxios(config),
  }
  return instance
}

function base64Encode(data: Buffer | Uint8Array | string): string {
  return Buffer.from(data as Buffer).toString('base64')
}

/** 构造子进程内使用的全局对象。 */
export function buildGlobals(logSink: (msg: string) => void): VendorSandboxGlobals {
  const logger = (msg: string): void => {
    logSink(String(msg))
  }

  const axios = createAxios()

  const jsonwebtoken = {
    sign(
      payload: Record<string, unknown>,
      secret: string,
      options?: { algorithm?: string; expiresIn?: number | string },
    ): string {
      const alg = options?.algorithm ?? 'HS256'
      if (alg !== 'HS256') throw new Error(`jsonwebtoken: 仅支持 HS256，收到 ${alg}`)
      const header = { alg: 'HS256', typ: 'JWT' }
      const now = Math.floor(Date.now() / 1000)
      const body: Record<string, unknown> = { ...payload, iat: now }
      if (typeof options?.expiresIn === 'number') body.exp = now + options.expiresIn
      else if (typeof options?.expiresIn === 'string') {
        const m = /^(\d+)([smhd])$/.exec(options.expiresIn)
        if (m) {
          const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd']
          body.exp = now + Number(m[1]) * mult
        }
      }
      const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
      const signingInput = `${b64(header)}.${b64(body)}`
      const sig = createHmac('sha256', secret).update(signingInput).digest('base64url')
      return `${signingInput}.${sig}`
    },
    verify(token: string, secret: string): unknown {
      const parts = token.split('.')
      if (parts.length !== 3) throw new Error('jsonwebtoken: 无效 token')
      const [h, p, s] = parts as [string, string, string]
      const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
      if (expected !== s) throw new Error('jsonwebtoken: 签名不匹配')
      return JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
    },
  }

  const urlToBase64 = async (url: string): Promise<string> => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`urlToBase64: HTTP ${res.status}`)
    const mime = res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream'
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:${mime};base64,${base64Encode(buf)}`
  }

  const zipImage = async (base64: string, _size: number): Promise<string> => {
    logger('zipImage 未实现（Node 无图像编解码），原样返回')
    return base64
  }
  const zipImageResolution = async (base64: string, _w: number, _h: number): Promise<string> => {
    logger('zipImageResolution 未实现，原样返回')
    return base64
  }
  const mergeImages = async (base64Arr: string[]): Promise<string> => {
    logger('mergeImages 未实现，返回首张')
    return base64Arr[0] ?? ''
  }

  const pollTask = async (fn: () => Promise<PollResult>, interval = 5000, timeout = 600000): Promise<PollResult> => {
    const deadline = Date.now() + timeout
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await fn()
      if (result.completed) return result
      if (Date.now() >= deadline) return { completed: true, error: `pollTask 超时（${timeout}ms）` }
      await new Promise((r) => setTimeout(r, interval))
    }
  }

  const factoryStub = (name: string): (() => never) => () => {
    throw new Error(`${name} 不可用：本插件不使用适配文件的文本模型（textRequest）`)
  }

  return {
    axios,
    logger,
    jsonwebtoken,
    zipImage,
    zipImageResolution,
    mergeImages,
    urlToBase64,
    pollTask,
    createOpenAI: factoryStub('createOpenAI'),
    createDeepSeek: factoryStub('createDeepSeek'),
    createZhipu: factoryStub('createZhipu'),
    createQwen: factoryStub('createQwen'),
    createAnthropic: factoryStub('createAnthropic'),
    createOpenAICompatible: factoryStub('createOpenAICompatible'),
    createXai: factoryStub('createXai'),
    createMinimax: factoryStub('createMinimax'),
    createGoogleGenerativeAI: factoryStub('createGoogleGenerativeAI'),
    console,
    Buffer,
    URL,
    URLSearchParams,
    fetch,
    AbortController,
    TextEncoder,
    TextDecoder,
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    JSON,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    Map,
    Set,
  }
}
