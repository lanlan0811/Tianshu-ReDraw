/**
 * TPI 入口。用 defineTianshuPlugin 描述插件并握手。
 *
 * 契约：
 *  - defineTianshuPlugin 只接受 { id, activate }；其它键被丢弃。
 *  - activate(host) 返回 { tools, lifecycle?, dispose? }。
 *  - tools 名称集合必须与 manifest.contributes.tools[].name 完全一致，否则 rejected_handshake。
 *  - lifecycle 的键必须在 contributes.lifecycle 里声明过。
 *
 * host 能力（须在 manifest.capabilities 声明，否则为 undefined）：
 *  storage / sidePathLLM / promptContext / transcripts 等。
 */
import { defineTianshuPlugin } from './tpi.js'
import { tools as implTools } from './tools.js'
import { makeLifecycle, type LifecycleHost } from './lifecycle.js'
import { disposeVendorSessions } from './vendor/runner.js'

const PLUGIN_ID = 'tianshu-redraw'

interface HostShape {
  cwd?: string
  sessionId?: string
  storage?: { dataDir: () => string }
  promptContext?: { setBlock: (block: string | null) => void }
  sidePathLLM?: { available: () => boolean; complete: (prompt: string, opts: { timeoutMs?: number; signal?: AbortSignal }) => Promise<string> }
  log?: { debug: (m: string) => void; warn: (m: string) => void }
}

export default defineTianshuPlugin({
  id: PLUGIN_ID,
  activate(hostUnknown: unknown) {
    const host = (hostUnknown ?? {}) as HostShape
    const lifecycleHost: LifecycleHost = {
      ...(host.cwd ? { cwd: host.cwd } : {}),
      ...(host.promptContext ? { promptContext: host.promptContext } : {}),
      ...(host.storage ? { storage: host.storage } : {}),
      ...(host.log ? { log: host.log } : {}),
    }
    const lifecycle = makeLifecycle(lifecycleHost)

    return {
      tools: implTools.map((tool) => ({
        name: tool.definition.name,
        description: tool.definition.description,
        inputSchema: tool.definition.input_schema,
        concurrencySafe: tool.isConcurrencySafe?.() === true,
        requiresApproval: tool.requiresApproval?.() === true,
        pathParams: tool.pathParams ?? {},
        execute: (call: { args: Record<string, unknown>; cwd: string; sessionId?: string }) =>
          tool.execute({ args: call.args, cwd: call.cwd, sessionId: call.sessionId ?? 'default' }),
      })),
      lifecycle: {
        turnStart: (e: unknown) => lifecycle.turnStart(e as Parameters<typeof lifecycle.turnStart>[0]),
        toolEnd: (e: unknown) => lifecycle.toolEnd(e),
        turnEnd: (e: unknown) => lifecycle.turnEnd(e),
        sessionEnd: (e: unknown) => lifecycle.sessionEnd(e),
      },
      dispose() {
        // 关闭 vendor 子进程（画布服务保持存活：浏览器标签可能仍开着）
        disposeVendorSessions()
      },
    }
  },
})

// 供测试直接使用（loader 只读 .default，忽略这些命名导出）。
export { tools } from './tools.js'
export { buildStateBlock } from './lifecycle.js'
export { checkVendorSource, prepareVendorCode, disposeVendorSessions, VendorSession } from './vendor/runner.js'
export { createJob, runJob, getJob, cancelJob, listJobs, resetJobsForTests, setConcurrency } from './jobs.js'
