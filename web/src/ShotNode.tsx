/**
 * 镜头节点：标题栏 + 分镜内容（iframe 渲染 shots/<id>.html）。
 *
 * 内容以逻辑分辨率渲染，节点标题栏在任意缩放下视觉尺寸恒定（scale 反向补偿）。
 * iframe 沙箱化：allow-scripts，无 allow-same-origin —— 分镜内容不可信。
 */
import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { shotUrl } from './api'
import { IconFilm } from './icons'

export type ShotFlowNode = Node<
  {
    id: string
    title: string
    width: number
    height: number
    aspect: string
    ws: string
    contentRev?: number
  },
  'shot'
>

function aspectBadge(aspect: string): string {
  switch (aspect) {
    case 'portrait':
      return '9:16'
    case 'landscape':
      return '16:9'
    case 'square':
      return '1:1'
    default:
      return '自由'
  }
}

function ShotNodeInner({ data, selected }: NodeProps<ShotFlowNode>) {
  const { title, width, height, aspect, ws, contentRev } = data
  return (
    <div className={`shot-node${selected ? ' is-selected' : ''}`} style={{ width, height }}>
      <div className="shot-node__header">
        <span className="shot-node__badge" title="画幅">
          {aspectBadge(aspect)}
        </span>
        <span className="shot-node__title" title={title}>
          {title}
        </span>
        <span className="shot-node__dim">
          {width}×{height}
        </span>
      </div>
      <div className="shot-node__frame">
        <iframe
          className="shot-node__iframe"
          src={shotUrl(ws, data.id, contentRev)}
          sandbox="allow-scripts"
          title={title}
          loading="lazy"
        />
      </div>
      <Handle type="source" position={Position.Right} className="shot-node__handle" />
      <Handle type="target" position={Position.Left} className="shot-node__handle" />
    </div>
  )
}

export const ShotNode = memo(ShotNodeInner)

/** React Flow 的 nodeTypes（放在模块级常量，避免每帧重建）。 */
export const nodeTypes = { shot: ShotNode }

export const EmptyIcon = IconFilm
