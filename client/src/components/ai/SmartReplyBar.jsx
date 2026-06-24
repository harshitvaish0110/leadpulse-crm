import { useState } from 'react';
import { MessageSquare, Zap, Coffee, AlertTriangle, Copy, CheckCircle2 } from 'lucide-react';
import Button from '../ui/Button';
import api from '../../api/axiosInstance';
import toast from 'react-hot-toast';

const TONES = [
  { key: 'professional', label: 'Professional', Icon: MessageSquare, desc: 'Formal & business-like' },
  { key: 'casual',       label: 'Casual',       Icon: Coffee,        desc: 'Friendly & warm' },
  { key: 'urgent',       label: 'Urgent',       Icon: AlertTriangle, desc: 'Direct & time-sensitive' },
];

export default function SmartReplyBar({ emailThread, contactId, onUseReply }) {
  const [activeTone, setActiveTone] = useState(null);
  const [reply,      setReply]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [copied,     setCopied]     = useState(false);

  const generate = async (tone) => {
    if (!emailThread?.trim()) {
      toast.error('Paste an email thread first');
      return;
    }
    setActiveTone(tone);
    setReply('');
    setLoading(true);
    setCopied(false);

    try {
      const { data } = await api.post('/api/ai/smart-reply', {
        emailThread,
        tone,
        contactId,
      });
      setReply(data.replies?.[0] || data.reply || '');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate reply');
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(reply).then(() => {
      setCopied(true);
      toast.success('Copied!');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Zap size={13} className="text-indigo-500" />
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Smart Reply</span>
      </div>

      {/* Tone buttons */}
      <div className="grid grid-cols-3 gap-2">
        {TONES.map(({ key, label, Icon, desc }) => (
          <button
            key={key}
            onClick={() => generate(key)}
            disabled={loading}
            className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-xs transition-all
              ${activeTone === key
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:bg-indigo-50'
              }`}
          >
            <Icon size={14} className={activeTone === key ? 'text-white' : 'text-indigo-500'} />
            <span className="font-semibold">{label}</span>
          </button>
        ))}
      </div>

      {/* Reply Preview */}
      {loading && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-full mb-1.5" />
          <div className="h-3 bg-gray-200 rounded w-4/5 mb-1.5" />
          <div className="h-3 bg-gray-200 rounded w-3/5" />
        </div>
      )}

      {reply && !loading && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
            <span className="text-xs font-medium text-gray-500 capitalize">{activeTone} reply</span>
            <button onClick={copy}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
              {copied ? <CheckCircle2 size={12} className="text-green-500" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="px-3 py-3 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
            {reply}
          </pre>
          {onUseReply && (
            <div className="px-3 py-2.5 border-t border-gray-100">
              <Button size="sm" variant="secondary" className="w-full" onClick={() => onUseReply(reply)}>
                Use This Reply
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
