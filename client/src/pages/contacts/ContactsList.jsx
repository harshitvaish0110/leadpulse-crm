import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Upload, Download, Search, Trash2, Tag, UserCheck, ArrowUp, ArrowDown, X } from 'lucide-react';
import api from '../../api/axiosInstance';
import { getContacts, createContact, deleteContact } from '../../api/contacts';
import { getCompanies } from '../../api/companies';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import SlideOver from '../../components/ui/SlideOver';
import { CustomFieldInputs } from '../../components/crm/CustomFields';
import { customFieldPayload } from '../../lib/customFields';
import Avatar from '../../components/ui/Avatar';
import Skeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import ImportCsvModal from '../../components/contacts/ImportCsvModal';
import { ScoreBadge, ChurnBar } from '../../components/crm/Indicators';
import { CONTACT_STATUSES, SCORE_LABELS } from '../../constants/crm';
import { formatDate, humanize } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import { useDirectory, useTags } from '../../hooks/queries/lookups';
import { useUrlFilters } from '../../hooks/useUrlFilters';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { apiError } from '../../lib/apiError';

const FILTER_DEFAULTS = { q: '', status: '', owner: '', tag: '', score: '', risk: '', sort: 'createdAt:desc', page: '1' };
const PAGE_SIZE = 25;
const selectClass = 'text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';

/** Query params for the list and export endpoints. */
const toQuery = (f) => {
  const [sortBy, sortDir] = f.sort.split(':');
  return {
    search: f.q || undefined, status: f.status || undefined, ownerId: f.owner || undefined,
    tags: f.tag || undefined, scoreLabel: f.score || undefined, atRisk: f.risk ? 'true' : undefined,
    sortBy, sortDir,
  };
};

