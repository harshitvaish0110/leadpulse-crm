import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, Eye, EyeOff, XCircle, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosInstance';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Skeleton from '../../components/ui/Skeleton';
import SectionCard from './SectionCard';
import { qk } from '../../hooks/queries/keys';
import { apiError } from '../../lib/apiError';
import { timeAgo } from '../../lib/format';

/** Display details for each integration the server knows (ids match integrations.service.js). */
const KEY_CARDS = {
  gemini:     { name: 'Google Gemini', placeholder: 'AIza…', docsUrl: 'https://aistudio.google.com/apikey', description: 'First choice for AI features: assistant, summaries, emails and next best actions.' },
  groq:       { name: 'Groq', placeholder: 'gsk_…', docsUrl: 'https://console.groq.com/keys', description: 'Fallback for AI features, and call transcription (Whisper).' },
  openrouter: { name: 'OpenRouter', placeholder: 'sk-or-…', docsUrl: 'https://openrouter.ai/keys', description: 'Second fallback, using free community models.' },
  anthropic:  { name: 'Anthropic', placeholder: 'sk-ant-…', docsUrl: 'https://console.anthropic.com/settings/keys', description: 'Optional; joins the fallback chain when a key is set.' },
  openai:     { name: 'OpenAI', placeholder: 'sk-…', docsUrl: 'https://platform.openai.com/api-keys', description: 'Optional; joins the fallback chain when a key is set.' },
  clearbit:   { name: 'Clearbit', placeholder: 'sk_…', docsUrl: 'https://dashboard.clearbit.com/api', description: 'Optional person and company data for contact enrichment.' },
  resend:     { name: 'Resend', placeholder: 're_…', docsUrl: 'https://resend.com/api-keys', description: 'Sends invitations and emails over HTTPS (works where SMTP is blocked).' },
};
const GROUPS = [['AI providers', ['gemini', 'groq', 'openrouter', 'anthropic', 'openai']], ['Enrichment', ['clearbit']]];

function SourceBadge({ item }) {
  if (item.source === 'env') return <Badge variant="green">From .env</Badge>;
  if (item.source === 'ui') return <Badge variant="indigo">Saved here</Badge>;
  return <Badge variant="amber">Not configured</Badge>;
}

function TestResult({ result }) {
  if (!result) return null;
  const Icon = result.ok ? CheckCircle2 : XCircle;
  return (
    <span role="status" className={`flex items-center gap-1 text-xs font-medium ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
      <Icon size={13} /> {result.detail} <span className="text-gray-400 font-normal">({result.latencyMs} ms)</span>
      {result.previewUrl && <a href={result.previewUrl} target="_blank" rel="noreferrer" className="underline ml-1">open</a>}
    </span>
  );
}

function useTest(id) {
  return useMutation({
    mutationFn: (apiKey) => api.post(`/api/settings/integrations/${id}/test`, apiKey ? { apiKey } : {}).then((r) => r.data.result),
    onError: (err) => toast.error(apiError(err, 'The test could not run')),
  });
}

function KeyCard({ item, encryption }) {
  const qc = useQueryClient();
  const card = KEY_CARDS[item.id];
  const [apiKey, setApiKey] = useState('');
  const [show, setShow] = useState(false);
  const test = useTest(item.id);
  const onSaved = (data, message) => { qc.setQueryData(qk.settings.integrations, data); setApiKey(''); test.reset(); toast.success(message); };
  const save = useMutation({
    mutationFn: () => api.put(`/api/settings/integrations/${item.id}`, { apiKey }).then((r) => r.data),
    onSuccess: (data) => onSaved(data, `${card.name} key saved`),
    onError: (err) => toast.error(apiError(err, 'Could not save the key')),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/settings/integrations/${item.id}`).then((r) => r.data),
    onSuccess: (data) => onSaved(data, `${card.name} key removed`),
    onError: (err) => toast.error(apiError(err, 'Could not remove the key')),
  });
  const inputId = `key-${item.id}`;

  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{card.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{card.description}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {item.circuit === 'open' && <Badge variant="red">Paused after errors</Badge>}
          <SourceBadge item={item} />
        </div>
      </div>
      {item.last4 && (
        <p className="text-xs text-gray-500 mt-2">
          Current key <span className="font-mono">••••{item.last4}</span>
          {item.source === 'env' && item.savedAt && ' · the key in .env is used; the one saved here is ignored'}
          {item.source === 'ui' && item.savedAt && ` · saved ${timeAgo(item.savedAt)}`}
        </p>
      )}
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label htmlFor={inputId} className="sr-only">{item.envVar}</label>
        <div className="relative flex-1 min-w-[14rem]">
          <input id={inputId} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} placeholder={item.source ? `Replace key (${card.placeholder})` : card.placeholder}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-9 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide key' : 'Show key'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <Button variant="secondary" size="sm" loading={test.isPending} disabled={!apiKey && !item.source}
          onClick={() => test.mutate(apiKey.trim())}>
          <Zap size={13} className="mr-1" /> Test
        </Button>
        <Button type="submit" size="sm" loading={save.isPending} disabled={!apiKey.trim() || !encryption}>Save</Button>
        {item.savedAt && (
          <Button variant="ghost" size="sm" loading={remove.isPending}
            onClick={() => { if (confirm(`Remove the ${card.name} key saved in LeadPulse?`)) remove.mutate(); }}>Remove</Button>
        )}
      </form>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <TestResult result={test.data} />
        <a href={card.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1 ml-auto">
          Get a key <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

function ServiceCard({ id, title, description, children, testLabel }) {
  const test = useTest(id);
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" loading={test.isPending} onClick={() => test.mutate()}><Zap size={13} className="mr-1" /> {testLabel}</Button>
        <TestResult result={test.data} />
      </div>
    </div>
  );
}

