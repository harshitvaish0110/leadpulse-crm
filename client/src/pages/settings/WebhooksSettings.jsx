import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronRight, Copy, KeyRound, Plus, Send, Trash2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosInstance';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Skeleton from '../../components/ui/Skeleton';
import SectionCard from './SectionCard';
import { qk } from '../../hooks/queries/keys';
import { apiError } from '../../lib/apiError';
import { timeAgo } from '../../lib/format';

const control = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';
const EVENT_LABELS = {
  'contact.created': 'A contact is created',
  'deal.stage_changed': 'A deal changes stage',
  'task.overdue': 'A task becomes overdue',
};

const VERIFY_SNIPPET = `// Node.js (Express): verify before trusting a delivery
const crypto = require('crypto');
app.post('/hooks/leadpulse', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-LeadPulse-Timestamp');
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.LEADPULSE_WEBHOOK_SECRET)
    .update(ts + '.' + req.body).digest('hex');
  const given = req.get('X-LeadPulse-Signature') || '';
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
  if (!fresh || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return res.sendStatus(401);
  }
  const { id, event, data } = JSON.parse(req.body); // id is unique per delivery: ignore repeats
  res.sendStatus(200);
});`;

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Copy failed — select the text and copy it manually');
  }
}

function SecretDialog({ secret, onClose }) {
  return (
    <Modal isOpen={Boolean(secret)} onClose={onClose} title="Signing secret" size="lg">
      {secret && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Copy it now: it won't be shown again. Your endpoint uses it to check that each delivery came from LeadPulse.</p>
          <div className="flex gap-2">
            <input readOnly value={secret} onFocus={(e) => e.target.select()} aria-label="Signing secret"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono bg-gray-50" />
            <Button variant="secondary" onClick={() => copy(secret, 'Secret')}><Copy size={14} className="mr-1.5" /> Copy</Button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-indigo-600">How to verify a delivery</summary>
            <pre className="mt-2 text-xs bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto"><code>{VERIFY_SNIPPET}</code></pre>
          </details>
          <Button onClick={onClose} className="w-full">I've saved it</Button>
        </div>
      )}
    </Modal>
  );
}

function EventPicker({ events, value, onChange, idPrefix }) {
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
      <legend className="sr-only">Events</legend>
      {events.map((e) => (
        <label key={e} htmlFor={`${idPrefix}-${e}`} className="flex items-center gap-1.5 text-sm text-gray-700">
          <input id={`${idPrefix}-${e}`} type="checkbox" checked={value.includes(e)}
            onChange={(ev) => onChange(ev.target.checked ? [...value, e] : value.filter((x) => x !== e))} />
          {EVENT_LABELS[e] ?? e} <code className="text-xs text-gray-400">{e}</code>
        </label>
      ))}
    </fieldset>
  );
}

