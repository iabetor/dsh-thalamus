/**
 * ThalamusDrawer: the notification center + file preview surface.
 *
 * Registered into ui-layout's shell.overlay slot: a bottom-right capsule
 * (with unread badge) that opens a two-tab drawer — Notifications (list,
 * unread dots, clear) and Preview (full text of a notification's attached
 * artifact, markdown/plain).
 */

import { h, useCallback, useEffect, useMemo, useState } from './react.ts'
import {
  clearNotifications, fetchNotifications, markNotificationRead,
  startNotificationEvents, type ThalamusNotificationView,
} from './api.ts'
import css from './thalamus.module.css'

// Minimal DOM faces (the host tsconfig has no DOM lib; the browser bundle
// provides the real globals).
declare const window: { confirm(message: string): boolean }

/** Props injected by the shell.overlay slot (empty for this host). */
export interface ThalamusDrawerProps {
  [key: string]: unknown
}

/** Injected services the drawer needs. */
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

/** Plain/markdown-ish preview body. */
function PreviewBody({ text }: { text: string }): ReturnType<typeof h> {
  // First pass: plain preformatted text (markdown rendering is a follow-up).
  return h('pre', { className: css.previewBody }, text)
}

/** The drawer shell. */
export function ThalamusDrawer({ injected }: { injected: ThalamusInjected }): ReturnType<typeof h> {
  const { t } = injected
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'notifications' | 'preview'>('notifications')
  const [notifications, setNotifications] = useState<ThalamusNotificationView[]>([])
  const [preview, setPreview] = useState<ThalamusNotificationView | null>(null)
  const [loaded, setLoaded] = useState(false)

  const unreadCount = useMemo(
    () => notifications.reduce((sum, item) => sum + (item.read ? 0 : 1), 0),
    [notifications],
  )

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await fetchNotifications(100)
      setNotifications(result.notifications)
    } catch {
      // The host may be down; keep the current list.
    }
  }, [])

  // SSE: a pushed notification lands at the top of the list and highlights
  // the capsule when the drawer is closed.
  useEffect(() => {
    const unsubscribe = startNotificationEvents(notification => {
      setNotifications(previous => [
        notification,
        ...previous.filter(item => item.id !== notification.id),
      ])
      if (!open) setLoaded(true)
    })
    return unsubscribe
  }, [open])

  // Load once when opened; mark all visible as read on close is handled by
  // per-row read (auto-read on open is friendlier: opening the center means
  // the user saw the headlines).
  useEffect(() => {
    if (open && !loaded) {
      setLoaded(true)
      void load()
    }
  }, [open, loaded, load])

  // Mark unread read shortly after the drawer opens.
  useEffect(() => {
    if (!open) return
    const ids = notifications.filter(item => !item.read).map(item => item.id)
    if (ids.length === 0) return
    const timer = setTimeout(() => {
      for (const id of ids) {
        void markNotificationRead(id)
        setNotifications(previous => previous.map(item => item.id === id ? { ...item, read: true } : item))
      }
    }, 800)
    return () => { clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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

  return h('div', { className: css.root },
    // Trigger capsule.
    h('button', {
      type: 'button',
      className: `${css.capsule}${unreadCount > 0 ? ` ${css.capsuleUnread}` : ''}`,
      onClick: () => { setOpen(value => !value) },
      'aria-label': t('thalamus.capsule'),
    },
      h('span', { className: css.capsuleLabel }, t('thalamus.capsule')),
      unreadCount > 0 && h('span', { className: css.capsuleBadge }, String(unreadCount)),
    ),
    // Drawer.
    open && h('div', { className: css.drawer },
      h('div', { className: css.drawerHeader },
        preview !== null
          ? h('div', { className: css.drawerTabs },
            h('button', {
              type: 'button',
              className: tab === 'notifications' ? `${css.tab} ${css.tabActive}` : css.tab,
              onClick: backToNotifications,
            }, t('thalamus.tab.notifications')),
            h('button', {
              type: 'button',
              className: tab === 'preview' ? `${css.tab} ${css.tabActive}` : css.tab,
              onClick: () => { setTab('preview') },
            }, t('thalamus.tab.preview')),
          )
          : h('div', { className: css.drawerTabs },
            h('button', {
              type: 'button',
              className: `${css.tab} ${css.tabActive}`,
              onClick: () => { setTab('notifications') },
            }, t('thalamus.tab.notifications')),
          ),
        h('div', { className: css.headerActions },
          tab === 'notifications' && notifications.length > 0
            && h('button', { type: 'button', className: css.headerAction, onClick: handleClear }, t('thalamus.clear')),
          h('button', {
            type: 'button',
            className: css.headerClose,
            onClick: () => { setOpen(false) },
            'aria-label': 'Close',
          }, '×'),
        ),
      ),
      h('div', { className: css.drawerBody },
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
    ),
  )
}

/** The overlay entry component (props may carry nothing; injected has t). */
export function ThalamusHost({ injected }: { injected: ThalamusInjected }): ReturnType<typeof h> {
  return h(ThalamusDrawer, { injected })
}
