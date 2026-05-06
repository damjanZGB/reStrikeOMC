import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import {
  type TileStateColor,
  shouldPulse,
  tileStateLabel,
} from '@/lib/tile-state';

/**
 * Small colored dot communicating tile state. Pulses for live broadcast and
 * recording — the two states a control-room operator most needs to see at a
 * glance from across the room.
 *
 * Color is set inline from the corresponding `--state-*` CSS variable so the
 * theme can retune without touching this component. 'subtle' falls back to
 * `--fg-subtle` since there's no `--state-subtle` token (semantically: not a
 * state, just an absence of state).
 */
function colorVar(color: TileStateColor): string {
  if (color === 'subtle') return 'var(--fg-subtle)';
  return `var(--state-${color})`;
}

export function StatusDot({
  color,
  size = 8,
  className,
}: {
  color: TileStateColor;
  size?: number;
  className?: string;
}): JSX.Element {
  const style: CSSProperties = {
    backgroundColor: `hsl(${colorVar(color)})`,
    width: `${size}px`,
    height: `${size}px`,
  };
  return (
    <span
      role="img"
      aria-label={tileStateLabel(color)}
      title={tileStateLabel(color)}
      className={cn(
        'inline-block rounded-full shrink-0',
        shouldPulse(color) && 'animate-pulse',
        className
      )}
      style={style}
    />
  );
}
