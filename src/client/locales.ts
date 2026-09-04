/**
 * dsh-thalamus locale dictionaries (zh/en, flat dot-keys).
 */

/** The locale namespace for this plugin. */
export const NS = 'dsh-thalamus'

/** Simplified-Chinese dictionary. */
export const zh = {
  'thalamus.capsule': '通知',
  'thalamus.drawerTitle': '通知中心',
  'thalamus.tab.notifications': '通知',
  'thalamus.tab.preview': '预览',
  'thalamus.empty': '暂无通知',
  'thalamus.clear': '清空',
  'thalamus.clearConfirm': '清空所有通知？',
  'thalamus.markAllRead': '全部已读',
  'thalamus.viewFull': '查看全文',
  'thalamus.back': '返回',
  'thalamus.previewTitle': '预览',
  'thalamus.source': '来源',
  'thalamus.time': '时间',
  'thalamus.unread': '未读',
  'thalamus.justNow': '刚刚',
  'thalamus.minutesAgo': '{count} 分钟前',
  'thalamus.hoursAgo': '{count} 小时前',
} satisfies Record<string, string>

/** English dictionary. */
export const en = {
  'thalamus.capsule': 'Notifications',
  'thalamus.drawerTitle': 'Notification Center',
  'thalamus.tab.notifications': 'Notifications',
  'thalamus.tab.preview': 'Preview',
  'thalamus.empty': 'No notifications',
  'thalamus.clear': 'Clear',
  'thalamus.clearConfirm': 'Clear all notifications?',
  'thalamus.markAllRead': 'Mark all read',
  'thalamus.viewFull': 'View full text',
  'thalamus.back': 'Back',
  'thalamus.previewTitle': 'Preview',
  'thalamus.source': 'Source',
  'thalamus.time': 'Time',
  'thalamus.unread': 'Unread',
  'thalamus.justNow': 'just now',
  'thalamus.minutesAgo': '{count} min ago',
  'thalamus.hoursAgo': '{count} hr ago',
} satisfies Record<string, string>
