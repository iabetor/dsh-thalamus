/**
 * BellButton: the sidebar.footer.action entry — a bell that toggles the
 * right-hand notification column. Narrow rail shows the bell glyph + unread
 * badge; wide sidebar adds the label.
 */

import { h } from './react.ts'
import css from './thalamus.module.css'

/** Owner props from the sidebar footer action slot. */
export interface BellButtonProps {
  /** True when the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Injected share for the bell. */
export interface BellInjected {
  /** Open/close the right notification column. */
  togglePanel(): void
  /** Current unread count. */
  unread: number
  /** Localized strings. */
  t: (key: string, params?: Record<string, unknown>) => string
}

/** The bell glyph (inline SVG, 16x16). */
function BellGlyph(): ReturnType<typeof h> {
  return h('svg', {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true,
  },
    h('path', {
      d: 'M8 1.5a4.25 4.25 0 0 0-4.25 4.25v2.3c0 .6-.22 1.18-.62 1.63l-.36.4a.9.9 0 0 0 .66 1.5h9.14a.9.9 0 0 0 .66-1.5l-.36-.4a2.43 2.43 0 0 1-.62-1.63v-2.3A4.25 4.25 0 0 0 8 1.5Z',
      stroke: 'currentColor',
      'stroke-width': 1.2,
    }),
    h('path', {
      d: 'M6.6 12.6a1.5 1.5 0 0 0 2.8 0',
      stroke: 'currentColor',
      'stroke-width': 1.2,
      'stroke-linecap': 'round',
    }),
  )
}

/** The sidebar footer action. */
export function BellButton({ wide, injected }: { wide: boolean; injected: BellInjected }): ReturnType<typeof h> {
  const label = injected.t('thalamus.bell')
  return h('button', {
    type: 'button',
    className: `${css.bell}${wide ? ` ${css.bellWide}` : ''}`,
    onClick: () => { injected.togglePanel() },
    title: label,
    'aria-label': label,
  },
    h('span', { className: css.bellIcon },
      h(BellGlyph, {}),
      injected.unread > 0 && h('span', { className: css.bellBadge }, String(injected.unread)),
    ),
    wide && h('span', { className: css.bellLabel }, label),
  )
}
