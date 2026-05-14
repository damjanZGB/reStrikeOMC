import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProtocolBadge } from './protocol-badge';

describe('ProtocolBadge', () => {
  it('renders "v5" for an explicit v5 protocol', () => {
    render(<ProtocolBadge protocol="v5" />);
    expect(screen.getByText('v5')).toBeInTheDocument();
  });

  it('renders "v4" for an explicit v4 protocol', () => {
    render(<ProtocolBadge protocol="v4" />);
    expect(screen.getByText('v4')).toBeInTheDocument();
  });

  it('renders "default" when protocol is null', () => {
    render(<ProtocolBadge protocol={null} />);
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('shows the resolved default in the tooltip when protocol is null', () => {
    render(<ProtocolBadge protocol={null} resolvedDefault="v4" />);
    const badge = screen.getByText('default');
    expect(badge.getAttribute('title')).toContain('v4');
  });

  it('omits the resolved-default value from the tooltip when not provided', () => {
    render(<ProtocolBadge protocol={null} />);
    const badge = screen.getByText('default');
    expect(badge.getAttribute('title')).toBe('inherits global default');
  });

  // Visual styling regression: v4 and v5 should not share the same class
  // string. A future "single accent color" refactor that flattens them
  // would lose the at-a-glance protocol identification.
  it('uses distinct styles for v4 vs v5', () => {
    const { container: c4 } = render(<ProtocolBadge protocol="v4" />);
    const { container: c5 } = render(<ProtocolBadge protocol="v5" />);
    expect((c4.firstChild as Element).className).not.toBe(
      (c5.firstChild as Element).className
    );
  });
});
