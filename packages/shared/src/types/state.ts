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

export const OutputSnapshotSchema = z.object({
  streaming: z.object({
    active: z.boolean(),
    durationMs: z.number().int().nonnegative(),
  }),
  recording: z.object({
    active: z.boolean(),
    paused: z.boolean(),
    durationMs: z.number().int().nonnegative(),
  }),
  replayBuffer: z.object({ active: z.boolean() }),
  virtualCam: z.object({ active: z.boolean() }),
});

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
});
export type InstanceStateDiff = z.infer<typeof InstanceStateDiffSchema>;
