import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from './selection';

describe('useSelectionStore', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('starts empty', () => {
    expect(useSelectionStore.getState().selected.size).toBe(0);
  });

  it('toggles ids in/out', () => {
    const { toggle } = useSelectionStore.getState();
    toggle('a');
    toggle('b');
    expect(useSelectionStore.getState().isSelected('a')).toBe(true);
    expect(useSelectionStore.getState().isSelected('b')).toBe(true);
    toggle('a');
    expect(useSelectionStore.getState().isSelected('a')).toBe(false);
    expect(useSelectionStore.getState().selected.size).toBe(1);
  });

  it('replaces selection via set()', () => {
    useSelectionStore.getState().toggle('a');
    useSelectionStore.getState().set(['x', 'y']);
    expect(useSelectionStore.getState().selected.size).toBe(2);
    expect(useSelectionStore.getState().isSelected('a')).toBe(false);
    expect(useSelectionStore.getState().isSelected('x')).toBe(true);
  });

  it('clears all', () => {
    useSelectionStore.getState().set(['a', 'b', 'c']);
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().selected.size).toBe(0);
  });

  it('returns immutable Set across toggles (new reference each call)', () => {
    const before = useSelectionStore.getState().selected;
    useSelectionStore.getState().toggle('a');
    const after = useSelectionStore.getState().selected;
    expect(after).not.toBe(before);
  });
});
