import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: (token, user) => set({ token, user }),
      logout: () => {
        set({ token: null, user: null });
      },
      updateUser: (user) => set({ user }),
    }),
    {
      name: 'leadpulse-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
    }
  )
);
