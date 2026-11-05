/**
 * 节点右键菜单。
 */
import { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  danger?: boolean
  onSelect: () => void
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div ref={ref} className="rd-menu" style={{ left: x, top: y }} role="menu">
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={`rd-menu__item${it.danger ? ' is-danger' : ''}`}
          onClick={() => {
            it.onSelect()
            onClose()
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
