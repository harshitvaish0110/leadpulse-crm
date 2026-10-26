import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Calendar, Plus, Edit2, Trash2, History } from 'lucide-react';
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';
import { getDeal, updateDeal, moveDeal, deleteDeal, getDealHistory } from '../../api/deals';
import { getActivities } from '../../api/activities';
import Button from '../../components/ui/Button';
import Avatar from '../../components/ui/Avatar';
import Skeleton from '../../components/ui/Skeleton';
import Input from '../../components/ui/Input';
import SlideOver from '../../components/ui/SlideOver';
import EmptyState from '../../components/ui/EmptyState';
import ErrorBoundary from '../../components/ErrorBoundary';
import StreamingMarkdownCard from '../../components/ai/StreamingMarkdownCard';
import ActionLauncher from '../../components/ai/ActionLauncher';
import NextActionCard from '../../components/ai/NextActionCard';
import ActivityTimeline from '../../components/activities/ActivityTimeline';
import LogActivityModal from '../../components/activities/LogActivityModal';
import Attachments from '../../components/deals/Attachments';
import LostReasonDialog from '../../components/deals/LostReasonDialog';
import ContactTasks from '../../components/contacts/ContactTasks';
import { formatCurrency, formatDate, humanize, toPercent } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import { useDirectory, usePipelineStages } from '../../hooks/queries/lookups';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

const CLOSED = new Set(['CLOSED_WON', 'CLOSED_LOST']);
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const apiError = (err, fallback) => err.response?.data?.details?.[0]?.msg || err.response?.data?.error || fallback;

/** @param {{ probability: number }} props 0–1 */
function WinProbGauge({ probability = 0 }) {
  const pct = toPercent(probability);
  const color = pct > 60 ? '#10b981' : pct >= 30 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative flex flex-col items-center" role="img" aria-label={`Win probability ${pct}%`}>
      <ResponsiveContainer width={160} height={100}>
        <RadialBarChart cx="50%" cy="100%" innerRadius="70%" outerRadius="100%" startAngle={180} endAngle={0} data={[{ value: pct, fill: color }]}>
          <RadialBar background dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute bottom-0 text-center">
        <p className="text-2xl font-bold" style={{ color }}>{pct}%</p>
        <p className="text-xs text-gray-400">Win probability</p>
      </div>
    </div>
  );
}

/**
 * Notes are seeded from the loaded deal. The parent remounts this per deal
 * (`key={deal.id}`), so the editor never starts empty and overwrites notes.
 */
