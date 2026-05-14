import { describe, it, expect } from 'vitest';
import {
  protocolChoiceToValue,
  protocolValueToChoice,
} from './protocol-choice.js';

describe('protocolChoiceToValue', () => {
  it('maps the "default" choice to null', () => {
    expect(protocolChoiceToValue('default')).toBeNull();
  });

  it.each([
    ['v4', 'v4'],
    ['v5', 'v5'],
  ] as const)('passes through %s untouched', (input, expected) => {
    expect(protocolChoiceToValue(input)).toBe(expected);
  });

  // Regression guard: a bug that returned the literal string 'default'
  // (instead of null) would persist the string 'default' into the DB and
  // break every connection it was applied to. Pinning the type-narrowing
  // makes that regression a typecheck failure.
  it('never returns the literal string "default"', () => {
    const result = protocolChoiceToValue('default');
    expect(result).not.toBe('default');
  });
});

describe('protocolValueToChoice', () => {
  it('maps null to the "default" choice', () => {
    expect(protocolValueToChoice(null)).toBe('default');
  });

  it.each([
    ['v4', 'v4'],
    ['v5', 'v5'],
  ] as const)('passes through %s untouched', (input, expected) => {
    expect(protocolValueToChoice(input)).toBe(expected);
  });

  it('is the inverse of protocolChoiceToValue', () => {
    expect(protocolChoiceToValue(protocolValueToChoice(null))).toBeNull();
    expect(protocolChoiceToValue(protocolValueToChoice('v4'))).toBe('v4');
    expect(protocolChoiceToValue(protocolValueToChoice('v5'))).toBe('v5');
  });
});
