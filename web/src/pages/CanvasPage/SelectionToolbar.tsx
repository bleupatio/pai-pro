/**
 * SelectionToolbar — floating pill above the bbox of selected nodes.
 *
 * Visual: translucent blurred pill, mono font, hue-tinted "+ Group"
 * action button + kbd hint, "📎 Refer" button.
 *
 * Holds three buttons, left → right:
 *   - Group: clicks invoke `onGroup` (CanvasPage opens the
 *     GroupCreateModal).
 *   - Archive: mirror of the Del keyboard shortcut.
 *   - Refer: invokes the registered chat composer's `insertAtCursor`
 *     with `@<shortId>` snippets. Disabled when no composer is
 *     registered (`useChatComposer` returns null).
 *
 * Renders only when 1+ NON-FRAME nodes are selected (group_frame
 * nodes are excluded — selecting a frame is a different UX).
 *
 * Positioning: bbox of selected nodes is in canvas coords; we
 * convert to screen coords using the current RF viewport transform
 * so the toolbar tracks the selection through pan/zoom.
 *
 * Must be rendered inside <ReactFlowProvider> so `useNodes` /
 * `useViewport` work.
 */
import './selection-toolbar.css'
import { useNodes, useViewport, type Node as RFNode } from '@xyflow/react'
import { useChatComposer } from '@/contexts/ChatComposerContext'

interface SelectionToolbarProps {
  /** Opens the GroupCreateModal with the current selection's ids. */
  onGroup: (selectedIds: string[]) => void
  /** Archives the current selection. Same handler as the Del keyboard
   * shortcut — buttons are mirror-actions of the keyboard surface. */
  onArchive: (selectedIds: string[]) => void
}

// Default fallback when a node hasn't been measured yet (rare; first
// render before applyNodeChanges runs). Using the projection's
// COL_WIDTH as a sensible guess.
const DEFAULT_NODE_WIDTH = 260

export function SelectionToolbar({ onGroup, onArchive }: SelectionToolbarProps): JSX.Element | null {
  const nodes = useNodes()
  const viewport = useViewport()
  const composer = useChatComposer()

  // Pending placeholders (drafts + in-flight) aren't real canvas nodes
  // yet — Group / Archive / Refer don't apply, so suppress the toolbar
  // when they're the only selection.
  const selected: RFNode[] = nodes.filter(
    (n) => n.selected === true && n.type !== 'group_frame' && n.type !== 'pending_generation',
  )

  if (selected.length < 1) return null

  const canGroup = selected.length >= 2

  const onRefer = (): void => {
    if (composer === null) return
    if (selected.length === 0) return
    const tokens = selected.map((n) => {
      const data = n.data as { shortId?: string } | undefined
      return `@${data?.shortId ?? n.id}`
    })
    const snippet = tokens.join('  ') + ' '
    composer.insertAtCursor(snippet)
  }

  // Compute selection bbox in canvas coords.
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  for (const n of selected) {
    const w =
      (n as RFNode & { width?: number; measured?: { width?: number } }).width ??
      (n as RFNode & { width?: number; measured?: { width?: number } }).measured?.width ??
      DEFAULT_NODE_WIDTH
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
  }

  // Toolbar's anchor: top-center of bbox, 44px above (toolbar height
  // + small gap). Convert canvas coords → screen coords via the
  // viewport transform.
  const canvasCenterX = (minX + maxX) / 2
  const canvasTopY = minY
  const screenX = canvasCenterX * viewport.zoom + viewport.x
  const screenY = canvasTopY * viewport.zoom + viewport.y - 44

  const selectedIds = selected.map((n) => n.id)

  return (
    <div
      className="selection-toolbar"
      style={{ left: screenX, top: screenY }}
    >
      <button
        type="button"
        className="selection-toolbar-btn"
        onClick={() => onGroup(selectedIds)}
        disabled={!canGroup}
        title={canGroup ? 'Group selected nodes (⌘G)' : 'Select 2+ nodes to group'}
      >
        <span>Group</span>
      </button>
      <button
        type="button"
        className="selection-toolbar-btn"
        onClick={() => onArchive(selectedIds)}
        title="Archive selected (Del)"
      >
        <span>📁 Archive</span>
      </button>
      <button
        type="button"
        className="selection-toolbar-btn"
        onClick={onRefer}
        disabled={composer === null}
        title={
          composer === null
            ? 'Chat composer not ready'
            : 'Insert @-mentions for selected nodes into chat'
        }
      >
        <span>📎 Refer</span>
      </button>
    </div>
  )
}
