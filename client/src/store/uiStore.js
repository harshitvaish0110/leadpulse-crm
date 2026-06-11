import { create } from 'zustand';

export const useUIStore = create((set, get) => ({
  sidebarOpen: true,
  notifications: [],
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  addNotification: (notification) => {
    const id = Date.now().toString();
    set((s) => ({
      notifications: [{ id, read: false, createdAt: new Date(), ...notification }, ...s.notifications].slice(0, 50)
    }));
    return id;
  },
  markAllRead: () => set((s) => ({ notifications: s.notifications.map(n => ({ ...n, read: true })) })),
  unreadCount: () => get().notifications.filter(n => !n.read).length,
}));
