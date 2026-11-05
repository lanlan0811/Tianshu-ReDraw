/**
 * 顶栏：品牌 + 项目标题 + 刷新。
 */
import { IconFilm, IconRefresh } from './icons'

export function TopBar({ title, onRefresh }: { ws: string; title: string; onRefresh: () => void }) {
  return (
    <header className="rd-topbar">
      <div className="rd-brand">
        <span className="rd-brand__mark">
          <IconFilm size={18} />
        </span>
        <span className="rd-brand__name">转绘短剧工厂</span>
        <span className="rd-brand__count">{title}</span>
      </div>
      <div className="rd-topbar__actions">
        <button className="rd-btn rd-btn--icon" onClick={onRefresh} title="刷新" aria-label="刷新">
          <IconRefresh size={15} />
        </button>
      </div>
    </header>
  )
}
