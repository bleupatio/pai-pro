/**
 * FireConfirmProvider — first-time confirmation gate for paid
 * generation. Mounts a centered modal once per browser to teach the
 * "fired API calls can't be cancelled" property; subsequent fires
 * run immediately (the ack persists in localStorage — see
 * firstFireGate.ts).
 *
 * Caller pattern (from a draft card or overlay):
 *   const { requestFire } = useFireConfirm()
 *   const onGenerate = () => requestFire({
 *     cost,
 *     onConfirm: () => doTheFire(),
 *   })
 *
 * - If the user has acked before, `onConfirm` runs synchronously and
 *   no modal renders — the call site stays a one-click experience.
 * - If not, the modal opens. Fire → ack + run onConfirm. Cancel →
 *   discard the request, no fire.
 *
 * The modal's body is intentionally generic (no kind / model / "this"
 * language) — it's a one-time lesson that has to cover every future
 * API call, not just the request that triggered it. Only the price
 * line is request-specific.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ackFirstFire, hasAckedFirstFire } from '@/lib/firstFireGate'
import { FireConfirmModal } from './FireConfirmModal'

export interface FireConfirmRequest {
  /** Cost in USD for this specific request. Optional — modal hides
   * the price line and the button price suffix when absent. */
  cost?: number
  /** Runs when the user confirms in the modal, or immediately when the
   * gate has already been acked. */
  onConfirm: () => void
}

interface FireConfirmContextValue {
  requestFire: (req: FireConfirmRequest) => void
}

const FireConfirmContext = createContext<FireConfirmContextValue | null>(null)

export function FireConfirmProvider({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  const [pending, setPending] = useState<FireConfirmRequest | null>(null)

  const requestFire = useCallback((req: FireConfirmRequest): void => {
    if (hasAckedFirstFire()) {
      req.onConfirm()
      return
    }
    setPending(req)
  }, [])

  const handleFire = useCallback((): void => {
    setPending((prev) => {
      if (prev === null) return null
      ackFirstFire()
      // Defer onConfirm until after state commits so React doesn't see
      // a re-entrant setState from inside an updater.
      queueMicrotask(prev.onConfirm)
      return null
    })
  }, [])

  const handleCancel = useCallback((): void => {
    setPending(null)
  }, [])

  const value = useMemo<FireConfirmContextValue>(
    () => ({ requestFire }),
    [requestFire],
  )

  return (
    <FireConfirmContext.Provider value={value}>
      {children}
      {pending !== null ? (
        <FireConfirmModal
          cost={pending.cost}
          onFire={handleFire}
          onCancel={handleCancel}
        />
      ) : null}
    </FireConfirmContext.Provider>
  )
}

export function useFireConfirm(): FireConfirmContextValue {
  const ctx = useContext(FireConfirmContext)
  if (ctx === null) {
    throw new Error('useFireConfirm must be used inside <FireConfirmProvider>')
  }
  return ctx
}