function DealNotes({ dealId, initialNotes }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(initialNotes ?? '');
  const timer = useRef(null);
  const latest = useRef(notes);

  const save = useMutation({
    mutationFn: (value) => updateDeal(dealId, { notes: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.deals.all }),
    onError: () => toast.error('Could not save notes'),
  });

  // Flush a pending save when navigating away.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      updateDeal(dealId, { notes: latest.current }).catch(() => {});
    }
  }, [dealId]);

  const onChange = (value) => {
    setNotes(value);
    latest.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; save.mutate(value); }, 800);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-3">
        <label htmlFor="deal-notes" className="text-sm font-semibold text-gray-700">Notes</label>
        {save.isPending && <span className="text-xs text-gray-400 animate-pulse">Saving…</span>}
      </div>
      <textarea id="deal-notes" className="w-full text-sm text-gray-700 border-0 resize-none focus:outline-none placeholder-gray-300 h-28"
        placeholder="Add notes about this deal…" value={notes} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function StageHistory({ dealId }) {
  const { data: history = [] } = useQuery({
    queryKey: [...qk.deals.detail(dealId), 'history'],
    queryFn: () => getDealHistory(dealId).then(r => r.data.history),
  });
  if (!history.length) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1"><History size={12} /> Stage history</p>
      <ol className="space-y-1.5 max-h-40 overflow-y-auto">
        {history.map(h => (
          <li key={h.id} className="text-xs text-gray-600 flex items-baseline gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0 translate-y-[-1px]" aria-hidden="true" />
            <span>
              {h.fromStage ? <>{h.fromLabel || humanize(h.fromStage)} → </> : 'Created in '}
              <strong className="font-medium text-gray-800">{h.toLabel || humanize(h.toStage)}</strong>
              {h.changedBy && <> · {h.changedBy.firstName}</>} · {formatDate(h.changedAt)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EditDealForm({ deal, onCancel, onSave, saving }) {
  const [form, setForm] = useState({
    title: deal.title, value: String(Number(deal.value)),
    expectedCloseDate: deal.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : '',
  });
  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={e => { e.preventDefault(); onSave({ ...form, expectedCloseDate: form.expectedCloseDate || null }); }} className="space-y-4">
      <Input label="Title" required value={form.title} onChange={set('title')} />
      <Input label="Value ($)" type="number" min="0" required value={form.value} onChange={set('value')} />
      <Input label="Expected close date" type="date" value={form.expectedCloseDate} onChange={set('expectedCloseDate')} />
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" loading={saving} className="flex-1">Save Changes</Button>
      </div>
    </form>
  );
}

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isPrivileged = useAuthStore((s) => ['ADMIN', 'MANAGER'].includes(s.user?.role));
  const { data: stages = [] } = usePipelineStages();
  const { data: directory = [] } = useDirectory();
  const [logging, setLogging] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [editing, setEditing] = useState(false);
  const [pendingLost, setPendingLost] = useState(null);

  const { data: dealData, isLoading } = useQuery({
    queryKey: qk.deals.detail(id),
    queryFn: () => getDeal(id).then(r => r.data),
  });
  const activityParams = { dealId: id, limit: 30 };
  const { data: activitiesData } = useQuery({
    queryKey: qk.activities.list(activityParams),
    queryFn: () => getActivities(activityParams).then(r => r.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.deals.all });
    qc.invalidateQueries({ queryKey: qk.analytics.all });
  };
  const move = useMutation({
    mutationFn: (body) => moveDeal(id, body),
    onSuccess: () => { refresh(); toast.success('Stage updated'); },
    onError: (err) => toast.error(apiError(err, 'Failed to update stage')),
  });
  const update = useMutation({
    mutationFn: (data) => updateDeal(id, data),
    onSuccess: () => { refresh(); setEditing(false); toast.success('Deal updated'); },
    onError: (err) => toast.error(apiError(err, 'Update failed')),
  });
  const remove = useMutation({
    mutationFn: () => deleteDeal(id),
    onSuccess: () => { refresh(); toast.success('Deal deleted'); navigate('/deals'); },
    onError: () => toast.error('Delete failed'),
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-[40fr_60fr] gap-6">
        <Skeleton className="h-96 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const deal = dealData?.deal;
  if (!deal) return <EmptyState title="Deal not found" description="It may have been deleted, or it belongs to someone else's book." actionLabel="Back to pipeline" onAction={() => navigate('/deals')} />;

  const onStageChange = (pipelineStageId) => {
    const target = stages.find(s => s.id === pipelineStageId);
    if (!target || target.id === deal.pipelineStageId) return;
    if (target.baseStage === 'CLOSED_LOST') setPendingLost({ pipelineStageId });
    else move.mutate({ pipelineStageId });
  };
  const contactRef = deal.contact ? { id: deal.contact.id, name: `${deal.contact.firstName} ${deal.contact.lastName}` } : null;
  const activities = activitiesData?.activities || [];

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <button onClick={() => navigate('/deals')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft size={16} /> Back to Pipeline
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-[40fr_60fr] gap-6 items-start">
        {/* LEFT — deal facts, notes, attachments */}
        <div className="space-y-4 min-w-0">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-xl font-bold text-gray-900">{deal.title}</h1>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)} aria-label="Edit deal"><Edit2 size={14} /></Button>
                <Button size="sm" variant="danger" onClick={() => { if (confirm('Delete this deal?')) remove.mutate(); }} aria-label="Delete deal"><Trash2 size={14} /></Button>
              </div>
            </div>
            <p className="text-3xl font-bold text-indigo-600 mb-4">{formatCurrency(deal.value, { compact: false })}</p>

            <label htmlFor="deal-stage-select" className="block text-xs font-semibold text-gray-500 uppercase mb-1">Stage</label>
            <select id="deal-stage-select" className={field} value={deal.pipelineStageId ?? ''} disabled={move.isPending}
              onChange={e => onStageChange(e.target.value)}>
              {stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">{deal.daysInStage} days in this stage{deal.lostReason && deal.stage === 'CLOSED_LOST' ? ` · Lost: ${deal.lostReason}` : ''}</p>

            <StageHistory dealId={deal.id} />

            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <dt className="sr-only">Expected close</dt>
                <Calendar size={15} className="text-gray-400" />
                <dd className="text-gray-700">{deal.expectedCloseDate ? `Expected close ${formatDate(deal.expectedCloseDate, { dateOnly: true })}` : 'No expected close date'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400 mb-1"><label htmlFor="deal-owner">Owner</label></dt>
                <dd>
                  {isPrivileged ? (
                    <select id="deal-owner" className={field} value={deal.ownerId} disabled={update.isPending}
                      onChange={e => update.mutate({ ownerId: e.target.value })}>
                      {directory.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                    </select>
                  ) : deal.owner && (
                    <span className="flex items-center gap-2 text-gray-700"><Avatar firstName={deal.owner.firstName} lastName={deal.owner.lastName} size="xs" /> {deal.owner.firstName} {deal.owner.lastName}</span>
                  )}
                </dd>
              </div>
              {deal.contact && (
                <div>
                  <dt className="text-xs text-gray-400 mb-1">Contact</dt>
                  <dd>
                    <Link to={`/contacts/${deal.contactId}`} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/40">
                      <Avatar firstName={deal.contact.firstName} lastName={deal.contact.lastName} size="sm" />
                      <span>
                        <span className="block text-sm font-medium text-gray-900">{deal.contact.firstName} {deal.contact.lastName}</span>
                        <span className="block text-xs text-gray-500">{deal.contact.title}{deal.contact.company ? ` · ${deal.contact.company.name}` : ''}</span>
                      </span>
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <DealNotes key={deal.id} dealId={deal.id} initialNotes={deal.notes} />
          <ErrorBoundary compact title="Attachments could not be shown"><Attachments dealId={deal.id} /></ErrorBoundary>
        </div>

        {/* RIGHT — AI, probability, next action, timeline */}
        <div className="space-y-4 min-w-0">
          <ErrorBoundary compact title="The AI briefing could not be shown">
            <StreamingMarkdownCard
              title="AI deal briefing"
              subtitle="From this deal's stage history, activities and emails"
              endpoint={`/api/ai/deal-summary/${id}`}
              emptyHint="Background, concerns raised, the last interaction and talking points for your next call."
              actionLabel="Generate AI summary"
            />
          </ErrorBoundary>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center justify-center">
              {CLOSED.has(deal.stage)
                ? <p className="text-sm text-gray-500">This deal is {deal.stage === 'CLOSED_WON' ? 'won' : 'lost'}.</p>
                : <WinProbGauge probability={deal.winProbability ?? 0} />}
            </div>
            {deal.contact && (
              <ErrorBoundary compact>
                <NextActionCard key={deal.contact.nextBestActionAt ?? 'none'} contactId={deal.contactId} dealId={deal.id}
                  initial={deal.contact.nextBestAction} generatedAt={deal.contact.nextBestActionAt} onDoIt={setPendingAction} />
              </ErrorBoundary>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-gray-700">Activity timeline</h2>
              <Button size="sm" onClick={() => setLogging(true)} disabled={!contactRef}><Plus size={14} className="mr-1.5" /> Log Activity</Button>
            </div>
            {activities.length === 0
              ? <EmptyState title="No activities" description="Log a call, email or meeting to track progress" />
              : <ActivityTimeline activities={activities} showDeal={false} />}
          </div>

          {deal.contact && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Tasks</h2>
              <ContactTasks contactId={deal.contactId} dealId={deal.id} />
            </div>
          )}
        </div>
      </div>

      <LogActivityModal isOpen={logging} onClose={() => setLogging(false)} contact={contactRef} dealId={deal.id} />
      {contactRef && <ActionLauncher request={pendingAction} onClose={() => setPendingAction(null)} contact={contactRef} dealId={deal.id} />}
      <LostReasonDialog key={pendingLost ? 'open' : 'closed'} pending={pendingLost} onCancel={() => setPendingLost(null)}
        onConfirm={(lostReason) => { move.mutate({ ...pendingLost, lostReason }); setPendingLost(null); }} />
      <SlideOver isOpen={editing} onClose={() => setEditing(false)} title="Edit Deal">
        <EditDealForm key={`${deal.id}-${deal.updatedAt}`} deal={deal} saving={update.isPending}
          onCancel={() => setEditing(false)} onSave={(data) => update.mutate(data)} />
      </SlideOver>
    </div>
  );
}
