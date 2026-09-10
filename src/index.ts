/**
 * dsh-thalamus host half: provides `ctx.notifications` — a generic
 * notification service for the DeepSeek Harness. Consumers (hippocampus,
 * future git/outline plugins) push events here; the browser client renders
 * the notification/preview drawer. Thalamus — the brain's signal relay.
 *
 * Storage: user-layer JSONL (~/.dsh/thalamus/notifications.jsonl), capped at
 * NOTIFICATION_CAP entries. All mutations are serialized through a promise
 * chain so concurrent push/markRead/clear never interleave file rewrites.
 *
 * The apply body also mounts /thalamus/api + /thalamus/events when the
 * webserver is present (web profiles).
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  appendNotification, readNotifications, storageRoot, writeNotifications,
} from './store.ts'
import { registerThalamusApi } from './api.ts'
import { registerQuestionAlert } from './question-alert.ts'

/** One notification pushed by a consumer plugin. */
export interface ThalamusNotification {
  /** Stable uuid, minted at push. */
  readonly id: string
  /** Source plugin: 'hippocampus' | 'git' | ... */
  readonly source: string
  /** Presentation tone. */
  readonly kind: 'info' | 'success' | 'error'
  /** One-line headline. */
  readonly title: string
  /** Optional short summary shown in the list. */
  readonly detail?: string
  /** Optional attached artifact, viewable in the preview tab. */
  readonly preview?: {
    /** Display name, e.g. 'implementation-plan.md'. */
    readonly name: string
    /** Full text content. */
    readonly text: string
    /** Hint for syntax highlighting (md/ts/json/...). */
    readonly language?: string
  }
  /**
   * Optional session this notification belongs to (e.g. the asking session for
   * a question alert). The browser uses it to jump to that session on click.
   */
  readonly sessionId?: string
  /** Unix epoch ms at push. */
  readonly time: number
  /** Whether the user has seen it. */
  readonly read: boolean
}

/** Input to push: everything except identity/time/read. */
export type ThalamusNotificationInput = Omit<ThalamusNotification, 'id' | 'time' | 'read'>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generic notification service (dsh-thalamus). */
    notifications: ThalamusService
  }
}

/** Host config: optional storage-root override. */
export interface ThalamusConfig {
  /** Storage root; defaults to ~/.dsh/thalamus. */
  readonly memoryRoot?: string
}

/**
 * The notification service. Registered as `ctx.notifications`; any plugin
 * that declares `notifications` in its inject list can push and read.
 */
export class ThalamusService extends Service {
  static provide = 'notifications'

  /** Storage root directory (user-layer). */
  private readonly root: string
  /** Serialization chain: every mutation awaits the previous one. */
  private chain: Promise<unknown> = Promise.resolve()
  /** Push listeners (SSE broadcast). */
  private readonly listeners = new Set<(notification: ThalamusNotification) => void>()

  constructor(ctx: Context, config: ThalamusConfig = {}) {
    super(ctx, 'notifications')
    this.root = storageRoot(config.memoryRoot)
  }

  /** Run one mutation after the previous one settles. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task)
    // Keep the chain alive even when a task rejects.
    this.chain = run.catch(() => {})
    return run
  }

  /** Push one notification; resolves to the stored record. */
  push(input: ThalamusNotificationInput): Promise<ThalamusNotification> {
    const notification: ThalamusNotification = {
      id: randomUUID(),
      ...input,
      time: Date.now(),
      read: false,
    }
    return this.serialize(async () => {
      await appendNotification(this.root, notification)
      for (const listener of this.listeners) {
        try { listener(notification) } catch { /* listener fault */ }
      }
      return notification
    })
  }

  /** Read notifications, newest first. */
  list(limit = 100): Promise<ThalamusNotification[]> {
    return this.serialize(async () => {
      const notifications = await readNotifications(this.root)
      return [...notifications].reverse().slice(0, limit)
    })
  }

  /** Mark one notification read. */
  markRead(id: string): Promise<void> {
    return this.serialize(async () => {
      const notifications = await readNotifications(this.root)
      const target = notifications.find(item => item.id === id)
      if (target === undefined || target.read) return
      const updated = notifications.map(item => item.id === id ? { ...item, read: true } : item)
      await writeNotifications(this.root, updated)
    })
  }

  /** Clear all notifications. */
  clear(): Promise<void> {
    return this.serialize(async () => {
      await writeNotifications(this.root, [])
    })
  }

  /** Subscribe to pushes; returns an unsubscribe. */
  onPush(listener: (notification: ThalamusNotification) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/** Stable Cordis plugin name; must match the cordis.patch.yml row id. */
export const name = 'dsh-thalamus'

/** Services required before mounting: none (webServer is optional, injected later). */
export const inject: string[] = []

/** The host plugin body: instantiate the service and mount web routes. */
export function apply(ctx: Context, config: ThalamusConfig = {}): void {
  const service = new ThalamusService(ctx, config)

  // SSE broadcast fan-out: one open /thalamus/events response per client.
  const sseClients = new Set<ServerResponse>()
  const broadcast = (payload: unknown): void => {
    const line = `data: ${JSON.stringify(payload)}\n\n`
    for (const client of sseClients) {
      try { client.write(line) } catch { /* client gone */ }
    }
  }
  service.onPush(notification => {
    broadcast({ type: 'notification', notification })
  })

  // 提问提醒：旁路监听 user-questions/request 瀑布事件，agent 提问时推一条
  // 通知（浏览器端在页面不可见时转成系统通知）。监听器始终 return next()，
  // 不影响 web/cortex 的既有应答链路。
  ctx.effect(() => registerQuestionAlert(ctx, service), 'dsh-thalamus: question alert')

  // Web surface (web profiles): register /thalamus/api + /thalamus/events
  // once the webserver + webRuntime arrive. Headless runs skip this.
  const webCtx = ctx as unknown as {
    inject?(services: string[], callback: (apiCtx: never) => void): void
  }
  webCtx.inject?.(['webServer', 'webRuntime'], (apiCtx) => {
    const host = apiCtx as unknown as {
      webServer: { register(route: WebRoute): () => void }
      webRuntime: { trustedHosts: string[] }
    }
    registerThalamusApi({
      webServer: host.webServer,
      webRuntime: host.webRuntime,
      notifications: service,
    } as never, {
      add: (client: ServerResponse) => {
        sseClients.add(client)
        return () => { sseClients.delete(client) }
      },
    } as never)
  })
}

// Type-only references kept for the module surface (used by consumers).
export type { IncomingMessage, ServerResponse }
