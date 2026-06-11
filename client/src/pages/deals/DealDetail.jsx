import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, DollarSign, User, Calendar, TrendingUp,
  PhoneCall, Mail, FileText, MessageSquare, Plus, Trash2
} from 'lucide-react';
import {
  RadialBarChart, RadialBar, ResponsiveContainer
} from 'recharts';
import { getDeal, updateDeal, updateDealStage } from '../../api/deals';
import { getActivities, createActivity } from '../../api/activities';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Avatar from '../../components/ui/Avatar';
import Skeleton from '../../components/ui/Skeleton';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import EmptyState from '../../components/ui/EmptyState';
import toast from 'react-hot-toast';

const STAGES = ['LEAD','CONTACTED','DEMO','PROPOSAL','NEGOTIATION','CLOSED_WON','CLOSED_LOST'];
const STAGE_VARIANT = {
  LEAD: 'gray', CONTACTED: 'indigo', DEMO: 'purple',
  PROPOSAL: 'amber', NEGOTIATION: 'amber',
  CLOSED_WON: 'green', CLOSED_LOST: 'red',
};
const ACTIVITY_ICONS = {
  CALL: PhoneCall, EMAIL: Mail,
  MEETING: Calendar, NOTE: FileText, TRANSCRIPT: MessageSquare,
};

function formatCurrency(n) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function WinProbGauge({ probability = 0 }) {
  const pct = Math.round(probability);
  const color = pct > 60 ? '#10b981' : pct > 30 ? '#f59e0b' : '#ef4444';
  const data = [{ name: 'win', value: pct, fill: color }];
  return (
    <div className="relative flex flex-col items-center">
      <ResponsiveContainer width={160} height={100}>
        <RadialBarChart
          cx="50%" cy="100%"
          innerRadius="70%" outerRadius="100%"
          startAngle={180} endAngle={0}
          data={data}
        >
          <RadialBar background dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute bottom-0 text-center">
        <p className="text-2xl font-bold" style={{ color }}>{pct}%</p>
        <p className="text-xs text-gray-400">Win Probability</p>
      </div>
    </div>
  );
}

