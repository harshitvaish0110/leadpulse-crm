import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Send, Trash2, Pencil, Sparkles, Mail, PenSquare } from 'lucide-react';
import api from '../../api/axiosInstance';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import SlideOver from '../ui/SlideOver';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import EmailComposer from '../ai/EmailComposer';
import SmartReplyBar from '../ai/SmartReplyBar';
import { formatDate } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';

const STATUS_VARIANT = { DRAFT: 'gray', SENT: 'green', FAILED: 'red', RECEIVED: 'blue' };
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const apiError = (err, fallback) => err.response?.data?.details?.[0]?.msg || err.response?.data?.error || fallback;

/** Subject + body form, used for new drafts, edits and logging received mail. */
function EmailForm({ initial, submitLabel, withReceivedAt, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState({ subject: initial?.subject ?? '', body: initial?.body ?? '', receivedAt: '' });
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <Input label="Subject" value={form.subject} onChange={set('subject')} />
      {withReceivedAt && <Input label="Received" type="datetime-local" value={form.receivedAt} onChange={set('receivedAt')} />}
      <div>
        <label htmlFor="email-body" className="block text-sm font-medium text-gray-700 mb-1">Message</label>
        <textarea id="email-body" required rows={10} className={`${field} resize-y`} value={form.body} onChange={set('body')} />
      </div>
      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button type="submit" className="flex-1" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}

function EmailItem({ email, onEdit, onSend, onDelete, sending }) {
  const inbound = email.direction === 'INBOUND';
  return (
    <li className={`rounded-xl border p-4 ${inbound ? 'bg-blue-50/40 border-blue-100' : 'bg-white border-gray-100'}`}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {inbound ? <Inbox size={14} className="text-blue-500" /> : <Mail size={14} className="text-indigo-500" />}
        <span className="text-sm font-medium text-gray-900">{email.subject || '(no subject)'}</span>
        <Badge variant={STATUS_VARIANT[email.status]}>{email.status.toLowerCase()}</Badge>
        {email.aiGenerated && <Badge variant="purple"><Sparkles size={10} className="mr-1" /> AI</Badge>}
        <time className="text-xs text-gray-400 ml-auto">
          {formatDate(email.sentAt || email.receivedAt || email.createdAt, { hour: 'numeric', minute: '2-digit' })}
        </time>
      </div>
      <p className="text-sm text-gray-700 whitespace-pre-wrap">{email.body}</p>
      {email.status === 'DRAFT' && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={() => onSend(email)} loading={sending}><Send size={13} className="mr-1" /> Send</Button>
          <Button size="sm" variant="secondary" onClick={() => onEdit(email)}><Pencil size={13} className="mr-1" /> Edit</Button>
          <Button size="sm" variant="secondary" onClick={() => onDelete(email)} aria-label="Delete draft"><Trash2 size={13} /></Button>
        </div>
      )}
      {email.status === 'FAILED' && <p className="text-xs text-red-600 mt-2">Sending failed. Check the email settings, then create the draft again.</p>}
    </li>
  );
}

export default function ContactEmails({ contactId, contactName }) {
  const qc = useQueryClient();
  const key = qk.emails.thread(contactId);
  const [dialog, setDialog] = useState(null); // 'new' | 'received' | { edit: email } | { reply: { subject, body, tone } }
  const [composing, setComposing] = useState(false);

  const { data: emails = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get('/api/emails', { params: { contactId } }).then((r) => r.data.emails),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (body) => api.post('/api/emails', { contactId, ...body }),
    onSuccess: (_res, body) => { refresh(); setDialog(null); setComposing(false); toast.success(body.direction === 'INBOUND' ? 'Received email logged' : 'Draft saved'); },
    onError: (err) => toast.error(apiError(err, 'Could not save the email')),
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/api/emails/${id}`, body),
    onSuccess: () => { refresh(); setDialog(null); toast.success('Draft updated'); },
    onError: (err) => toast.error(apiError(err, 'Could not update the draft')),
  });
  const send = useMutation({
    mutationFn: (email) => api.post(`/api/emails/${email.id}/send`).then((r) => r.data),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['activities'] }); toast.success(`Email sent to ${contactName}`); },
    onError: (err) => { refresh(); toast.error(apiError(err, 'The email could not be sent')); },
  });
  const remove = useMutation({
    mutationFn: (email) => api.delete(`/api/emails/${email.id}`),
    onSuccess: refresh,
    onError: () => toast.error('Could not delete the draft'),
  });

  const latestInbound = [...emails].reverse().find((e) => e.direction === 'INBOUND');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Email thread</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDialog('received')}><Inbox size={13} className="mr-1" /> Log received email</Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog('new')}><PenSquare size={13} className="mr-1" /> New draft</Button>
          <Button size="sm" onClick={() => setComposing(true)}><Sparkles size={13} className="mr-1" /> Compose with AI</Button>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-32 w-full" /> : emails.length === 0 ? (
        <EmptyState icon={Mail} title="No emails yet" description="Write a draft, compose one with AI, or log an email you received." />
      ) : (
        <ul className="space-y-3">
          {emails.map((email) => (
            <EmailItem key={email.id} email={email}
              sending={send.isPending && send.variables?.id === email.id}
              onEdit={(e) => setDialog({ edit: e })}
              onSend={(e) => send.mutate(e)}
              onDelete={(e) => { if (confirm('Delete this draft?')) remove.mutate(e); }} />
          ))}
        </ul>
      )}

      {latestInbound && (
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <SmartReplyBar
            key={latestInbound.id}
            email={latestInbound}
            contactId={contactId}
            onUseReply={(body, tone) => setDialog({
              reply: { subject: latestInbound.subject ? `Re: ${latestInbound.subject.replace(/^re:\s*/i, '')}` : '', body, tone },
            })}
          />
        </div>
      )}

      <Modal isOpen={Boolean(dialog)} onClose={() => setDialog(null)} size="lg"
        title={dialog === 'received' ? 'Log received email' : dialog?.edit ? 'Edit draft' : dialog?.reply ? 'Reply' : 'New draft'}>
        {dialog && (
          <EmailForm
            key={dialog.edit?.id ?? (dialog.reply ? 'reply' : dialog)}
            initial={dialog.edit ?? dialog.reply}
            withReceivedAt={dialog === 'received'}
            submitLabel={dialog === 'received' ? 'Log email' : 'Save draft'}
            busy={create.isPending || update.isPending}
            onCancel={() => setDialog(null)}
            onSubmit={({ subject, body, receivedAt }) => {
              if (dialog.edit) update.mutate({ id: dialog.edit.id, subject, body });
              else if (dialog === 'received') create.mutate({ direction: 'INBOUND', subject, body, receivedAt: receivedAt ? new Date(receivedAt).toISOString() : undefined });
              else if (dialog.reply) create.mutate({ subject, body, aiGenerated: true, tone: dialog.reply.tone });
              else create.mutate({ subject, body });
            }}
          />
        )}
      </Modal>

      <SlideOver isOpen={composing} onClose={() => setComposing(false)} title="Compose with AI" width="sm:max-w-lg">
        {composing && <EmailComposer contactId={contactId} onSaved={() => setComposing(false)} />}
      </SlideOver>
    </div>
  );
}
