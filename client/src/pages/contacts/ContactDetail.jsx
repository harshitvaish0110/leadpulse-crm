import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { ArrowLeft, Mail, Phone, Building2, Edit2, Trash2, Plus, TrendingUp, Sparkles } from 'lucide-react';
import api from '../../api/axiosInstance';
import { getContact, updateContact, deleteContact } from '../../api/contacts';
import { getActivities } from '../../api/activities';
import { getDeals } from '../../api/deals';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Avatar from '../../components/ui/Avatar';
import Input from '../../components/ui/Input';
import Skeleton from '../../components/ui/Skeleton';
import SlideOver from '../../components/ui/SlideOver';
import EmptyState from '../../components/ui/EmptyState';
import ErrorBoundary from '../../components/ErrorBoundary';
import NextActionCard from '../../components/ai/NextActionCard';
import ActionLauncher from '../../components/ai/ActionLauncher';
import EnrichModal from '../../components/ai/EnrichModal';
import ActivityTimeline from '../../components/activities/ActivityTimeline';
import LogActivityModal from '../../components/activities/LogActivityModal';
import ContactEmails from '../../components/contacts/ContactEmails';
import ContactTasks from '../../components/contacts/ContactTasks';
import ContactInsights from '../../components/contacts/ContactInsights';
import { ScoreBadge, ChurnBar, WinProbabilityBar } from '../../components/crm/Indicators';
import { CustomFieldInputs, CustomFieldValues } from '../../components/crm/CustomFields';
import { customFieldPayload, customFieldState } from '../../lib/customFields';
import { CONTACT_STATUSES } from '../../constants/crm';
import { formatCurrency, formatDate, humanize } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import { useDirectory } from '../../hooks/queries/lookups';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { apiError } from '../../lib/apiError';
import { useUrlFlag } from '../../hooks/useUrlFlag';

const TABS = [
  ['overview', 'Overview'], ['activities', 'Activities'], ['deals', 'Deals'],
  ['emails', 'Emails'], ['tasks', 'Tasks'], ['insights', 'AI Insights'],
];
const EDITABLE_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'title', 'status', 'linkedinUrl'];
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function EditContactForm({ contact, onCancel, onSave, saving }) {
  const [form, setForm] = useState(() => ({
    ...Object.fromEntries(EDITABLE_FIELDS.map(f => [f, contact[f] ?? ''])),
    tags: (contact.tags || []).join(', '),
  }));
  const [custom, setCustom] = useState(() => customFieldState(contact.customFields));
  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSave({ ...form, customFields: customFieldPayload(custom, contact.customFields ?? {}) }); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="First name" required value={form.firstName} onChange={set('firstName')} />
        <Input label="Last name" required value={form.lastName} onChange={set('lastName')} />
      </div>
      <Input label="Email" type="email" required value={form.email} onChange={set('email')} />
      <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
      <Input label="Title" value={form.title} onChange={set('title')} />
      <Input label="LinkedIn URL" type="url" value={form.linkedinUrl} onChange={set('linkedinUrl')} />
      <div>
        <label htmlFor="contact-status" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
        <select id="contact-status" value={form.status} onChange={set('status')} className={field}>
          {CONTACT_STATUSES.map(st => <option key={st} value={st}>{humanize(st)}</option>)}
        </select>
      </div>
      <Input label="Tags" value={form.tags} onChange={set('tags')} placeholder="Comma separated" />
      <CustomFieldInputs entity="CONTACT" values={custom} onChange={(key, value) => setCustom(p => ({ ...p, [key]: value }))} />
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" loading={saving} className="flex-1">Save Changes</Button>
      </div>
    </form>
  );
}

