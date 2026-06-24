/**
 * useSocket — Socket.IO connection hook.
 * Initializes one persistent connection per session, joins the user's
 * private room, and wires real-time events to React Query invalidations
 * and UIStore notifications.
 */

import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { useUIStore } from '../store/uiStore';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ||
                   import.meta.env.VITE_API_URL    ||
                   'http://localhost:3001';

export function useSocket() {
  const { user, token }       = useAuthStore();
  const { addNotification }   = useUIStore();
  const queryClient           = useQueryClient();
  const socketRef             = useRef(null);

  useEffect(() => {
    if (!user?.id || !token) return;

    // Prevent duplicate connections (React StrictMode double-mount)
    if (socketRef.current?.connected) return;

    const socket = io(SOCKET_URL, {
      query: { userId: user.id },
      auth:  { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    // ── Join private user room ──────────────────────────────────────────────
    socket.on('connect', () => {
      socket.emit('join', user.id);
      console.log('[Socket] connected →', socket.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] disconnected →', reason);
    });

    // ── Deal events ─────────────────────────────────────────────────────────
    socket.on('deal:stage_changed', (data) => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['deal', data.dealId] });
      addNotification({
        type:    'deal',
        title:   'Deal Stage Updated',
        message: `"${data.title}" moved to ${data.newStage.replace(/_/g, ' ')}`,
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
  }, [user?.id, token]);

  return socketRef.current;
}
