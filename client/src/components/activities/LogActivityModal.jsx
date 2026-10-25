import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { createActivity } from '../../api/activities';
import ContactPicker from '../contacts/ContactPicker';
import { getDeals } from '../../api/deals';
import { LOGGABLE_ACTIVITY_TYPES } from '../../constants/crm';
import { humanize } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';

const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

/** "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
const toLocalInput = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function LogActivityForm({ contact: fixedContact, dealId: fixedDealId, onClose }) {
  const qc = useQueryClient();
  const [contact, setContact] = useState(fixedContact ?? null);
  const [form, setForm] = useState({
    type: 'CALL', subject: '', notes: '', durationMinutes: '',
    dealId: fixedDealId ?? '', occurredAt: toLocalInput(new Date()),
  });
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const dealParams = { view: 'list', contactId: contact?.id, limit: 100 };
  const { data: deals = [] } = useQuery({
    queryKey: qk.deals.list(dealParams),
    queryFn: () => getDeals(dealParams).then((r) => r.data.deals),
    enabled: Boolean(contact?.id) && !fixedDealId,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: createActivity,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.activities.all });
      qc.invalidateQueries({ queryKey: qk.contacts.all });
      qc.invalidateQueries({ queryKey: qk.deals.all });
      toast.success('Activity logged');
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.details?.[0]?.msg || err.response?.data?.error || 'Failed to log activity'),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!contact) { toast.error('Choose a contact'); return; }
    mutate({
      type: form.type,
      subject: form.subject || undefined,
      notes: form.notes || undefined,
      contactId: contact.id,
      dealId: form.dealId || undefined,
      occurredAt: new Date(form.occurredAt).toISOString(),
      durationMinutes: ['CALL', 'MEETING'].includes(form.type) && form.durationMinutes ? Number(form.durationMinutes) : undefined,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="activity-type" className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select id="activity-type" className={field} value={form.type} onChange={set('type')}>
            {LOGGABLE_ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
          </select>
        </div>
        <Input label="When" type="datetime-local" required value={form.occurredAt} onChange={set('occurredAt')} />
      </div>

      {!fixedContact && (
        <div>
          <label htmlFor="activity-contact" className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
          <ContactPicker id="activity-contact" value={contact} onChange={(c) => { setContact(c); setForm((p) => ({ ...p, dealId: '' })); }} />
        </div>
      )}

      {!fixedDealId && contact && (
        <div>
          <label htmlFor="activity-deal" className="block text-sm font-medium text-gray-700 mb-1">Deal (optional)</label>
          <select id="activity-deal" className={field} value={form.dealId} onChange={set('dealId')}>
            <option value="">No deal</option>
            {deals.map((d) => <option key={d.id} value={d.id}>{d.title} · {humanize(d.stage)}</option>)}
          </select>
        </div>
      )}

      <div className={['CALL', 'MEETING'].includes(form.type) ? 'grid grid-cols-3 gap-4' : ''}>
        <Input label="Subject" value={form.subject} onChange={set('subject')} className={['CALL', 'MEETING'].includes(form.type) ? 'col-span-2' : ''} />
        {['CALL', 'MEETING'].includes(form.type) && (
          <Input label="Minutes" type="number" min="0" max="1440" value={form.durationMinutes} onChange={set('durationMinutes')} />
        )}
      </div>

      <div>
        <label htmlFor="activity-notes" className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea id="activity-notes" className={`${field} resize-none`} rows={4} value={form.notes} onChange={set('notes')}
          placeholder="What happened? Notes are scored for sentiment." />
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Log Activity</Button>
      </div>
    </form>
  );
}

/**
 * Log an activity. Pass `contact` ({ id, name }) to fix the contact, and
 * `dealId` to fix the deal; otherwise the form asks for them.
 */
export default function LogActivityModal({ isOpen, onClose, contact, dealId }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Log Activity">
      {/* Remounts per opening, so the form always starts fresh. */}
      {isOpen && <LogActivityForm contact={contact} dealId={dealId} onClose={onClose} />}
    </Modal>
  );
}
