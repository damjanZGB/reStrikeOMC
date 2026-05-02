import { z } from 'zod';
import { InstanceStateSchema, InstanceStateDiffSchema } from '../types/state.js';

export const FailureCodeSchema = z.enum([
  'SceneNotFound',
  'InputNotFound',
  'RequestTimeout',
  'Disconnected',
  'AuthFailed',
  'InvalidPayload',
  'Unknown',
]);
export type FailureCode = z.infer<typeof FailureCodeSchema>;

export const PerTargetFailureSchema = z.object({
  connId: z.string().uuid(),
  code: FailureCodeSchema,
  message: z.string(),
});
export type PerTargetFailure = z.infer<typeof PerTargetFailureSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state.snapshot'),
    states: z.array(InstanceStateSchema),
  }),
  z.object({
    type: z.literal('state.diff'),
    diff: InstanceStateDiffSchema,
  }),
  z.object({
    type: z.literal('cmd.result'),
    id: z.string(),
    ok: z.array(z.string().uuid()),
    failed: z.array(PerTargetFailureSchema),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sync'),
  }),
  z.object({
    type: z.literal('cmd'),
    id: z.string().min(1),
    action: z.string().min(1),
    targets: z.array(z.string().uuid()).min(1),
    payload: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('selection.update'),
    selected: z.array(z.string().uuid()),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
