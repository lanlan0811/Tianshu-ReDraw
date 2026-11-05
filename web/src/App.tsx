/**
 * 转绘短剧工厂 · 画布应用。
 * 拉项目 → 渲染 React Flow 无限画布（深黑底）→ 订阅 SSE 实时刷新。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type NodeChange,
} from '@xyflow/react'
import { canvasConfig, GRID_STEP } from './canvasConfig'
import { nodeTypes, type ShotFlowNode } from './ShotNode'
import {
  fetchProject,
  fetchSelection,
  postEdge,
  postSelection,
  postShotOp,
  postViewport,
  subscribeEvents,
  type ApiProject,
  type ApiSelection,
} from './api'
import { TopBar } from './TopBar'
import { ShotSidebar } from './ShotSidebar'
import { ZoomControls } from './ZoomControls'
import { EmptyState } from './EmptyState'
import { ContextMenu, type MenuItem } from './ContextMenu'

const ws = new URLSearchParams(location.search).get('ws') ?? ''

function toFlowNodes(project: ApiProject): ShotFlowNode[] {
  return project.shots.map((n) => ({
    id: n.id,
    type: 'shot',
    position: { x: n.x, y: n.y },
    data: {
      id: n.id,
      title: n.title,
      width: n.width,
      height: n.height,
      aspect: n.aspect,
      ws,
      contentRev: n.contentRev,
    },
    selected: false,
  })) as ShotFlowNode[]
}

function toFlowEdges(project: ApiProject): Edge[] {
  return project.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    animated: false,
    style: { stroke: 'var(--rd-accent-line)', strokeWidth: 1.6 },
    labelStyle: { fill: 'var(--rd-text-dim)', fontSize: 11 },
  }))
}

function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<ShotFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const [selection, setSelection] = useState<ApiSelection | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const { setViewport, getViewport, fitView } = useReactFlow()
  const projectRef = useRef<ApiProject | null>(null)

  const load = useCallback(async () => {
    try {
      const project = await fetchProject(ws)
      projectRef.current = project
      setNodes(toFlowNodes(project))
      setEdges(toFlowEdges(project))
      setIssue(project.issue ?? null)
      setReady(true)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
      setReady(true)
    }
  }, [setNodes, setEdges])

  useEffect(() => {
    void load()
    const vp = projectRef.current?.viewport
    if (vp) setViewport(vp)
  }, [load, setViewport])

  // 首次渲染后恢复视口（项目视口在 load 之后才可用）
  useEffect(() => {
    if (!ready) return
    const vp = projectRef.current?.viewport
    if (vp && (vp.x !== 0 || vp.y !== 0 || vp.zoom !== 1)) setViewport(vp)
  }, [ready, setViewport])

  // SSE：项目或选中变化时重新拉取
  useEffect(() => {
    return subscribeEvents(ws, {
      onProject: () => void load(),
      onSelection: () => void fetchSelection(ws).then(setSelection),
    })
  }, [load])

  // 视口持久化（节流）
  const handleMove = useCallback(
    (_: unknown, vp: { x: number; y: number; zoom: number }) => {
      postViewport(ws, { x: vp.x, y: vp.y, zoom: vp.zoom })
    },
    [],
  )

  // 节点拖拽结束后回写坐标（拖拽中不回写，避免刷屏）
  const handleNodesChange = useCallback(
    (changes: NodeChange<ShotFlowNode>[]) => {
      onNodesChange(changes)
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false && c.position) {
          void postShotOp(ws, 'move', { id: c.id, x: Math.round(c.position.x), y: Math.round(c.position.y) })
        }
      }
    },
    [onNodesChange],
  )

  const onNodeClick = useCallback((_: unknown, node: ShotFlowNode) => {
    void postSelection(ws, node.id, 'shot')
    void fetchSelection(ws).then(setSelection)
  }, [])

  const onConnect = useCallback(
    (conn: { source?: string | null; target?: string | null }) => {
      if (!conn.source || !conn.target) return
      void postEdge(ws, 'add', conn.source, conn.target)
    },
    [],
  )

  const onEdgeDoubleClick = useCallback((_: unknown, edge: Edge) => {
    void postEdge(ws, 'remove', edge.source, edge.target)
  }, [])

  const onNodeContextMenu = useCallback((e: ReactMouseEvent, node: ShotFlowNode) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, id: node.id })
  }, [])

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return []
    const id = menu.id
    const title = nodes.find((n) => n.id === id)?.data.title ?? id
    return [
      {
        label: '重命名',
        onSelect: () => {
          const next = window.prompt('镜头标题', title)
          if (next && next.trim()) void postShotOp(ws, 'rename', { id, title: next.trim() })
        },
      },
      { label: '复制镜头', onSelect: () => void postShotOp(ws, 'duplicate', { id }) },
      { label: '删除镜头', danger: true, onSelect: () => void postShotOp(ws, 'remove', { id }) },
    ]
  }, [menu, nodes])

  if (!ws) {
    return <div className="rd-fatal">缺少工作区参数（?ws=…）。请从插件返回的画布链接打开。</div>
  }

  return (
    <div className="rd-app">
      <TopBar
        shotCount={nodes.length}
        onRefresh={() => void load()}
        onFit={() => fitView({ padding: 0.2, duration: 300 })}
      />
      <ShotSidebar nodes={nodes} onLocate={(id) => locate(id, nodes, setViewport, getViewport)} />

      <div className="rd-canvas">
        {ready && nodes.length === 0 && !error && <EmptyState />}
        {error && <div className="rd-banner rd-banner--error">加载失败：{error}</div>}
        {issue && <div className="rd-banner rd-banner--warn">{issue}</div>}

        <ReactFlow<ShotFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onConnect={onConnect}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onMove={handleMove}
          onPaneClick={() => setMenu(null)}
          {...canvasConfig}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={GRID_STEP * 2}
            size={1.4}
            color="var(--rd-bg-grid)"
            bgColor="var(--rd-bg)"
          />
          <MiniMap
            className="rd-minimap"
            pannable
            zoomable
            nodeColor={() => '#2a303a'}
            nodeStrokeColor={() => '#3a424f'}
            maskColor="rgba(5,6,8,0.72)"
          />
          <ZoomControls />
        </ReactFlow>

        {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      </div>

      {selection && <SelectionBar selection={selection} onClose={() => setSelection(null)} />}
    </div>
  )
}

/** 视口定位到某镜头（居中）。 */
function locate(
  id: string,
  nodes: ShotFlowNode[],
  setViewport: (vp: { x: number; y: number; zoom: number }) => void,
  getViewport: () => { zoom: number },
) {
  const node = nodes.find((n) => n.id === id)
  if (!node) return
  const zoom = Math.max(getViewport().zoom, 0.5)
  const w = node.data.width
  const h = node.data.height
  const el = document.querySelector('.react-flow')
  const rect = el?.getBoundingClientRect()
  const cx = (rect?.width ?? 1200) / 2
  const cy = (rect?.height ?? 800) / 2
  setViewport({ x: cx - (node.position.x + w / 2) * zoom, y: cy - (node.position.y + h / 2) * zoom, zoom })
}

/** 底部选中条：显示当前选中镜头/元素，供用户复制给 AI。 */
function SelectionBar({ selection, onClose }: { selection: ApiSelection; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const text =
    selection.kind === 'element' && selection.element
      ? `选中的是镜头内元素 <${selection.element.tagName}>，xpath=${selection.element.xpath}` +
        (selection.element.textContent ? `，文案「${selection.element.textContent}」` : '')
      : `选中的是整个镜头（id=${selection.shotId}）`
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }
  return (
    <div className="rd-selection">
      <span className="rd-selection__dot" />
      <span className="rd-selection__text" title={text}>
        {text}
      </span>
      <button className="rd-btn rd-btn--ghost" onClick={copy}>
        {copied ? '已复制' : '复制修改请求'}
      </button>
      <button className="rd-btn rd-btn--icon" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}
