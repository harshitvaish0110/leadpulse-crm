import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Globe, Building2, Users, TrendingUp,
  Edit2, Trash2, ExternalLink, Activity
} from 'lucide-react';
import { getCompany, updateCompany, deleteCompany } from '../../api/companies';
import { getContacts } from '../../api/contacts';
import { getDeals } from '../../api/deals';
import { getActivities } from '../../api/activities';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Avatar from '../../components/ui/Avatar';
import Skeleton from '../../components/ui/Skeleton';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import EmptyState from '../../components/ui/EmptyState';
import toast from 'react-hot-toast';

const STAGE_VARIANT = {
  LEAD: 'gray', CONTACTED: 'indigo', DEMO: 'purple',
  PROPOSAL: 'amber', NEGOTIATION: 'amber',
  CLOSED_WON: 'green', CLOSED_LOST: 'red',
};

function formatCurrency(n) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState('contacts');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const { data: companyData, isLoading } = useQuery({
    queryKey: ['company', id],
    queryFn: () => getCompany(id).then(r => r.data),
    onSuccess: (d) => !editForm && setEditForm(d.company),
  });

  const { data: contactsData } = useQuery({
    queryKey: ['company-contacts', id],
    queryFn: () => getContacts({ companyId: id, limit: 50 }).then(r => r.data),
    enabled: tab === 'contacts',
  });

  const { data: dealsData } = useQuery({
    queryKey: ['company-deals', id],
    queryFn: () => getDeals({ companyId: id, limit: 50 }).then(r => r.data),
    enabled: tab === 'deals',
  });

  const { data: activitiesData } = useQuery({
    queryKey: ['company-activities', id],
    queryFn: () => getActivities({ companyId: id, limit: 30 }).then(r => r.data),
    enabled: tab === 'activities',
  });

  const updateMutation = useMutation({
    mutationFn: (data) => updateCompany(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', id] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Company updated');
      setEditing(false);
    },
    onError: () => toast.error('Update failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCompany(id),
    onSuccess: () => { toast.success('Company deleted'); navigate('/companies'); },
    onError: () => toast.error('Delete failed'),
  });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  const company = companyData?.company;
  if (!company) return <div className="text-center py-20 text-gray-400">Company not found</div>;

  const TABS = [
    { key: 'contacts', label: 'Contacts', icon: Users },
    { key: 'deals', label: 'Deals', icon: TrendingUp },
    { key: 'activities', label: 'Activities', icon: Activity },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Back */}
      <button onClick={() => navigate('/companies')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft size={16} /> Back to Companies
      </button>

      {/* Company Header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 font-bold text-xl">
              {company.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{company.name}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {company.domain && (
                  <span className="flex items-center gap-1 text-sm text-gray-500">
                    <Globe size={13} /> {company.domain}
                  </span>
                )}
                {company.industry && <Badge variant="indigo">{company.industry}</Badge>}
                {company.size && <Badge variant="gray">{company.size} employees</Badge>}
              </div>
              {company.description && (
                <p className="text-sm text-gray-500 mt-2 max-w-xl">{company.description}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {company.website && (
              <a href={company.website} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  <ExternalLink size={14} className="mr-1.5" /> Website
                </Button>
              </a>
            )}
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Edit2 size={14} className="mr-1.5" /> Edit
            </Button>
            <Button variant="danger" size="sm"
              onClick={() => { if (confirm('Delete this company?')) deleteMutation.mutate(); }}>
              <Trash2 size={14} className="mr-1.5" /> Delete
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mt-6 pt-5 border-t border-gray-100">
          {[
            { label: 'Contacts', value: company._count?.contacts ?? 0, icon: Users },
            { label: 'Deals', value: company._count?.deals ?? 0, icon: TrendingUp },
            { label: 'Activities', value: company._count?.activities ?? 0, icon: Activity },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="text-center">
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Contacts Tab */}
      {tab === 'contacts' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {(contactsData?.contacts || []).length === 0 ? (
            <EmptyState icon={Users} title="No contacts" description="No contacts linked to this company" />
          ) : (
            <table className="w-full">
              <thead><tr className="border-b border-gray-100">
                {['Name', 'Title', 'Email', 'Lead Score', 'Status'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3 uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {(contactsData?.contacts || []).map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/contacts/${c.id}`)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar firstName={c.firstName} lastName={c.lastName} size="sm" />
                        <span className="text-sm font-medium text-gray-900">{c.firstName} {c.lastName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-500">{c.title || '—'}</td>
                    <td className="px-5 py-3 text-sm text-gray-500">{c.email || '—'}</td>
                    <td className="px-5 py-3">
                      {c.leadScore ? <Badge variant={c.leadScore === 'HOT' ? 'red' : c.leadScore === 'WARM' ? 'amber' : 'blue'}>{c.leadScore}</Badge> : '—'}
                    </td>
                    <td className="px-5 py-3"><Badge variant="gray">{c.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Deals Tab */}
      {tab === 'deals' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(dealsData?.deals || []).length === 0 ? (
            <div className="col-span-2">
              <EmptyState icon={TrendingUp} title="No deals" description="No deals linked to this company yet" />
            </div>
          ) : (dealsData?.deals || []).map(d => (
            <div key={d.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-all cursor-pointer"
              onClick={() => navigate(`/deals/${d.id}`)}>
              <div className="flex items-start justify-between mb-3">
                <p className="font-semibold text-gray-900">{d.title}</p>
                <Badge variant={STAGE_VARIANT[d.stage] || 'gray'}>{d.stage.replace('_', ' ')}</Badge>
              </div>
              <p className="text-xl font-bold text-indigo-600 mb-2">{formatCurrency(d.value)}</p>
              <div className="w-full h-1.5 bg-gray-100 rounded-full">
                <div className={`h-1.5 rounded-full transition-all ${(d.winProbability || 0) > 60 ? 'bg-green-500' : (d.winProbability || 0) > 30 ? 'bg-amber-500' : 'bg-red-400'}`}
                  style={{ width: `${d.winProbability || 0}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-1">{d.winProbability || 0}% win probability</p>
            </div>
          ))}
        </div>
      )}

      {/* Activities Tab */}
      {tab === 'activities' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          {(activitiesData?.activities || []).length === 0 ? (
            <EmptyState icon={Activity} title="No activities" description="No activities logged for this company yet" />
          ) : (
            <div className="space-y-4">
              {(activitiesData?.activities || []).map(a => (
                <div key={a.id} className="flex gap-4 pb-4 border-b border-gray-50 last:border-0">
                  <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-500 flex-shrink-0">
                    <Activity size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium text-gray-900">{a.subject || a.type}</p>
                      <Badge variant="gray">{a.type}</Badge>
                    </div>
                    {a.contact && (
                      <p className="text-xs text-gray-500 cursor-pointer hover:text-indigo-600"
                        onClick={() => navigate(`/contacts/${a.contactId}`)}>
                        {a.contact.firstName} {a.contact.lastName}
                      </p>
                    )}
                    {a.notes && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{a.notes}</p>}
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(a.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editForm && (
        <Modal isOpen={editing} onClose={() => setEditing(false)} title="Edit Company" size="lg">
          <form onSubmit={e => { e.preventDefault(); updateMutation.mutate(editForm); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Company name" required value={editForm.name || ''} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
              <Input label="Domain" value={editForm.domain || ''} onChange={e => setEditForm(p => ({ ...p, domain: e.target.value }))} />
              <Input label="Industry" value={editForm.industry || ''} onChange={e => setEditForm(p => ({ ...p, industry: e.target.value }))} />
              <Input label="Website" value={editForm.website || ''} onChange={e => setEditForm(p => ({ ...p, website: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                rows={3} value={editForm.description || ''} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={() => setEditing(false)} className="flex-1">Cancel</Button>
              <Button type="submit" loading={updateMutation.isPending} className="flex-1">Save Changes</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
