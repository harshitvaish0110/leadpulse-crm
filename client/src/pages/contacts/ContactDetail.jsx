import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Mail, Phone, Building2, Calendar, TrendingUp,
  Edit2, Trash2, Plus, PhoneCall, MessageSquare, FileText
} from 'lucide-react';
import { getContact, updateContact, deleteContact } from '../../api/contacts';
import { getActivities, createActivity } from '../../api/activities';
import { getTasks, createTask } from '../../api/tasks';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Avatar from '../../components/ui/Avatar';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Skeleton from '../../components/ui/Skeleton';
import toast from 'react-hot-toast';

const LEAD_SCORE_VARIANT = { HOT: 'red', WARM: 'amber', COLD: 'blue', NEW: 'gray' };
const ACTIVITY_ICONS = { CALL: PhoneCall, EMAIL: Mail, MEETING: Calendar, NOTE: FileText, TRANSCRIPT: MessageSquare };

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <Icon size={15} className="text-gray-400 mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm text-gray-800 font-medium">{value}</p>
      </div>
    </div>
  );
}

function AddActivityModal({ contactId, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ type: 'CALL', subject: '', notes: '' });
  const { mutate, isPending } = useMutation({
    mutationFn: createActivity,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities', contactId] });
      toast.success('Activity logged');
      onClose();
    },
    onError: () => toast.error('Failed to log activity'),
  });
  return (
    <form onSubmit={e => { e.preventDefault(); mutate({ ...form, contactId }); }} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
        <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
          {['CALL','EMAIL','MEETING','NOTE'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <Input label="Subject" value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          rows={4} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
      </div>
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Log Activity</Button>
      </div>
    </form>
  );
}

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showActivity, setShowActivity] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const { data: contactData, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => getContact(id).then(r => r.data),
    onSuccess: (d) => !editForm && setEditForm(d.contact),
  });
  const { data: activitiesData } = useQuery({
    queryKey: ['activities', id],
    queryFn: () => getActivities({ contactId: id, limit: 20 }).then(r => r.data),
  });
  const { data: tasksData } = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => getTasks({ contactId: id, completed: 'false' }).then(r => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: (data) => updateContact(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', id] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Contact updated'); setEditing(false);
    },
    onError: () => toast.error('Update failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteContact(id),
    onSuccess: () => { toast.success('Contact deleted'); navigate('/contacts'); },
    onError: () => toast.error('Delete failed'),
  });

  const contact = contactData?.contact;

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!contact) return <div className="text-center py-20 text-gray-400">Contact not found</div>;

  const risk = contact.churnRisk ?? 0;
  const riskColor = risk > 0.6 ? 'red' : risk > 0.3 ? 'amber' : 'green';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Back nav */}
      <button onClick={() => navigate('/contacts')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft size={16} /> Back to Contacts
      </button>

      {/* Profile Header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Avatar firstName={contact.firstName} lastName={contact.lastName} size="lg" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{contact.firstName} {contact.lastName}</h1>
              <p className="text-sm text-gray-500">{contact.title}{contact.company ? ` at ${contact.company.name}` : ''}</p>
              <div className="flex items-center gap-2 mt-2">
                {contact.leadScore && <Badge variant={LEAD_SCORE_VARIANT[contact.leadScore]}>{contact.leadScore}</Badge>}
                <Badge variant={riskColor}>{(risk * 100).toFixed(0)}% churn risk</Badge>
                <Badge variant="gray">{contact.status}</Badge>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Edit2 size={14} className="mr-1.5" /> Edit
            </Button>
            <Button variant="danger" size="sm" onClick={() => { if (confirm('Delete this contact?')) deleteMutation.mutate(); }}>
              <Trash2 size={14} className="mr-1.5" /> Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Left: Info Panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Contact Info</h2>
            <InfoRow icon={Mail} label="Email" value={contact.email} />
            <InfoRow icon={Phone} label="Phone" value={contact.phone} />
            <InfoRow icon={Building2} label="Company" value={contact.company?.name} />
            <InfoRow icon={Calendar} label="Member since" value={new Date(contact.createdAt).toLocaleDateString()} />
            {contact.sentimentScore != null && (
              <InfoRow icon={TrendingUp} label="Avg Sentiment" value={`${contact.sentimentScore.toFixed(2)} / 1.0`} />
            )}
          </div>

          {/* Open Tasks */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Open Tasks</h2>
              <span className="text-xs text-gray-400">{tasksData?.meta?.total ?? 0}</span>
            </div>
            {(tasksData?.tasks || []).length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No open tasks</p>
            ) : (
              <div className="space-y-2">
                {(tasksData?.tasks || []).slice(0, 5).map(t => (
                  <div key={t.id} className="flex items-start gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${t.priority === 'HIGH' ? 'bg-red-500' : t.priority === 'MEDIUM' ? 'bg-amber-500' : 'bg-gray-300'}`} />
                    <div>
                      <p className="text-sm text-gray-700">{t.title}</p>
                      {t.dueDate && <p className="text-xs text-gray-400">{new Date(t.dueDate).toLocaleDateString()}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Activity Timeline */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Activity Timeline</h2>
            <Button size="sm" onClick={() => setShowActivity(true)}>
              <Plus size={14} className="mr-1.5" /> Log Activity
            </Button>
          </div>
          {(activitiesData?.activities || []).length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No activities yet — log a call, email, or meeting</p>
          ) : (
            <div className="relative space-y-0">
              <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-100" />
              {(activitiesData?.activities || []).map(a => {
                const Icon = ACTIVITY_ICONS[a.type] || PhoneCall;
                const sentiment = a.sentiment;
                const sentimentColor = sentiment === 'POSITIVE' ? 'text-green-600' : sentiment === 'NEGATIVE' ? 'text-red-500' : 'text-gray-400';
                return (
                  <div key={a.id} className="flex gap-4 pb-6 relative">
                    <div className="w-8 h-8 bg-white border-2 border-gray-100 rounded-full flex items-center justify-center flex-shrink-0 z-10">
                      <Icon size={14} className="text-indigo-500" />
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-800">{a.subject || a.type}</span>
                        {a.sentiment && (
                          <span className={`text-xs ${sentimentColor}`}>{a.sentiment.toLowerCase()}</span>
                        )}
                        <span className="text-xs text-gray-400 ml-auto">
                          {new Date(a.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      {a.notes && <p className="text-sm text-gray-500">{a.notes}</p>}
                      {a.durationMinutes && (
                        <p className="text-xs text-gray-400 mt-0.5">{a.durationMinutes} min</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Log Activity Modal */}
      <Modal isOpen={showActivity} onClose={() => setShowActivity(false)} title="Log Activity">
        <AddActivityModal contactId={id} onClose={() => setShowActivity(false)} />
      </Modal>

      {/* Edit Modal */}
      {editForm && (
        <Modal isOpen={editing} onClose={() => setEditing(false)} title="Edit Contact" size="lg">
          <form onSubmit={e => { e.preventDefault(); updateMutation.mutate(editForm); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="First name" value={editForm.firstName || ''} onChange={e => setEditForm(p => ({ ...p, firstName: e.target.value }))} />
              <Input label="Last name" value={editForm.lastName || ''} onChange={e => setEditForm(p => ({ ...p, lastName: e.target.value }))} />
              <Input label="Email" type="email" value={editForm.email || ''} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} />
              <Input label="Phone" type="tel" value={editForm.phone || ''} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} />
              <Input label="Title" value={editForm.title || ''} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={() => setEditing(false)} className="flex-1">Cancel</Button>
              <Button type="submit" loading={updateMutation.isPending} className="flex-1">Save Changes</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
