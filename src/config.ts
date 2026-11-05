/**
 * 工作区配置（<cwd>/.tianshu-redraw/config.json）。
 *
 * 含密钥（用户明确要求全存工作区）。若工作区恰好是 git 仓库，请把
 * `.tianshu-redraw/` 加入 .gitignore —— 插件自身的仓库已忽略该目录。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { configFile, projectDir } from './project.js'

export interface VendorEntry {
  /** 启用的适配文件 id（对应 vendors/<id>.ts）。 */
  enabled?: boolean
  /** 覆盖 vendor 声明里的 inputValues（如 apiKey/baseUrl）。 */
  inputValues?: Record<string, string>
  /** 用户显式信任该 vendor 才允许执行其代码。 */
  trusted?: boolean
}

export interface RedrawConfig {
  version: 1
  /** 当前启用的图像/视频供应商与模型。 */
  active: {
    image?: { vendorId: string; modelName: string }
    video?: { vendorId: string; modelName: string }
  }
  vendors: Record<string, VendorEntry>
}

export function emptyConfig(): RedrawConfig {
  return { version: 1, active: {}, vendors: {} }
}

/** 密钥字段名（用于脱敏）。 */
const SECRET_KEYS = /key|secret|token|password|passwd|pwd|apikey/i

export function readConfig(cwd: string): RedrawConfig {
  const file = configFile(cwd)
  if (!existsSync(file)) return emptyConfig()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const cfg = emptyConfig()
    if (raw.active && typeof raw.active === 'object') {
      const a = raw.active as Record<string, unknown>
      for (const kind of ['image', 'video'] as const) {
        const v = a[kind]
        if (v && typeof v === 'object') {
          const vo = v as Record<string, unknown>
          if (typeof vo.vendorId === 'string' && typeof vo.modelName === 'string') {
            cfg.active[kind] = { vendorId: vo.vendorId, modelName: vo.modelName }
          }
        }
      }
    }
    if (raw.vendors && typeof raw.vendors === 'object') {
      for (const [id, entry] of Object.entries(raw.vendors as Record<string, unknown>)) {
        if (!entry || typeof entry !== 'object') continue
        const e = entry as Record<string, unknown>
        const out: VendorEntry = {}
        if (typeof e.enabled === 'boolean') out.enabled = e.enabled
        if (typeof e.trusted === 'boolean') out.trusted = e.trusted
        if (e.inputValues && typeof e.inputValues === 'object') {
          const iv: Record<string, string> = {}
          for (const [k, v] of Object.entries(e.inputValues as Record<string, unknown>)) {
            if (typeof v === 'string') iv[k] = v
          }
          out.inputValues = iv
        }
        cfg.vendors[id] = out
      }
    }
    return cfg
  } catch {
    return emptyConfig()
  }
}

export function writeConfig(cwd: string, cfg: RedrawConfig): void {
  mkdirSync(projectDir(cwd), { recursive: true })
  const file = configFile(cwd)
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

/** 深合并一次配置变更。 */
export function updateConfig(cwd: string, patch: Partial<RedrawConfig>): RedrawConfig {
  const cfg = readConfig(cwd)
  const next: RedrawConfig = {
    version: 1,
    active: { ...cfg.active, ...(patch.active ?? {}) },
    vendors: { ...cfg.vendors },
  }
  if (patch.vendors) {
    for (const [id, entry] of Object.entries(patch.vendors)) {
      next.vendors[id] = { ...(next.vendors[id] ?? {}), ...entry }
    }
  }
  writeConfig(cwd, next)
  return next
}

/** 脱敏副本：密钥字段替换为 `***`。 */
export function redactConfig(cfg: RedrawConfig): RedrawConfig {
  const out: RedrawConfig = { version: 1, active: cfg.active, vendors: {} }
  for (const [id, entry] of Object.entries(cfg.vendors)) {
    const e: VendorEntry = {}
    if (typeof entry.enabled === 'boolean') e.enabled = entry.enabled
    if (typeof entry.trusted === 'boolean') e.trusted = entry.trusted
    if (entry.inputValues) {
      const iv: Record<string, string> = {}
      for (const [k, v] of Object.entries(entry.inputValues)) iv[k] = SECRET_KEYS.test(k) ? '***' : v
      e.inputValues = iv
    }
    out.vendors[id] = e
  }
  return out
}
