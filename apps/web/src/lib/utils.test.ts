import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges plain class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false && 'b', null, undefined, 'c')).toBe('a c');
  });

  it('dedupes conflicting tailwind utilities (last wins)', () => {
    // tailwind-merge collapses conflicting padding utilities
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('preserves non-conflicting classes from object/array forms', () => {
    expect(cn('flex', { 'gap-2': true, hidden: false }, ['rounded'])).toBe('flex gap-2 rounded');
  });
});
