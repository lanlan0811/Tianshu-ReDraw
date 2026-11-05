/**
 * 空画布提示。
 */
import { IconFilm } from './icons'

export function EmptyState() {
  return (
    <div className="rd-empty">
      <div className="rd-empty__icon">
        <IconFilm size={40} />
      </div>
      <div className="rd-empty__title">画布上还没有镜头</div>
      <div className="rd-empty__hint">
        让天枢把分镜写进画布（工具 <code>redraw_upsert_shot</code>），
        <br />
        每个镜头会作为一张分镜卡出现在这里。
      </div>
    </div>
  )
}
