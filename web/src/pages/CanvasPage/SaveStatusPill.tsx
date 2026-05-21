/**
 * SaveStatusPill — floating pill at bottom-center of the canvas pane.
 * Three states:
 *
 *   Saved        — no pending writes (default)
 *   Saving…      — at least one persist in flight
 *   Save failed  — most recent persist returned an error (hover for
 *                  details)
 *
 * Closes the information asymmetry where a fast user could refresh
 * during the drag-stop → commit window and silently lose the drag.
 * The pill is informational only; click-to-retry deferred.
 */
import './save-status.css'
import { useCanvasSaveStatus } from './saveStatusContext'

export function SaveStatusPill(): JSX.Element | null {
  const status = useCanvasSaveStatus()
  if (!status) return null

  const { pendingCount, lastError } = status

  if (pendingCount > 0) {
    return (
      <div className="save-pill-wrap">
        <div className="save-pill saving">
          <span className="save-dot" />
          <span>Saving…</span>
        </div>
      </div>
    )
  }

  if (lastError !== null) {
    return (
      <div className="save-pill-wrap">
        <div className="save-pill failed" title={lastError}>
          <span className="save-dot" />
          <span>Save failed</span>
        </div>
      </div>
    )
  }

  return (
    <div className="save-pill-wrap">
      <div className="save-pill saved">
        <span className="save-dot" />
        <span>Saved</span>
      </div>
    </div>
  )
}
