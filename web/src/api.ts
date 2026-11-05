/**
 * 与本地画布服务通信：拉项目、提交视口、选中、镜头/连线编排、订阅 SSE。
 */
export interface ApiShotNode {
  id: string
  type: 'shot'
  title: string
  x: number
  y: number
  width: number
  height: number
  aspect: string
  contentPath: string
  contentRev?: number
}

export interface ApiEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface ApiProject {
  version: 1
  viewport: { x: number; y: number; zoom: number }
  shots: ApiShotNode[]
  edges: ApiEdge[]
  /** 项目文件有问题时的提示。 */
  issue?: string
}

export interface ApiSelection {
  shotId: string
  kind: 'shot' | 'element'
  element?: {
    xpath: string
    tagName: string
    textContent?: string
    computedStyles?: Record<string, string>
  }
  at: number
}

const MUTATION_HEADERS = { 'Content-Type': 'application/json', 'X-Tianshu-Redraw': '1' }

export async function fetchProject(ws: string): Promise<ApiProject> {
  const res = await fetch(`/api/project?ws=${encodeURIComponent(ws)}`)
  if (!res.ok) throw new Error(`project ${res.status}`)
  return (await res.json()) as ApiProject
}

export async function fetchSelection(ws: string): Promise<ApiSelection | null> {
  const res = await fetch(`/api/selection?ws=${encodeURIComponent(ws)}`)
  if (!res.ok) return null
  const data = (await res.json()) as { selection: ApiSelection | null }
  return data.selection
}

let viewportTimer: ReturnType<typeof setTimeout> | undefined

export function postViewport(ws: string, vp: { x: number; y: number; zoom: number }): void {
  clearTimeout(viewportTimer)
  viewportTimer = setTimeout(() => {
    void fetch('/api/viewport', {
      method: 'POST',
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ ws, ...vp }),
    }).catch(() => {
      /* ignore */
    })
  }, 500)
}

export async function postSelection(
  ws: string,
  shotId: string,
  kind: 'shot' | 'element',
  payload?: Record<string, unknown>,
): Promise<void> {
  await fetch('/api/selection', {
    method: 'POST',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ ws, shotId, kind, payload }),
  }).catch(() => {
    /* ignore */
  })
}

export type ShotOp = 'remove' | 'rename' | 'duplicate' | 'move'

export async function postShotOp(
  ws: string,
  op: ShotOp,
  data: { id: string; title?: string; x?: number; y?: number },
): Promise<ApiShotNode | null> {
  const res = await fetch('/api/shots', {
    method: 'POST',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ ws, op, ...data }),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { shot?: ApiShotNode }
  return body.shot ?? null
}

export async function postEdge(
  ws: string,
  op: 'add' | 'remove',
  source: string,
  target: string,
  label?: string,
): Promise<void> {
  await fetch('/api/edges', {
    method: 'POST',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ ws, op, source, target, label }),
  }).catch(() => {
    /* ignore */
  })
}

export function shotUrl(ws: string, id: string, rev?: number): string {
  const base = `/shot/${encodeURIComponent(id)}?ws=${encodeURIComponent(ws)}`
  return rev === undefined ? base : `${base}&rev=${rev}`
}

export interface EventHandlers {
  onProject?: () => void
  onSelection?: () => void
}

/** 单一 EventSource，同时订阅 project / selection 两类事件。 */
export function subscribeEvents(ws: string, handlers: EventHandlers): () => void {
  const es = new EventSource(`/api/events?ws=${encodeURIComponent(ws)}`)
  if (handlers.onProject) es.addEventListener('project', handlers.onProject)
  if (handlers.onSelection) es.addEventListener('selection', handlers.onSelection)
  return () => es.close()
}
