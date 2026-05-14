import type { ObsProtocol } from '@restrike/shared';

/**
 * The connection form's protocol dropdown has three positions:
 * 'default' (inherit the global default), 'v4', 'v5'. The DB / API layer
 * stores either null (= inherit) or a concrete protocol. This helper
 * converts the form value to the API value.
 *
 * Extracted from connections.tsx so the round-trip can be unit-tested.
 * The previous inline helper had no test, and a regression that flipped
 * it to return the literal string 'default' would have persisted a bad
 * value into the DB and broken every connection it was applied to.
 */
export type ProtocolChoice = 'default' | ObsProtocol;

export function protocolChoiceToValue(c: ProtocolChoice): ObsProtocol | null {
  return c === 'default' ? null : c;
}

export function protocolValueToChoice(v: ObsProtocol | null): ProtocolChoice {
  return v === null ? 'default' : v;
}
