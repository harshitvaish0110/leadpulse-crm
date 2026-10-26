import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../api/axiosInstance';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Skeleton from '../../components/ui/Skeleton';
import { formatDate, humanize } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';

const field = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const TYPE_LABEL = { ai_action: 'AI action', ai_conversation: 'AI conversation' };
const typeLabel = (t) => TYPE_LABEL[t] ?? humanize(t);
const ACTION_VARIANT = { delete: 'red', execute_failed: 'red', reject: 'amber', approve: 'green', execute: 'green', create: 'blue', update: 'indigo', login: 'gray' };

function Entry({ entry }) {
  const [open, setOpen] = useState(false);
  const who = entry.actor ? (entry.actor.deleted ? 'Deleted user' : `${entry.actor.firstName} ${entry.actor.lastName}`) : 'System';
  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50/60">
        <td className="py-2.5 pr-3 whitespace-nowrap text-gray-500">{formatDate(entry.createdAt, { hour: 'numeric', minute: '2-digit' })}</td>
        <td className="py-2.5 pr-3 text-gray-800">{who}</td>
        <td className="py-2.5 pr-3"><Badge variant={ACTION_VARIANT[entry.action] || 'gray'}>{humanize(entry.action)}</Badge></td>
        <td className="py-2.5 pr-3 text-gray-700">{typeLabel(entry.entityType)}</td>
        <td className="py-2.5 pr-3 font-mono text-xs text-gray-400" title={entry.entityId ?? ''}>{entry.entityId?.slice(0, 8) ?? '—'}</td>
        <td className="py-2.5 text-right">
          {(entry.before || entry.after) && (
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Show changes"
              className="p-1 text-gray-400 hover:text-gray-700">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="p-3">
            <div className="grid md:grid-cols-2 gap-3">
              {[['Before', entry.before], ['After', entry.after]].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
                  <pre className="text-[11px] text-gray-600 bg-white border border-gray-100 rounded-lg p-2 overflow-x-auto max-h-64">{value ? JSON.stringify(value, null, 2) : '—'}</pre>
                </div>
              ))}
            </div>
            {entry.requestId && <p className="text-[11px] text-gray-400 mt-2">Request {entry.requestId}{entry.ip ? ` · ${entry.ip}` : ''}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

/** Who did what: every audited change, newest first (append-only, ADMIN only). */
export default function AuditLogSettings() {
  const [filters, setFilters] = useState({ entityType: '', action: '', entityId: '' });
  const [page, setPage] = useState(1);
  const params = { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v.trim())), page, limit: 50 };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: qk.audit.list(params),
    queryFn: () => api.get('/api/audit-logs', { params }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };

  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div>
        <h1 className="text-base font-semibold text-gray-900">Audit log</h1>
        <p className="text-sm text-gray-500">Every recorded change, approval and deletion. Entries can't be edited or removed.</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <label>
          <span className="sr-only">Record type</span>
          <select className={field} value={filters.entityType} onChange={set('entityType')}>
            <option value="">All record types</option>
            {(data?.entityTypes ?? []).map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Action</span>
          <select className={field} value={filters.action} onChange={set('action')}>
            <option value="">All actions</option>
            {['create', 'update', 'delete', 'bulk_assign', 'approve', 'reject', 'execute', 'execute_failed', 'login', 'role_change'].map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
          </select>
        </label>
        <label className="flex-1 min-w-[14rem]">
          <span className="sr-only">Record id</span>
          <input className={`${field} w-full`} placeholder="Record id" value={filters.entityId} onChange={set('entityId')} />
        </label>
      </div>

      {isLoading ? <Skeleton className="h-64 w-full" /> : (
        <div className={`overflow-x-auto ${isFetching ? 'opacity-60' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                {['When', 'Who', 'Action', 'Record', 'Id', ''].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.entries.length === 0
                ? <tr><td colSpan={6} className="py-10 text-center text-gray-400">No entries match these filters</td></tr>
                : data.entries.map((e) => <Entry key={e.id} entry={e} />)}
            </tbody>
          </table>
        </div>
      )}

      {data?.meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total.toLocaleString()} entries</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </section>
  );
}
