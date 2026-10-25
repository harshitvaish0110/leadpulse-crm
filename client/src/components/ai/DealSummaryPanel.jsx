import { useEffect, useRef, useState } from 'react';
import { Brain, RefreshCw, AlertCircle } from 'lucide-react';
import Button from '../ui/Button';
import { streamSSE } from '../../lib/sse';
import { Markdown } from '../../lib/markdown';
import toast from 'react-hot-toast';

export default function DealSummaryPanel({ dealId }) {
  const [summary, setSummary]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError]         = useState(null);
  const abortRef = useRef(null);

  // Stop an in-flight stream when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSummary('');
    setLoading(true);
    setGenerated(false);
    setError(null);

    let text = '';
    let failure = null;
    try {
      await streamSSE(`/api/ai/deal-summary/${dealId}`, {}, {
        delta: ({ text: chunk }) => { text += chunk; setSummary(text); },
        error: ({ message }) => { failure = message; },
      }, { signal: controller.signal });
      if (failure) throw new Error(failure);
      setGenerated(true);
    } catch (err) {
      if (err.name === 'AbortError') return;
      const msg = err.message || 'AI service unavailable';
      setError(msg);
      toast.error(msg);
    } finally {
      if (abortRef.current === controller) setLoading(false);
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
            <p className="text-xs text-slate-400">Generated from this deal's recent activity</p>
          </div>
        </div>
        {generated && (
          <button onClick={generate} disabled={loading} aria-label="Regenerate briefing"
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
        <Markdown text={summary} className="prose prose-sm prose-invert max-w-none text-slate-300 text-sm leading-relaxed" />
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
