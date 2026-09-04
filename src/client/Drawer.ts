/**
 * ThalamusPanel: the right-hand notification column (方案 B).
 *
 * Hidden by default; the sidebar bell (sidebar.footer.action) toggles it via
 * the shared panel-state module. Fixed on the right edge, it overlays the
 * app rather than squeezing the conversation column (the harness details
 * slot is single-occupied by ui-chat, so a true layout column is not
 * available to plugins; a fixed overlay column keeps the same feel).
 *
 * Two tabs: Notifications (list, unread dots, clear) and Preview (full text
 * of a notification's attached artifact).
 */

import { h, useCallback, useEffect, useMemo, useState } from './react.ts'
import {
  clearNotifications, fetchNotifications, markNotificationRead,
  startNotificationEvents, type ThalamusNotificationView,
} from './api.ts'
import { getUnread, isPanelOpen, setPanelOpen, setUnread, subscribePanel } from './panel-state.ts'
import css from './thalamus.module.css'

// Minimal DOM face (the host tsconfig has no DOM lib; the browser bundle
// provides the real global).
declare const window: { confirm(message: string): boolean }

/** Injected services the panel needs. */
export interface ThalamusInjected {
  t: (key: string, params?: Record<string, unknown>) => string
}

/** Relative time label. */
function relativeTime(time: number, t: ThalamusInjected['t']): string {
  const delta = Date.now() - time
  if (delta < 60_000) return t('thalamus.justNow')
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 60) return t('thalamus.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  return t('thalamus.hoursAgo', { count: hours })
}

/** One notification row. */
function NotificationRow({
  notification,
  t,
  onOpenPreview,
  onRead,
}: {
  notification: ThalamusNotificationView
  t: ThalamusInjected['t']
  onOpenPreview: (notification: ThalamusNotificationView) => void
  onRead: (id: string) => void
}): ReturnType<typeof h> {
  const kindClass = notification.kind === 'error'
    ? css.rowError
    : notification.kind === 'success' ? css.rowSuccess : css.rowInfo
  const clickable = notification.preview !== undefined
  const handleClick = (): void => {
    if (notification.preview !== undefined) onOpenPreview(notification)
    else onRead(notification.id)
  }
  return h('div', {
    className: `${css.notificationRow} ${kindClass}${notification.read ? ` ${css.rowRead}` : ''}`,
    onClick: handleClick,
    role: clickable ? 'button' : undefined,
    title: clickable ? notification.preview?.name : undefined,
  },
    h('span', { className: css.rowUnread }, notification.read ? undefined : h('span', { className: css.unreadDot })),
    h('div', { className: css.rowBody },
      h('div', { className: css.rowTitle }, notification.title),
      notification.detail !== undefined && notification.detail.length > 0
        && h('div', { className: css.rowDetail }, notification.detail),
      h('div', { className: css.rowMeta },
        h('span', { className: css.rowSource }, notification.source),
        h('span', { className: css.rowTime }, relativeTime(notification.time, t)),
        clickable && h('span', { className: css.rowFull }, t('thalamus.viewFull')),
      ),
    ),
  )
}

/** Plain/preformatted preview body. */
function PreviewBody({ text }: { text: string }): ReturnType<typeof h> {
  return h('pre', { className: css.previewBody }, text)
}