function SentimentSparkline({ contactId }) {
  const { data = [] } = useQuery({
    queryKey: [...qk.contacts.detail(contactId), 'snapshots', 'sentimentScore', 730],
    queryFn: () => api.get(`/api/contacts/${contactId}/snapshots`, { params: { metric: 'sentimentScore', days: 730 } }).then(r => r.data.points.slice(-30)),
  });
  if (data.length < 2) return null;
  return (
    <div className="h-10 w-28" aria-label="Sentiment trend" role="img">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}><Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} /></LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProfilePanel({ contact, onEdit, onDelete, onEnrich }) {
  const qc = useQueryClient();
  const isPrivileged = useAuthStore((s) => ['ADMIN', 'MANAGER'].includes(s.user?.role));
  const { data: directory = [] } = useDirectory();
  const reassign = useMutation({
    mutationFn: (ownerId) => updateContact(contact.id, { ownerId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.contacts.all }); toast.success('Owner updated'); },
    onError: (err) => toast.error(apiError(err, 'Could not change the owner')),
  });
  const explain = useMutation({
    mutationFn: () => api.post(`/api/ai/lead-score/${contact.id}/explain`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.contacts.detail(contact.id) }),
    onError: (err) => toast.error(apiError(err, 'Could not explain the score')),
  });

  return (
    <aside className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
      <div className="flex items-start gap-4">
        <Avatar firstName={contact.firstName} lastName={contact.lastName} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">{contact.firstName} {contact.lastName}</h1>
          <p className="text-sm text-gray-500">
            {contact.title}
            {contact.company && <> {contact.title ? 'at ' : ''}<Link to={`/companies/${contact.company.id}`} className="text-indigo-600 hover:text-indigo-700">{contact.company.name}</Link></>}
          </p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Badge variant="gray">{humanize(contact.status)}</Badge>
            <ScoreBadge label={contact.leadScoreLabel} score={contact.leadScore} explanation={contact.leadScoreExplanation} />
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onEnrich}><Sparkles size={13} className="mr-1" /> Enrich</Button>
      </div>

      <div className="space-y-2 text-sm">
        <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-gray-700 hover:text-indigo-600"><Mail size={14} className="text-gray-400" /> {contact.email}</a>
        {contact.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-gray-700 hover:text-indigo-600"><Phone size={14} className="text-gray-400" /> {contact.phone}</a>}
        {contact.company && <p className="flex items-center gap-2 text-gray-700"><Building2 size={14} className="text-gray-400" /> {contact.company.industry || 'Company'}</p>}
      </div>

      <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 space-y-1.5">
        <p>{contact.leadScoreExplanation || `${contact.leadScore}/120 points`}</p>
        <button type="button" onClick={() => explain.mutate()} disabled={explain.isPending}
          className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-60">
          <Sparkles size={11} /> {explain.isPending ? 'Explaining…' : 'Explain with AI'}
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs text-gray-400 mb-1">Churn risk</p>
          <ChurnBar value={contact.churnRisk ?? 0} />
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-gray-400">Sentiment</p>
            <p className="text-sm font-medium text-gray-800">{(contact.sentimentScore ?? 0.5).toFixed(2)} / 1.00</p>
          </div>
          <SentimentSparkline contactId={contact.id} />
        </div>
      </div>

      <div>
        <label htmlFor="contact-owner-select" className="block text-xs text-gray-400 mb-1">Owner</label>
        {isPrivileged ? (
          <select id="contact-owner-select" className={field} value={contact.ownerId ?? ''} disabled={reassign.isPending}
            onChange={e => e.target.value && reassign.mutate(e.target.value)}>
            {!contact.ownerId && <option value="">Unassigned</option>}
            {directory.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        ) : (
          <p className="text-sm text-gray-800">{contact.owner ? `${contact.owner.firstName} ${contact.owner.lastName}` : 'Unassigned'}</p>
        )}
      </div>

      {contact.tags?.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">{contact.tags.map(t => <Badge key={t} variant="indigo">{t}</Badge>)}</div>
      )}

      <CustomFieldValues entity="CONTACT" values={contact.customFields} />

      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <Button variant="secondary" size="sm" onClick={onEdit} className="flex-1"><Edit2 size={14} className="mr-1.5" /> Edit</Button>
        <Button variant="danger" size="sm" onClick={onDelete} aria-label="Delete contact"><Trash2 size={14} /></Button>
      </div>
      <p className="text-xs text-gray-400">Added {formatDate(contact.createdAt)}</p>
    </aside>
  );
}

