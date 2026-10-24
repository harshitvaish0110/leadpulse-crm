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
import { useUIStore } from '../store/uiStore';
import { refreshSession } from '../api/axiosInstance';

// Empty = same origin (the Vite dev proxy forwards /socket.io).
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || undefined;

export function useSocket() {
  const userId                = useAuthStore((s) => s.user?.id);
  const { addNotification }   = useUIStore();
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

    // ── Deal events ─────────────────────────────────────────────────────────
    socket.on('deal:stage_changed', (data) => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['deal', data.dealId] });
      addNotification({
        type:    'deal',
        title:   'Deal Stage Updated',
        message: `"${data.title}" moved to ${data.toStage.replace(/_/g, ' ')}`,
        dealId:  data.dealId,
      });
    });

    socket.on('deal:score_updated', () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    });

    // ── Activity events ─────────────────────────────────────────────────────
    socket.on('activity:created', (data) => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      if (data?.contactId) {
        queryClient.invalidateQueries({ queryKey: ['activities', data.contactId] });
      }
    });

    // ── Contact events ──────────────────────────────────────────────────────
    socket.on('contact:updated', () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    });

    socket.on('contact:churn_alert', (data) => {
      addNotification({
        type:    'alert',
        title:   '⚠️ Churn Alert',
        message: `${data.name} has ${Math.round(data.churnRisk * 100)}% churn risk`,
        contactId: data.contactId,
      });
    });

    // ── Task events ─────────────────────────────────────────────────────────
    socket.on('task:due_soon', (data) => {
      addNotification({
        type:    'task',
        title:   'Task Due Soon',
        message: data.title,
        taskId:  data.taskId,
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps -- store actions and queryClient are stable; reconnect only when the signed-in user changes
}