function Deliveries({ deliveries }) {
  if (!deliveries.length) return <p className="text-xs text-gray-500">No deliveries yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500">
            {['Result', 'Event', 'Response', 'Attempt', 'Time', 'When'].map((h) => <th key={h} scope="col" className="py-1.5 pr-3 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {deliveries.map((d, i) => (
            <tr key={`${d.id}:${d.attempt}:${i}`}>
              <td className="py-1.5 pr-3">{d.ok ? <CheckCircle2 size={14} className="text-green-600" aria-label="Delivered" /> : <XCircle size={14} className="text-red-600" aria-label="Failed" />}</td>
              <td className="py-1.5 pr-3 font-mono">{d.event}</td>
              <td className="py-1.5 pr-3">{d.statusCode ? `HTTP ${d.statusCode}` : d.error}</td>
              <td className="py-1.5 pr-3 tabular-nums">{d.attempt}</td>
              <td className="py-1.5 pr-3 tabular-nums">{d.durationMs} ms</td>
              <td className="py-1.5 pr-3 text-gray-500" title={d.at}>{timeAgo(d.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WebhookRow({ webhook, events, onSecret }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.settings.webhooks });
  const fail = (fallback) => (err) => { toast.error(apiError(err, fallback)); refresh(); };
  const update = useMutation({
    mutationFn: (data) => api.patch(`/api/settings/webhooks/${webhook.id}`, data),
    onSuccess: refresh,
    onError: fail('Could not update the webhook'),
  });
  const test = useMutation({
    mutationFn: () => api.post(`/api/settings/webhooks/${webhook.id}/test`).then((r) => r.data.delivery),
    onSuccess: (d) => {
      refresh();
      setOpen(true);
      if (d.ok) toast.success(`Test delivered: HTTP ${d.statusCode} in ${d.durationMs} ms`);
      else toast.error(`Test failed: ${d.statusCode ? `HTTP ${d.statusCode}` : d.error}`);
    },
    onError: fail('Could not send the test'),
  });
  const rotate = useMutation({
    mutationFn: () => api.post(`/api/settings/webhooks/${webhook.id}/rotate-secret`).then((r) => r.data.secret),
    onSuccess: onSecret,
    onError: fail('Could not rotate the secret'),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/settings/webhooks/${webhook.id}`),
    onSuccess: () => { refresh(); toast.success('Webhook deleted'); },
    onError: fail('Could not delete the webhook'),
  });
  const last = webhook.recentDeliveries[0];

  return (
    <li className="border border-gray-100 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? 'Hide deliveries' : 'Show deliveries'}
          className="text-gray-400 hover:text-gray-700">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
        <span className="font-mono text-sm text-gray-900 break-all flex-1 min-w-[12rem]">{webhook.url}</span>
        {last && <Badge variant={last.ok ? 'green' : 'red'}>{last.ok ? 'Last delivery OK' : 'Last delivery failed'}</Badge>}
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={webhook.isActive} onChange={(e) => update.mutate({ isActive: e.target.checked })} /> Active
        </label>
      </div>
      <EventPicker events={events} value={webhook.events} idPrefix={webhook.id}
        onChange={(next) => (next.length ? update.mutate({ events: next }) : toast.error('Keep at least one event'))} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" loading={test.isPending} onClick={() => test.mutate()}><Send size={13} className="mr-1" /> Send test</Button>
        <Button variant="secondary" size="sm" loading={rotate.isPending}
          onClick={() => { if (confirm('Create a new signing secret? Deliveries signed with the old one will fail verification until your endpoint uses the new one.')) rotate.mutate(); }}>
          <KeyRound size={13} className="mr-1" /> Rotate secret
        </Button>
        <Button variant="ghost" size="sm" loading={remove.isPending} onClick={() => { if (confirm('Delete this webhook?')) remove.mutate(); }}>
          <Trash2 size={13} className="mr-1" /> Delete
        </Button>
      </div>
      {open && <Deliveries deliveries={webhook.recentDeliveries} />}
    </li>
  );
}

function AddWebhookForm({ events, onCreated }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState(events);
  const create = useMutation({
    mutationFn: () => api.post('/api/settings/webhooks', { url, events: selected }).then((r) => r.data),
    onSuccess: ({ secret }) => { qc.invalidateQueries({ queryKey: qk.settings.webhooks }); setUrl(''); onCreated(secret); },
    onError: (err) => toast.error(apiError(err, 'Could not add the webhook')),
  });
  return (
    <form className="space-y-3 mt-4 border-t border-gray-100 pt-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <div className="flex flex-wrap gap-2">
        <label htmlFor="webhook-url" className="sr-only">Endpoint URL</label>
        <input id="webhook-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/leadpulse"
          className={`${control} flex-1 min-w-[16rem] font-mono`} />
        <Button type="submit" loading={create.isPending} disabled={!selected.length}><Plus size={14} className="mr-1" /> Add webhook</Button>
      </div>
      <EventPicker events={events} value={selected} onChange={setSelected} idPrefix="new" />
    </form>
  );
}

export default function WebhooksSettings() {
  const [secret, setSecret] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: qk.settings.webhooks,
    queryFn: () => api.get('/api/settings/webhooks').then((r) => r.data),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <SectionCard title="Webhooks"
        description="LeadPulse POSTs a signed JSON event to each endpoint and retries failures for about 15 minutes. HTTPS only.">
        {isLoading || !data ? <Skeleton lines={4} /> : (
          <>
            {data.webhooks.length === 0 ? <p className="text-sm text-gray-500">No webhooks yet.</p> : (
              <ul className="space-y-3">
                {data.webhooks.map((w) => <WebhookRow key={w.id} webhook={w} events={data.events} onSecret={setSecret} />)}
              </ul>
            )}
            <AddWebhookForm events={data.events} onCreated={setSecret} />
          </>
        )}
      </SectionCard>
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}
