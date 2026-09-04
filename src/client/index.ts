/**
 * dsh-thalamus client half: register the notification center + preview
 * drawer into ui-layout's shell.overlay slot.
 */

import type { Context } from '@deepseek-ai/cordis'
import { h } from './react.ts'
import { en, NS, zh } from './locales.ts'
import { ThalamusHost } from './Drawer.ts'

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

/** Required services: the slot system and the locale service. */
export const inject = ['slots', 'locale']

/** Client plugin body: register the drawer into shell.overlay. */
export function apply(rawCtx: Context): void {
  const ctx = rawCtx as ThalamusClientContext
  ctx.effect(() => ctx.locale.register(NS as never, { zh, en }) as never, 'dsh-thalamus: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay',
      id: 'thalamus-drawer',
      order: 90,
      locale: NS as never,
    },
    () => h(ThalamusHost, { injected: { t } }),
  ))
}
