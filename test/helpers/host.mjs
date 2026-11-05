/**
 * 复刻天枢 loader 语义的最小宿主，用于端到端验证插件。
 * 复刻点：品牌/冻结、wrapTpiTool 的 input→args、pathParams 改写、返回值只取 content/isError；
 * 并额外提供 storage / promptContext / sidePathLLM 与 lifecycle 捕获（v0.2 需要）。
 */
import { isAbsolute, relative, resolve } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const TPI_BRAND = Symbol.for('tianshu.tpi.plugin/v1')

export function installFakeSdk() {
  function defineTianshuPlugin(spec) {
    if (!spec || typeof spec !== 'object') throw new TypeError('defineTianshuPlugin: spec must be an object')
    if (typeof spec.id !== 'string' || spec.id.length === 0) throw new TypeError('defineTianshuPlugin: id is required')
    if (typeof spec.activate !== 'function') throw new TypeError('defineTianshuPlugin: activate(host) is required')
    return Object.freeze({ id: spec.id, activate: spec.activate, [TPI_BRAND]: Object.freeze({ tpi: '1.0' }) })
  }
  globalThis.__tianshuTPI = Object.freeze({ version: '1.0', defineTianshuPlugin })
  return TPI_BRAND
}

// 简化版路径守卫：仅根限定。
export function validatePathSafe(root, candidate) {
  const realRoot = resolve(root)
  const target = resolve(realRoot, candidate)
  const rel = relative(realRoot, target)
  if (rel.startsWith('..') || isAbsolute(rel)) return { ok: false, error: 'Path outside project directory: ' + candidate }
  return { ok: true, path: target }
}

export function wrapTool(pluginId, tool, defaultSessionId = 'sess-1') {
  const pathParams = Object.entries(tool.pathParams ?? {})
  return {
    name: tool.name,
    definition: { name: tool.name, description: tool.description, input_schema: tool.inputSchema },
    async execute(call) {
      const args = call?.input && typeof call.input === 'object' ? { ...call.input } : {}
      for (const [param, mode] of pathParams) {
        const value = args[param]
        if (typeof value !== 'string' || value.length === 0) continue
        const g = validatePathSafe(call.cwd, value, mode)
        if (!g.ok) return { content: 'Path rejected: ' + g.error, isError: true }
        args[param] = g.path
      }
      try {
        const result = await tool.execute({ args, cwd: call.cwd, sessionId: call.sessionId ?? defaultSessionId })
        return { content: String(result?.content ?? ''), ...(result?.isError ? { isError: true } : {}) }
      } catch (err) {
        return { content: '[' + pluginId + '] ' + tool.name + ' failed: ' + (err?.message ?? String(err)), isError: true }
      }
    },
  }
}

/**
 * 用假宿主加载构建产物，返回 { def, api, tools, host }。
 * host 提供 storage / promptContext（捕获 block）/ sidePathLLM，并暴露 lifecycle。
 */
export async function loadPlugin(entryUrl, opts = {}) {
  const brand = installFakeSdk()
  const mod = await import(entryUrl)
  const def = mod.default
  if (!def || !def[brand]) throw new Error('入口未通过 TPI 品牌校验')
  const dataDir = mkdtempSync(join(tmpdir(), 'tsr-plugin-data-'))
  const blocks = []
  const host = {
    cwd: opts.cwd,
    sessionId: 'test-session',
    storage: { dataDir: () => dataDir },
    promptContext: { setBlock: (b) => blocks.push(b) },
    sidePathLLM: { available: () => true, complete: async () => 'ok' },
    log: { debug() {}, warn() {} },
  }
  const api = await def.activate(host)
  const tools = Object.fromEntries((api.tools ?? []).map((t) => [t.name, wrapTool(def.id, t)]))
  return { def, api, tools, host, blocks, lifecycle: api.lifecycle ?? {} }
}
