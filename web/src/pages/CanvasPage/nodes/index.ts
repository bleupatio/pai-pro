/**
 * nodeTypes registry handed to <ReactFlow>. Module-scope so the prop
 * reference stays stable across renders — RF re-runs node-type
 * resolution whenever this object identity changes. Per-renderer
 * `memo(...)` + `nodePropsEqual` in `_shared.tsx` is what actually
 * skips re-renders for unchanged nodes; this map just keeps the
 * registry stable.
 */
import { memo } from 'react'
import { GroupFrameNode } from '../GroupFrameNode'
import { AudioResultNode } from './AudioResultNode'
import { ImageResultNode } from './ImageResultNode'
import { NoteNodeRenderer } from './NoteNode'
import { PendingGenerationNode } from './PendingGenerationNode'
import { VideoResultNode } from './VideoResultNode'
import { nodePropsEqual } from './_shared'

export const nodeTypes = {
  note: memo(NoteNodeRenderer, nodePropsEqual),
  image_result: memo(ImageResultNode, nodePropsEqual),
  video_result: memo(VideoResultNode, nodePropsEqual),
  audio_result: memo(AudioResultNode, nodePropsEqual),
  pending_generation: memo(PendingGenerationNode, nodePropsEqual),
  group_frame: memo(GroupFrameNode, nodePropsEqual),
}
