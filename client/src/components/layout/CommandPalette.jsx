import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Activity, BarChart2, Building2, CheckSquare, LayoutDashboard, Mail, Phone, Plus, Search, Settings, Sparkles, Sun, TrendingUp, Users,
} from 'lucide-react';
import api from '../../api/axiosInstance';
import { useDialog } from '../ui/useDialog';
import { useUIStore } from '../../store/uiStore';
import { qk } from '../../hooks/queries/keys';
import { SHORTCUT_LABEL } from '../../lib/shortcut';

const COMMANDS = [
  { id: 'new-contact', group: 'Create', label: 'New contact', icon: Plus, to: '/contacts?new=1' },
  { id: 'new-deal', group: 'Create', label: 'New deal', icon: Plus, to: '/deals?new=1' },
  { id: 'new-task', group: 'Create', label: 'New task', icon: Plus, to: '/tasks?new=1' },
  { id: 'go-my-day', group: 'Go to', label: 'My Day', icon: Sun, to: '/my-day' },
  { id: 'go-dashboard', group: 'Go to', label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { id: 'go-contacts', group: 'Go to', label: 'Contacts', icon: Users, to: '/contacts' },
  { id: 'go-companies', group: 'Go to', label: 'Companies', icon: Building2, to: '/companies' },
  { id: 'go-deals', group: 'Go to', label: 'Deals pipeline', icon: TrendingUp, to: '/deals' },
  { id: 'go-activities', group: 'Go to', label: 'Activities', icon: Activity, to: '/activities' },
  { id: 'go-tasks', group: 'Go to', label: 'Tasks', icon: CheckSquare, to: '/tasks' },
  { id: 'go-analytics', group: 'Go to', label: 'Analytics', icon: BarChart2, to: '/analytics' },
  { id: 'go-assistant', group: 'Go to', label: 'AI Assistant', icon: Sparkles, to: '/ai-assistant' },
  { id: 'go-settings', group: 'Go to', label: 'Settings', icon: Settings, to: '/settings' },
];

const matches = (label, terms) => terms.every((t) => label.toLowerCase().includes(t));

/** The flat, ordered list of what Enter can run for `query`. */
function buildItems(query, results) {
  const q = query.trim();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const items = COMMANDS.filter((c) => !terms.length || matches(c.label, terms));
  if (results) {
    const [first] = results.contacts;
    for (const c of results.contacts) items.push({ id: `contact-${c.id}`, group: 'Contacts', label: c.name, hint: c.subtitle, icon: Users, to: `/contacts/${c.id}` });
    if (first) {
      items.push({ id: `log-${first.id}`, group: 'Contacts', label: `Log a call with ${first.name}`, icon: Phone, to: `/contacts/${first.id}?log=1` });
      items.push({ id: `email-${first.id}`, group: 'Contacts', label: `Email ${first.name}`, icon: Mail, to: `/contacts/${first.id}?tab=emails&compose=1` });
    }
    for (const d of results.deals) items.push({ id: `deal-${d.id}`, group: 'Deals', label: d.name, hint: d.subtitle, icon: TrendingUp, to: `/deals/${d.id}` });
    for (const c of results.companies) items.push({ id: `company-${c.id}`, group: 'Companies', label: c.name, hint: c.subtitle, icon: Building2, to: `/companies/${c.id}` });
  }
  if (q) items.push({ id: 'ask', group: 'Ask AI', label: `Ask AI: “${q}”`, hint: 'Answers from your CRM records', icon: Sparkles, to: `/ai-assistant?ask=${encodeURIComponent(q)}` });
  return items;
}

function Palette({ onClose }) {
  const navigate = useNavigate();
  const panelRef = useDialog(true, onClose);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  const search = useQuery({
    queryKey: qk.search(debounced),
    queryFn: () => api.get('/api/search', { params: { q: debounced } }).then((r) => r.data.results),
    enabled: debounced.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const results = debounced.length >= 2 ? search.data : null;
  const items = useMemo(() => buildItems(query, results), [query, results]);
  const current = Math.min(active, Math.max(items.length - 1, 0));

  const run = (item) => {
    onClose();
    navigate(item.to);
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) setActive((current + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (e.key === 'Enter' && items[current]) {
      e.preventDefault();
      run(items[current]);
    }
  };

  const groups = [];
  items.forEach((item, index) => {
    const last = groups.at(-1);
    if (last?.name === item.group) last.items.push({ item, index });
    else groups.push({ name: item.group, items: [{ item, index }] });
  });
  const optionId = (item) => `${listId}-${item.id}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Command palette"
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b border-gray-100">
          <Search size={18} className="text-gray-400 flex-shrink-0" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search contacts, deals and companies, or ask AI…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items[current] ? optionId(items[current]) : undefined}
            aria-label="Search or run a command"
            className="flex-1 py-4 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
          />
          {search.isFetching && <span className="text-xs text-gray-400" role="status">Searching…</span>}
        </div>
        <div id={listId} role="listbox" aria-label="Results" className="max-h-[55vh] overflow-y-auto py-2">
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name} className="px-2 pb-1">
              <p className="px-2 pt-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider" aria-hidden="true">{g.name}</p>
              {g.items.map(({ item, index }) => {
                const Icon = item.icon;
                const selected = index === current;
                return (
                  <div key={item.id} id={optionId(item)} role="option" aria-selected={selected}
                    onMouseMove={() => setActive(index)} onClick={() => run(item)}
                    className={`flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer text-sm ${selected ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700'}`}>
                    <Icon size={15} className={selected ? 'text-indigo-600' : 'text-gray-400'} aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                    {item.hint && <span className="ml-auto pl-3 text-xs text-gray-400 truncate max-w-[45%]">{item.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {debounced.length >= 2 && results && !results.contacts.length && !results.deals.length && !results.companies.length && (
            <p className="px-4 py-2 text-xs text-gray-400">No contacts, deals or companies match “{debounced}”.</p>
          )}
        </div>
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400">
          <span><kbd className="font-sans">↑↓</kbd> move</span>
          <span><kbd className="font-sans">Enter</kbd> open</span>
          <span><kbd className="font-sans">Esc</kbd> close</span>
          <span className="ml-auto">{SHORTCUT_LABEL} anywhere</span>
        </div>
      </div>
    </div>
  );
}

/** ⌘K / Ctrl K from anywhere: jump to a record, create one, or ask the assistant. */
export default function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen);
  const setOpen = useUIStore((s) => s.setPaletteOpen);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useUIStore.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
  return open ? <Palette onClose={() => setOpen(false)} /> : null;
}