async function download(params, fileName) {
  const res = await api.get('/api/contacts/export', { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  URL.revokeObjectURL(url);
}

function ContactForm({ onDone }) {
  const qc = useQueryClient();
  const isPrivileged = useAuthStore((s) => ['ADMIN', 'MANAGER'].includes(s.user?.role));
  const userId = useAuthStore((s) => s.user?.id);
  const { data: directory = [] } = useDirectory();
  const { data: companiesData } = useQuery({
    queryKey: qk.companies.options,
    queryFn: () => getCompanies({ limit: 100, sortBy: 'name', sortDir: 'asc' }).then(r => r.data),
  });
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', title: '', companyId: '', status: 'LEAD', ownerId: userId, tags: '' });
  const [custom, setCustom] = useState({});
  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const { mutate, isPending } = useMutation({
    mutationFn: createContact,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.contacts.all }); toast.success('Contact created'); onDone(); },
    onError: (err) => toast.error(apiError(err, 'Failed to create contact')),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutate({ ...form, customFields: customFieldPayload(custom) }); }} className="space-y-4">
      <div className="flex gap-3">
        <Input label="First name" required value={form.firstName} onChange={set('firstName')} className="w-1/2" />
        <Input label="Last name" required value={form.lastName} onChange={set('lastName')} className="w-1/2" />
      </div>
      <Input label="Email" type="email" required value={form.email} onChange={set('email')} />
      <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
      <Input label="Job title" value={form.title} onChange={set('title')} />
      <div>
        <label htmlFor="contact-company" className="block text-sm font-medium text-gray-700 mb-1">Company</label>
        <select id="contact-company" className={`w-full ${selectClass}`} value={form.companyId} onChange={set('companyId')}>
          <option value="">No company</option>
          {(companiesData?.companies || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="flex gap-3">
        <div className="w-1/2">
          <label htmlFor="contact-status-new" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select id="contact-status-new" className={`w-full ${selectClass}`} value={form.status} onChange={set('status')}>
            {CONTACT_STATUSES.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </div>
        {isPrivileged && (
          <div className="w-1/2">
            <label htmlFor="contact-owner" className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
            <select id="contact-owner" className={`w-full ${selectClass}`} value={form.ownerId} onChange={set('ownerId')}>
              {directory.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
            </select>
          </div>
        )}
      </div>
      <Input label="Tags" value={form.tags} onChange={set('tags')} placeholder="Comma separated, e.g. Inbound, VIP" />
      <CustomFieldInputs entity="CONTACT" values={custom} onChange={(key, value) => setCustom(p => ({ ...p, [key]: value }))} />
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onDone} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Create Contact</Button>
      </div>
    </form>
  );
}

function SortHeader({ label, field, sort, onSort }) {
  const [current, dir] = sort.split(':');
  const active = current === field;
  const next = active && dir === 'desc' ? 'asc' : 'desc';
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left px-4 py-3">
      <button onClick={() => onSort(`${field}:${next}`)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-800">
        {label}
        {active && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );
}

function BulkBar({ ids, onDone, isPrivileged, directory, tags }) {
  const qc = useQueryClient();
  const [ownerId, setOwnerId] = useState('');
  const [tag, setTag] = useState('');
  const bulk = useMutation({
    mutationFn: (body) => api.post('/api/contacts/bulk', { ids, ...body }).then(r => r.data),
    onSuccess: (data, body) => {
      qc.invalidateQueries({ queryKey: qk.contacts.all });
      const verb = { assign: 'Reassigned', tag: 'Tagged', untag: 'Untagged', delete: 'Deleted' }[body.action];
      toast.success(`${verb} ${data.updated} contact${data.updated === 1 ? '' : 's'}${data.skipped ? ` (${data.skipped} skipped)` : ''}`);
      onDone(body.action === 'delete');
    },
    onError: (err) => toast.error(apiError(err, 'Bulk action failed')),
  });

  return (
    <div className="flex items-center gap-3 flex-wrap bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3" role="region" aria-label="Bulk actions">
      <span className="text-sm font-medium text-indigo-700">{ids.length} selected</span>
      {isPrivileged && (
        <div className="flex items-center gap-2">
          <select aria-label="New owner" value={ownerId} onChange={e => setOwnerId(e.target.value)} className={selectClass}>
            <option value="">Assign to…</option>
            {directory.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
          <Button size="sm" variant="secondary" disabled={!ownerId} loading={bulk.isPending && bulk.variables?.action === 'assign'}
            onClick={() => bulk.mutate({ action: 'assign', ownerId })}>
            <UserCheck size={13} className="mr-1" /> Assign
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input list="bulk-tags" aria-label="Tag" value={tag} onChange={e => setTag(e.target.value)} placeholder="Tag…" className={`${selectClass} w-32`} />
        <datalist id="bulk-tags">{tags.map(t => <option key={t.id} value={t.name} />)}</datalist>
        <Button size="sm" variant="secondary" disabled={!tag.trim()} onClick={() => bulk.mutate({ action: 'tag', tag })}>
          <Tag size={13} className="mr-1" /> Add tag
        </Button>
        <Button size="sm" variant="secondary" disabled={!tag.trim()} onClick={() => bulk.mutate({ action: 'untag', tag })}>Remove tag</Button>
      </div>
      <Button size="sm" variant="secondary" onClick={() => download({ ids: ids.join(',') }, 'leadpulse-contacts-selected.csv').catch(() => toast.error('Export failed'))}>
        <Download size={13} className="mr-1" /> Export
      </Button>
      <Button size="sm" variant="danger" loading={bulk.isPending && bulk.variables?.action === 'delete'}
        onClick={() => { if (confirm(`Delete ${ids.length} contacts? Their deals, activities and emails are deleted too.`)) bulk.mutate({ action: 'delete' }); }}>
        <Trash2 size={13} className="mr-1" /> Delete
      </Button>
      <button onClick={() => onDone(true)} aria-label="Clear selection" className="ml-auto text-indigo-400 hover:text-indigo-700"><X size={16} /></button>
    </div>
  );
}

export default function ContactsList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isPrivileged = useAuthStore((s) => ['ADMIN', 'MANAGER'].includes(s.user?.role));
  const [filters, setFilters] = useUrlFilters(FILTER_DEFAULTS);
  const [searchInput, setSearchInput] = useState(filters.q);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const { data: directory = [] } = useDirectory();
  const { data: tags = [] } = useTags();

  // Keep the box in sync when the URL changes from outside (back/forward, Clear filters).
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    setSyncedQ(filters.q);
    setSearchInput(filters.q);
  }
  // Debounced: the URL (and the query) follow typing after a 300 ms pause.
  useEffect(() => {
    if (searchInput === filters.q) return undefined;
    const t = setTimeout(() => setFilters({ q: searchInput }), 300);
    return () => clearTimeout(t);
  }, [searchInput, filters.q, setFilters]);

  const page = Math.max(1, Number(filters.page) || 1);
  const listParams = { ...toQuery(filters), page, limit: PAGE_SIZE };
  const { data, isLoading } = useQuery({
    queryKey: qk.contacts.list(listParams),
    queryFn: () => getContacts(listParams).then(r => r.data),
    placeholderData: keepPreviousData,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteContact,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.contacts.all }); toast.success('Contact deleted'); },
    onError: () => toast.error('Failed to delete contact'),
  });

  const contacts = data?.contacts || [];
  const meta = data?.meta || {};
  const allOnPage = contacts.length > 0 && contacts.every(c => selected.has(c.id));
  const toggle = (id) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev);
    contacts.forEach(c => (allOnPage ? next.delete(c.id) : next.add(c.id)));
    return next;
  });
  const hasFilters = ['q', 'status', 'owner', 'tag', 'score', 'risk'].some(k => filters[k]);

  const exportFiltered = () => {
    const id = toast.loading('Exporting…');
    download(toQuery(filters), 'leadpulse-contacts.csv')
      .then(() => toast.success('Exported', { id }))
      .catch(() => toast.error('Export failed', { id }));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">All Contacts</h2>
          {meta.total != null && <p className="text-sm text-gray-400">{meta.total.toLocaleString()} contacts</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}><Upload size={14} className="mr-1.5" /> Import CSV</Button>
          <Button variant="secondary" size="sm" onClick={exportFiltered}><Download size={14} className="mr-1.5" /> Export{hasFilters ? ' filtered' : ''}</Button>
          <Button size="sm" onClick={() => setShowForm(true)}><UserPlus size={14} className="mr-1.5" /> Add Contact</Button>
        </div>
      </div>

      {selected.size > 0 && (
        <BulkBar ids={[...selected]} isPrivileged={isPrivileged} directory={directory} tags={tags}
          onDone={(clear) => { if (clear) setSelected(new Set()); }} />
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input placeholder="Search contacts..." aria-label="Search contacts" value={searchInput} onChange={e => setSearchInput(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64" />
        </div>
        <select aria-label="Status" value={filters.status} onChange={e => setFilters({ status: e.target.value })} className={selectClass}>
          <option value="">All statuses</option>
          {CONTACT_STATUSES.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        <select aria-label="Lead score" value={filters.score} onChange={e => setFilters({ score: e.target.value })} className={selectClass}>
          <option value="">Any score</option>
          {SCORE_LABELS.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        {isPrivileged && (
          <select aria-label="Owner" value={filters.owner} onChange={e => setFilters({ owner: e.target.value })} className={selectClass}>
            <option value="">All owners</option>
            <option value="none">Unassigned</option>
            {directory.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        )}
        <select aria-label="Tag" value={filters.tag} onChange={e => setFilters({ tag: e.target.value })} className={selectClass}>
          <option value="">Any tag</option>
          {tags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" className="rounded" checked={Boolean(filters.risk)} onChange={e => setFilters({ risk: e.target.checked ? '1' : '' })} />
          At risk only
        </label>
        {hasFilters && (
          <button onClick={() => setFilters({ q: '', status: '', owner: '', tag: '', score: '', risk: '' })} className="text-sm text-indigo-600 hover:text-indigo-700">
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-100">
                <th scope="col" className="w-10 px-4 py-3">
                  <input type="checkbox" className="rounded" aria-label="Select all on this page" checked={allOnPage} onChange={toggleAll} />
                </th>
                <SortHeader label="Name" field="lastName" sort={filters.sort} onSort={(sort) => setFilters({ sort })} />
                {['Company', 'Email', 'Phone'].map(h => (
                  <th key={h} scope="col" className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wider">{h}</th>
                ))}
                <SortHeader label="Lead score" field="leadScore" sort={filters.sort} onSort={(sort) => setFilters({ sort })} />
                <SortHeader label="Churn risk" field="churnRisk" sort={filters.sort} onSort={(sort) => setFilters({ sort })} />
                <th scope="col" className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wider">Owner</th>
                <SortHeader label="Created" field="createdAt" sort={filters.sort} onSort={(sort) => setFilters({ sort })} />
                <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={10} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td></tr>
                ))
              ) : contacts.length === 0 ? (
                <tr><td colSpan={10}>
                  <EmptyState title="No contacts found" description={hasFilters ? 'Try adjusting your search or filters' : 'Add a contact or import a CSV to get started'} />
                </td></tr>
              ) : contacts.map(c => (
                <tr key={c.id} className={`even:bg-gray-50/50 hover:bg-indigo-50/50 transition-colors ${selected.has(c.id) ? 'bg-indigo-50/40' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" className="rounded" aria-label={`Select ${c.firstName} ${c.lastName}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                  <td className="px-4 py-3">
                    <button className="flex items-center gap-3 text-left" onClick={() => navigate(`/contacts/${c.id}`)}>
                      <Avatar firstName={c.firstName} lastName={c.lastName} size="sm" />
                      <span>
                        <span className="block text-sm font-medium text-gray-900 hover:text-indigo-600">{c.firstName} {c.lastName}</span>
                        <span className="block text-xs text-gray-400">{c.title || humanize(c.status)}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.company?.name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.email}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{c.phone || '—'}</td>
                  <td className="px-4 py-3"><ScoreBadge label={c.leadScoreLabel} score={c.leadScore} explanation={c.leadScoreExplanation} /></td>
                  <td className="px-4 py-3"><ChurnBar value={c.churnRisk ?? 0} /></td>
                  <td className="px-4 py-3">
                    {c.owner ? (
                      <div className="flex items-center gap-2">
                        <Avatar firstName={c.owner.firstName} lastName={c.owner.lastName} size="xs" />
                        <span className="text-xs text-gray-500">{c.owner.firstName}</span>
                      </div>
                    ) : <span className="text-xs text-gray-400">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(c.createdAt)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => { if (confirm(`Delete ${c.firstName} ${c.lastName}?`)) deleteMutation.mutate(c.id); }}
                      aria-label={`Delete ${c.firstName} ${c.lastName}`}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <p className="text-sm text-gray-500">Page {meta.page} of {meta.totalPages} · {meta.total} total</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setFilters({ page: String(page - 1) })}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setFilters({ page: String(page + 1) })}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <SlideOver isOpen={showForm} onClose={() => setShowForm(false)} title="Add New Contact">
        <ContactForm onDone={() => setShowForm(false)} />
      </SlideOver>
      <ImportCsvModal isOpen={showImport} onClose={() => setShowImport(false)} />
    </div>
  );
}
