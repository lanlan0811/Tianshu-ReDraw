/**
 * vendor 适配器运行器（主进程侧）。
 *
 * 职责：
 *  1. 读 vendors/<id>.ts；拒绝 import/export（仅允许 `export {}`）。
 *  2. `module.stripTypeScriptTypes` 去类型，删掉 `export {}`。
 *  3. spawn 子进程（`node --permission dist/vendor-host.js`）执行 vendor 代码。
 *  4. 提供 imageRequest/videoRequest 的 RPC 调用（超时 + 取消）。
 *
 * 子进程隔离：fs 被 Node 权限模型限制（--allow-fs-read 仅放行 vendor 目录），
 * 网络放行（适配器必须联网）。stdio 行分隔 JSON 通信。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import { isSafeId } from '../ids.js'
import { vendorsDir } from '../project.js'
import type { ImageModel, VendorConfig, VideoModel } from './types.js'

const HOST_PATH = fileURLToPath(new URL('./vendor-host.js', import.meta.url))

export interface VendorSummary {
  id: string
  file: string
  vendor: VendorConfig
  imageModels: ImageModel[]
  videoModels: VideoModel[]
}

export interface VendorError {
  id: string
  error: string
}

/** 校验 vendor 源码的静态约束（模板禁止 import/export）。 */
export function checkVendorSource(src: string): string | null {
  if (/^\s*import\b/m.test(src)) return 'vendor 文件禁止使用 import（仅可用模板声明的全局）'
  if (/^\s*export\s+(default|const|function|class|let|var)\b/m.test(src)) {
    return 'vendor 文件禁止具名/默认导出，仅允许 `export {}`'
  }
  return null
}

/** 去类型并移除 `export {}`，得到可在 script 上下文执行的 JS。 */
export function prepareVendorCode(src: string): string {
  const stripped = stripTypeScriptTypes(src, { mode: 'strip' })
  return stripped.replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, '')
}

