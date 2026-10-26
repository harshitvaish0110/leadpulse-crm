import { create } from 'zustand';

export const useUIStore = create((set) => ({
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
