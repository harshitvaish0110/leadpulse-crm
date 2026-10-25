import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, Activity as ActivityIcon } from 'lucide-react';
import { getActivities, deleteActivity } from '../api/activities';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import ActivityTimeline from '../components/activities/ActivityTimeline';
import LogActivityModal from '../components/activities/LogActivityModal';
import ContactPicker from '../components/contacts/ContactPicker';
import { ACTIVITY_TYPES } from '../constants/crm';
import { humanize } from '../lib/format';
import { qk } from '../hooks/queries/keys';
import { useDirectory } from '../hooks/queries/lookups';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

const FILTER_DEFAULTS = { type: '', from: '', to: '', contact: '', contactName: '', rep: '', page: '1' };
const control = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';
const PAGE_SIZE = 30;

/** Inclusive local-day bounds as ISO timestamps. */
const dayStart = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const dayEnd = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

export default function Activities() {
  const qc = useQueryClient();
  const isPrivileged = useAuthStore((s) => ['ADMIN', 'MANAGER'].includes(s.user?.role));
  const { data: directory = [] } = useDirectory();
  const [filters, setFilters] = useUrlFilters(FILTER_DEFAULTS);
  const [logging, setLogging] = useState(false);

  const page = Math.max(1, Number(filters.page) || 1);
  const params = {
    type: filters.type || undefined, contactId: filters.contact || undefined, userId: filters.rep || undefined,
    dateFrom: dayStart(filters.from), dateTo: dayEnd(filters.to), page, limit: PAGE_SIZE,
  };
  const { data, isLoading } = useQuery({
    queryKey: qk.activities.list(params),
    queryFn: () => getActivities(params).then(r => r.data),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (a) => deleteActivity(a.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.activities.all }); toast.success('Activity deleted'); },
    onError: () => toast.error('Could not delete the activity'),
  });

  const activities = data?.activities || [];
  const meta = data?.meta || {};
  const hasFilters = ['type', 'from', 'to', 'contact', 'rep'].some(k => filters[k]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Activities</h2>
          {meta.total != null && <p className="text-sm text-gray-400">{meta.total.toLocaleString()} matching</p>}
        </div>
        <Button size="sm" onClick={() => setLogging(true)}><Plus size={14} className="mr-1.5" /> Log Activity</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
        {/* Filter sidebar */}
        <aside className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4" aria-label="Filters">
          <fieldset>
            <legend className="text-xs font-semibold text-gray-500 uppercase mb-2">Type</legend>
            <div className="flex flex-wrap gap-1.5">
              {['', ...ACTIVITY_TYPES].map(t => (
                <button key={t || 'all'} type="button" onClick={() => setFilters({ type: t })} aria-pressed={filters.type === t}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${filters.type === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                  {t ? humanize(t) : 'All'}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500">From
              <input type="date" className={`${control} mt-1`} value={filters.from} onChange={e => setFilters({ from: e.target.value })} />
            </label>
            <label className="text-xs text-gray-500">To
              <input type="date" className={`${control} mt-1`} value={filters.to} onChange={e => setFilters({ to: e.target.value })} />
            </label>
          </div>
          <div>
            <label htmlFor="filter-contact" className="block text-xs text-gray-500 mb-1">Contact</label>
            <ContactPicker id="filter-contact"
              value={filters.contact ? { id: filters.contact, name: filters.contactName || 'Selected contact' } : null}
              onChange={(c) => setFilters({ contact: c?.id ?? '', contactName: c?.name ?? '' })} />
          </div>
          {isPrivileged && (
            <label className="block text-xs text-gray-500">Rep
              <select className={`${control} mt-1`} value={filters.rep} onChange={e => setFilters({ rep: e.target.value })}>
                <option value="">Everyone</option>
                {directory.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
              </select>
            </label>
          )}
          {hasFilters && (
            <button type="button" className="text-sm text-indigo-600 hover:text-indigo-700"
              onClick={() => setFilters({ type: '', from: '', to: '', contact: '', contactName: '', rep: '' })}>
              Clear filters
            </button>
          )}
        </aside>

        {/* Feed */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 min-w-0">
          {isLoading ? <div className="space-y-3">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
            : activities.length === 0 ? (
              <EmptyState icon={ActivityIcon} title="No activities found"
                description={hasFilters ? 'Try other filters' : 'Log a call, email, meeting or note to get started'}
                actionLabel={hasFilters ? undefined : 'Log Activity'} onAction={() => setLogging(true)} />
            ) : (
              <ActivityTimeline activities={activities} showContact
                onDelete={(a) => { if (confirm('Delete this activity?')) remove.mutate(a); }} />
            )}
          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
              <p className="text-sm text-gray-500">Page {meta.page} of {meta.totalPages}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setFilters({ page: String(page - 1) })}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setFilters({ page: String(page + 1) })}>Next</Button>
              </div>
            </div>
          )}
        </section>
      </div>

      <LogActivityModal isOpen={logging} onClose={() => setLogging(false)} />
    </div>
  );
}
