/**
 * dsh-thalamus — 浏览器系统通知（提问提醒的 presence-aware 层）。
 *
 * 页面**可见且聚焦**时不打扰（用户就在看，页内 toast 足够）；隐藏/失焦时才
 * 发系统通知，并在标签标题加 `(N) ` 前缀，直到用户回来或问题被回答。
 *
 * 权限：Notification.requestPermission() 必须在**用户手势**内调用，因此只能
 * 由「启用系统通知」按钮触发（见 SettingsSection / Drawer 的按钮）。
 *
 * @module dsh-thalamus/desktop-notify
 */

/** 权限状态（'unsupported' = 浏览器无 Notification API）。 */
export type NotifyPermission = 'default' | 'granted' | 'denied' | 'unsupported'

/** 标题前缀用的未读提问计数。 */
let pendingCount = 0

/** 原始 document.title（首次加前缀前保存，用于还原）。 */
let baseTitle: string | null = null

/** Notification 构造器的结构面（宿主 tsconfig 无 DOM lib）。 */
interface NotificationCtor {
  new (title: string, options?: { body?: string; tag?: string }): {
    onclick: (() => void) | null
    close(): void
  }
  permission: NotifyPermission
  requestPermission(): Promise<NotifyPermission>
}

/** 取浏览器的 Notification 构造器（不存在则 undefined）。 */
function notificationCtor(): NotificationCtor | undefined {
  const ctor = (globalThis as { Notification?: unknown }).Notification
  return typeof ctor === 'function' ? ctor as NotificationCtor : undefined
}

/** 当前权限状态。 */
export function notifyPermission(): NotifyPermission {
  const ctor = notificationCtor()
  return ctor === undefined ? 'unsupported' : (ctor.permission as NotifyPermission)
}

/**
 * 请求通知权限。**必须在用户手势（click）内调用**，否则浏览器会忽略。
 * @returns 请求后的权限状态。
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  const ctor = notificationCtor()
  if (ctor === undefined) return 'unsupported'
  if (ctor.permission === 'granted') return 'granted'
  try {
    return await ctor.requestPermission()
  } catch {
    return ctor.permission as NotifyPermission
  }
}

/** 页面是否处于「用户可能没在看」的状态。 */
export function pageHidden(): boolean {
  const doc = (globalThis as { document?: { visibilityState?: string; hasFocus?: () => boolean } }).document
  if (doc === undefined) return true
  if (doc.visibilityState !== undefined && doc.visibilityState !== 'visible') return true
  if (typeof doc.hasFocus === 'function') return !doc.hasFocus()
  return false
}

/** 标签标题加 `(N) ` 前缀（N = 待回答提问数）。 */
export function bumpTitlePrefix(count: number): void {
  const doc = (globalThis as { document?: { title: string } }).document
  if (doc === undefined) return
  if (baseTitle === null) baseTitle = doc.title
  pendingCount = count
  doc.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle
}

/** 清除标题前缀（用户回到页面或问题已答）。 */
export function clearTitlePrefix(): void {
  const doc = (globalThis as { document?: { title: string } }).document
  if (doc === undefined) return
  if (baseTitle !== null) doc.title = baseTitle
  pendingCount = 0
}

/** 当前待回答计数（标题前缀用）。 */
export function pendingQuestionCount(): number {
  return pendingCount
}

/**
 * 发一条系统通知（仅在权限已授予时）。点击后聚焦窗口，并可选跳转到会话。
 * @param title - 通知标题。
 * @param body - 通知正文（通常为问题摘要）。
 * @param options - tag（去重键）与 onClick（点击回调）。
 * @returns 是否真的发出了通知。
 */
export function showSystemNotification(
  title: string,
  body: string,
  options: { tag?: string; onClick?: () => void } = {},
): boolean {
  const ctor = notificationCtor()
  if (ctor === undefined || ctor.permission !== 'granted') return false
  try {
    const notification = new ctor(title, {
      body,
      ...(options.tag === undefined ? {} : { tag: options.tag }),
    })
    notification.onclick = () => {
      try {
        (globalThis as { focus?: () => void }).focus?.()
        options.onClick?.()
      } catch {
        // 聚焦/跳转失败不影响提醒本身。
      }
      notification.close()
    }
    return true
  } catch {
    return false
  }
}
