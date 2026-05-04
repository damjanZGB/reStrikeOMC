import { z } from 'zod';

export const ConnectionStatusSchema = z.enum([
  'connecting',
  'connected',
  'degraded',
  'disconnected',
  'auth_failed',
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const SceneSchema = z.object({
  name: z.string(),
  index: z.number().int().nonnegative(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const InputChannelLevelSchema = z.object({
  current: z.number(),
  average: z.number(),
  peak: z.number(),
});

export const InputStateSchema = z.object({
  name: z.string(),
  kind: z.string(),
  muted: z.boolean(),
  volumeDb: z.number(),
  volumeMul: z.number().nonnegative(),
  syncOffsetMs: z.number().int(),
  levels: z.array(InputChannelLevelSchema),
});
export type InputState = z.infer<typeof InputStateSchema>;

/**
 * Diffs may carry partial per-input updates — e.g. an InputMuteStateChanged
 * carries only `{ name, muted }`, an InputVolumeMeters carries only `{ name,
 * levels }`. The StateStore (and the web client's mirror) deep-merge per-input
 * keyed by name so a single field change never clobbers the other fields. The
 * `name` is the only required key — it identifies which input to update.
 */
export const InputStatePartialSchema = z.object({
  name: z.string(),
  kind: z.string().optional(),
  muted: z.boolean().optional(),
  volumeDb: z.number().optional(),
  volumeMul: z.number().nonnegative().optional(),
  syncOffsetMs: z.number().int().optional(),
  levels: z.array(InputChannelLevelSchema).optional(),
});
export type InputStatePartial = z.infer<typeof InputStatePartialSchema>;

const StreamingOutputSchema = z.object({
  active: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});
const RecordingOutputSchema = z.object({
  active: z.boolean(),
  paused: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});
const ReplayBufferOutputSchema = z.object({ active: z.boolean() });
const VirtualCamOutputSchema = z.object({ active: z.boolean() });

export const OutputSnapshotSchema = z.object({
  streaming: StreamingOutputSchema,
  recording: RecordingOutputSchema,
  replayBuffer: ReplayBufferOutputSchema,
  virtualCam: VirtualCamOutputSchema,
});

/**
 * Diffs may carry a partial outputs payload — e.g. only `streaming` if a
 * StreamStateChanged event arrived. The StateStore (and the web client's
 * mirror) deep-merge into the existing four-key struct so a stream toggle
 * does not clobber the recording/replay/virtualcam siblings.
 */
export const OutputSnapshotPartialSchema = z.object({
  streaming: StreamingOutputSchema.optional(),
  recording: RecordingOutputSchema.optional(),
  replayBuffer: ReplayBufferOutputSchema.optional(),
  virtualCam: VirtualCamOutputSchema.optional(),
});
export type OutputSnapshotPartial = z.infer<typeof OutputSnapshotPartialSchema>;

export const StatsSchema = z.object({
  fps: z.number().nonnegative(),
  cpuUsage: z.number().nonnegative(),
  memoryUsageMb: z.number().nonnegative(),
  kbitsPerSec: z.number().nonnegative(),
});

export const InstanceStateSchema = z.object({
  connId: z.string().uuid(),
  status: ConnectionStatusSchema,
  currentProgramScene: z.string().nullable(),
  currentPreviewScene: z.string().nullable(),
  studioMode: z.boolean(),
  scenes: z.array(SceneSchema),
  inputs: z.array(InputStateSchema),
  outputs: OutputSnapshotSchema,
  stats: StatsSchema.nullable(),
});
export type InstanceState = z.infer<typeof InstanceStateSchema>;

export const InstanceStateDiffSchema = InstanceStateSchema.partial().extend({
  connId: z.string().uuid(),
  // Override the inherited (.partial()) outputs with the per-key partial form
  // so producers can emit just `outputs: { streaming: {...} }` without having
  // to also send synthetic defaults for recording/replay/virtualcam.
  outputs: OutputSnapshotPartialSchema.optional(),
  // Same idea for inputs: a mute toggle carries only { name, muted }, a meter
  // event carries only { name, levels }. The store keys by name and merges
  // field-by-field so siblings (and other fields on the same input) survive.
  inputs: z.array(InputStatePartialSchema).optional(),
});
export type InstanceStateDiff = z.infer<typeof InstanceStateDiffSchema>;
