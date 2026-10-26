/**
 * useSocket — Socket.IO connection hook.
 * One connection per signed-in user. The server authenticates the handshake
 * and assigns rooms; events are wired to React Query invalidations and
 * UIStore notifications.
 */

import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore, getAccessToken } from '../store/authStore';
import { refreshSession } from '../api/axiosInstance';
import { qk } from './queries/keys';
import toast from 'react-hot-toast';

const TOAST_TYPES = new Set(['task', 'churn', 'transcript']);

// Empty = same origin (the Vite dev proxy forwards /socket.io).
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || undefined;

export function useSocket() {
  const userId                = useAuthStore((s) => s.user?.id);
  const queryClient           = useQueryClient();
  const socketRef             = useRef(null);

  useEffect(() => {
    if (!userId) return;

    const socket = io(SOCKET_URL, {
      // Called on every (re)connect, so a refreshed token is picked up without reconnecting.
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    // The server rejects expired tokens at the handshake; refresh once and retry.
    socket.on('connect_error', (err) => {
      if (err.data?.code !== 'TOKEN_EXPIRED') return;
      refreshSession().then(() => socket.connect()).catch(() => {});
    });

    const refresh = (...keys) => keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));

    // Persisted notifications (task assigned, churn alert, ...): refresh the bell and toast.
    socket.on('notification:new', (n) => {
      refresh(['notifications']);
      if (TOAST_TYPES.has(n.type)) toast(`${n.title}: ${n.message}`, { icon: n.type === 'churn' ? '⚠️' : '🔔' });
    });

    // ── Data changes: keep open views current ───────────────────────────────
    ['deal:created', 'deal:updated', 'deal:deleted', 'deal:stage_changed', 'deal:score_updated'].forEach((event) => {
      socket.on(event, () => refresh(qk.deals.all, qk.analytics.all, qk.myDay));
    });
    ['activity:created', 'activity:updated', 'activity:deleted', 'activity:transcribed'].forEach((event) => {
      socket.on(event, () => refresh(qk.activities.all, qk.contacts.all));
    });
    ['contact:created', 'contact:updated', 'contact:deleted', 'contact:churn_alert'].forEach((event) => {
      socket.on(event, () => refresh(qk.contacts.all, qk.analytics.all, qk.myDay));
    });
    ['task:assigned', 'task:due_soon', 'task:overdue'].forEach((event) => {
      socket.on(event, () => refresh(qk.tasks.all, qk.myDay));
    });
    socket.on('email:created', () => refresh(['emails']));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps -- queryClient is stable; reconnect only when the signed-in user changes
}
