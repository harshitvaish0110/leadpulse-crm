import { create } from 'zustand';

// Sessions used to be persisted here; the access token now lives in memory only
// and the session is restored from the httpOnly refresh cookie on load.
try { localStorage.removeItem('leadpulse-auth'); } catch { /* storage unavailable */ }

/**
 * status: 'bootstrapping' (restoring the session) | 'authenticated' | 'anonymous'
 */
export const useAuthStore = create((set) => ({
  status: 'bootstrapping',
  user: null,
  accessToken: null,
  setSession: (accessToken, user) => set({ status: 'authenticated', accessToken, user }),
  setToken: (accessToken) => set({ accessToken }),
  updateUser: (user) => set({ user }),
  clear: () => set({ status: 'anonymous', accessToken: null, user: null }),
}));

export const getAccessToken = () => useAuthStore.getState().accessToken;

/** Only same-app paths are allowed as a post-login destination (no open redirects). */
export function safeNext(value) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}
