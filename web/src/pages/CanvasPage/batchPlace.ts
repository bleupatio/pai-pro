/**
 * batchPlace.ts — grid-pack placement for batch arrivals (≥2 fresh
 * nodes landing in the same merge pass).
 *
 * Single-node arrivals still flow through `placeNode` (spiral search);
 * batches use one decision over the whole set: row-major grid from an
 * anchor, shift-as-a-unit if the batch's bounding box collides with
 * existing nodes. Affects /script-compose shot-note batches, mosaic
 * splits via split_image.js, and any future bulk operation.
 */
import {
  PLACEMENT_PADDING,
  pickStart,
  type AABB,
  type Viewport,
} from './placement'

const MAX_BATCH_SHIFTS = 80

interface BatchNode {
  id: string
  size: { w: number; h: number }
}

/**
 * Lay out `nodes` in row-major order from `anchor` (or viewport
 * center / origin when anchor is off-screen / null), wrapping at
 * `cols` columns. If the resulting batch bbox collides with any
 * `existingAabbs`, shift the entire batch as a unit — down then
 * right — until clear.
 */
export function gridPackBatch(args: {
  nodes: ReadonlyArray<BatchNode>
  anchor: { x: number; y: number } | null
  viewport: Viewport | null
  existingAabbs: ReadonlyArray<AABB>
}): Map<string, { x: number; y: number }> {
  const { nodes, anchor, viewport, existingAabbs } = args
  const out = new Map<string, { x: number; y: number }>()
  if (nodes.length === 0) return out

  const start = pickStart(anchor, viewport)
  const cols = pickCols(nodes)

  // Pass 1: row-major layout from (0,0) so we can compute the batch
  // bbox independent of the anchor; shifted into anchor coords below.
  const offsets: Array<{ id: string; dx: number; dy: number; w: number; h: number }> = []
  let xCursor = 0
  let yCursor = 0
  let rowMaxH = 0
  let bboxW = 0
  let bboxH = 0
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i]
    const col = i % cols
    if (col === 0 && i > 0) {
      xCursor = 0
      yCursor += rowMaxH + PLACEMENT_PADDING
      rowMaxH = 0
    }
    offsets.push({ id: n.id, dx: xCursor, dy: yCursor, w: n.size.w, h: n.size.h })
    if (xCursor + n.size.w > bboxW) bboxW = xCursor + n.size.w
    if (yCursor + n.size.h > bboxH) bboxH = yCursor + n.size.h
    xCursor += n.size.w + PLACEMENT_PADDING
    if (n.size.h > rowMaxH) rowMaxH = n.size.h
  }

  // Pass 2: try anchor; if collision, shift down by row height (or by
  // a sensible default) then right. Bounded to MAX_BATCH_SHIFTS so a
  // pathologically packed canvas degrades gracefully instead of looping.
  const shiftDown = rowMaxH > 0 ? rowMaxH + PLACEMENT_PADDING : PLACEMENT_PADDING * 4
  const shiftRight = PLACEMENT_PADDING * 4
  let ox = start.x
  let oy = start.y
  for (let i = 0; i < MAX_BATCH_SHIFTS; i += 1) {
    if (!batchCollides(ox, oy, bboxW, bboxH, existingAabbs)) break
    oy += shiftDown
    if (i > 0 && i % 8 === 0) {
      // After several downward shifts, walk right one column and
      // restart from the anchor's y so the batch can find space in a
      // less-packed region.
      ox += shiftRight
      oy = start.y
    }
  }

  for (const o of offsets) {
    out.set(o.id, { x: ox + o.dx, y: oy + o.dy })
  }
  return out
}

function pickCols(nodes: ReadonlyArray<BatchNode>): number {
  // As-square-as-possible: ceil(sqrt(n)) gives a slightly wider-than-tall
  // grid (9→3×3, 12→4×3, 16→4×4). We deliberately ignore the current
  // viewport zoom — clamping to the visible world-width collapsed batches
  // to 1×N when the user pasted while zoomed in. The canvas is infinite;
  // a grid that spills past the viewport recovers with pan/zoom.
  const sqrtCap = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
  return Math.min(sqrtCap, nodes.length)
}

function batchCollides(
  ox: number,
  oy: number,
  bw: number,
  bh: number,
  aabbs: ReadonlyArray<AABB>,
): boolean {
  for (const a of aabbs) {
    if (
      ox + bw + PLACEMENT_PADDING > a.x &&
      a.x + a.w + PLACEMENT_PADDING > ox &&
      oy + bh + PLACEMENT_PADDING > a.y &&
      a.y + a.h + PLACEMENT_PADDING > oy
    ) return true
  }
  return false
}
