/**
 * dsh-thalamus client API: typed fetch wrapper over the /thalamus JSON API
 * plus the SSE completion channel (/thalamus/events).
 */

/** One notification as the browser sees it. */
export interface ThalamusNotificationView {
  id: string
  source: string
  kind: 'info' | 'success' | 'error'
  title: string
  detail?: string
  preview?: {
    name: string
    text: string
    language?: string
  }
  time: number
  read: boolean
}

/** Error envelope thrown on a non-ok response. */
export class ThalamusApiClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** POST one /thalamus/api/<method> call with a JSON body. */
async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/thalamus/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new ThalamusApiClientError('network', `thalamus api unreachable: ${String(error)}`)
  }
  const parsed = await res.json().catch(() => null) as unknown
  const record = (parsed ?? {}) as Record<string, unknown>
  if (!res.ok || record['ok'] === false) {
    throw new ThalamusApiClientError(
      String(record['code'] ?? 'error'),
      String(record['message'] ?? `thalamus api failed (${res.status})`),
    )
  }
  return record as T
}

/** List notifications, newest first. */
export function fetchNotifications(limit = 100): Promise<{ notifications: ThalamusNotificationView[] }> {
  return call('list', { limit })
}

/** Mark one notification read. */
export function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  return call('mark-read', { id })
}

/** Clear all notifications. */
export function clearNotifications(): Promise<{ ok: boolean }> {
  return call('clear', {})
}

/** Open the SSE channel; invokes onNotification per pushed notification. */
export function startNotificationEvents(onNotification: (notification: ThalamusNotificationView) => void): () => void {
  const source = new EventSource('/thalamus/events')
  const handler = (event: MessageEvent): void => {
    if (typeof event.data !== 'string' || event.data.length === 0) return
    let payload: { type?: unknown; notification?: unknown } | null = null
    try {
      payload = JSON.parse(event.data) as { type?: unknown; notification?: unknown }
    } catch {
      return // Heartbeat/non-JSON frames are ignored.
    }
    if (payload?.type !== 'notification') return
    const notification = payload.notification as ThalamusNotificationView | undefined
    if (notification !== undefined && typeof notification.id === 'string') {
      onNotification(notification)
    }
  }
  source.addEventListener('message', handler)
  return () => {
    source.removeEventListener('message', handler)
    source.close()
  }
}
