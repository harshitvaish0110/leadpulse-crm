import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PhoneCall, Mail, Calendar, FileText, MessageSquare, Plus, Trash2, Filter } from 'lucide-react';
import { getActivities, createActivity, deleteActivity } from '../api/activities';
import { getContacts } from '../api/contacts';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import SlideOver from '../components/ui/SlideOver';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import Input from '../components/ui/Input';
import Avatar from '../components/ui/Avatar';
import toast from 'react-hot-toast';

const ACTIVITY_CONFIG = {
  CALL:       { icon: PhoneCall,      color: 'bg-blue-100 text-blue-600',   badge: 'blue' },
  EMAIL:      { icon: Mail,           color: 'bg-indigo-100 text-indigo-600', badge: 'indigo' },
  MEETING:    { icon: Calendar,       color: 'bg-green-100 text-green-600',  badge: 'green' },
  NOTE:       { icon: FileText,       color: 'bg-amber-100 text-amber-600',  badge: 'amber' },
  TRANSCRIPT: { icon: MessageSquare,  color: 'bg-purple-100 text-purple-600',badge: 'purple' },
};

const SENTIMENT_VARIANT = { POSITIVE: 'green', NEGATIVE: 'red', NEUTRAL: 'gray' };

function AddActivityForm({ onClose }) {
  const qc = useQueryClient();
  const { data: contactsData } = useQuery({
    queryKey: ['contacts', 'all'],
    queryFn: () => getContacts({ limit: 100 }).then(r => r.data),
  });
  const [form, setForm] = useState({ type: 'CALL', subject: '', notes: '', contactId: '', durationMinutes: '' });
  const { mutate, isPending } = useMutation({
    mutationFn: createActivity,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['activities'] }); toast.success('Activity logged'); onClose(); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to log activity'),
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <form onSubmit={e => { e.preventDefault(); mutate(form); }} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(ACTIVITY_CONFIG).map(([type, { icon: Icon, color }]) => (
            <button key={type} type="button" onClick={() => set('type', type)}
              className={`flex flex-col items-center gap-1 py-2 rounded-xl border-2 text-xs font-medium transition-all
                ${form.type === type ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
                <Icon size={14} />
              </div>
              {type}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Contact <span className="text-red-500">*</span></label>
        <select required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.contactId} onChange={e => set('contactId', e.target.value)}>
          <option value="">Select contact...</option>
          {(contactsData?.contacts || []).map(c => (
            <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
          ))}
        </select>
      </div>
      <Input label="Subject" value={form.subject} onChange={e => set('subject', e.target.value)} />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          rows={4} value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="What was discussed?" />
      </div>
      {['CALL','MEETING'].includes(form.type) && (
        <Input label="Duration (minutes)" type="number" min="1" value={form.durationMinutes} onChange={e => set('durationMinutes', e.target.value)} />
      )}
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Log Activity</Button>
      </div>
    </form>
  );
}

export default function Activities() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['activities', typeFilter, page],
    queryFn: () => getActivities({ type: typeFilter || undefined, page, limit: 25 }).then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteActivity,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['activities'] }); toast.success('Deleted'); },
  });

  const activities = data?.activities || [];
  const meta = data?.meta || {};

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Activities</h2>
          {meta.total != null && <p className="text-sm text-gray-400">{meta.total} total</p>}
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" /> Log Activity
        </Button>
      </div>

      {/* Type filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => { setTypeFilter(''); setPage(1); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all
            ${!typeFilter ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
          All
        </button>
        {Object.entries(ACTIVITY_CONFIG).map(([type, { icon: Icon, badge }]) => (
          <button key={type} onClick={() => { setTypeFilter(type); setPage(1); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all
              ${typeFilter === type ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            <Icon size={11} /> {type}
          </button>
        ))}
      </div>

      {/* Activity Cards */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : activities.length === 0 ? (
        <EmptyState icon={Calendar} title="No activities yet" description="Log calls, emails, meetings, and notes to track all interactions"
          actionLabel="Log Activity" onAction={() => setShowForm(true)} />
      ) : (
        <div className="space-y-3">
          {activities.map(a => {
            const config = ACTIVITY_CONFIG[a.type] || ACTIVITY_CONFIG.NOTE;
            const Icon = config.icon;
            return (
              <div key={a.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex gap-4 group hover:shadow-md transition-all">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${config.color}`}>
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900">{a.subject || a.type}</p>
                    <Badge variant={config.badge}>{a.type}</Badge>
                    {a.sentiment && (
                      <Badge variant={SENTIMENT_VARIANT[a.sentiment] || 'gray'}>{a.sentiment.toLowerCase()}</Badge>
                    )}
                  </div>
                  {a.contact && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <Avatar firstName={a.contact.firstName} lastName={a.contact.lastName} size="xs" />
                      <span className="text-xs text-gray-500">{a.contact.firstName} {a.contact.lastName}</span>
                      {a.deal && <span className="text-xs text-indigo-500">· {a.deal.title}</span>}
                    </div>
                  )}
                  {a.notes && <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">{a.notes}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    <span>{new Date(a.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {a.durationMinutes && <span>· {a.durationMinutes} min</span>}
                    {a.user && <span>· by {a.user.firstName} {a.user.lastName}</span>}
                  </div>
                </div>
                <button onClick={() => deleteMutation.mutate(a.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition-all flex-shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Page {meta.page} of {meta.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <SlideOver isOpen={showForm} onClose={() => setShowForm(false)} title="Log Activity">
        <AddActivityForm onClose={() => setShowForm(false)} />
      </SlideOver>
    </div>
  );
}
