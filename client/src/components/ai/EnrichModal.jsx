import { useState } from 'react';
import { Sparkles, AlertTriangle } from 'lucide-react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import api from '../../api/axiosInstance';
import { formatPercent } from '../../lib/format';
import toast from 'react-hot-toast';

const FIELDS = [
  ['title', 'Title'], ['company', 'Company'], ['companySize', 'Employees'], ['industry', 'Industry'],
  ['location', 'Country'], ['estimatedBudgetTier', 'Budget tier'], ['companySummary', 'Company summary'],
];
const LINKEDIN = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?$/;
const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\/?$/i;
const apiError = (err, fallback) => err.response?.data?.details?.[0]?.msg || err.response?.data?.error || fallback;

const show = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const differs = (proposed, current) => proposed !== null && proposed !== undefined && String(proposed) !== String(current ?? '');

function EnrichForm({ contact, onClose, onApplied }) {
  const [mode, setMode] = useState(contact.linkedinUrl && !contact.company ? 'linkedin' : 'domain');
  const [domain, setDomain] = useState(contact.company?.domain ?? contact.email.split('@')[1] ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(contact.linkedinUrl ?? '');
  const [phase, setPhase] = useState('input'); // input | loading | preview | applying
  const [proposal, setProposal] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [problem, setProblem] = useState(null);

  const value = mode === 'domain' ? domain.trim() : linkedinUrl.trim();
  const preview = async (e) => {
    e.preventDefault();
    if (mode === 'domain' ? !DOMAIN.test(value) : !LINKEDIN.test(value)) {
      setProblem(mode === 'domain' ? 'Enter a domain like acme.com' : 'Use a profile URL like https://www.linkedin.com/in/jane-doe');
      return;
    }
    setProblem(null);
    setPhase('loading');
    try {
      const { data } = await api.post('/api/ai/enrich-contact', { contactId: contact.id, ...(mode === 'domain' ? { domain: value } : { linkedinUrl: value }) });
      setProposal(data);
      setSelected(new Set(FIELDS.map(([key]) => key).filter((key) => differs(data.proposed[key], data.current[key]))));
      setPhase('preview');
    } catch (err) {
      setPhase('input');
      setProblem(apiError(err, 'Could not enrich this contact'));
    }
  };

  const apply = async () => {
    setPhase('applying');
    try {
      const fields = Object.fromEntries([...selected].map((key) => [key, proposal.proposed[key]]));
      await api.post(`/api/ai/enrich-contact/${contact.id}/apply`, { fields, domain: proposal.domain ?? undefined });
      toast.success(`Updated ${selected.size} field${selected.size === 1 ? '' : 's'}`);
      onApplied?.();
      onClose();
    } catch (err) {
      setPhase('preview');
      toast.error(apiError(err, 'Could not save the changes'));
    }
  };

  const toggle = (key) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  if (phase === 'preview' || phase === 'applying') {
    const rows = FIELDS.filter(([key]) => differs(proposal.proposed[key], proposal.current[key]));
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="purple">Source: {proposal.source === 'clearbit' ? 'Clearbit + AI' : 'AI'}</Badge>
          <Badge variant={proposal.confidence < 0.5 ? 'amber' : 'green'}>Confidence {formatPercent(proposal.confidence)}</Badge>
          {proposal.domain && !proposal.publicMeta && <Badge variant="gray">Website not readable</Badge>}
        </div>
        {proposal.confidence < 0.5 && (
          <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> Low confidence. Check each value before saving it.
          </p>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">Nothing new to add: the proposal matches what the CRM already has.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th scope="col" className="py-2 font-medium">Field</th>
                <th scope="col" className="py-2 font-medium">Current</th>
                <th scope="col" className="py-2 font-medium">Proposed</th>
                <th scope="col" className="py-2 font-medium text-right">Apply</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, label]) => (
                <tr key={key} className="border-b border-gray-50 align-top">
                  <td className="py-2 pr-2 text-gray-500 whitespace-nowrap">{label}</td>
                  <td className="py-2 pr-2 text-gray-400">{show(proposal.current[key])}</td>
                  <td className="py-2 pr-2 text-gray-900">{show(proposal.proposed[key])}</td>
                  <td className="py-2 text-right">
                    <input type="checkbox" className="rounded" checked={selected.has(key)} onChange={() => toggle(key)} aria-label={`Apply ${label}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => setPhase('input')} disabled={phase === 'applying'}>Back</Button>
          <Button type="button" className="flex-1" onClick={apply} disabled={!selected.size} loading={phase === 'applying'}>
            Save {selected.size || ''} field{selected.size === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={preview} className="space-y-4">
      <div role="radiogroup" aria-label="Enrich from" className="grid grid-cols-2 gap-2">
        {[['domain', 'Company domain'], ['linkedin', 'LinkedIn URL']].map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={mode === key} onClick={() => { setMode(key); setProblem(null); }}
            className={`text-sm font-medium rounded-lg border px-3 py-2 ${mode === key ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-200 text-gray-600 hover:border-indigo-300'}`}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'domain'
        ? <Input label="Company domain" placeholder="acme.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
        : <Input label="LinkedIn profile URL" placeholder="https://www.linkedin.com/in/jane-doe" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />}
      <p className="text-xs text-gray-400">
        {mode === 'domain'
          ? 'Reads the public homepage title and description, then suggests updates. Nothing is saved until you confirm.'
          : 'LinkedIn pages are not fetched; only the profile name in the URL is used, so expect fewer suggestions.'}
      </p>
      {problem && <p role="alert" className="text-xs text-red-600">{problem}</p>}
      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button type="submit" className="flex-1" loading={phase === 'loading'}><Sparkles size={14} className="mr-1.5" /> Find details</Button>
      </div>
    </form>
  );
}

/** Proposes enrichment for a contact and saves only the fields the user ticks. */
export default function EnrichModal({ isOpen, onClose, contact, onApplied }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Enrich contact" size="lg">
      {isOpen && <EnrichForm contact={contact} onClose={onClose} onApplied={onApplied} />}
    </Modal>
  );
}
