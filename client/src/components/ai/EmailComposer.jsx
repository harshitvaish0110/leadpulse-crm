import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wand2, Copy, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import Button from '../ui/Button';
import api from '../../api/axiosInstance';
import { parseEmail } from '../../lib/email';
import { useAIStream } from '../../hooks/useAIStream';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';

const TONES = [['professional', 'Professional'], ['friendly', 'Friendly'], ['concise', 'Concise']];
const MAX_POINTS = 10;
const MAX_POINT_LENGTH = 300;

/** Bullet points in, a streamed personalised email out; "Use this email" saves it as a draft. */
export default function EmailComposer({ contactId, dealId, initialBullets = [], onSaved }) {
  const qc = useQueryClient();
  const [bullets, setBullets] = useState(initialBullets.join('\n'));
  const [tone, setTone] = useState('professional');
  const [problem, setProblem] = useState(null);
  const [copied, setCopied] = useState(false);
  const { text, phase, error, incomplete, start } = useAIStream();
  const { subject, body } = parseEmail(text);
  const streaming = phase === 'streaming';

  const save = useMutation({
    mutationFn: () => api.post('/api/emails', { contactId, dealId, direction: 'OUTBOUND', subject, body, aiGenerated: true, tone }).then((r) => r.data.email),
    onSuccess: (email) => {
      qc.invalidateQueries({ queryKey: qk.emails.thread(contactId) });
      toast.success('Draft saved to the email thread');
      onSaved?.(email);
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not save the draft'),
  });

  const generate = () => {
    const points = bullets.split('\n').map((b) => b.trim()).filter(Boolean);
    if (!points.length) return setProblem('Add at least one point to cover.');
    if (points.length > MAX_POINTS) return setProblem(`Use at most ${MAX_POINTS} points.`);
    if (points.some((p) => p.length > MAX_POINT_LENGTH)) return setProblem(`Keep each point under ${MAX_POINT_LENGTH} characters.`);
    setProblem(null);
    setCopied(false);
    start('/api/ai/compose-email', { contactId, dealId, bulletPoints: points, tone });
  };

  const copy = () => navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="compose-points" className="block text-sm font-medium text-gray-700 mb-1.5">
          Points to cover <span className="text-gray-400 font-normal">(one per line)</span>
        </label>
        <textarea id="compose-points" rows={4} value={bullets} onChange={(e) => setBullets(e.target.value)}
          aria-invalid={Boolean(problem)} aria-describedby={problem ? 'compose-problem' : undefined}
          placeholder={'Follow up on last week\'s demo\nAnswer the pricing question\nPropose a call next week'}
          className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none bg-gray-50" />
        {problem && <p id="compose-problem" className="text-xs text-red-600 mt-1">{problem}</p>}
      </div>

      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 mb-1.5">Tone</legend>
        <div className="grid grid-cols-3 gap-2">
          {TONES.map(([key, label]) => (
            <label key={key} className={`text-center text-xs font-medium rounded-lg border px-2 py-2 cursor-pointer transition-colors ${
              tone === key ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-200 text-gray-600 hover:border-indigo-300'}`}>
              <input type="radio" name="compose-tone" value={key} checked={tone === key} onChange={() => setTone(key)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <Button onClick={generate} loading={streaming} className="w-full">
        <Wand2 size={15} className="mr-2" /> {streaming ? 'Writing…' : phase === 'idle' ? 'Generate email' : 'Generate again'}
      </Button>

      {phase === 'error' && (
        <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{incomplete ? `The email stopped early: ${error}` : error}</p>
        </div>
      )}

      {(text || streaming) && (
        <div className="border border-gray-200 rounded-xl overflow-hidden" aria-live="polite" aria-busy={streaming}>
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Preview</span>
            <div className="flex gap-3">
              <button type="button" onClick={generate} disabled={streaming} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50">
                <RefreshCw size={12} className={streaming ? 'animate-spin' : ''} /> Regenerate
              </button>
              <button type="button" onClick={copy} disabled={!body} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50">
                {copied ? <CheckCircle2 size={12} className="text-green-500" /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="px-4 py-2.5 border-b border-gray-100 flex gap-2 text-sm">
            <span className="text-gray-400 flex-shrink-0">Subject</span>
            <span className="font-semibold text-gray-900">{subject || <span className="text-gray-300">…</span>}</span>
          </div>
          <div className="px-4 py-3.5 bg-white">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{body || <span className="text-gray-300 animate-pulse">Writing…</span>}</p>
          </div>
          {phase === 'done' && body && (
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
              <Button size="sm" className="w-full" onClick={() => save.mutate()} loading={save.isPending}>Use this email</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
