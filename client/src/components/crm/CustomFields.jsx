import { useCustomFields } from '../../hooks/queries/lookups';
import { formatDate } from '../../lib/format';

const control = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

/** Inputs for the workspace's custom fields of `entity` ('CONTACT' | 'DEAL'). */
export function CustomFieldInputs({ entity, values, onChange }) {
  const { data: fields = [] } = useCustomFields(entity);
  if (!fields.length) return null;
  return (
    <fieldset className="space-y-4 border-t border-gray-100 pt-4">
      <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Custom fields</legend>
      {fields.map((f) => {
        const id = `cf-${entity}-${f.key}`;
        const props = { id, required: f.required, value: values[f.key] ?? '', onChange: (e) => onChange(f.key, e.target.value), className: control };
        return (
          <div key={f.id}>
            <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
              {f.label}{f.required && <span className="text-red-500" aria-hidden="true"> *</span>}
            </label>
            {f.type === 'SELECT' ? (
              <select {...props}>
                <option value="">{f.required ? 'Select…' : '—'}</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input {...props} type={f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : 'text'}
                step={f.type === 'NUMBER' ? 'any' : undefined} maxLength={f.type === 'TEXT' ? 500 : undefined} />
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

const display = (field, value) => {
  if (field.type === 'DATE') return formatDate(`${value}T00:00:00Z`, { dateOnly: true });
  if (field.type === 'NUMBER') return Number(value).toLocaleString('en-US');
  return String(value);
};

/** The record's custom field values that are set, as a definition list. */
export function CustomFieldValues({ entity, values }) {
  const { data: fields = [] } = useCustomFields(entity);
  const set = fields.filter((f) => values?.[f.key] !== undefined && values[f.key] !== null && values[f.key] !== '');
  if (!set.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {set.map((f) => (
        <div key={f.id} className="min-w-0">
          <dt className="text-xs text-gray-400">{f.label}</dt>
          <dd className="text-gray-800 truncate" title={String(values[f.key])}>{display(f, values[f.key])}</dd>
        </div>
      ))}
    </dl>
  );
}
