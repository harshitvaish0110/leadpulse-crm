import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Zap, Mail, Phone, CheckSquare, Users, RefreshCw, ArrowRight } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import api from '../../api/axiosInstance';
import { humanize, timeAgo } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';

const TYPE_ICONS = { EMAIL: Mail, CALL: Phone, TASK: CheckSquare, MEETING: Users };
const URGENCY_VARIANT = { HIGH: 'red', MEDIUM: 'amber', LOW: 'green' };
const URGENCY_GRADIENT = {
  HIGH:   'from-red-50 to-orange-50 border-red-200',
  MEDIUM: 'from-amber-50 to-yellow-50 border-amber-200',
  LOW:    'from-green-50 to-emerald-50 border-green-200',
};

/**
 * The stored AI recommendation for a contact (generated on demand or nightly),
 * with "Do It", which opens the matching composer, activity or task form.
 */
export default function NextActionCard({ contactId, dealId, initial, generatedAt, onDoIt }) {
  const qc = useQueryClient();
  const [rec, setRec] = useState(initial ? { recommendation: initial, generatedAt } : null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const { data } = await api.post(`/api/ai/next-action/${contactId}`, dealId ? { dealId } : {});
      setRec({ recommendation: data.recommendation, generatedAt: data.generatedAt });
      qc.invalidateQueries({ queryKey: qk.contacts.detail(contactId) });
      qc.invalidateQueries({ queryKey: qk.analytics.all });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not get a recommendation');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !rec) {
    return (
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 animate-pulse" aria-label="Getting a recommendation">
        <div className="h-3 bg-indigo-200 rounded w-1/3 mb-2" />
        <div className="h-4 bg-indigo-200 rounded w-3/4 mb-2" />
        <div className="h-3 bg-indigo-100 rounded w-2/3" />
      </div>
    );
  }

  if (!rec) {
    return (
      <div className="border-2 border-dashed border-indigo-200 rounded-2xl p-5 text-center bg-indigo-50/40">
        <Zap size={20} className="text-indigo-400 mx-auto mb-2" />
        <p className="text-sm text-gray-500 mb-3">Get an AI recommendation for the next step with this contact</p>
        <Button variant="secondary" size="sm" onClick={generate}><Zap size={13} className="mr-1.5" /> Generate recommendation</Button>
      </div>
    );
  }

  const { recommendation: action } = rec;
  const type = action.type ?? action.channel ?? 'TASK';
  const Icon = TYPE_ICONS[type] || Zap;
  const urgency = action.urgency || 'MEDIUM';

  return (
    <div className={`bg-gradient-to-r ${URGENCY_GRADIENT[urgency] || URGENCY_GRADIENT.MEDIUM} border rounded-2xl p-5`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm">
            <Icon size={16} className="text-indigo-600" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider">Next best action</p>
            <div className="flex gap-1.5 mt-0.5">
              <Badge variant={URGENCY_VARIANT[urgency] || 'gray'}>{humanize(urgency)} priority</Badge>
              <Badge variant="gray">{humanize(type)}</Badge>
            </div>
          </div>
        </div>
        <button type="button" onClick={generate} disabled={loading} aria-label="Refresh recommendation"
          className="text-gray-400 hover:text-indigo-600 transition-colors p-1 rounded-lg hover:bg-white/60">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <p className="text-sm font-semibold text-gray-900 mb-1 leading-snug">{action.action}</p>
      <p className="text-xs text-gray-500 mb-1 leading-relaxed">{action.reason}</p>
      {rec.generatedAt && <p className="text-[11px] text-gray-400 mb-4">Updated {timeAgo(rec.generatedAt)}</p>}

      {onDoIt && (
        <Button size="sm" className="w-full" onClick={() => onDoIt({ ...action, type })}>
          Do it <ArrowRight size={13} className="ml-1.5" />
        </Button>
      )}
    </div>
  );
}
