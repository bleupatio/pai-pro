import {
  BaseEdge,
  type EdgeProps,
  getBezierPath,
  useStore,
} from '@xyflow/react'

// Per-edge selector — only edges whose source or target is currently
// selected re-render when that node's `selected` flag flips.
export function HighlightEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  source,
  target,
  markerEnd,
  style: incomingStyle,
}: EdgeProps): JSX.Element {
  const highlighted = useStore((s) =>
    Boolean(
      s.nodeLookup.get(source)?.selected ||
        s.nodeLookup.get(target)?.selected,
    ),
  )

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={{
        ...incomingStyle,
        stroke: highlighted ? '#ffffff' : 'var(--line-2)',
        strokeWidth: 1,
        opacity: highlighted ? 1 : 0.32,
        filter: highlighted
          ? 'drop-shadow(0 0 3px rgba(255, 255, 255, 0.55))'
          : undefined,
        transition:
          'opacity 160ms ease, stroke 160ms ease, filter 160ms ease',
      }}
    />
  )
}
