import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Upload, Download, Search, Trash2, Edit2, MoreHorizontal } from 'lucide-react';
import { getContacts, createContact, deleteContact, exportContacts, importContacts } from '../../api/contacts';
import { getCompanies } from '../../api/companies';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import SlideOver from '../../components/ui/SlideOver';
import Badge from '../../components/ui/Badge';
import Avatar from '../../components/ui/Avatar';
import Skeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import toast from 'react-hot-toast';

const LEAD_SCORE_VARIANT = { HOT: 'red', WARM: 'amber', COLD: 'blue', NEW: 'gray' };

function churnColor(risk) {
  if (risk > 0.6) return 'text-red-600';
  if (risk > 0.3) return 'text-amber-600';
  return 'text-green-600';
}

function ContactForm({ onSuccess, onClose }) {
  const qc = useQueryClient();
  const { data: companiesData } = useQuery({
    queryKey: ['companies', 'all'],
    queryFn: () => getCompanies({ limit: 100 }).then(r => r.data),
  });

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    title: '', companyId: '', status: 'LEAD',
  });

  const { mutate, isPending } = useMutation({
    mutationFn: createContact,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Contact created');
      onSuccess?.();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to create contact'),
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutate(form); }} className="space-y-4">
      <div className="flex gap-3">
        <Input label="First name" required value={form.firstName} onChange={e => set('firstName', e.target.value)} className="w-1/2" />
        <Input label="Last name" required value={form.lastName} onChange={e => set('lastName', e.target.value)} className="w-1/2" />
      </div>
      <Input label="Email" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
      <Input label="Phone" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} />
      <Input label="Job title" value={form.title} onChange={e => set('title', e.target.value)} />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
        <select
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.companyId} onChange={e => set('companyId', e.target.value)}>
          <option value="">No company</option>
          {(companiesData?.companies || []).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
        <select
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.status} onChange={e => set('status', e.target.value)}>
          {['LEAD','PROSPECT','CUSTOMER','CHURNED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Create Contact</Button>
      </div>
    </form>
  );
}

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const timerRef = useState(null);

  const updateDebounced = useCallback((val) => {
    if (timerRef[0]) clearTimeout(timerRef[0]);
    timerRef[0] = setTimeout(() => setDebouncedValue(val), delay);
  }, [delay]);

  // Synchronous update for mount
  useState(() => { updateDebounced(value); }, [value]);

  return debouncedValue;
}

export default function ContactsList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [importFile, setImportFile] = useState(null);
  const [importLoading, setImportLoading] = useState(false);

  // Simple 300ms debounce
  const [searchInput, setSearchInput] = useState('');
  const [searchTimer, setSearchTimer] = useState(null);
  const handleSearchChange = (v) => {
    setSearchInput(v);
    if (searchTimer) clearTimeout(searchTimer);
    setSearchTimer(setTimeout(() => { setSearch(v); setPage(1); }, 300));
  };

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', { search, status: statusFilter, page }],
    queryFn: () => getContacts({ search, status: statusFilter || undefined, page, limit: 25 }).then(r => r.data),
    keepPreviousData: true,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteContact,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Contact deleted');
    },
    onError: () => toast.error('Failed to delete contact'),
  });

  const handleExport = async () => {
    const toastId = toast.loading('Exporting...');
    try {
      const res = await exportContacts();
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported!', { id: toastId });
    } catch { toast.error('Export failed', { id: toastId }); }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImportLoading(true);
    try {
      const { data: res } = await importContacts(importFile);
      toast.success(`Imported ${res.created} contacts`);
      qc.invalidateQueries({ queryKey: ['contacts'] });
      setShowImport(false); setImportFile(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally { setImportLoading(false); }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (selected.size === data?.contacts?.length) setSelected(new Set());
    else setSelected(new Set(data?.contacts?.map(c => c.id)));
  };

  const contacts = data?.contacts || [];
  const meta = data?.meta || {};

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">All Contacts</h2>
          {meta.total != null && (
            <p className="text-sm text-gray-400">{meta.total.toLocaleString()} contacts</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>
            <Upload size={14} className="mr-1.5" /> Import CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExport}>
            <Download size={14} className="mr-1.5" /> Export
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <UserPlus size={14} className="mr-1.5" /> Add Contact
          </Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-indigo-700">{selected.size} selected</span>
          <Button variant="danger" size="sm" onClick={() => {
            selected.forEach(id => deleteMutation.mutate(id));
            setSelected(new Set());
          }}>
            <Trash2 size={13} className="mr-1" /> Delete selected
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            placeholder="Search contacts..."
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="">All statuses</option>
          {['LEAD','PROSPECT','CUSTOMER','CHURNED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" className="rounded"
                    checked={selected.size === contacts.length && contacts.length > 0}
                    onChange={toggleAll} />
                </th>
                {['Name', 'Company', 'Email', 'Lead Score', 'Churn Risk', 'Owner', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr><td colSpan={8}>
                  <EmptyState title="No contacts found" description="Try adjusting your search or filters" />
                </td></tr>
              ) : contacts.map(c => (
                <tr key={c.id} className={`hover:bg-gray-50 transition-colors ${selected.has(c.id) ? 'bg-indigo-50/30' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" className="rounded"
                      checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate(`/contacts/${c.id}`)}>
                      <Avatar firstName={c.firstName} lastName={c.lastName} size="sm" />
                      <div>
                        <p className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors">
                          {c.firstName} {c.lastName}
                        </p>
                        <p className="text-xs text-gray-400">{c.title || ''}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.company?.name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.email || '—'}</td>
                  <td className="px-4 py-3">
                    {c.leadScore ? (
                      <Badge variant={LEAD_SCORE_VARIANT[c.leadScore] || 'gray'}>{c.leadScore}</Badge>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-medium ${churnColor(c.churnRisk ?? 0)}`}>
                      {c.churnRisk != null ? `${(c.churnRisk * 100).toFixed(0)}%` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {c.owner ? (
                      <div className="flex items-center gap-2">
                        <Avatar firstName={c.owner.firstName} lastName={c.owner.lastName} size="xs" />
                        <span className="text-xs text-gray-500">{c.owner.firstName}</span>
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => navigate(`/contacts/${c.id}`)}
                        className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => { if (confirm('Delete this contact?')) deleteMutation.mutate(c.id); }}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              Page {meta.page} of {meta.totalPages} · {meta.total} total
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Add Contact SlideOver */}
      <SlideOver isOpen={showForm} onClose={() => setShowForm(false)} title="Add New Contact">
        <ContactForm onSuccess={() => setShowForm(false)} onClose={() => setShowForm(false)} />
      </SlideOver>

      {/* Import CSV Modal */}
      <Modal isOpen={showImport} onClose={() => setShowImport(false)} title="Import Contacts from CSV">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Upload a CSV file with columns: firstName, lastName, email, phone, title, company</p>
          <input
            type="file" accept=".csv"
            onChange={e => setImportFile(e.target.files[0])}
            className="text-sm text-gray-600"
          />
          {importFile && (
            <p className="text-xs text-indigo-600 font-medium">Selected: {importFile.name}</p>
          )}
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowImport(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleImport} loading={importLoading} disabled={!importFile} className="flex-1">Import</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
