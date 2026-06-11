import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, Search, Building2 } from 'lucide-react';
import { getCompanies, createCompany, deleteCompany } from '../../api/companies';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import SlideOver from '../../components/ui/SlideOver';
import Badge from '../../components/ui/Badge';
import Skeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import toast from 'react-hot-toast';

const INDUSTRY_COLORS = {
  'Technology': 'indigo', 'Finance': 'green', 'Healthcare': 'blue',
  'Retail': 'amber', 'Manufacturing': 'purple', 'Education': 'teal',
};

function CompanyForm({ onSuccess, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', domain: '', industry: '', size: '', website: '' });
  const { mutate, isPending } = useMutation({
    mutationFn: createCompany,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['companies'] }); toast.success('Company created'); onSuccess?.(); },
    onError: (err) => toast.error(err.response?.data?.error || 'Failed to create company'),
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <form onSubmit={e => { e.preventDefault(); mutate(form); }} className="space-y-4">
      <Input label="Company name" required value={form.name} onChange={e => set('name', e.target.value)} />
      <Input label="Domain" placeholder="acme.com" value={form.domain} onChange={e => set('domain', e.target.value)} />
      <Input label="Industry" value={form.industry} onChange={e => set('industry', e.target.value)} />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Company size</label>
        <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.size} onChange={e => set('size', e.target.value)}>
          <option value="">Unknown</option>
          {['1-10','11-50','51-200','201-500','501-1000','1000+'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Input label="Website" placeholder="https://acme.com" value={form.website} onChange={e => set('website', e.target.value)} />
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Add Company</Button>
      </div>
    </form>
  );
}

export default function CompaniesList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchTimer, setSearchTimer] = useState(null);
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);

  const handleSearch = (v) => {
    setSearchInput(v);
    if (searchTimer) clearTimeout(searchTimer);
    setSearchTimer(setTimeout(() => { setSearch(v); setPage(1); }, 300));
  };

  const { data, isLoading } = useQuery({
    queryKey: ['companies', { search, page }],
    queryFn: () => getCompanies({ search, page, limit: 24 }).then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCompany,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['companies'] }); toast.success('Company deleted'); },
  });

  const companies = data?.companies || [];
  const meta = data?.meta || {};

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Companies</h2>
          {meta.total != null && <p className="text-sm text-gray-400">{meta.total} companies</p>}
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" /> Add Company
        </Button>
      </div>

      {/* Search */}
      <div className="relative w-64">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          placeholder="Search companies..."
          value={searchInput}
          onChange={e => handleSearch(e.target.value)}
          className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
        />
      </div>

      {/* Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <Skeleton className="h-5 w-32 mb-3" />
              <Skeleton lines={3} />
            </div>
          ))}
        </div>
      ) : companies.length === 0 ? (
        <EmptyState icon={Building2} title="No companies found" description="Add a company to get started" actionLabel="Add Company" onAction={() => setShowForm(true)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {companies.map(co => (
            <div key={co.id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-all cursor-pointer group"
              onClick={() => navigate(`/companies/${co.id}`)}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 font-bold text-sm flex-shrink-0">
                    {co.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">{co.name}</p>
                    {co.domain && <p className="text-xs text-gray-400">{co.domain}</p>}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); if (confirm('Delete this company?')) deleteMutation.mutate(co.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition-all">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {co.industry && (
                  <Badge variant={INDUSTRY_COLORS[co.industry] || 'gray'}>{co.industry}</Badge>
                )}
                {co.size && <Badge variant="gray">{co.size} employees</Badge>}
              </div>
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-50 text-xs text-gray-400">
                <span>{co._count?.contacts ?? 0} contacts</span>
                <span>{co._count?.deals ?? 0} deals</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-gray-500">Page {meta.page} of {meta.totalPages}</span>
          <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      <SlideOver isOpen={showForm} onClose={() => setShowForm(false)} title="Add Company">
        <CompanyForm onSuccess={() => setShowForm(false)} onClose={() => setShowForm(false)} />
      </SlideOver>
    </div>
  );
}
