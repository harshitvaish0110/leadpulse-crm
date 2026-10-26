import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Search, Building2, ArrowUp, ArrowDown } from 'lucide-react';
import { getCompanies, createCompany, deleteCompany } from '../../api/companies';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import SlideOver from '../../components/ui/SlideOver';
import Badge from '../../components/ui/Badge';
import Skeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { formatDate } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import { useIndustries } from '../../hooks/queries/lookups';
import { useUrlFilters } from '../../hooks/useUrlFilters';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { apiError } from '../../lib/apiError';

const FILTER_DEFAULTS = { q: '', industry: '', sort: 'name:asc', page: '1' };
const control = 'text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';

function CompanyForm({ onDone }) {
  const qc = useQueryClient();
  const { data: industries = [] } = useIndustries();
  const [form, setForm] = useState({ name: '', domain: '', industry: '', size: '', website: '', country: '' });
  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const { mutate, isPending } = useMutation({
    mutationFn: createCompany,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.companies.all }); toast.success('Company created'); onDone(); },
    onError: (err) => toast.error(apiError(err, 'Failed to create company')),
  });
  return (
    <form onSubmit={e => { e.preventDefault(); mutate({ ...form, size: form.size || undefined }); }} className="space-y-4">
      <Input label="Company name" required value={form.name} onChange={set('name')} />
      <Input label="Domain" required placeholder="acme.com" value={form.domain} onChange={set('domain')} />
      <Input label="Industry" list="industry-options" value={form.industry} onChange={set('industry')} />
      <datalist id="industry-options">{industries.map(i => <option key={i} value={i} />)}</datalist>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Employees" type="number" min="1" value={form.size} onChange={set('size')} />
        <Input label="Country" value={form.country} onChange={set('country')} />
      </div>
      <Input label="Website" type="url" placeholder="https://acme.com" value={form.website} onChange={set('website')} />
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onDone} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Add Company</Button>
      </div>
    </form>
  );
}

function SortHeader({ label, field, sort, onSort }) {
  const [current, dir] = sort.split(':');
  const active = current === field;
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left px-4 py-3">
      <button onClick={() => onSort(`${field}:${active && dir === 'asc' ? 'desc' : 'asc'}`)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-800">
        {label}{active && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );
}

export default function CompaniesList() {
  const qc = useQueryClient();
  const canDelete = useAuthStore((s) => ['ADMIN', 'MANAGER'].includes(s.user?.role));
  const { data: industries = [] } = useIndustries();
  const [filters, setFilters] = useUrlFilters(FILTER_DEFAULTS);
  const [searchInput, setSearchInput] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) { setSyncedQ(filters.q); setSearchInput(filters.q); }
  useEffect(() => {
    if (searchInput === filters.q) return undefined;
    const t = setTimeout(() => setFilters({ q: searchInput }), 300);
    return () => clearTimeout(t);
  }, [searchInput, filters.q, setFilters]);
  const [showForm, setShowForm] = useState(false);

  const [sortBy, sortDir] = filters.sort.split(':');
  const page = Math.max(1, Number(filters.page) || 1);
  const params = { search: filters.q || undefined, industry: filters.industry || undefined, sortBy, sortDir, page, limit: 25 };
  const { data, isLoading } = useQuery({
    queryKey: qk.companies.list(params),
    queryFn: () => getCompanies(params).then(r => r.data),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: deleteCompany,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.companies.all }); toast.success('Company deleted'); },
    onError: (err) => toast.error(apiError(err, 'Delete failed')),
  });

  const companies = data?.companies || [];
  const meta = data?.meta || {};
  const onSort = (sort) => setFilters({ sort });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Companies</h2>
          {meta.total != null && <p className="text-sm text-gray-400">{meta.total.toLocaleString()} companies</p>}
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}><Plus size={14} className="mr-1.5" /> Add Company</Button>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input placeholder="Search name or domain…" aria-label="Search companies" value={searchInput} onChange={e => setSearchInput(e.target.value)}
            className={`${control} pl-9 w-64`} />
        </div>
        <select aria-label="Industry" className={control} value={filters.industry} onChange={e => setFilters({ industry: e.target.value })}>
          <option value="">All industries</option>
          {industries.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        {(filters.q || filters.industry) && (
          <button onClick={() => setFilters({ q: '', industry: '' })} className="text-sm text-indigo-600 hover:text-indigo-700">Clear filters</button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-100">
                <SortHeader label="Company" field="name" sort={filters.sort} onSort={onSort} />
                <th scope="col" className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wider">Domain</th>
                <th scope="col" className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wider">Industry</th>
                <SortHeader label="Employees" field="size" sort={filters.sort} onSort={onSort} />
                <th scope="col" className="text-left text-xs font-semibold text-gray-500 px-4 py-3 uppercase tracking-wider">Contacts</th>
                <SortHeader label="Created" field="createdAt" sort={filters.sort} onSort={onSort} />
                {canDelete && <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td></tr>
              )) : companies.length === 0 ? (
                <tr><td colSpan={7}><EmptyState icon={Building2} title="No companies found" description={filters.q || filters.industry ? 'Try other filters' : 'Add your first company'} /></td></tr>
              ) : companies.map(c => (
                <tr key={c.id} className="even:bg-gray-50/50 hover:bg-indigo-50/50">
                  <td className="px-4 py-3">
                    <Link to={`/companies/${c.id}`} className="flex items-center gap-3">
                      <span className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 font-bold text-sm" aria-hidden="true">{c.name?.[0]?.toUpperCase()}</span>
                      <span className="text-sm font-medium text-gray-900 hover:text-indigo-600">{c.name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.domain}</td>
                  <td className="px-4 py-3">{c.industry ? <Badge variant="indigo">{c.industry}</Badge> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.size ? c.size.toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c._count?.contacts ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(c.createdAt)}</td>
                  {canDelete && (
                    <td className="px-4 py-3">
                      <button onClick={() => { if (confirm(`Delete ${c.name}?`)) remove.mutate(c.id); }} aria-label={`Delete ${c.name}`}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <p className="text-sm text-gray-500">Page {meta.page} of {meta.totalPages}</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setFilters({ page: String(page - 1) })}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setFilters({ page: String(page + 1) })}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <SlideOver isOpen={showForm} onClose={() => setShowForm(false)} title="Add Company">
        <CompanyForm onDone={() => setShowForm(false)} />
      </SlideOver>
    </div>
  );
}
