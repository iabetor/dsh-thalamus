/**
 * dsh-thalamus persistence: notifications as one JSON line each, appended
 * atomically to a capped user-layer file.
 *
 * Layout: ~/.dsh/thalamus/notifications.jsonl
 * Cap: NOTIFICATION_CAP entries; older lines are trimmed on append.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ThalamusNotification } from './index.ts'

/** Maximum stored notifications; older lines are trimmed away. */
export const NOTIFICATION_CAP = 200

/** Resolve the storage root: a user-layer root that follows the host. */
export function storageRoot(memoryRoot?: string): string {
  return resolve(memoryRoot ?? join(homedir(), '.dsh', 'thalamus'))
}

/** The notifications file path. */
export function notificationsPath(root: string): string {
  return join(root, 'notifications.jsonl')
}

/** Read all stored notifications, oldest first. Malformed lines are skipped. */
export async function readNotifications(root: string): Promise<ThalamusNotification[]> {
  try {
    const raw = await readFile(notificationsPath(root), 'utf8')
    const notifications: ThalamusNotification[] = []
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      try {
        const parsed = JSON.parse(line) as ThalamusNotification
        if (typeof parsed.id === 'string' && typeof parsed.title === 'string'
          && typeof parsed.time === 'number') {
          notifications.push(parsed)
        }
      } catch {
        // Skip malformed lines.
      }
    }
    return notifications
  } catch {
    return []
  }
}

/** Append one notification and trim to the cap (best-effort). */
export async function appendNotification(
  root: string,
  notification: ThalamusNotification,
): Promise<void> {
  const dir = resolve(notificationsPath(root), '..')
  await mkdir(dir, { recursive: true })
  const path = notificationsPath(root)
  const temp = `${path}.tmp-${notification.id}`
  try {
    // Read-trim-append in one atomic rewrite (200 lines is tiny; simpler and
    // safer than a racy append+trim pair).
    const existing = await readNotifications(root)
    const next = [...existing, notification].slice(-NOTIFICATION_CAP)
    const body = next.map(item => JSON.stringify(item)).join('\n')
    await writeFile(temp, body.length === 0 ? '' : `${body}\n`, 'utf8')
    await rename(temp, path)
  } catch {
    // Best-effort: a storage failure never breaks push callers.
  }
}

/** Rewrite the file with a mutated list (mark-read / clear). */
export async function writeNotifications(
  root: string,
  notifications: readonly ThalamusNotification[],
): Promise<void> {
  const path = notificationsPath(root)
  const temp = `${path}.tmp-${Date.now().toString(36)}`
  try {
    const body = notifications.map(item => JSON.stringify(item)).join('\n')
    await writeFile(temp, body.length === 0 ? '' : `${body}\n`, 'utf8')
    await rename(temp, path)
  } catch {
    // Best-effort.
  }
}
