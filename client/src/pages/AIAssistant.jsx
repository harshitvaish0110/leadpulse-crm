import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Sparkles, PlusCircle, Bot, User, Loader2, ExternalLink } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

const SUGGESTIONS = [
  'Which deals are at risk this week?',
  'Summarise my pipeline',
  'Who are my hottest leads?',
  'Which contacts haven\'t been contacted in 30 days?',
  'What was the outcome of my last call with Acme?',
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function SourceChip({ source }) {
  const navigate = useNavigate();
  const isContact = source.type === 'contact';
  const path = isContact ? `/contacts/${source.id}` : `/deals/${source.id}`;
  return (
    <button onClick={() => navigate(path)}
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-md text-xs font-medium transition-colors">
      [{source.type}: {source.name}] <ExternalLink size={10} />
    </button>
  );
}

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isUser ? 'bg-indigo-600' : 'bg-gray-100'}`}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-gray-600" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-2`}>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${isUser ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white border border-gray-100 shadow-sm text-gray-800 rounded-tl-sm'}`}>
          {msg.content || (
            <span className="flex items-center gap-2 text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Thinking…
            </span>
          )}
        </div>

        {/* Sources */}
        {msg.sources?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {msg.sources.map((s, i) => <SourceChip key={i} source={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AIAssistant() {
  const { token } = useAuthStore();
  const [conversations, setConversations] = useState([
    { id: 'default', label: 'New Chat', messages: [] },
  ]);
  const [activeConvId, setActiveConvId] = useState('default');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const sourceRef = useRef(null);

  const activeConv = conversations.find(c => c.id === activeConvId);
  const messages = activeConv?.messages || [];

  const setMessages = (updater) => {
    setConversations(prev => prev.map(c =>
      c.id === activeConvId
        ? { ...c, messages: typeof updater === 'function' ? updater(c.messages) : updater }
        : c
    ));
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (question) => {
    if (!question.trim() || streaming) return;
    setInput('');
    setStreaming(true);

    // Append user message
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    // Placeholder for assistant
    setMessages(prev => [...prev, { role: 'assistant', content: '', sources: [] }]);

    // Update conversation label from first message
    setConversations(prev => prev.map(c =>
      c.id === activeConvId && c.label === 'New Chat'
        ? { ...c, label: question.slice(0, 30) + (question.length > 30 ? '…' : '') }
        : c
    ));

    const url = `${API_BASE}/api/ai/chat?question=${encodeURIComponent(question)}`;
    const es = new EventSource(url, {
      withCredentials: false,
    });
    sourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.done) {
          setMessages(prev => {
            const msgs = [...prev];
            if (msgs.length > 0) msgs[msgs.length - 1].sources = data.sources || [];
            return msgs;
          });
          es.close();
          setStreaming(false);
          return;
        }
        setMessages(prev => {
          const msgs = [...prev];
          if (msgs.length > 0) msgs[msgs.length - 1].content += (data.text || '');
          return msgs;
        });
      } catch {}
    };

    es.onerror = () => {
      setMessages(prev => {
        const msgs = [...prev];
        if (msgs.length > 0 && !msgs[msgs.length - 1].content) {
          msgs[msgs.length - 1].content = 'Sorry, I had trouble connecting to the AI service. Please try again.';
        }
        return msgs;
      });
      es.close();
      setStreaming(false);
    };
  };

  const newChat = () => {
    const id = `conv-${Date.now()}`;
    setConversations(prev => [...prev, { id, label: 'New Chat', messages: [] }]);
    setActiveConvId(id);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] -m-6">
      {/* Left Sidebar */}
      <div className="w-56 xl:w-64 bg-gray-50 border-r border-gray-100 flex flex-col p-3 gap-2 flex-shrink-0">
        <button onClick={newChat}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
          <PlusCircle size={15} /> New Chat
        </button>

        {/* Conversation history */}
        <div className="flex-1 overflow-y-auto space-y-1 mt-1">
          {conversations.map(conv => (
            <button key={conv.id} onClick={() => setActiveConvId(conv.id)}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-all truncate
                ${conv.id === activeConvId ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:bg-white hover:text-gray-700'}`}>
              {conv.label}
            </button>
          ))}
        </div>

        {/* Suggestions footer */}
        <div className="pt-3 border-t border-gray-200">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-2 px-1">Suggestions</p>
          <div className="space-y-1">
            {SUGGESTIONS.slice(0, 3).map((s, i) => (
              <button key={i} onClick={() => sendMessage(s)}
                className="w-full text-left px-2 py-1.5 text-xs text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors truncate">
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-gray-50 min-w-0">

        {/* Header */}
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">LeadPulse AI</p>
            <p className="text-xs text-gray-400">Powered by your CRM data</p>
          </div>
          {streaming && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-indigo-600">
              <Loader2 size={12} className="animate-spin" /> Generating…
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {messages.length === 0 ? (
            /* Empty state with suggestion chips */
            <div className="flex flex-col items-center justify-center h-full gap-6 max-w-lg mx-auto text-center">
              <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center">
                <Sparkles size={28} className="text-indigo-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">How can I help?</h2>
                <p className="text-sm text-gray-500">Ask me anything about your contacts, deals, pipeline, or team performance.</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => sendMessage(s)}
                    className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-600 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all shadow-sm">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => <Message key={i} msg={msg} />)
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="bg-white border-t border-gray-100 px-6 py-4">
          <div className="flex items-end gap-3 max-w-4xl mx-auto">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about your CRM…"
                disabled={streaming}
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 pr-12 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 max-h-40 overflow-y-auto"
                style={{ minHeight: '48px' }}
              />
            </div>
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || streaming}
              className="w-11 h-11 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center flex-shrink-0 transition-colors">
              <Send size={16} className="text-white" />
            </button>
          </div>
          <p className="text-center text-xs text-gray-300 mt-2">Press Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
