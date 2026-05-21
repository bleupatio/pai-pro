/**
 * placement.ts — deterministic spiral-search placement for brand-new
 * node arrivals. Existing nodes' positions stay with the projection /
 * persisted-positions sidecar; this only handles the "fresh arrival,
 * no sidecar entry" branch.
 *
 * Exports `computeAABBSet`, `placeNode`, `pickStart`, `pickSize`,
 * plus `PLACEMENT_PADDING` so callers can offset anchors by the same
 * gap the spiral uses for collision. `pickSize` is shared with
 * `batchPlace.ts` and `tidy.ts` so all three primitives reason about
 * the same node footprint.
 */
import type {
  CanvasNode,
  ImageResultNode,
  VideoResultNode,
} from '@/types/canvas'
import {
  IMAGE_CARD_CHROME_PX,
  NODE_SIZES,
  NOTE_CARD_FALLBACK_HEIGHT,
  sizeForAspect,
} from './nodeData'

export interface AABB {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * React Flow transform + canvas container dims. `x` / `y` are pan
 * offsets in screen pixels relative to the RF container; `zoom` is the
 * scale factor; `width` / `height` are the wrapper's bounding rect
 * (NOT window.innerWidth/Height — the right-side Panel would otherwise
 * be counted as visible canvas). With these we can map screen ↔ flow
 * coords and decide whether a flow-space anchor is currently visible.
 */
export interface Viewport {
  x: number
  y: number
  zoom: number
  width: number
  height: number
}

/** Gap between AABBs, also used as the spiral step. */
export const PLACEMENT_PADDING = 40
const MAX_SPIRAL_RADIUS = 4000

/** Read positions + sizes off a node array into an AABB array. */
export function computeAABBSet<
  N extends { id: string; position: { x: number; y: number } },
>(
  nodes: ReadonlyArray<N>,
  sizeFor: (node: N) => { w: number; h: number },
): AABB[] {
  const out: AABB[] = []
  for (const n of nodes) {
    const s = sizeFor(n)
    out.push({ id: n.id, x: n.position.x, y: n.position.y, w: s.w, h: s.h })
  }
  return out
}

function isFree(
  x: number,
  y: number,
  w: number,
  h: number,
  aabbs: ReadonlyArray<AABB>,
): boolean {
  for (const a of aabbs) {
    if (
      x + w + PLACEMENT_PADDING > a.x &&
      a.x + a.w + PLACEMENT_PADDING > x &&
      y + h + PLACEMENT_PADDING > a.y &&
      a.y + a.h + PLACEMENT_PADDING > y
    ) {
      return false
    }
  }
  return true
}

/**
 * Spiral outward from `anchor` in clockwise rings; within each ring
 * visits east → south → west → north so placements bias right/below
 * (matching the "anchor = lastPlaced + right" convention). Bounded
 * by MAX_SPIRAL_RADIUS; on exhaustion returns the anchor so even
 * degenerate cases produce a defined position.
 */
function firstFreeSlot(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  aabbs: ReadonlyArray<AABB>,
): { x: number; y: number } {
  if (isFree(anchor.x, anchor.y, size.w, size.h, aabbs)) {
    return { x: anchor.x, y: anchor.y }
  }
  for (let r = 1; r * PLACEMENT_PADDING <= MAX_SPIRAL_RADIUS; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      const x = anchor.x + r * PLACEMENT_PADDING
      const y = anchor.y + dy * PLACEMENT_PADDING
      if (isFree(x, y, size.w, size.h, aabbs)) return { x, y }
    }
    for (let dx = r - 1; dx >= -r; dx -= 1) {
      const x = anchor.x + dx * PLACEMENT_PADDING
      const y = anchor.y + r * PLACEMENT_PADDING
      if (isFree(x, y, size.w, size.h, aabbs)) return { x, y }
    }
    for (let dy = r - 1; dy >= -r; dy -= 1) {
      const x = anchor.x - r * PLACEMENT_PADDING
      const y = anchor.y + dy * PLACEMENT_PADDING
      if (isFree(x, y, size.w, size.h, aabbs)) return { x, y }
    }
    for (let dx = -r + 1; dx <= r - 1; dx += 1) {
      const x = anchor.x + dx * PLACEMENT_PADDING
      const y = anchor.y - r * PLACEMENT_PADDING
      if (isFree(x, y, size.w, size.h, aabbs)) return { x, y }
    }
  }
  return { x: anchor.x, y: anchor.y }
}

/**
 * Pick start point (anchor if visible, else viewport center, else
 * origin), then spiral until a free slot is found.
 */
export function placeNode(args: {
  anchor: { x: number; y: number } | null
  viewport: Viewport | null
  size: { w: number; h: number }
  aabbs: ReadonlyArray<AABB>
}): { x: number; y: number } {
  return firstFreeSlot(pickStart(args.anchor, args.viewport), args.size, args.aabbs)
}

/**
 * Anchor if visible in viewport, else viewport center (when known),
 * else the anchor itself, else origin. Shared by single-node spiral
 * placement and batch grid-pack so both pick the same starting frame.
 */
export function pickStart(
  anchor: { x: number; y: number } | null,
  viewport: Viewport | null,
): { x: number; y: number } {
  if (anchor !== null && viewport !== null && contains(viewport, anchor)) return anchor
  if (viewport !== null) {
    return {
      x: (viewport.width / 2 - viewport.x) / viewport.zoom,
      y: (viewport.height / 2 - viewport.y) / viewport.zoom,
    }
  }
  if (anchor !== null) return anchor
  return { x: 0, y: 0 }
}

function contains(vp: Viewport, p: { x: number; y: number }): boolean {
  const minX = -vp.x / vp.zoom
  const minY = -vp.y / vp.zoom
  const maxX = (vp.width - vp.x) / vp.zoom
  const maxY = (vp.height - vp.y) / vp.zoom
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
}

/**
 * Per-node size. Notes use the measured rendered height when available
 * (falling back to NOTE_CARD_FALLBACK_HEIGHT for the first paint);
 * images / videos derive size from aspect_ratio; audio uses the fixed
 * compact pill. Shared by placement, batchPlace, and tidy so all
 * three primitives compute identical AABBs for the same node.
 */
export function pickSize(
  id: string,
  type: CanvasNode['type'],
  data: CanvasNode['data'],
  measuredHeights: ReadonlyMap<string, number> | undefined,
): { w: number; h: number } {
  if (type === 'image_result') {
    const ar = (data as ImageResultNode['data']).metadata?.aspect_ratio
    // Default to 16:9 to match the renderer's fallback in nodes.tsx —
    // mismatched defaults (placement '1:1' vs render '16:9') made the
    // AABB narrower than the visible card and caused horizontal overlap
    // on pasted batches without aspect_ratio metadata.
    const body = sizeForAspect(ar ?? '16:9')
    return { w: body.w, h: body.h + IMAGE_CARD_CHROME_PX }
  }
  if (type === 'video_result') {
    const ar =
      (data as VideoResultNode['data']).aspect ??
      (data as VideoResultNode['data']).metadata?.aspect_ratio
    const body = sizeForAspect(ar ?? '16:9')
    return { w: body.w, h: body.h + IMAGE_CARD_CHROME_PX }
  }
  if (type === 'audio_result') {
    return NODE_SIZES.audio_result
  }
  return { w: 280, h: measuredHeights?.get(id) ?? NOTE_CARD_FALLBACK_HEIGHT }
}
