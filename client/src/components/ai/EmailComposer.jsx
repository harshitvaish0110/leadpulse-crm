import { useState, useRef } from 'react';
import { Wand2, Copy, RefreshCw, CheckCircle2 } from 'lucide-react';
import Button from '../ui/Button';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function EmailComposer({ contactId, dealId, onEmailReady }) {
  const { token } = useAuthStore();
  const [bullets,  setBullets]  = useState('');
  const [subject,  setSubject]  = useState('');
  const [body,     setBody]     = useState('');
  const [streaming, setStreaming] = useState(false);
  const [copied,   setCopied]   = useState(false);

  const generate = async () => {
    const bulletList = bullets.split('\n').map(b => b.trim()).filter(Boolean);
    if (!bulletList.length) { toast.error('Add at least one bullet point'); return; }

    setSubject('');
    setBody('');
    setStreaming(true);
    setCopied(false);

    try {
      const response = await fetch(`${API_BASE}/api/ai/compose-email`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ contactId, dealId, bulletPoints: bulletList }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Generation failed');
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;
          try {
            const { text } = JSON.parse(raw);
            fullText += text;

            // Parse subject from first line starting with "Subject:"
            const allLines = fullText.split('\n');
            const subjectLine = allLines.find(l => l.startsWith('Subject:'));
            if (subjectLine) {
              setSubject(subjectLine.replace('Subject:', '').trim());
              setBody(
                allLines
                  .filter(l => !l.startsWith('Subject:'))
                  .join('\n')
                  .trim()
              );
            } else {
              setBody(fullText);
            }
          } catch {}
        }
      }
    } catch (err) {
      toast.error(err.message || 'Failed to generate email');
    } finally {
      setStreaming(false);
    }
  };

  const copy = () => {
    const full = `Subject: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(full).then(() => {
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-4">
      {/* Bullet Points Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Key points to cover <span className="text-gray-400 font-normal">(one per line)</span>
        </label>
        <textarea
          rows={4}
          value={bullets}
          onChange={e => setBullets(e.target.value)}
          placeholder={`Follow up on last week's demo\nAddress pricing concern\nPropose next meeting date`}
          className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none bg-gray-50"
        />
      </div>

      <Button onClick={generate} loading={streaming} className="w-full">
        <Wand2 size={15} className="mr-2" />
        {streaming ? 'Generating…' : 'Generate Email'}
      </Button>

      {/* Generated Email Preview */}
      {(subject || body) && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Generated Email</span>
            <div className="flex gap-2">
              <button onClick={generate} disabled={streaming}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                <RefreshCw size={12} className={streaming ? 'animate-spin' : ''} /> Regenerate
              </button>
              <button onClick={copy}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                {copied ? <CheckCircle2 size={12} className="text-green-500" /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Subject */}
          {subject && (
            <div className="px-4 py-2.5 bg-white border-b border-gray-100 flex items-center gap-2">
              <span className="text-xs font-medium text-gray-400 flex-shrink-0">Subject:</span>
              <p className="text-sm font-semibold text-gray-900">{subject}</p>
            </div>
          )}

          {/* Body */}
          <div className="px-4 py-3.5 bg-white">
            <pre className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">
              {body || <span className="text-gray-300 animate-pulse">Generating…</span>}
            </pre>
          </div>

          {/* Use this email CTA */}
          {onEmailReady && body && !streaming && (
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
              <Button size="sm" className="w-full" onClick={() => onEmailReady(subject, body)}>
                Use This Email
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
