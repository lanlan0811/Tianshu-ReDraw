/**
 * 图标集（全部为内联 SVG，禁止 emoji）。
 * 统一 24×24 视口、currentColor 描边。
 */
import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Base({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconFilm = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <path d="M2.5 9h19M7 4.5v4.5M12 4.5v4.5M17 4.5v4.5M7 19.5V15M12 19.5V15M17 19.5V15" />
  </Base>
)

export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
)

export const IconCopy = (p: IconProps) => (
  <Base {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Base>
)

export const IconTrash = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
  </Base>
)

export const IconPen = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Base>
)

export const IconLink = (p: IconProps) => (
  <Base {...p}>
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </Base>
)

export const IconRefresh = (p: IconProps) => (
  <Base {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
  </Base>
)

export const IconCursor = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 3l6 16 2.2-6.4L19.6 10Z" />
  </Base>
)

export const IconClose = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
)

export const IconChevron = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 6l6 6-6 6" />
  </Base>
)
