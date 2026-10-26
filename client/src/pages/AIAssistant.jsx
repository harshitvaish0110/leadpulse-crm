import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Sparkles, PlusCircle, Bot, User, Loader2, ExternalLink, Trash2, RotateCcw, Square } from 'lucide-react';
import api from '../api/axiosInstance';
import { streamSSE } from '../lib/sse';
import { Markdown } from '../lib/markdown';
import { timeAgo } from '../lib/format';
import { qk } from '../hooks/queries/keys';
import ApprovalCard from '../components/ai/ApprovalCard';
import ErrorBoundary from '../components/ErrorBoundary';
import toast from 'react-hot-toast';

const STARTERS = ['Which deals are at risk?', 'Summarise my pipeline', 'Who are my hottest leads?', 'What happened with Acme Corp last week?'];
const NO_MESSAGES = [];

const fetchConversation = (id) => () => api.get(`/api/ai/conversations/${id}`).then((r) => r.data.conversation);

/** Server messages, each assistant reply carrying the actions proposed right after it. */
function withActions(conversation) {
  if (!conversation) return NO_MESSAGES;
  const messages = conversation.messages.map((m) => ({ ...m, actions: [] }));
  for (const action of conversation.actions ?? []) {
    const owner = [...messages].reverse().find((m) => m.role === 'assistant' && m.createdAt <= action.createdAt);
    owner?.actions.push(action);
  }
  return messages;
}

const SOURCE_PATH = {
  contact: (s) => `/contacts/${s.id}`,
  deal: (s) => `/deals/${s.id}`,
  company: (s) => `/companies/${s.id}`,
  activity: (s) => `/contacts/${s.contactId}?tab=activities`,
};

function SourceChip({ source }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(SOURCE_PATH[source.type]?.(source) ?? '/')}
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-md text-xs font-medium transition-colors max-w-[16rem]">
      <span className="truncate">{source.type}: {source.name}</span> <ExternalLink size={10} className="flex-shrink-0" />
    </button>
  );
}

