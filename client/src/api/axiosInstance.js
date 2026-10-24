import axios from 'axios';
import { useAuthStore, getAccessToken } from '../store/authStore';

/** Empty in dev (Vite proxies /api) — set VITE_API_URL to the API origin in production. */
export const API_BASE = import.meta.env.VITE_API_URL || '';

const api = axios.create({ baseURL: API_BASE, timeout: 30000 });

/**
 * Session endpoints are always same-origin (Vite proxy in dev, Vercel rewrite in prod)
 * so the refresh cookie stays first-party. X-Requested-With is the server's CSRF check.
 */
export const authApi = axios.create({
  baseURL: '',
  timeout: 15000,
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

let refreshPromise = null;

/** Single-flight: concurrent callers share one /refresh request. Resolves to the new access token. */
export function refreshSession() {
  refreshPromise ??= authApi.post('/api/auth/refresh')
    .then(({ data }) => {
      useAuthStore.getState().setSession(data.accessToken, data.user);
      return data.accessToken;
    })
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function logout() {
  try { await authApi.post('/api/auth/logout'); } catch { /* the local session is cleared regardless */ }
  useAuthStore.getState().clear();
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401: refresh once and replay. If the refresh fails, PrivateRoute sends the user to /login.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    if (response?.status !== 401 || !config || config._retried) throw error;
    config._retried = true;
    try {
      const token = await refreshSession();
      config.headers.Authorization = `Bearer ${token}`;
      return api(config);
    } catch {
      useAuthStore.getState().clear();
      throw error;
    }
  },
);

/** fetch() with the access token and the same refresh-once-on-401 behaviour (used for SSE streams). */
export async function authFetch(path, init = {}) {
  const send = (token) => fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, ...(token && { Authorization: `Bearer ${token}` }) },
  });
  const res = await send(getAccessToken());
  if (res.status !== 401) return res;
  try {
    return await send(await refreshSession());
  } catch {
    useAuthStore.getState().clear();
    return res;
  }
}

export default api;
