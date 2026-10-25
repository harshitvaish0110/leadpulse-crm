import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getContacts } from '../../api/contacts';
import { qk } from '../../hooks/queries/keys';

const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

/**
 * Search-as-you-type contact chooser. `value` is `{ id, name }` or null.
 */
export default function ContactPicker({ id, value, onChange, placeholder = 'Search by name or email…' }) {
  const [term, setTerm] = useState('');
  const { data } = useQuery({
    queryKey: qk.contacts.list({ search: term, limit: 8, picker: true }),
    queryFn: () => getContacts({ search: term, limit: 8, sortBy: 'lastName', sortDir: 'asc' }).then((r) => r.data.contacts),
    enabled: term.trim().length > 0,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2 text-sm">
        <span>{value.name}</span>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-indigo-600 hover:text-indigo-700">Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input id={id} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={placeholder}
        className={field} autoComplete="off" aria-autocomplete="list" aria-controls={`${id}-results`} />
      {term.trim() && (
        <ul id={`${id}-results`} role="listbox" className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {(data || []).length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">No matching contacts</li>
          ) : data.map((c) => (
            <li key={c.id} role="option" aria-selected="false">
              <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50"
                onClick={() => { setTerm(''); onChange({ id: c.id, name: `${c.firstName} ${c.lastName}` }); }}>
                {c.firstName} {c.lastName} <span className="text-gray-400">· {c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
