/**
 * MediaExpandContext — bridge between the AssetRail (sidebar) and
 * CanvasPage's MediaExpandOverlay.
 *
 * Same register/consume pattern as CanvasFocusContext. CanvasPage owns
 * the overlay state and registers an `expand(nodeId)` function that
 * looks up the node in workflow.json (live OR archived) and opens the
 * overlay with the right payload. AssetRow consumes via
 * `useMediaExpand()` and calls it on dblclick.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type MediaExpandFn = (nodeId: string) => void

interface MediaExpandContextValue {
  expand: MediaExpandFn | null
  register: (fn: MediaExpandFn | null) => void
}

const MediaExpandContext = createContext<MediaExpandContextValue | null>(null)

export function MediaExpandProvider({ children }: { children: ReactNode }): JSX.Element {
  const [expand, setExpand] = useState<MediaExpandFn | null>(null)

  const register = useCallback((fn: MediaExpandFn | null) => {
    setExpand(() => fn)
  }, [])

  const value = useMemo<MediaExpandContextValue>(
    () => ({ expand, register }),
    [expand, register],
  )

  return (
    <MediaExpandContext.Provider value={value}>
      {children}
    </MediaExpandContext.Provider>
  )
}

/** Returns the registered expand fn, or null if no canvas is mounted. */
export function useMediaExpand(): MediaExpandFn | null {
  const ctx = useContext(MediaExpandContext)
  return ctx?.expand ?? null
}

/** CanvasPage calls this in a useEffect to publish its expand wrapper. */
export function useMediaExpandRegistration(fn: MediaExpandFn | null): void {
  const ctx = useContext(MediaExpandContext)
  useEffect(() => {
    if (ctx === null) return
    if (fn === null) return
    ctx.register(fn)
    return () => {
      ctx.register(null)
    }
  }, [ctx, fn])
}
