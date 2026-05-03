import { z } from 'zod';

export const ConnectionConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  hasPassword: z.boolean(),
});

export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;

export const ConnectionInputSchema = z.object({
  name: z.string().min(1).max(64),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(4455),
  password: z.string().max(256).optional(),
});

export type ConnectionInput = z.infer<typeof ConnectionInputSchema>;
