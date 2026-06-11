import { useState } from 'react';
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2, Zap } from 'lucide-react';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';

const INTEGRATIONS = [
  {
    key: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Powers AI chat, relationship summaries, and next-action recommendations.',
    envKey: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/keys',
    logo: '🤖',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    description: 'Used for embeddings and fallback language model capabilities.',
    envKey: 'OPENAI_API_KEY',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    logo: '🧠',
  },
  {
    key: 'clearbit',
    name: 'Clearbit Enrichment',
    description: 'Auto-enriches contact and company profiles with firmographic data.',
    envKey: 'CLEARBIT_API_KEY',
    placeholder: 'sk_...',
    docsUrl: 'https://dashboard.clearbit.com/keys',
    logo: '🔍',
  },
  {
    key: 'smtp',
    name: 'SMTP Email',
    description: 'Send email drafts and invitations directly from LeadPulse.',
    envKey: null,
    placeholder: null,
    docsUrl: null,
    logo: '📧',
    isSmtp: true,
  },
];

function ApiKeyInput({ value, onChange, placeholder, show, onToggle }) {
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
      />
      <button type="button" onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function IntegrationCard({ integration }) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | 'ok' | 'fail'

  // SMTP fields
  const [smtp, setSmtp] = useState({ host: '', port: '587', user: '', pass: '', from: '' });
  const [showSmtpPass, setShowSmtpPass] = useState(false);

  const handleSave = async () => {
    if (!integration.isSmtp && !apiKey.trim()) {
      toast.error('Enter an API key first');
      return;
    }
    setSaved(false);
    await new Promise(r => setTimeout(r, 500));
    setSaved(true);
    toast.success(`${integration.name} key saved`);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    await new Promise(r => setTimeout(r, 1200));
    // Simulate: keys starting with valid prefixes pass
    const valid = integration.isSmtp
      ? smtp.host.length > 0
      : apiKey.startsWith('sk-') || apiKey.startsWith('sk_');
    setTestResult(valid ? 'ok' : 'fail');
    setTesting(false);
    toast[valid ? 'success' : 'error'](valid ? 'Connection successful!' : 'Connection failed — check your key');
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-gray-50 rounded-xl flex items-center justify-center text-2xl border border-gray-100">
            {integration.logo}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{integration.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5 max-w-xs">{integration.description}</p>
          </div>
        </div>
        {/* Status badge */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {testResult === 'ok' && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle2 size={13} /> Connected
            </span>
          )}
          {testResult === 'fail' && (
            <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
              <XCircle size={13} /> Failed
            </span>
          )}
          {testResult === null && (
            <span className="text-xs text-gray-400">Not configured</span>
          )}
        </div>
      </div>

      {/* SMTP fields */}
      {integration.isSmtp ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">SMTP Host</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={smtp.host} onChange={e => setSmtp(p => ({ ...p, host: e.target.value }))} placeholder="smtp.gmail.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Port</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={smtp.port} onChange={e => setSmtp(p => ({ ...p, port: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={smtp.user} onChange={e => setSmtp(p => ({ ...p, user: e.target.value }))} placeholder="you@gmail.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <div className="relative">
                <input type={showSmtpPass ? 'text' : 'password'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={smtp.pass} onChange={e => setSmtp(p => ({ ...p, pass: e.target.value }))} placeholder="••••••••" />
                <button type="button" onClick={() => setShowSmtpPass(p => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showSmtpPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From address</label>
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={smtp.from} onChange={e => setSmtp(p => ({ ...p, from: e.target.value }))} placeholder="noreply@yourcompany.com" />
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-600">{integration.envKey}</label>
            {integration.docsUrl && (
              <a href={integration.docsUrl} target="_blank" rel="noreferrer"
                className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors">Get key ↗</a>
            )}
          </div>
          <ApiKeyInput
            value={apiKey} onChange={setApiKey}
            placeholder={integration.placeholder}
            show={showKey} onToggle={() => setShowKey(p => !p)}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-4">
        <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing}>
          {testing ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Zap size={13} className="mr-1.5" />}
          Test Connection
        </Button>
        <Button size="sm" onClick={handleSave}>Save</Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 size={13} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}

export default function IntegrationsSettings() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Integrations</h2>
        <p className="text-sm text-gray-400">Connect external services to unlock AI and enrichment features</p>
      </div>

      <div className="space-y-4">
        {INTEGRATIONS.map(integration => (
          <IntegrationCard key={integration.key} integration={integration} />
        ))}
      </div>
    </div>
  );
}
