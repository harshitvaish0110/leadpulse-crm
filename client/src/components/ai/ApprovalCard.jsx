import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, PhoneCall, ArrowRightLeft, Mail, ChevronDown, ChevronRight, Check, X, ShieldCheck } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import api from '../../api/axiosInstance';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';

const ICONS = { CREATE_TASK: CheckSquare, LOG_ACTIVITY: PhoneCall, UPDATE_DEAL_STAGE: ArrowRightLeft, DRAFT_EMAIL: Mail };
const STATUS = {
  PENDING: ['amber', 'Waiting for your approval'], APPROVED: ['blue', 'Approved'], EXECUTED: ['green', 'Done'],
  REJECTED: ['gray', 'Rejected'], FAILED: ['red', 'Failed'],
};

/** Where the record an executed action created can be seen. */
function resultLink(action) {
  const r = action.result ?? {};
  if (r.taskId) return ['/tasks', 'View tasks'];
  if (r.dealId) return [`/deals/${r.dealId}`, 'View deal'];
  if (r.emailId && action.contactId) return [`/contacts/${action.contactId}?tab=emails`, 'View draft'];
  if (r.activityId && action.contactId) return [`/contacts/${action.contactId}?tab=activities`, 'View activity'];
  return null;
}

/**
 * An action the assistant proposed. Nothing happens until the user approves it;
 * the server then runs it through the same code as the normal screens.
 */
export default function ApprovalCard({ action: initial }) {
  const qc = useQueryClient();
  const [action, setAction] = useState(initial);
  const [open, setOpen] = useState(false);
  const Icon = ICONS[action.type] || ShieldCheck;

  const decide = useMutation({
    mutationFn: (verb) => api.post(`/api/ai/actions/${action.id}/${verb}`).then((r) => r.data.action),
    onMutate: (verb) => {
      const previous = action;
      setAction((a) => ({ ...a, status: verb === 'approve' ? 'APPROVED' : 'REJECTED' }));
      return { previous };
    },
    onSuccess: (updated) => {
      setAction(updated);
      if (updated.status === 'EXECUTED') {
        toast.success(`${updated.summary} — done`);
        ['tasks', 'activities', 'deals', 'emails', 'contacts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      } else if (updated.status === 'FAILED') toast.error(updated.error || 'The action failed');
      qc.invalidateQueries({ queryKey: qk.ai.all });
    },
    onError: (err, _verb, context) => {
      setAction(context.previous);
      toast.error(err.response?.data?.error || 'Could not update this action');
    },
  });

  const [variant, label] = STATUS[action.status] ?? ['gray', action.status];
  const link = action.status === 'EXECUTED' ? resultLink(action) : null;

  return (
    <div className="bg-white border border-indigo-100 rounded-xl p-3 shadow-sm max-w-md">
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0"><Icon size={15} className="text-indigo-600" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{action.summary}</p>
          {action.rationale && <p className="text-xs text-gray-500 mt-0.5">{action.rationale}</p>}
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            <Badge variant={action.risk === 'medium' ? 'amber' : 'green'}>{action.risk} risk</Badge>
            <Badge variant={variant}>{label}</Badge>
          </div>
        </div>
      </div>

      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Details
      </button>
      {open && <pre className="mt-1 text-[11px] text-gray-600 bg-gray-50 rounded-lg p-2 overflow-x-auto">{JSON.stringify(action.payload, null, 2)}</pre>}

      {action.status === 'PENDING' && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => decide.mutate('approve')} disabled={decide.isPending}>
            <Check size={13} className="mr-1" /> Approve
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => decide.mutate('reject')} disabled={decide.isPending}>
            <X size={13} className="mr-1" /> Reject
          </Button>
        </div>
      )}
      {action.status === 'APPROVED' && decide.isPending && <p className="text-xs text-gray-500 mt-2">Running…</p>}
      {action.status === 'FAILED' && action.error && <p className="text-xs text-red-600 mt-2">{action.error}</p>}
      {link && <Link to={link[0]} className="block w-fit text-xs font-medium text-indigo-600 hover:text-indigo-700 mt-2">{link[1]} →</Link>}
    </div>
  );
}
