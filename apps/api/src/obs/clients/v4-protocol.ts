import { createHash } from 'node:crypto';

/**
 * v4 wire format is plain JSON frames with these top-level fields:
 *
 *   Request from client → server:
 *     { "request-type": "<TypeName>", "message-id": "<uuid>", ...args }
 *
 *   Response from server → client:
 *     { "message-id": "<uuid>", "status": "ok" | "error",
 *       "error"?: string, "code"?: string, ...payload }
 *
 *   Event from server → client (no message-id):
 *     { "update-type": "<EventName>", ...payload }
 *
 * Auth: server's first AuthRequired reply includes {challenge, salt}. Client
 * computes base64(sha256(base64(sha256(password + salt)) + challenge)) and
 * sends an Authenticate request with the result as the `auth` field.
 */

export interface V4Response {
  'message-id': string;
  status: 'ok' | 'error';
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export interface V4Event {
  'update-type': string;
  [key: string]: unknown;
}

export type V4Frame = V4Response | V4Event;

export function isV4Event(frame: V4Frame): frame is V4Event {
  return typeof (frame as V4Event)['update-type'] === 'string';
}

export function isV4Response(frame: V4Frame): frame is V4Response {
  return typeof (frame as V4Response)['message-id'] === 'string';
}

/**
 * Computes the auth response per obs-websocket v4 protocol.
 *   secret       = base64( sha256( password + salt ) )
 *   authResponse = base64( sha256( secret + challenge ) )
 */
export function computeV4Auth(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(password + salt).digest('base64');
  return createHash('sha256').update(secret + challenge).digest('base64');
}
