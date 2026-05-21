/**
 * useAssets — derives sidebar rows from the workflow.
 *
 * Source of truth = workflow.json (every file on disk corresponds to
 * a node, live or archived — no filesystem scan).
 *
 * Output: rows grouped by kind. Live group sorts by `generated_at`
 * desc; archived group sorts by `archived_at` desc (most-recently
 * archived on top, like an OS Trash). Empty kinds reuse a stable
 * array identity so React.memo on the row doesn't churn.
 */
import { useMemo } from 'react'
import type { CanvasNode, Workflow } from '@/types/canvas'

export type AssetKind = 'images' | 'videos' | 'audios' | 'notes'

export interface AssetItem {
  id: string
  kind: AssetKind
  type: CanvasNode['type']
  subtype?: string
  label: string
  /** Image URL for image rows (renders as <img>). */
  thumbnail_url: string | null
  /** Video URL for video rows (renders as <video poster frame>). */
  video_url: string | null
  /** Audio URL for inline <audio> in audio rows. */
  audio_url: string | null
  prompt_excerpt: string
  archived: boolean
  generated_at: string | null
  /** ISO timestamp when the node was archived; null if live or if the
   * node was archived before this field existed. Drives the
   * "most-recently archived first" ordering of the archived group. */
  archived_at: string | null
}

export interface AssetGroups {
  images: AssetItem[]
  videos: AssetItem[]
  audios: AssetItem[]
  notes: AssetItem[]
  /** Counts of (live + archived) per kind, for the icon-column badges. */
  counts: Record<AssetKind, number>
  /** Archived-only counts per kind, surfaced on hover. */
  archivedCounts: Record<AssetKind, number>
}

const EMPTY_ROWS: AssetItem[] = []

const EXCERPT_MAX = 80

function excerpt(s: string | undefined): string {
  if (s === undefined || s === null) return ''
  const trimmed = s.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= EXCERPT_MAX) return trimmed
  return trimmed.slice(0, EXCERPT_MAX).trimEnd() + '…'
}

function toItem(node: CanvasNode): AssetItem | null {
  if (node.type === 'image_result') {
    return {
      id: node.id,
      kind: 'images',
      type: node.type,
      subtype: node.data.subtype,
      label: node.data.label ?? node.id,
      thumbnail_url: node.data.image_url ?? null,
      video_url: null,
      audio_url: null,
      prompt_excerpt: excerpt(node.data.prompt ?? node.data.description ?? ''),
      archived: node.data.archived === true,
      generated_at: node.data.metadata?.generated_at ?? null,
      archived_at: node.data.archived_at ?? null,
    }
  }
  if (node.type === 'video_result') {
    return {
      id: node.id,
      kind: 'videos',
      type: node.type,
      label: node.data.label ?? node.id,
      thumbnail_url: null,
      video_url: node.data.video_url ?? null,
      audio_url: null,
      prompt_excerpt: excerpt(node.data.prompt),
      archived: node.data.archived === true,
      generated_at: node.data.metadata?.generated_at ?? null,
      archived_at: node.data.archived_at ?? null,
    }
  }
  if (node.type === 'audio_result') {
    return {
      id: node.id,
      kind: 'audios',
      type: node.type,
      subtype: node.data.subtype,
      label: node.data.label ?? node.id,
      thumbnail_url: null,
      video_url: null,
      audio_url: node.data.audio_url ?? null,
      prompt_excerpt: excerpt(node.data.text ?? node.data.prompt),
      archived: node.data.archived === true,
      generated_at: node.data.metadata?.generated_at ?? null,
      archived_at: node.data.archived_at ?? null,
    }
  }
  if (node.type === 'note') {
    return {
      id: node.id,
      kind: 'notes',
      type: node.type,
      subtype: node.data.subtype,
      label: node.data.label ?? node.id,
      thumbnail_url: null,
      video_url: null,
      audio_url: null,
      prompt_excerpt: excerpt(node.data.body),
      archived: node.data.archived === true,
      generated_at:
        node.data.metadata?.timestamp ?? node.data.metadata?.generated_at ?? null,
      archived_at: node.data.archived_at ?? null,
    }
  }
  return null
}

function sortAndPartition(items: AssetItem[]): AssetItem[] {
  // Live group sorts by generated_at desc — "most-recently created
  // first" is the right reading order while you're building.
  // Archived group sorts by archived_at desc — "most-recently archived
  // on top" matches how OS Trash bins behave, so undo discovery is
  // immediate. Falls back to generated_at when archived_at is missing
  // (older archives saved before the timestamp was added).
  const liveCmp = (a: AssetItem, b: AssetItem): number => {
    const at = a.generated_at ?? ''
    const bt = b.generated_at ?? ''
    if (at === bt) return a.id.localeCompare(b.id)
    if (at === '') return 1
    if (bt === '') return -1
    return bt.localeCompare(at)
  }
  const archivedCmp = (a: AssetItem, b: AssetItem): number => {
    const at = a.archived_at ?? a.generated_at ?? ''
    const bt = b.archived_at ?? b.generated_at ?? ''
    if (at === bt) return a.id.localeCompare(b.id)
    if (at === '') return 1
    if (bt === '') return -1
    return bt.localeCompare(at)
  }
  const live = items.filter((i) => !i.archived).sort(liveCmp)
  const archived = items.filter((i) => i.archived).sort(archivedCmp)
  if (live.length === 0 && archived.length === 0) return EMPTY_ROWS
  return [...live, ...archived]
}

export function useAssets(workflow: Workflow | null): AssetGroups {
  return useMemo<AssetGroups>(() => {
    const buckets: Record<AssetKind, AssetItem[]> = {
      images: [],
      videos: [],
      audios: [],
      notes: [],
    }
    if (workflow !== null) {
      for (const node of workflow.nodes) {
        const item = toItem(node)
        if (item === null) continue
        buckets[item.kind].push(item)
      }
    }
    const counts: Record<AssetKind, number> = {
      images: buckets.images.length,
      videos: buckets.videos.length,
      audios: buckets.audios.length,
      notes: buckets.notes.length,
    }
    const archivedCounts: Record<AssetKind, number> = {
      images: buckets.images.filter((i) => i.archived).length,
      videos: buckets.videos.filter((i) => i.archived).length,
      audios: buckets.audios.filter((i) => i.archived).length,
      notes: buckets.notes.filter((i) => i.archived).length,
    }
    return {
      images: sortAndPartition(buckets.images),
      videos: sortAndPartition(buckets.videos),
      audios: sortAndPartition(buckets.audios),
      notes: sortAndPartition(buckets.notes),
      counts,
      archivedCounts,
    }
  }, [workflow])
}
