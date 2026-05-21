/**
 * Canvas-wide one-at-a-time audio playback controller.
 *
 * Pauses any other playing audio element on the canvas when a new one
 * starts. Used by both AudioResultNode and the character card's play
 * button so all audio sources share the same "single playhead" rule.
 *
 * Pure module state — survives node re-renders, gets reset only by a
 * full page reload. Plays nicely with React Flow's memoized nodes.
 */

let currentEl: HTMLAudioElement | null = null

export function notifyPlaying(el: HTMLAudioElement): void {
  if (currentEl && currentEl !== el && !currentEl.paused) {
    try {
      currentEl.pause()
    } catch {
      /* element may have been detached; ignore */
    }
  }
  currentEl = el
}

export function notifyPaused(el: HTMLAudioElement): void {
  if (currentEl === el) currentEl = null
}

export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