function LogActivityModal({ dealId, contactId, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ type: 'CALL', subject: '', notes: '', contactId: contactId || '' });
  const { mutate, isPending } = useMutation({
    mutationFn: createActivity,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deal-activities', dealId] });
      toast.success('Activity logged');
      onClose();
    },
  });
  return (
    <form onSubmit={e => { e.preventDefault(); mutate({ ...form, dealId }); }} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
        <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
          {['CALL','EMAIL','MEETING','NOTE'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <Input label="Subject" value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          rows={4} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
      </div>
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Log</Button>
      </div>
    </form>
  );
}

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showActivity, setShowActivity] = useState(false);
  const [stageChanging, setStageChanging] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesTimer, setNotesTimer] = useState(null);

  const { data: dealData, isLoading } = useQuery({
    queryKey: ['deal', id],
    queryFn: () => getDeal(id).then(r => r.data),
    onSuccess: (d) => setNotes(d.deal?.notes || ''),
  });

  const { data: activitiesData } = useQuery({
    queryKey: ['deal-activities', id],
    queryFn: () => getActivities({ dealId: id, limit: 20 }).then(r => r.data),
  });

  const stageMutation = useMutation({
    mutationFn: (stage) => updateDealStage(id, stage),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deal', id] }); toast.success('Stage updated'); },
    onError: () => toast.error('Failed to update stage'),
  });

  const updateMutation = useMutation({
    mutationFn: (data) => updateDeal(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deal', id] }),
  });

  const handleNotesChange = (val) => {
    setNotes(val);
    if (notesTimer) clearTimeout(notesTimer);
    setNotesTimer(setTimeout(() => updateMutation.mutate({ notes: val }), 1000));
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const deal = dealData?.deal;
  if (!deal) return <div className="text-center py-20 text-gray-400">Deal not found</div>;

  const winProb = deal.winProbability || 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Back */}
      <button onClick={() => navigate('/deals')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft size={16} /> Back to Pipeline
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

        {/* LEFT — Deal Info (40%) */}
        <div className="xl:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h1 className="text-xl font-bold text-gray-900 mb-1">{deal.title}</h1>
            <p className="text-3xl font-bold text-indigo-600 mb-4">{formatCurrency(deal.value)}</p>

            {/* Stage selector */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Stage</label>
              <div className="flex gap-1 flex-wrap">
                {STAGES.map(s => (
                  <button key={s}
                    onClick={() => stageMutation.mutate(s)}
                    disabled={stageMutation.isPending}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border
                      ${deal.stage === s
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
                      }`}>
                    {s.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Details */}
            <div className="space-y-3 text-sm">
              {deal.expectedCloseDate && (
                <div className="flex items-center gap-3 text-gray-600">
                  <Calendar size={15} className="text-gray-400" />
                  <span>Close: {new Date(deal.expectedCloseDate).toLocaleDateString()}</span>
                </div>
              )}
              {deal.contact && (
                <div className="flex items-center gap-3 text-gray-600 cursor-pointer hover:text-indigo-600"
                  onClick={() => navigate(`/contacts/${deal.contactId}`)}>
                  <User size={15} className="text-gray-400" />
                  <Avatar firstName={deal.contact.firstName} lastName={deal.contact.lastName} size="xs" />
                  <span>{deal.contact.firstName} {deal.contact.lastName}</span>
                </div>
              )}
              {deal.owner && (
                <div className="flex items-center gap-3 text-gray-600">
                  <User size={15} className="text-gray-400" />
                  <Avatar firstName={deal.owner.firstName} lastName={deal.owner.lastName} size="xs" />
                  <span>{deal.owner.firstName} {deal.owner.lastName}</span>
                </div>
              )}
            </div>
          </div>

          {/* Win Probability Gauge */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center">
            <p className="text-sm font-semibold text-gray-700 mb-4">Win Probability</p>
            <WinProbGauge probability={winProb} />
            <div className="w-full mt-4 h-2 bg-gray-100 rounded-full">
              <div className={`h-2 rounded-full transition-all ${winProb > 60 ? 'bg-green-500' : winProb > 30 ? 'bg-amber-500' : 'bg-red-400'}`}
                style={{ width: `${winProb}%` }} />
            </div>
          </div>

          {/* Notes — auto-save */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700">Notes</p>
              {updateMutation.isPending && <span className="text-xs text-gray-400 animate-pulse">Saving…</span>}
            </div>
            <textarea
              className="w-full text-sm text-gray-700 border-0 resize-none focus:outline-none placeholder-gray-300 h-28"
              placeholder="Add notes about this deal…"
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
            />
          </div>
        </div>

        {/* RIGHT — Activity & Timeline (60%) */}
        <div className="xl:col-span-3 space-y-4">

          {/* Activity Timeline */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-gray-700">Activity Timeline</h2>
              <Button size="sm" onClick={() => setShowActivity(true)}>
                <Plus size={14} className="mr-1.5" /> Log Activity
              </Button>
            </div>

            {(activitiesData?.activities || []).length === 0 ? (
              <EmptyState icon={PhoneCall} title="No activities" description="Log a call, email, or meeting to track progress" />
            ) : (
              <div className="relative space-y-0">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-100" />
                {(activitiesData?.activities || []).map(a => {
                  const Icon = ACTIVITY_ICONS[a.type] || PhoneCall;
                  const sentimentColor = a.sentiment === 'POSITIVE' ? 'text-green-600' : a.sentiment === 'NEGATIVE' ? 'text-red-500' : 'text-gray-400';
                  return (
                    <div key={a.id} className="flex gap-4 pb-5 relative">
                      <div className="w-8 h-8 bg-white border-2 border-gray-100 rounded-full flex items-center justify-center flex-shrink-0 z-10">
                        <Icon size={14} className="text-indigo-500" />
                      </div>
                      <div className="flex-1 pt-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-gray-800">{a.subject || a.type}</span>
                          {a.sentiment && (
                            <span className={`text-xs ${sentimentColor}`}>{a.sentiment.toLowerCase()}</span>
                          )}
                          <span className="text-xs text-gray-400 ml-auto">
                            {new Date(a.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        {a.notes && <p className="text-sm text-gray-500">{a.notes}</p>}
                        {a.contact && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {a.contact.firstName} {a.contact.lastName}
                            {a.durationMinutes ? ` · ${a.durationMinutes} min` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Log Activity Modal */}
      <Modal isOpen={showActivity} onClose={() => setShowActivity(false)} title="Log Activity">
        <LogActivityModal
          dealId={id}
          contactId={deal.contactId}
          onClose={() => setShowActivity(false)}
        />
      </Modal>
    </div>
  );
}
