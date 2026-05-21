/**
 * First-fire gate — one-time confirm before the first paid Generate click
 * in this browser. After the user fires once, every subsequent Generate
 * fires immediately. Per-browser (localStorage), not per-project, by
 * design: the lesson is "this is irreversible," not "re-check the
 * account context."
 *
 * Storage is best-effort: Safari private mode throws on `setItem`, and a
 * failed write just means the user re-confirms next session — harmless.
 * A failed read returns `false` (safer to show the gate than skip it).
 */

const KEY = 'paiCanvas.firstFireAcked'

export function hasAckedFirstFire(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

export function ackFirstFire(): void {
  try {
    window.localStorage.setItem(KEY, 'true')
  } catch {
    /* localStorage unavailable (private mode, disabled): silently fall
       through. Next session the user will be re-prompted. */
  }
}
