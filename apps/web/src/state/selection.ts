import { create } from 'zustand';

interface SelectionState {
  selected: Set<string>;
  toggle: (id: string) => void;
  set: (ids: string[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selected: new Set<string>(),
  toggle: (id) =>
    set((prev) => {
      const next = new Set(prev.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next };
    }),
  set: (ids) => set({ selected: new Set(ids) }),
  clear: () => set({ selected: new Set() }),
  isSelected: (id) => get().selected.has(id),
}));