function Message({ msg, onRetry }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isUser ? 'bg-indigo-600' : 'bg-gray-100'}`}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-gray-600" />}
      </div>
      <div className={`max-w-[80%] flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${isUser ? 'bg-indigo-600 text-white rounded-tr-sm whitespace-pre-wrap' : 'bg-white border border-gray-100 shadow-sm text-gray-800 rounded-tl-sm'}`}>
          {isUser ? msg.content : msg.content
            ? <Markdown text={msg.content} />
            : !msg.error && <span className="flex items-center gap-2 text-gray-400"><Loader2 size={14} className="animate-spin" /> Searching your CRM…</span>}
          {msg.error && (
            <p role="alert" className={`text-xs text-red-600 ${msg.content ? 'mt-2' : ''}`}>
              {msg.error}{' '}
              {msg.retry && <button type="button" onClick={() => onRetry(msg.retry)} className="inline-flex items-center gap-1 font-medium underline"><RotateCcw size={11} /> Retry</button>}
            </p>
          )}
        </div>
        {msg.sources?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">{msg.sources.map((s) => <SourceChip key={`${s.type}:${s.id}`} source={s} />)}</div>
        )}
        {msg.actions?.map((a) => (
          <ErrorBoundary key={a.id} compact title="Failed to load approval details"><ApprovalCard action={a} /></ErrorBoundary>
        ))}
      </div>
    </div>
  );
}

export default function AIAssistant() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const conversationId = params.get('c');
  const [pending, setPending] = useState(null); // the question in flight: { conversationId, streaming, messages: [user, assistant] }
  const [input, setInput] = useState('');
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const list = useQuery({ queryKey: qk.ai.conversations, queryFn: () => api.get('/api/ai/conversations').then((r) => r.data.conversations) });
  const detail = useQuery({ queryKey: qk.ai.conversation(conversationId), queryFn: fetchConversation(conversationId), enabled: Boolean(conversationId) });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/api/ai/conversations/${id}`),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: qk.ai.conversations });
      if (id === conversationId) setParams({});
    },
    onError: () => toast.error('Could not delete the conversation'),
  });

  const serverMessages = conversationId ? withActions(detail.data) : NO_MESSAGES;
  const messages = pending && pending.conversationId === conversationId ? [...serverMessages, ...pending.messages] : serverMessages;
  const streaming = Boolean(pending?.streaming);

  // Scroll for new messages and streamed text only, not on every keystroke.
  const lastText = messages.at(-1)?.content;
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, lastText]);
  useEffect(() => () => abortRef.current?.abort(), []); // leaving the page cancels the answer
  useEffect(() => {
    if (!streaming) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') abortRef.current?.abort(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [streaming]);

  const send = async (question) => {
    const q = question.trim();
    if (!q || streaming) return;
    setInput('');
    const controller = new AbortController();
    abortRef.current = controller;
    setPending({ conversationId, streaming: true, messages: [{ role: 'user', content: q }, { role: 'assistant', content: '', sources: [], actions: [] }] });
    const patch = (fn) => setPending((p) => p && { ...p, messages: [p.messages[0], { ...p.messages[1], ...fn(p.messages[1]) }] });

    let done = null;
    let failure = null;
    try {
      await streamSSE('/api/ai/chat', { conversationId, question: q }, {
        delta: ({ text }) => patch((m) => ({ content: m.content + text })),
        sources: ({ sources }) => patch(() => ({ sources })),
        actions: ({ actions }) => patch(() => ({ actions })),
        done: (data) => { done = data; },
        error: ({ message }) => { failure = message; },
      }, { signal: controller.signal });
    } catch (err) {
      failure = err.name === 'AbortError' ? 'Stopped.' : err.message;
    }
    qc.invalidateQueries({ queryKey: qk.ai.conversations });
    if (failure || !done) {
      patch(() => ({ error: failure || 'The answer did not finish.', retry: q }));
      setPending((p) => p && { ...p, streaming: false });
      return;
    }
    // Load the saved conversation before dropping the local copy, so nothing flickers. staleTime 0:
    // a conversation fetched moments ago still counts as fresh and would otherwise not be reloaded.
    await qc.fetchQuery({ queryKey: qk.ai.conversation(done.conversationId), queryFn: fetchConversation(done.conversationId), staleTime: 0 });
    if (done.conversationId !== conversationId) setParams({ c: done.conversationId });
    setPending(null);
  };

  const retry = (question) => {
    setPending(null);
    send(question);
  };

  const newChat = () => {
    abortRef.current?.abort();
    setPending(null);
    setParams({});
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] -m-6">
      <aside className="w-56 xl:w-64 bg-gray-50 border-r border-gray-100 flex flex-col p-3 gap-2 flex-shrink-0" aria-label="Conversations">
        <button type="button" onClick={newChat}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
          <PlusCircle size={15} /> New chat
        </button>
        <ul className="flex-1 overflow-y-auto space-y-1 mt-1">
          {(list.data ?? []).map((c) => (
            <li key={c.id} className="group relative">
              <button type="button" onClick={() => { setPending(null); setParams({ c: c.id }); }}
                aria-current={c.id === conversationId ? 'page' : undefined}
                className={`w-full text-left px-3 py-2 pr-8 rounded-xl text-sm transition-all ${c.id === conversationId ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:bg-white hover:text-gray-700'}`}>
                <span className="block truncate">{c.title}</span>
                <span className="block text-[11px] text-gray-400">{timeAgo(c.updatedAt)}</span>
              </button>
              <button type="button" onClick={() => remove.mutate(c.id)} aria-label={`Delete conversation ${c.title}`}
                className="absolute right-2 top-2.5 p-1 text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        <div className="pt-3 border-t border-gray-200">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-2 px-1">Try asking</p>
          {STARTERS.slice(0, 3).map((s) => (
            <button key={s} type="button" onClick={() => send(s)} disabled={streaming}
              className="w-full text-left px-2 py-1.5 text-xs text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors truncate">
              {s}
            </button>
          ))}
        </div>
      </aside>

      <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center"><Sparkles size={16} className="text-white" /></div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">LeadPulse AI</h1>
            <p className="text-xs text-gray-400">Answers from your own CRM records. Changes it suggests need your approval.</p>
          </div>
          {streaming && (
            <button type="button" onClick={() => abortRef.current?.abort()} className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800">
              <Square size={11} /> Stop (Esc)
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6" aria-live="polite">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 max-w-lg mx-auto text-center">
              <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center"><Sparkles size={28} className="text-indigo-600" /></div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">How can I help?</h2>
                <p className="text-sm text-gray-500">Ask about your contacts, deals and pipeline, or ask me to create a task, log a call or draft an email.</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)}
                    className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-600 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all shadow-sm">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => <Message key={msg.id ?? `pending-${i}`} msg={msg} onRetry={retry} />)
          )}
          <div ref={bottomRef} />
        </div>

        <form className="bg-white border-t border-gray-100 px-6 py-4" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <div className="flex items-end gap-3 max-w-4xl mx-auto">
            <label className="flex-1">
              <span className="sr-only">Your question</span>
              <textarea ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="Ask anything about your CRM…" disabled={streaming} maxLength={2000}
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 max-h-40 overflow-y-auto"
                style={{ minHeight: '48px' }} />
            </label>
            <button type="submit" disabled={!input.trim() || streaming} aria-label="Send"
              className="w-11 h-11 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center flex-shrink-0 transition-colors">
              <Send size={16} className="text-white" />
            </button>
          </div>
          <p className="text-center text-xs text-gray-300 mt-2">Enter to send · Shift+Enter for a new line</p>
        </form>
      </div>
    </div>
  );
}
