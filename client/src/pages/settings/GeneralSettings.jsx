import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axiosInstance';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Skeleton from '../../components/ui/Skeleton';
import SectionCard from './SectionCard';
import { useWorkspace } from '../../hooks/queries/lookups';
import { qk } from '../../hooks/queries/keys';
import { apiError } from '../../lib/apiError';

const control = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const TIMEZONES = Intl.supportedValuesOf('timeZone');
const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' });
const CURRENCIES = Intl.supportedValuesOf('currency').map((code) => ({ code, name: currencyNames.of(code) }));

function WorkspaceForm({ workspace }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(workspace);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: (data) => api.patch('/api/settings/workspace', data).then((r) => r.data.workspace),
    onSuccess: (saved) => { qc.setQueryData(qk.settings.workspace, saved); toast.success('Workspace saved'); },
    onError: (err) => toast.error(apiError(err, 'Could not save the workspace')),
  });
  const timezones = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(form); }} className="space-y-4">
      <Input label="Workspace name" required maxLength={80} value={form.companyName} onChange={set('companyName')} />
      <div>
        <label htmlFor="ws-timezone" className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
        <select id="ws-timezone" className={control} value={form.timezone} onChange={set('timezone')}>
          {timezones.map((tz) => <option key={tz} value={tz}>{tz.replaceAll('_', ' ')}</option>)}
        </select>
        <p className="text-xs text-gray-500 mt-1">Nightly scoring, churn and forecasts run on this timezone's clock.</p>
      </div>
      <div>
        <label htmlFor="ws-currency" className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
        <select id="ws-currency" className={control} value={form.currency} onChange={set('currency')}>
          {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
        </select>
        <p className="text-xs text-gray-500 mt-1">Deal values are shown in this currency, and AI-written emails and summaries use it too. Amounts are not converted.</p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}><Save size={14} className="mr-1.5" /> Save</Button>
      </div>
    </form>
  );
}

export default function GeneralSettings() {
  const { data: workspace, isLoading } = useWorkspace();
  return (
    <div className="space-y-6 max-w-3xl">
      <SectionCard title="Workspace" description="Your organisation's name, timezone and currency">
        {isLoading || !workspace ? <Skeleton lines={3} /> : <WorkspaceForm key={JSON.stringify(workspace)} workspace={workspace} />}
      </SectionCard>
    </div>
  );
}
