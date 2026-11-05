/**
 * 顶栏：品牌 + 镜头数 + 操作（适应视图 / 刷新）。
 */
import { IconFilm, IconRefresh } from './icons'

export function TopBar({
  shotCount,
  onRefresh,
  onFit,
}: {
  shotCount: number
  onRefresh: () => void
  onFit: () => void
}) {
  return (
    <header className="rd-topbar">
      <div className="rd-brand">
        <span className="rd-brand__mark">
          <IconFilm size={18} />
        </span>
        <span className="rd-brand__name">转绘短剧工厂</span>
        <span className="rd-brand__count">{shotCount} 个镜头</span>
      </div>

      <div className="rd-topbar__actions">
        <button className="rd-btn" onClick={onFit} title="适应视图">
          适应视图
        </button>
        <button className="rd-btn rd-btn--icon" onClick={onRefresh} title="刷新" aria-label="刷新">
          <IconRefresh size={15} />
        </button>
      </div>
    </header>
  )
}
