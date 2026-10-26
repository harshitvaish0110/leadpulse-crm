import { useState } from 'react';
import { MessageSquare, Zap, Coffee, AlertTriangle, Copy, CheckCircle2 } from 'lucide-react';
import Button from '../ui/Button';
import api from '../../api/axiosInstance';
import toast from 'react-hot-toast';

const TONES = [
  { key: 'professional', label: 'Reply professionally', Icon: MessageSquare },
  { key: 'casual',       label: 'Reply casually',       Icon: Coffee },
  { key: 'urgent',       label: 'Reply urgently',       Icon: AlertTriangle },
];

/** Three one-click replies to a received email; the chosen one opens as an editable draft. */
export default function SmartReplyBar({ contactId, email, onUseReply }) {
  const [activeTone, setActiveTone] = useState(null);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async (tone) => {
    setActiveTone(tone);
    setReply('');
    setLoading(true);
    setCopied(false);
    try {
      const { data } = await api.post('/api/ai/smart-reply', { contactId, emailId: email.id, tone });
      setReply(data.reply || '');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not write a reply');
    } finally {
      setLoading(false);
    }
  };

  const copy = () => navigator.clipboard.writeText(reply).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Zap size={13} className="text-indigo-500" />
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Smart reply to “{email.subject || 'the latest email'}”</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {TONES.map(({ key, label, Icon }) => (
          <button key={key} type="button" onClick={() => generate(key)} disabled={loading} aria-pressed={activeTone === key}
            className={`flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl border text-xs font-semibold transition-all disabled:opacity-60 ${
              activeTone === key ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:bg-indigo-50'}`}>
            <Icon size={14} className={activeTone === key ? 'text-white' : 'text-indigo-500'} /> {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 animate-pulse" aria-label="Writing a reply">
          <div className="h-3 bg-gray-200 rounded w-full mb-1.5" />
          <div className="h-3 bg-gray-200 rounded w-4/5 mb-1.5" />
          <div className="h-3 bg-gray-200 rounded w-3/5" />
        </div>
      )}

      {reply && !loading && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
            <span className="text-xs font-medium text-gray-500 capitalize">{activeTone} reply</span>
            <button type="button" onClick={copy} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
              {copied ? <CheckCircle2 size={12} className="text-green-500" /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="px-3 py-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{reply}</p>
          <div className="px-3 py-2.5 border-t border-gray-100">
            <Button size="sm" variant="secondary" className="w-full" onClick={() => onUseReply(reply, activeTone)}>Use this reply</Button>
          </div>
        </div>
      )}
    </div>
  );
}
