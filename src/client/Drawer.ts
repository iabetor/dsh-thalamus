/**
 * ThalamusPanel: the right-hand notification column (方案 B).
 *
 * The shell.overlay host (ThalamusPanel) stays mounted at all times: it owns
 * the SSE channel and the notification list so a push updates the bell badge
 * whether or not the panel is open. The panel body renders only while open;
 * opening auto-marks visible notifications read, which clears the badge.
 */

import { h, useCallback, useEffect, useMemo, useRef, useState } from './react.ts'
import {
  clearNotifications, fetchNotifications, markNotificationRead,
  startNotificationEvents, type ThalamusNotificationView,
} from './api.ts'
import { getUnread, isPanelOpen, setPanelOpen, setUnread, subscribePanel } from './panel-state.ts'
import {
  bumpTitlePrefix, clearTitlePrefix, notifyPermission, pageHidden,
  requestNotifyPermission, showSystemNotification, type NotifyPermission,
} from './desktop-notify.ts'
import css from './thalamus.module.css'

// Minimal DOM face (the host tsconfig has no DOM lib; the browser bundle
// provides the real global).
declare const window: { confirm(message: string): boolean }

/** Injected services the panel needs. */
export interface ThalamusInjected {
  t: (key: string, params?: Record<string, unknown>) => string
  /** Jump to one session (question alerts). Optional: absent in reduced profiles. */
  openSession?: (sessionId: string) => void
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

/** The panel body: notifications list + preview tabs. */
function PanelContent({
  notifications,
  t,
  onMarkRead,
  onClear,
  onClose,
  permission,
  enableNotifications,
}: {
  notifications: readonly ThalamusNotificationView[]
  t: ThalamusInjected['t']
  onMarkRead: (id: string) => void
  onClear: () => void
  onClose: () => void
  /** Current system-notification permission (button shows only when 'default'). */
  permission: NotifyPermission
  enableNotifications: () => Promise<void>
}): ReturnType<typeof h> {
  const [tab, setTab] = useState<'notifications' | 'preview'>('notifications')
  const [preview, setPreview] = useState<ThalamusNotificationView | null>(null)

  const openPreview = (notification: ThalamusNotificationView): void => {
    setPreview(notification)
    setTab('preview')
  }
  const backToNotifications = (): void => {
    setPreview(null)
    setTab('notifications')
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
        tab === 'notifications' && permission === 'default'
          && h('button', {
            type: 'button',
            className: css.panelAction,
            title: t('thalamus.notifyHint'),
            onClick: () => { void enableNotifications() },
          }, t('thalamus.enableNotify')),
        tab === 'notifications' && notifications.length > 0
          && h('button', { type: 'button', className: css.panelAction, onClick: onClear }, t('thalamus.clear')),
        h('button', {
          type: 'button',
          className: css.panelClose,
          onClick: onClose,
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
              onRead: onMarkRead,
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

/** The shell.overlay host: always mounted; owns SSE + list + open state. */
export function ThalamusPanel({ injected }: { injected: ThalamusInjected }): ReturnType<typeof h> | null {
  const { t } = injected
  const [open, setOpen] = useState(isPanelOpen)
  const [notifications, setNotifications] = useState<ThalamusNotificationView[]>([])
  const [loaded, setLoaded] = useState(false)
  // 最新列表的镜像：SSE 回调闭包不随 state 更新，用它读当前未读提问数。
  // injected 每次渲染都是新对象；用 ref 让 SSE 回调读到最新值而不重连。
  const injectedRef = useRef(injected)
  injectedRef.current = injected
  // 提问提醒是 ephemeral（不入库、不在 notifications 列表里），前缀计数
  // 只能自己维护；用户回到页面时归零。
  const pendingQuestionsRef = useRef(0)

  // Follow the shared open flag.
  useEffect(() => {
    return subscribePanel(() => { setOpen(isPanelOpen()) })
  }, [])

  // Sync unread into the shared store for the bell badge.
  const unreadCount = useMemo(
    () => notifications.reduce((sum, item) => sum + (item.read ? 0 : 1), 0),
    [notifications],
  )
  useEffect(() => { setUnread(unreadCount) }, [unreadCount])

  // SSE (always on).
  // - 普通通知（记忆整理等）：入库并置顶显示、计入角标。
  // - 提问提醒（source: 'question'）：host 走 broadcastOnly —— 不入库、
  //   不进列表、不占角标。仅当页面**不可见/失焦**时才提醒（标题前缀 +
  //   系统通知）；用户就在页面上时什么都不做（会话树的 pending 黄点足够）。
  useEffect(() => {
    const unsubscribe = startNotificationEvents(notification => {
      if (notification.source === 'question') {
        if (!pageHidden()) return
        pendingQuestionsRef.current += 1
        bumpTitlePrefix(pendingQuestionsRef.current)
        const openSession = injectedRef.current.openSession
        showSystemNotification(
          notification.title,
          notification.detail ?? '',
          {
            tag: notification.sessionId ?? notification.id,
            ...(notification.sessionId === undefined || openSession === undefined
              ? {}
              : { onClick: () => { openSession(notification.sessionId as string) } }),
          },
        )
        return
      }
      setNotifications(previous => [
        notification,
        ...previous.filter(item => item.id !== notification.id),
      ])
    })
    return unsubscribe
  }, [])

  // 用户回到页面（可见 + 聚焦）时清除标题前缀并归零提问计数。
  useEffect(() => {
    const doc = (globalThis as {
      document?: { addEventListener?: (type: string, fn: () => void) => void; removeEventListener?: (type: string, fn: () => void) => void }
    }).document
    if (doc?.addEventListener === undefined) return
    const onVisible = (): void => {
      if (pageHidden()) return
      clearTitlePrefix()
      pendingQuestionsRef.current = 0
    }
    doc.addEventListener('visibilitychange', onVisible)
    return () => { doc.removeEventListener?.('visibilitychange', onVisible) }
  }, [])

  // Load the persisted history once at startup.
  useEffect(() => {
    if (loaded) return
    setLoaded(true)
    void fetchNotifications(100).then(result => {
      setNotifications(result.notifications)
    }).catch(() => {
      // Host may be down; keep the current list.
    })
  }, [loaded])

  // Auto-read: when the panel is open, mark visible unread notifications
  // read shortly after they appear (fires per unread batch via the key).
  const unreadIds = useMemo(
    () => notifications.filter(item => !item.read).map(item => item.id),
    [notifications],
  )
  useEffect(() => {
    if (!open || unreadIds.length === 0) return
    const timer = setTimeout(() => {
      for (const id of unreadIds) {
        void markNotificationRead(id)
        setNotifications(previous => previous.map(item => item.id === id ? { ...item, read: true } : item))
      }
    }, 800)
    return () => { clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unreadIds.join('|')])

  const markRead = useCallback((id: string): void => {
    void markNotificationRead(id)
    setNotifications(previous => previous.map(item => item.id === id ? { ...item, read: true } : item))
  }, [])

  const handleClear = (): void => {
    if (!window.confirm(t('thalamus.clearConfirm'))) return
    void clearNotifications().then(() => { setNotifications([]) })
  }

  // 系统通知权限：仅能由用户手势请求，所以做成按钮（见 PanelContent 头部）。
  const [permission, setPermission] = useState<NotifyPermission>(notifyPermission)
  const enableNotifications = async (): Promise<void> => {
    setPermission(await requestNotifyPermission())
  }

  return h('div', { className: css.panelOverlay },
    open && h(PanelContent, {
      notifications,
      t,
      onMarkRead: markRead,
      onClear: handleClear,
      onClose: () => { setPanelOpen(false) },
      permission,
      enableNotifications,
    }),
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
