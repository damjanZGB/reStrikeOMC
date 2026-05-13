import { z } from 'zod';

export const ObsProtocolSchema = z.enum(['v4', 'v5']);
export type ObsProtocol = z.infer<typeof ObsProtocolSchema>;

export const ConnectionConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  hasPassword: z.boolean(),
  // null means "inherit the global default" — see GET /api/settings.
  protocol: ObsProtocolSchema.nullable().default(null),
});

export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;

export const ConnectionInputSchema = z.object({
  name: z.string().min(1).max(64),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(4455),
  password: z.string().max(256).optional(),
  protocol: ObsProtocolSchema.nullable().optional(),
});

export type ConnectionInput = z.infer<typeof ConnectionInputSchema>;

export const AppSettingsSchema = z.object({
  defaultProtocol: ObsProtocolSchema,
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;