interface Pending {
  resolve: (value: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** 一个已加载的 vendor 子进程会话。 */
export class VendorSession {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  private logs: string[] = []
  vendor: VendorConfig | null = null
  imageModels: ImageModel[] = []
  videoModels: VideoModel[] = []
  private ready: Promise<void> | null = null

  constructor(private readonly file: string) {}

  /** 启动子进程并加载 vendor。 */
  async start(inputValues: Record<string, string>): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const src = readFileSync(this.file, 'utf8')
      const staticErr = checkVendorSource(src)
      if (staticErr) return reject(new Error(staticErr))
      const code = prepareVendorCode(src)
      const vendorId = this.file.split(/[\\/]/).pop()?.replace(/\.ts$/, '') ?? 'vendor'

      const proc = spawn(
        process.execPath,
        ['--permission', `--allow-fs-read=${vendorsDirOf(this.file)}`, HOST_PATH],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          // 清空宿主环境变量：node:vm 不是安全边界，vendor 代码可经 constructor 链拿到
          // process.env；只保留运行必需项，避免泄漏宿主的 API Key / 代理等敏感变量。
          env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '' },
        },
      )
      this.proc = proc

      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => this.onData(chunk, resolve, reject))
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        const msg = chunk.toString().trim()
        if (msg && !/ExperimentalWarning/.test(msg)) this.logs.push(`[stderr] ${msg}`)
      })
      proc.on('error', (err) => reject(err))
      proc.on('exit', (code) => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(new Error(`vendor 子进程已退出（code ${code}）`))
        }
        this.pending.clear()
        this.proc = null
      })

      this.write({ type: 'load', code, vendorId, inputValues })
    })
    return this.ready
  }

  private onData(chunk: string, resolveStart: () => void, rejectStart: (e: Error) => void): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      if (!line.trim()) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      if (msg.type === 'log') {
        this.logs.push(String(msg.msg))
      } else if (msg.type === 'loaded') {
        this.vendor = msg.vendor as VendorConfig
        this.imageModels = (msg.imageModels as ImageModel[]) ?? []
        this.videoModels = (msg.videoModels as VideoModel[]) ?? []
        resolveStart()
      } else if (msg.type === 'result' && typeof msg.id === 'number') {
        const p = this.pending.get(msg.id)
        if (p) {
          clearTimeout(p.timer)
          this.pending.delete(msg.id)
          p.resolve(String(msg.value))
        }
      } else if (msg.type === 'error') {
        const err = new Error(String(msg.error ?? '未知错误'))
        if (typeof msg.id === 'number') {
          const p = this.pending.get(msg.id)
          if (p) {
            clearTimeout(p.timer)
            this.pending.delete(msg.id)
            p.reject(err)
            continue
          }
        }
        rejectStart(err)
      }
    }
  }

  private write(msg: Record<string, unknown>): void {
    if (!this.proc) throw new Error('vendor 子进程未运行')
    this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  private call(method: 'imageRequest' | 'videoRequest', config: unknown, modelName: string, timeoutMs: number): Promise<string> {
    if (!this.proc) return Promise.reject(new Error('vendor 子进程未运行'))
    const id = this.nextId++
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} 超时（${timeoutMs}ms）`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ type: 'call', id, method, config, modelName })
    })
  }

  imageRequest(config: unknown, modelName: string, timeoutMs = 120000): Promise<string> {
    return this.call('imageRequest', config, modelName, timeoutMs)
  }

  videoRequest(config: unknown, modelName: string, timeoutMs = 900000): Promise<string> {
    return this.call('videoRequest', config, modelName, timeoutMs)
  }

  takeLogs(): string[] {
    const l = this.logs
    this.logs = []
    return l
  }

  dispose(): void {
    try {
      this.write({ type: 'shutdown' })
    } catch {
      /* ignore */
    }
    this.proc?.kill()
    this.proc = null
  }
}

function vendorsDirOf(file: string): string {
  return file.replace(/[\\/][^\\/]+$/, '')
}

// ---------------------------------------------------------------------------
// 发现 / 加载（供工具使用）
// ---------------------------------------------------------------------------

/** 列出工作区 vendors/ 下的适配文件 id。 */
export function listVendorFiles(cwd: string): string[] {
  const dir = vendorsDir(cwd)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.replace(/\.ts$/, ''))
      .filter(isSafeId)
      .sort()
  } catch {
    return []
  }
}

/** 加载并校验一个 vendor（启动子进程读取 vendor 元数据后关闭）。 */
export async function loadVendorSummary(
  cwd: string,
  id: string,
  inputValues: Record<string, string>,
): Promise<VendorSummary | VendorError> {
  if (!isSafeId(id)) return { id, error: '非法 vendor id' }
  const file = join(vendorsDir(cwd), `${id}.ts`)
  if (!existsSync(file)) return { id, error: `vendor 文件不存在：vendors/${id}.ts` }
  const session = new VendorSession(file)
  try {
    await session.start(inputValues)
    if (!session.vendor) return { id, error: 'vendor 加载失败' }
    return { id, file, vendor: session.vendor, imageModels: session.imageModels, videoModels: session.videoModels }
  } catch (err) {
    return { id, error: (err as Error)?.message ?? String(err) }
  } finally {
    session.dispose()
  }
}

/** 常驻会话缓存（按 cwd+id 复用，避免重复 spawn）。 */
const sessions = new Map<string, VendorSession>()

export async function getVendorSession(
  cwd: string,
  id: string,
  inputValues: Record<string, string>,
): Promise<VendorSession> {
  if (!isSafeId(id)) throw new Error('非法 vendor id')
  const key = `${cwd}::${id}`
  let session = sessions.get(key)
  if (!session || !session.vendor) {
    session?.dispose()
    session = new VendorSession(join(vendorsDir(cwd), `${id}.ts`))
    await session.start(inputValues)
    sessions.set(key, session)
  }
  return session
}

/** 关闭某工作区的全部 vendor 会话。 */
export function disposeVendorSessions(cwd?: string): void {
  for (const [key, session] of sessions) {
    if (!cwd || key.startsWith(`${cwd}::`)) {
      session.dispose()
      sessions.delete(key)
    }
  }
}

// 供构建期确认 Node 版本能力
export function hasStripTypeScriptTypes(): boolean {
  return typeof stripTypeScriptTypes === 'function'
}
