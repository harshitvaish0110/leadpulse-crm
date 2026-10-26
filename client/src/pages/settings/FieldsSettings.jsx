import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosInstance';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Skeleton from '../../components/ui/Skeleton';
import SectionCard from './SectionCard';
import { useCustomFields, useTags } from '../../hooks/queries/lookups';
import { qk } from '../../hooks/queries/keys';
import { apiError } from '../../lib/apiError';
import { humanize } from '../../lib/format';

const control = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';
const TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT'];
const splitOptions = (text) => text.split(',').map((o) => o.trim()).filter(Boolean);

/** A text input that saves when it loses focus (or on Enter), and reverts when emptied. */
function InlineText({ value, onCommit, label, className = '', ...props }) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (!next) setDraft(value);
    else if (next !== value) onCommit(next, () => setDraft(value));
  };
  return (
    <input value={draft} aria-label={label} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      className={`${control} ${className}`} {...props} />
  );
}

// ── Custom fields ──────────────────────────────────────────────────────────────

function AddFieldForm({ entity, onAdd, pending }) {
  const empty = { label: '', type: 'TEXT', options: '', required: false };
  const [form, setForm] = useState(empty);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <form className="flex flex-wrap items-center gap-2 mt-4" onSubmit={(e) => {
      e.preventDefault();
      onAdd({ entity, label: form.label, type: form.type, required: form.required, ...(form.type === 'SELECT' && { options: splitOptions(form.options) }) },
        () => setForm(empty));
    }}>
      <input required value={form.label} onChange={set('label')} placeholder="Field name, e.g. Contract end" aria-label="New field name" maxLength={60}
        className={`${control} flex-1 min-w-[10rem]`} />
      <select value={form.type} onChange={set('type')} aria-label="Field type" className={control}>
        {TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
      </select>
      {form.type === 'SELECT' && (
        <input required value={form.options} onChange={set('options')} placeholder="Options, comma separated" aria-label="Options"
          className={`${control} flex-1 min-w-[12rem]`} />
      )}
      <label className="flex items-center gap-1.5 text-sm text-gray-600">
        <input type="checkbox" checked={form.required} onChange={set('required')} /> Required
      </label>
      <Button type="submit" loading={pending}><Plus size={14} className="mr-1" /> Add field</Button>
    </form>
  );
}

