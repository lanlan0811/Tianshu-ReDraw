/**
 * 右下角缩放控件：缩小 / 百分比 / 放大 / 适应视图。
 */
import { useReactFlow, useViewport } from '@xyflow/react'

export function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()
  return (
    <div className="rd-zoom">
      <button onClick={() => void zoomOut({ duration: 150 })} aria-label="缩小">
        −
      </button>
      <button className="rd-zoom__pct" onClick={() => void fitView({ padding: 0.2, duration: 250 })} title="适应视图">
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => void zoomIn({ duration: 150 })} aria-label="放大">
        +
      </button>
    </div>
  )
}
