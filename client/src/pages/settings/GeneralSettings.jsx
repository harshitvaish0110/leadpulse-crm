import { useState } from 'react';
import { Save, Plus, Trash2, GripVertical, Tag } from 'lucide-react';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import toast from 'react-hot-toast';

const DEFAULT_STAGES = [
  { id: '1', name: 'Lead' },
  { id: '2', name: 'Contacted' },
  { id: '3', name: 'Demo' },
  { id: '4', name: 'Proposal' },
  { id: '5', name: 'Negotiation' },
  { id: '6', name: 'Closed Won' },
  { id: '7', name: 'Closed Lost' },
];

function SectionCard({ title, description, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {description && <p className="text-sm text-gray-400 mt-0.5">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

export default function GeneralSettings() {
  const [company, setCompany] = useState({ name: 'LeadPulse Inc.', website: 'https://leadpulse.dev', timezone: 'Asia/Kolkata' });
  const [stages, setStages] = useState(DEFAULT_STAGES);
  const [newStage, setNewStage] = useState('');
  const [tags, setTags] = useState(['VIP', 'Enterprise', 'SMB', 'Startup', 'Partner']);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);

  const saveCompany = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 600));
    setSaving(false);
    toast.success('Settings saved');
  };

  const addStage = () => {
    if (!newStage.trim()) return;
    setStages(p => [...p, { id: Date.now().toString(), name: newStage.trim() }]);
    setNewStage('');
  };

  const removeStage = (id) => setStages(p => p.filter(s => s.id !== id));
  const updateStage = (id, name) => setStages(p => p.map(s => s.id === id ? { ...s, name } : s));

  const addTag = () => {
    if (!newTag.trim() || tags.includes(newTag.trim())) return;
    setTags(p => [...p, newTag.trim()]);
    setNewTag('');
  };
  const removeTag = (tag) => setTags(p => p.filter(t => t !== tag));

  const TIMEZONES = ['Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">General Settings</h2>
        <p className="text-sm text-gray-400">Configure your workspace and pipeline</p>
      </div>

      {/* Company Info */}
      <SectionCard title="Company Information" description="Basic details about your organization">
        <div className="space-y-4">
          <Input label="Company name" value={company.name} onChange={e => setCompany(p => ({ ...p, name: e.target.value }))} />
          <Input label="Website" value={company.website} onChange={e => setCompany(p => ({ ...p, website: e.target.value }))} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={company.timezone} onChange={e => setCompany(p => ({ ...p, timezone: e.target.value }))}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveCompany} loading={saving}>
              <Save size={14} className="mr-1.5" /> Save Settings
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Pipeline Stages */}
      <SectionCard title="Pipeline Stages" description="Customize your deal stages — drag to reorder">
        <div className="space-y-2 mb-4">
          {stages.map((stage, idx) => (
            <div key={stage.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl group">
              <GripVertical size={16} className="text-gray-300 cursor-grab flex-shrink-0" />
              <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                {idx + 1}
              </span>
              <input
                className="flex-1 bg-transparent text-sm text-gray-900 focus:outline-none"
                value={stage.name}
                onChange={e => updateStage(stage.id, e.target.value)}
              />
              <button onClick={() => removeStage(stage.id)}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-all">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            placeholder="New stage name…"
            value={newStage}
            onChange={e => setNewStage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addStage()}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <Button onClick={addStage} size="sm">
            <Plus size={14} className="mr-1" /> Add
          </Button>
        </div>
        <div className="flex justify-end mt-4">
          <Button onClick={() => toast.success('Pipeline stages saved')} variant="secondary">
            <Save size={14} className="mr-1.5" /> Save Stages
          </Button>
        </div>
      </SectionCard>

      {/* Tags Manager */}
      <SectionCard title="Tags" description="Manage contact and deal tags for your workspace">
        <div className="flex flex-wrap gap-2 mb-4 min-h-[40px]">
          {tags.map(tag => (
            <span key={tag} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium group">
              <Tag size={12} />
              {tag}
              <button onClick={() => removeTag(tag)}
                className="text-indigo-400 hover:text-red-500 transition-colors leading-none">×</button>
            </span>
          ))}
          {tags.length === 0 && <p className="text-sm text-gray-400">No tags yet</p>}
        </div>
        <div className="flex gap-2">
          <input
            placeholder="New tag…"
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTag()}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <Button onClick={addTag} size="sm">
            <Plus size={14} className="mr-1" /> Add Tag
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