function FieldList({ entity, title }) {
  const qc = useQueryClient();
  const { data: fields = [], isLoading } = useCustomFields(entity);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.settings.customFields(entity) });
  const onError = (fallback) => (err) => { toast.error(apiError(err, fallback)); refresh(); };

  const create = useMutation({
    mutationFn: (data) => api.post('/api/settings/custom-fields', data),
    onSuccess: () => { refresh(); toast.success('Field added'); },
    onError: onError('Could not add the field'),
  });
  const update = useMutation({
    mutationFn: ({ id, ...data }) => api.patch(`/api/settings/custom-fields/${id}`, data),
    onSuccess: refresh,
    onError: onError('Could not save the field'),
  });
  const reorder = useMutation({
    mutationFn: (ids) => api.put('/api/settings/custom-fields/order', { entity, ids }),
    onSuccess: refresh,
    onError: onError('Could not reorder the fields'),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/api/settings/custom-fields/${id}`).then((r) => r.data),
    onSuccess: ({ cleared }) => { refresh(); toast.success(cleared ? `Field deleted; cleared on ${cleared} records` : 'Field deleted'); },
    onError: onError('Could not delete the field'),
  });

  const move = (index, delta) => {
    const ids = fields.map((f) => f.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <SectionCard title={title} description="Shown on the record's page and its create and edit forms.">
      {isLoading ? <Skeleton lines={3} /> : fields.length === 0 ? (
        <p className="text-sm text-gray-500">No custom fields yet.</p>
      ) : (
        <ul className="space-y-2">
          {fields.map((f, i) => (
            <li key={`${f.id}:${f.label}:${(f.options ?? []).join('|')}`} className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 rounded-xl">
              <div className="flex flex-col">
                <button type="button" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(i, -1)}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp size={13} /></button>
                <button type="button" aria-label={`Move ${f.label} down`} disabled={i === fields.length - 1} onClick={() => move(i, 1)}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown size={13} /></button>
              </div>
              <InlineText value={f.label} label="Field name" maxLength={60} className="flex-1 min-w-[10rem]"
                onCommit={(label) => update.mutate({ id: f.id, label })} />
              <Badge variant="gray">{humanize(f.type)}</Badge>
              {f.type === 'SELECT' && (
                <InlineText value={(f.options ?? []).join(', ')} label={`Options of ${f.label}`} className="flex-1 min-w-[12rem]"
                  onCommit={(text) => update.mutate({ id: f.id, options: splitOptions(text) })} />
              )}
              <code className="text-xs text-gray-400" title="Key in the API and webhooks">{f.key}</code>
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <input type="checkbox" checked={f.required} onChange={(e) => update.mutate({ id: f.id, required: e.target.checked })} /> Required
              </label>
              <button type="button" aria-label={`Delete ${f.label}`}
                onClick={() => { if (confirm(`Delete "${f.label}"? Its value is removed from every ${entity === 'CONTACT' ? 'contact' : 'deal'}.`)) remove.mutate(f.id); }}
                className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <AddFieldForm entity={entity} pending={create.isPending} onAdd={(data, reset) => create.mutate(data, { onSuccess: reset })} />
    </SectionCard>
  );
}

// ── Tags ───────────────────────────────────────────────────────────────────────

function TagManager() {
  const qc = useQueryClient();
  const { data: tags = [], isLoading } = useTags();
  const [form, setForm] = useState({ name: '', color: '#6366f1' });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.settings.tags });
    qc.invalidateQueries({ queryKey: qk.contacts.all });
    qc.invalidateQueries({ queryKey: qk.analytics.all }); // lead sources
  };
  const onError = (fallback) => (err) => { toast.error(apiError(err, fallback)); refresh(); };

  const create = useMutation({
    mutationFn: (data) => api.post('/api/settings/tags', data),
    onSuccess: () => { refresh(); setForm((p) => ({ ...p, name: '' })); toast.success('Tag added'); },
    onError: onError('Could not add the tag'),
  });
  const update = useMutation({
    mutationFn: ({ id, ...data }) => api.patch(`/api/settings/tags/${id}`, data).then((r) => r.data),
    onSuccess: ({ merged, tag, contacts }) => {
      refresh();
      if (merged) toast.success(`Merged into "${tag.name}" on ${contacts} contacts`);
      else if (contacts) toast.success(`Renamed on ${contacts} contacts`);
    },
    onError: onError('Could not save the tag'),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/api/settings/tags/${id}`).then((r) => r.data),
    onSuccess: ({ contacts }) => { refresh(); toast.success(contacts ? `Tag removed from ${contacts} contacts` : 'Tag deleted'); },
    onError: onError('Could not delete the tag'),
  });

  const rename = (tag) => (name, revert) => {
    const existing = tags.find((t) => t.id !== tag.id && t.name === name);
    if (existing && !confirm(`"${name}" already exists. Merge "${tag.name}" into it? Contacts with either tag keep one "${name}".`)) { revert(); return; }
    update.mutate({ id: tag.id, name });
  };

  return (
    <SectionCard title="Tags" description="Renaming or deleting a tag updates every contact that has it. Lead-source tags feed the Analytics lead-source chart.">
      {isLoading ? <Skeleton lines={4} /> : (
        <ul className="divide-y divide-gray-100">
          {tags.map((tag) => (
            <li key={`${tag.id}:${tag.name}:${tag.color}`} className="flex flex-wrap items-center gap-3 py-2.5">
              <input type="color" defaultValue={tag.color} aria-label={`Colour of ${tag.name}`}
                onBlur={(e) => e.target.value !== tag.color && update.mutate({ id: tag.id, color: e.target.value })}
                className="w-7 h-7 rounded border border-gray-200 bg-white p-0.5" />
              <InlineText value={tag.name} label="Tag name" maxLength={40} className="flex-1 min-w-[10rem]" onCommit={rename(tag)} />
              <span className="text-xs text-gray-500 w-24 tabular-nums">{tag.contactCount ?? 0} contacts</span>
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <input type="checkbox" checked={tag.isSource} onChange={(e) => update.mutate({ id: tag.id, isSource: e.target.checked })} /> Lead source
              </label>
              <button type="button" aria-label={`Delete ${tag.name}`}
                onClick={() => { if (confirm(tag.contactCount ? `Remove "${tag.name}" from ${tag.contactCount} contacts and delete it?` : `Delete "${tag.name}"?`)) remove.mutate(tag.id); }}
                className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"><Trash2 size={14} /></button>
            </li>
          ))}
          {tags.length === 0 && <li className="py-3 text-sm text-gray-500">No tags yet.</li>}
        </ul>
      )}
      <form className="flex gap-2 mt-4" onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) create.mutate(form); }}>
        <input type="color" value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))} aria-label="New tag colour"
          className="w-10 h-10 rounded border border-gray-200 bg-white p-0.5" />
        <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="New tag" aria-label="New tag name" maxLength={40}
          className={`${control} flex-1`} />
        <Button type="submit" loading={create.isPending}><Plus size={14} className="mr-1" /> Add tag</Button>
      </form>
    </SectionCard>
  );
}

export default function FieldsSettings() {
  return (
    <div className="space-y-6 max-w-4xl">
      <FieldList entity="CONTACT" title="Contact fields" />
      <FieldList entity="DEAL" title="Deal fields" />
      <TagManager />
    </div>
  );
}
