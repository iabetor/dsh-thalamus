/**
 * Panel state: a tiny module singleton shared between the sidebar bell
 * (open/close trigger) and the right-hand notification panel (content).
 * Deliberately dependency-free: open flag + unread count + subscribers.
 */

type Listener = () => void

let open = false
let unread = 0
const listeners = new Set<Listener>()

/** Whether the right notification column is open. */
export function isPanelOpen(): boolean {
  return open
}

/** Set open/closed; notifies subscribers. */
export function setPanelOpen(next: boolean): void {
  if (open === next) return
  open = next
  emit()
}

/** Toggle the panel. */
export function togglePanel(): void {
  setPanelOpen(!open)
}

/** Current unread count (drives the bell badge). */
export function getUnread(): number {
  return unread
}

/** Set the unread count; notifies subscribers. */
export function setUnread(next: number): void {
  if (unread === next) return
  unread = next
  emit()
}

/** Subscribe to state changes; returns an unsubscribe. */
export function subscribePanel(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function emit(): void {
  for (const listener of listeners) listener()
}