function DealCards({ deals }) {
  if (!deals.length) return <EmptyState icon={TrendingUp} title="No deals" description="Deals for this contact will show here." />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {deals.map(d => (
        <Link key={d.id} to={`/deals/${d.id}`} className="block bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-sm font-semibold text-gray-900">{d.title}</p>
            <Badge variant="gray">{d.pipelineStage?.label || humanize(d.stage)}</Badge>
          </div>
          <p className="text-lg font-bold text-indigo-600 mb-2">{formatCurrency(d.value)}</p>
          <WinProbabilityBar value={d.winProbability} />
        </Link>
      ))}
    </div>
  );
}

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'overview';
  const setTab = (key) => setParams(key === 'overview' ? {} : { tab: key }, { replace: true });
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useUrlFlag('log');
  const [enriching, setEnriching] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const { data: contactData, isLoading } = useQuery({
    queryKey: qk.contacts.detail(id),
    queryFn: () => getContact(id).then(r => r.data),
  });
  const activityParams = { contactId: id, limit: tab === 'overview' ? 5 : 50 };
  const { data: activitiesData } = useQuery({
    queryKey: qk.activities.list(activityParams),
    queryFn: () => getActivities(activityParams).then(r => r.data),
    enabled: tab === 'overview' || tab === 'activities',
  });
  const dealParams = { view: 'list', contactId: id, limit: 100 };
  const { data: dealsData } = useQuery({
    queryKey: qk.deals.list(dealParams),
    queryFn: () => getDeals(dealParams).then(r => r.data.deals),
    enabled: tab === 'deals',
  });

  const updateMutation = useMutation({
    mutationFn: (data) => updateContact(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.contacts.all }); toast.success('Contact updated'); setEditing(false); },
    onError: (err) => toast.error(apiError(err, 'Update failed')),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteContact(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.contacts.all }); toast.success('Contact deleted'); navigate('/contacts'); },
    onError: () => toast.error('Delete failed'),
  });

  const contact = contactData?.contact;
  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-[35fr_65fr] gap-6">
        <Skeleton className="h-96 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }
  if (!contact) return <EmptyState title="Contact not found" description="It may have been deleted, or it belongs to someone else's book." actionLabel="Back to contacts" onAction={() => navigate('/contacts')} />;

  const contactRef = { id: contact.id, name: `${contact.firstName} ${contact.lastName}` };
  const activities = activitiesData?.activities || [];

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <button onClick={() => navigate('/contacts')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft size={16} /> Back to Contacts
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-[35fr_65fr] gap-6 items-start">
        <ProfilePanel contact={contact} onEdit={() => setEditing(true)} onEnrich={() => setEnriching(true)}
          onDelete={() => { if (confirm('Delete this contact? Their deals, activities and emails are deleted too.')) deleteMutation.mutate(); }} />

        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm min-w-0">
          <div role="tablist" aria-label="Contact sections" className="flex border-b border-gray-100 px-4 pt-3 overflow-x-auto">
            {TABS.map(([key, label]) => (
              <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`pb-3 px-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  tab === key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="p-6" role="tabpanel">
            <ErrorBoundary key={tab} compact>
              {tab === 'overview' && (
                <div className="space-y-6">
                  <NextActionCard key={contact.nextBestActionAt ?? 'none'} contactId={id}
                    initial={contact.nextBestAction} generatedAt={contact.nextBestActionAt} onDoIt={setPendingAction} />
                  {contact.deals?.length > 0 && (
                    <div>
                      <h2 className="text-sm font-semibold text-gray-700 mb-3">Open deals</h2>
                      <DealCards deals={contact.deals} />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-sm font-semibold text-gray-700">Recent activity</h2>
                      <button onClick={() => setTab('activities')} className="text-xs text-indigo-600 hover:text-indigo-700">See all</button>
                    </div>
                    {activities.length ? <ActivityTimeline activities={activities} /> : <p className="text-sm text-gray-400">No activity yet.</p>}
                  </div>
                </div>
              )}

              {tab === 'activities' && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-700">Activity timeline</h2>
                    <Button size="sm" onClick={() => setLogging(true)}><Plus size={14} className="mr-1.5" /> Log Activity</Button>
                  </div>
                  {activities.length ? <ActivityTimeline activities={activities} />
                    : <EmptyState title="No activities yet" description="Log a call, email, meeting or note." />}
                </>
              )}

              {tab === 'deals' && <DealCards deals={dealsData || []} />}
              {tab === 'emails' && <ContactEmails contactId={id} contactName={contactRef.name} />}
              {tab === 'tasks' && <ContactTasks contactId={id} />}
              {tab === 'insights' && <ContactInsights contactId={id} days={365} />}
            </ErrorBoundary>
          </div>
        </section>
      </div>

      <LogActivityModal isOpen={logging} onClose={() => setLogging(false)} contact={contactRef} />
      <ActionLauncher request={pendingAction} onClose={() => setPendingAction(null)} contact={contactRef} onEmailSaved={() => setTab('emails')} />
      <EnrichModal isOpen={enriching} onClose={() => setEnriching(false)} contact={contact}
        onApplied={() => { qc.invalidateQueries({ queryKey: qk.contacts.all }); qc.invalidateQueries({ queryKey: qk.activities.all }); }} />

      <SlideOver isOpen={editing} onClose={() => setEditing(false)} title="Edit Contact">
        <EditContactForm key={`${contact.id}-${contact.updatedAt}`} contact={contact}
          saving={updateMutation.isPending} onCancel={() => setEditing(false)} onSave={(data) => updateMutation.mutate(data)} />
      </SlideOver>
    </div>
  );
}
