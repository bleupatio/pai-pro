import { useReactFlow, useStore } from '@xyflow/react'

// Must render inside <ReactFlow> so the RF hooks resolve against the
// provider context.

interface ZoomBarProps {
  /** "Reset to clean" — re-runs type-clustered tidy and PATCHes
   *  every position. Wired from useCanvasPositions.onTidy. */
  onTidy: () => Promise<void> | void
}

export function ZoomBar({ onTidy }: ZoomBarProps) {
  const { fitView, zoomTo } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])
  const minZoom = useStore((s) => s.minZoom)
  const maxZoom = useStore((s) => s.maxZoom)

  const pct = ((zoom - minZoom) / (maxZoom - minZoom)) * 100

  return (
    <div className="zoom-bar" role="group" aria-label="Canvas controls">
      <button
        type="button"
        className="zoom-bar-btn"
        onClick={() => fitView({ duration: 200 })}
        aria-label="Fit view"
        title="Fit view"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M1 4.5V1.5C1 1.22 1.22 1 1.5 1H4.5M9.5 1H12.5C12.78 1 13 1.22 13 1.5V4.5M13 9.5V12.5C13 12.78 12.78 13 12.5 13H9.5M4.5 13H1.5C1.22 13 1 12.78 1 12.5V9.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <input
        className="zoom-bar-slider"
        type="range"
        min={minZoom}
        max={maxZoom}
        step={0.01}
        value={zoom}
        onChange={(e) => zoomTo(Number(e.target.value))}
        aria-label="Zoom level"
        style={{ ['--zoom-fill' as string]: `${pct}%` }}
      />
      <button
        type="button"
        className="zoom-bar-btn"
        onClick={() => {
          void onTidy()
        }}
        aria-label="Tidy canvas"
        title="Tidy canvas — re-arrange every node into type-clustered rows"
      >
        Tidy
      </button>
    </div>
  )
}
