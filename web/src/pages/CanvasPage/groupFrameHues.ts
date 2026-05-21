/**
 * Shared hue presets for group frames. Used by both `GroupCreateModal`
 * (initial pick when creating a frame) and `GroupFrameNode`'s recolor
 * toolbar (change a frame's hue post-creation).
 */
export interface HueOption {
  hue: number
  label: string
}

export const HUE_PRESETS: readonly HueOption[] = [
  { hue: 220, label: 'Blue' },
  { hue: 60, label: 'Amber' },
  { hue: 150, label: 'Green' },
  { hue: 25, label: 'Red' },
  { hue: 290, label: 'Violet' },
  { hue: 0, label: 'Neutral' },
]
