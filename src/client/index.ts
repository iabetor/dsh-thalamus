/**
 * dsh-thalamus client half: register the notification center.
 *
 * - Sidebar footer action (`sidebar.footer.action`): the bell entry with an
 *   unread badge that toggles the panel.
 * - shell.overlay host: renders the right-hand notification panel only when
 *   open (方案 B — fixed right column feel without touching the layout).
 */

import type { Context } from '@deepseek-ai/cordis'
import { h, useState, useEffect } from './react.ts'
import { en, NS, zh } from './locales.ts'
import { BellButton, type BellInjected } from './Bell.ts'
import { ThalamusPanel, useBellUnread, type ThalamusInjected } from './Drawer.ts'
import { isPanelOpen, setPanelOpen, subscribePanel } from './panel-state.ts'

/** Structural face of the client services this plugin consumes. */
export interface ThalamusClientContext extends Context {
  slots: {
    inject(name: string, register: () => unknown): unknown
    register(options: unknown, component?: unknown): unknown
  }
  locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): unknown
    bind(ns: string): (key: string, params?: Record<string, unknown>) => string
  }
}

/** Required services: the slot system and the locale service. Session
 * navigation is optional (see the conditional inject below) so the
 * notification center still mounts in profiles without `sessions`. */
export const inject = ['slots', 'locale']

/** Client plugin body. */
export function apply(rawCtx: Context): void {
  const ctx = rawCtx as ThalamusClientContext
  ctx.effect(() => ctx.locale.register(NS as never, { zh, en }) as never, 'dsh-thalamus: dictionaries')
  const t = ctx.locale.bind(NS)

  // Right-hand notification panel host (renders only while open).
  // `sessions` is resolved lazily (ctx.get) rather than injected: jump-to-session
  // is a convenience, and a profile without the service must still get the
  // notification center itself.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay',
      id: 'thalamus-panel',
      order: 90,
      locale: NS as never,
    },
    () => h(ThalamusPanel, {
      injected: {
        t,
        openSession: (sessionId: string) => {
          const sessions = (ctx as unknown as {
            get?(name: string): unknown
          }).get?.('sessions') as { open(id: string): void } | undefined
          sessions?.open(sessionId)
        },
      },
    }),
  ))

  // Sidebar footer bell: entry + unread badge + toggle.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    {
      name: 'sidebar.footer.action',
      id: 'thalamus-bell',
      order: 90,
      locale: NS as never,
      label: () => t('thalamus.bell'),
    },
    (props: { wide: boolean }) => h(BellWithUnread, { wide: props.wide, t }),
  ))
}

/** The bell wired to the shared open/unread state. */
function BellWithUnread({
  wide,
  t,
}: {
  wide: boolean
  t: (key: string, params?: Record<string, unknown>) => string
}): ReturnType<typeof h> {
  const unread = useBellUnread()
  // Re-render when the panel open state changes so the button stays live.
  const [, forceRender] = useState(0)
  useEffect(() => {
    return subscribePanel(() => { forceRender(value => value + 1) })
  }, [])
  const injected: BellInjected = {
    togglePanel: () => { setPanelOpen(!isPanelOpen()) },
    unread,
    t,
  }
  return h(BellButton, { wide, injected })
}
