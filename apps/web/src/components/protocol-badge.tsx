import type { ObsProtocol } from '@restrike/shared';

interface Props {
  protocol: ObsProtocol | null;
  /** When `protocol` is null, render this as "Default (vX)" tooltip text. */
  resolvedDefault?: ObsProtocol;
}

const STYLES: Record<ObsProtocol, string> = {
  v5: 'bg-primary/15 text-primary border-primary/30',
  v4: 'bg-state-warn/15 text-state-warn border-state-warn/30',
};

/**
 * Small visual badge showing which obs-websocket protocol a connection
 * speaks. Null means "inherit the global default" — rendered as a muted
 * "default" pill whose tooltip reveals the resolved value.
 */
export function ProtocolBadge({ protocol, resolvedDefault }: Props): JSX.Element {
  if (protocol === null) {
    return (
      <span
        className="inline-flex items-center text-xs px-1.5 py-0.5 rounded border bg-muted text-muted-foreground border-border"
        title={`inherits global default${resolvedDefault ? ` (${resolvedDefault})` : ''}`}
      >
        default
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded border font-mono ${STYLES[protocol]}`}
    >
      {protocol}
    </span>
  );
}