function UsageTable({ usage }) {
  if (!usage.length) return <p className="text-sm text-gray-500">No AI calls in the last 24 hours.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
            {['Provider', 'Calls', 'Errors', 'Fell back', 'Median latency'].map((h) => <th key={h} scope="col" className="py-2 pr-4 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {usage.map((u) => (
            <tr key={u.provider}>
              <td className="py-2 pr-4 font-medium text-gray-900">{KEY_CARDS[u.provider]?.name ?? u.provider}</td>
              <td className="py-2 pr-4 tabular-nums">{u.calls}</td>
              <td className={`py-2 pr-4 tabular-nums ${u.errors ? 'text-red-600' : ''}`}>{u.errors}</td>
              <td className="py-2 pr-4 tabular-nums">{u.fallbacks}</td>
              <td className="py-2 pr-4 tabular-nums">{u.p50Ms == null ? '—' : `${(u.p50Ms / 1000).toFixed(1)} s`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mt-2">Each attempt counts once; "fell back" means the next provider in the chain answered instead.</p>
    </div>
  );
}

export default function IntegrationsSettings() {
  const { data, isLoading } = useQuery({
    queryKey: qk.settings.integrations,
    queryFn: () => api.get('/api/settings/integrations').then((r) => r.data),
  });

  if (isLoading || !data) return <div className="max-w-4xl"><Skeleton lines={8} /></div>;
  const byId = Object.fromEntries(data.keys.map((k) => [k.id, k]));

  return (
    <div className="space-y-6 max-w-4xl">
      {!data.encryption && (
        <p className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl p-4">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>Keys can't be saved here until the server has an <code>ENCRYPTION_KEY</code> (32 bytes, base64; e.g. <code>openssl rand -base64 32</code>). Keys in <code>.env</code> work either way.</span>
        </p>
      )}
      {data.aiMock && <p className="text-sm text-gray-600 bg-gray-50 rounded-xl p-4">AI_MOCK is on: AI features use canned answers and no provider is called.</p>}

      <SectionCard title="AI usage" description="Calls in the last 24 hours, per provider">
        <UsageTable usage={data.usage} />
      </SectionCard>

      {GROUPS.map(([title, ids]) => (
        <SectionCard key={title} title={title}
          description={title === 'AI providers' ? 'Tried in this order; a key in .env takes precedence over one saved here.' : undefined}>
          <div className="space-y-3">{ids.map((id) => <KeyCard key={id} item={byId[id]} encryption={data.encryption} />)}</div>
        </SectionCard>
      ))}

      <SectionCard title="Email and services">
        <div className="space-y-3">
          <ServiceCard id="email" title="Email delivery" testLabel="Send me a test email"
            description={`Driver: ${data.email.driver} · from ${data.email.from}. A Resend key (below) switches delivery to Resend unless EMAIL_DRIVER is set.`} />
          <KeyCard item={byId.resend} encryption={data.encryption} />
          <ServiceCard id="ml" title="ML service" testLabel="Check connection"
            description={`Sentiment, embeddings, churn and win models at ${data.mlService.url}.`} />
          <div className="border border-gray-100 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900">File storage</h3>
            <p className="text-xs text-gray-500 mt-0.5">Driver: {data.storage.driver}. Call recordings and attachments are private and served through short-lived signed links.</p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
