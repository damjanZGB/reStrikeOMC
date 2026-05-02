import type { SessionRepo } from './sessions.js';

export function startSessionPurgeTimer(
  sessions: SessionRepo,
  intervalMs: number = 5 * 60 * 1000
): () => void {
  const handle = setInterval(() => {
    try {
      sessions.purgeExpired();
    } catch {
      // best-effort cleanup; ignore
    }
  }, intervalMs);
  handle.unref?.();
  return () => clearInterval(handle);
}
