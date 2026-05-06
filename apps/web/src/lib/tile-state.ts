import type { InstanceState } from '@restrike/shared';

/**
 * Semantic color name for a tile, picked from the live state by priority.
 *
 * Priority order (highest first):
 *   1. auth_failed → 'bad'        — red, needs user action
 *   2. disconnected → 'subtle'    — gray, neutral
 *   3. connecting → 'warn'        — amber, transient
 *   --- below: status is connected/degraded ---
 *   4. streaming → 'live'         — red broadcast indicator
 *   5. recording → 'record'       — magenta, distinct from live
 *   6. replay armed → 'replay'    — amber
 *   7. virtual cam → 'vcam'       — purple
 *   8. preview scene set → 'preview' — green, "studio mode active"
 *   9. otherwise → 'ok'           — dim green, "connected idle"
 *
 * Maps directly to a CSS variable: 'live' → `var(--state-live)`.
 */
export type TileStateColor =
  | 'live'
  | 'record'
  | 'replay'
  | 'vcam'
  | 'preview'
  | 'warn'
  | 'bad'
  | 'ok'
  | 'subtle';

export function getTileStateColor(live: InstanceState | undefined): TileStateColor {
  if (!live) return 'subtle';
  if (live.status === 'auth_failed') return 'bad';
  if (live.status === 'disconnected') return 'subtle';
  if (live.status === 'connecting') return 'warn';
  // status is 'connected' or 'degraded' — outputs decide
  if (live.outputs.streaming.active) return 'live';
  if (live.outputs.recording.active) return 'record';
  if (live.outputs.replayBuffer.active) return 'replay';
  if (live.outputs.virtualCam.active) return 'vcam';
  if (live.currentPreviewScene) return 'preview';
  return 'ok';
}

/** Should the indicator pulse — used for active broadcast/record states. */
export function shouldPulse(color: TileStateColor): boolean {
  return color === 'live' || color === 'record';
}

/** Human-readable label for tooltips / aria-labels. */
export function tileStateLabel(color: TileStateColor): string {
  switch (color) {
    case 'live':
      return 'Streaming live';
    case 'record':
      return 'Recording';
    case 'replay':
      return 'Replay buffer armed';
    case 'vcam':
      return 'Virtual camera active';
    case 'preview':
      return 'Studio mode — preview ready';
    case 'warn':
      return 'Connecting…';
    case 'bad':
      return 'Authentication failed';
    case 'ok':
      return 'Connected';
    case 'subtle':
      return 'Disconnected';
  }
}
