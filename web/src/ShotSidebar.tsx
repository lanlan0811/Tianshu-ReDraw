/**
 * 左侧镜头列表：点击定位到画布上的对应镜头。
 */
import type { ShotFlowNode } from './ShotNode'

export function ShotSidebar({ nodes, onLocate }: { nodes: ShotFlowNode[]; onLocate: (id: string) => void }) {
  return (
    <aside className="rd-sidebar">
      <div className="rd-sidebar__title">分镜列表</div>
      {nodes.length === 0 ? (
        <div className="rd-sidebar__empty">暂无镜头</div>
      ) : (
        <ul className="rd-sidebar__list">
          {nodes.map((n, i) => (
            <li key={n.id}>
              <button className="rd-sidebar__item" onClick={() => onLocate(n.id)} title={n.data.title}>
                <span className="rd-sidebar__idx">{String(i + 1).padStart(2, '0')}</span>
                <span className="rd-sidebar__name">{n.data.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