/** The right-hand panel content. */
function PanelContent({ injected }: { injected: ThalamusInjected }): ReturnType<typeof h> {
  const { t } = injected
  const [tab, setTab] = useState<'notifications' | 'preview'>('notifications')
  const [notifications, setNotifications] = useState<ThalamusNotificationView[]>([])
  const [preview, setPreview] = useState<ThalamusNotificationView | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Sync unread into the shared store for the bell badge.
  const unreadCount = useMemo(
    () => notifications.reduce((sum, item) => sum + (item.read ? 0 : 1), 0),
    [notifications],
  )
  useEffect(() => { setUnread(unreadCount) }, [unreadCount])

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await fetchNotifications(100)
      setNotifications(result.notifications)
    } catch {
      // Host may be down; keep the current list.
    }
  }, [])

  // SSE: a pushed notification lands at the top.
  useEffect(() => {
    const unsubscribe = startNotificationEvents(notification => {
      setNotifications(previous => [
        notification,
        ...previous.filter(item => item.id !== notification.id),
      ])
    })
    return unsubscribe
  }, [])

  // Load once when the panel content mounts.
  useEffect(() => {
    if (!loaded) {
      setLoaded(true)
      void load()
    }
  }, [loaded, load])

  // Auto-mark visible notifications read shortly after load (once).
  useEffect(() => {
    if (!loaded) return
    const ids = notifications.filter(item => !item.read).map(item => item.id)
    if (ids.length === 0) return
    const timer = setTimeout(() => {
      for (const id of ids) {
        void markNotificationRead(id)
        setNotifications(previous => previous.map(item => item.id === id ? { ...item, read: true } : item))
      }
    }, 1200)
    return () => { clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  const openPreview = (notification: ThalamusNotificationView): void => {
    setPreview(notification)
    setTab('preview')
  }
  const backToNotifications = (): void => {
    setPreview(null)
    setTab('notifications')
  }
  const handleClear = (): void => {
    if (!window.confirm(t('thalamus.clearConfirm'))) return
    void clearNotifications().then(() => { setNotifications([]) })
  }

  return h('div', { className: css.panel },
    h('div', { className: css.panelHeader },
      preview !== null
        ? h('div', { className: css.panelTabs },
          h('button', {
            type: 'button',
            className: tab === 'notifications' ? `${css.panelTab} ${css.panelTabActive}` : css.panelTab,
            onClick: backToNotifications,
          }, t('thalamus.tab.notifications')),
          h('button', {
            type: 'button',
            className: tab === 'preview' ? `${css.panelTab} ${css.panelTabActive}` : css.panelTab,
            onClick: () => { setTab('preview') },
          }, t('thalamus.tab.preview')),
        )
        : h('div', { className: css.panelTitle }, t('thalamus.drawerTitle')),
      h('div', { className: css.panelHeaderActions },
        tab === 'notifications' && notifications.length > 0
          && h('button', { type: 'button', className: css.panelAction, onClick: handleClear }, t('thalamus.clear')),
        h('button', {
          type: 'button',
          className: css.panelClose,
          onClick: () => { setPanelOpen(false) },
          'aria-label': t('thalamus.close'),
        }, '×'),
      ),
    ),
    h('div', { className: css.panelBody },
      tab === 'notifications' && (
        notifications.length === 0
          ? h('div', { className: css.empty }, t('thalamus.empty'))
          : h('div', { className: css.notificationList },
            ...notifications.map(notification => h(NotificationRow, {
              key: notification.id,
              notification,
              t,
              onOpenPreview: openPreview,
              onRead: (id: string) => {
                void markNotificationRead(id)
                setNotifications(previous => previous.map(item => item.id === id ? { ...item, read: true } : item))
              },
            })),
          )
      ),
      tab === 'preview' && preview !== null
        ? h('div', { className: css.previewPane },
          h('div', { className: css.previewName }, preview.preview?.name ?? preview.title),
          h(PreviewBody, { text: preview.preview?.text ?? '' }),
        )
        : undefined,
    ),
  )
}

/** The shell.overlay host: renders the panel only when open. */
export function ThalamusPanel({ injected }: { injected: ThalamusInjected }): ReturnType<typeof h> | null {
  const [open, setOpen] = useState(isPanelOpen)

  useEffect(() => {
    return subscribePanel(() => { setOpen(isPanelOpen()) })
  }, [])

  if (!open) return null
  return h('div', { className: css.panelOverlay },
    h(PanelContent, { injected }),
  )
}

/** Read the shared unread for the bell (driven by the panel store). */
export function useBellUnread(): number {
  const [unread, setUnreadState] = useState(getUnread)
  useEffect(() => {
    return subscribePanel(() => { setUnreadState(getUnread()) })
  }, [])
  return unread
}
