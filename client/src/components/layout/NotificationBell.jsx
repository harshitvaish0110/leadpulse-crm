import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckSquare, AlertTriangle, TrendingUp, Sparkles, Info } from 'lucide-react';
import api from '../../api/axiosInstance';
import { formatDate } from '../../lib/format';

const TYPE_ICONS = { task: CheckSquare, churn: AlertTriangle, deal: TrendingUp, ai_action: Sparkles };
const NOTIFICATIONS_KEY = ['notifications', 'latest'];

/** Bell with the unread count and the latest 10 notifications (persisted on the server). */
export default function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const { data } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => api.get('/api/notifications', { params: { limit: 10 } }).then((r) => r.data),
    refetchInterval: 120_000, // safety net if a socket event was missed
  });
  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api.patch('/api/notifications/read-all'), onSuccess: refresh });
  const readOne = useMutation({ mutationFn: (id) => api.patch(`/api/notifications/${id}/read`), onSuccess: refresh });

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openItem = (n) => {
    if (!n.readAt) readOne.mutate(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-80 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
            {unread > 0 && (
              <button onClick={() => readAll.mutate()} className="text-xs text-indigo-600 hover:text-indigo-700">Mark all read</button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <li className="text-center text-sm text-gray-500 py-8">No notifications yet</li>
            ) : notifications.map((n) => {
              const Icon = TYPE_ICONS[n.type] || Info;
              return (
                <li key={n.id}>
                  <button onClick={() => openItem(n)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 flex gap-3 ${n.readAt ? '' : 'bg-indigo-50/40'}`}>
                    <Icon size={16} className="text-indigo-500 flex-shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">{n.title}</span>
                      <span className="block text-xs text-gray-600">{n.message}</span>
                      <span className="block text-xs text-gray-400 mt-0.5">{formatDate(n.createdAt, { hour: 'numeric', minute: '2-digit' })}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
