import { useState } from 'react';
import { Brain, RefreshCw, AlertCircle } from 'lucide-react';
import Button from '../ui/Button';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/** Minimal markdown renderer — converts ## headings + **bold** to HTML */
function renderMarkdown(md) {
  if (!md) return '';
  return md
    .replace(/^## (.+)$/gm, '<h3 class="text-sm font-semibold text-gray-800 mt-3 mb-1">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 class="text-xs font-semibold text-gray-700 mt-2 mb-0.5">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li class="text-sm text-gray-600 ml-3 list-disc">$1</li>')
    .replace(/\n\n/g, '<div class="mb-2" />')
    .replace(/\n/g, '<br/>');
}

export default function DealSummaryPanel({ dealId }) {
  const { token }         = useAuthStore();
  const [summary, setSummary]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError]       = useState(null);

  const generate = async () => {
    setSummary('');
    setLoading(true);
    setGenerated(false);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/ai/deal-summary/${dealId}`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ dealId }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Summary generation failed');
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
            const parsed = JSON.parse(raw);
            if (parsed.text) {
              fullText += parsed.text;
              setSummary(fullText);
            } else if (parsed.summary) {
              // Non-streaming JSON response (fallback)
              setSummary(parsed.summary);
            }
          } catch {}
        }
      }
      setGenerated(true);
    } catch (err) {
      const msg = err.message || 'AI service unavailable';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-5 text-white shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-500/20 rounded-lg flex items-center justify-center">
            <Brain size={16} className="text-indigo-300" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">AI Deal Briefing</p>
            <p className="text-xs text-slate-400">Powered by Claude</p>
          </div>
        </div>
        {generated && (
          <button onClick={generate} disabled={loading}
            className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* Empty State */}
      {!summary && !loading && !error && (
        <div className="text-center py-4">
          <p className="text-sm text-slate-400 mb-4">
            Get an AI-generated briefing with key concerns, last interaction, and talking points.
          </p>
          <Button size="sm" className="w-full bg-indigo-600 hover:bg-indigo-700 border-0" onClick={generate}>
            <Brain size={14} className="mr-2" /> Generate Briefing
          </Button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !summary && (
        <div className="space-y-2 animate-pulse">
          {[1, 0.8, 0.9, 0.7, 0.85].map((w, i) => (
            <div key={i} className="h-3 bg-white/10 rounded" style={{ width: `${w * 100}%` }} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-3 mt-2">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Summary — streams in live */}
      {summary && (
        <div
          className="prose prose-sm prose-invert max-w-none text-slate-300 text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
        />
      )}

      {/* Regenerate button after first generation */}
      {generated && !loading && (
        <Button
          size="sm"
          variant="secondary"
          className="w-full mt-4 bg-white/10 border-white/10 text-white hover:bg-white/20"
          onClick={generate}
        >
          <RefreshCw size={13} className="mr-1.5" /> Regenerate
        </Button>
      )}
    </div>
  );
}
