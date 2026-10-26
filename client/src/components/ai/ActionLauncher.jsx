import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Modal from '../ui/Modal';
import SlideOver from '../ui/SlideOver';
import Input from '../ui/Input';
import Button from '../ui/Button';
import EmailComposer from './EmailComposer';
import LogActivityModal from '../activities/LogActivityModal';
import { createTask } from '../../api/tasks';
import { TASK_PRIORITIES } from '../../constants/crm';
import { humanize } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';

const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

/** "YYYY-MM-DD" for tomorrow, in local time. */
function tomorrow() {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function TaskForm({ contactId, dealId, title: initialTitle, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: initialTitle, dueDate: tomorrow(), priority: 'MEDIUM' });
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const add = useMutation({
    mutationFn: () => createTask({ ...form, contactId, dealId, dueDate: new Date(`${form.dueDate}T09:00:00`).toISOString() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.tasks.all }); toast.success('Task added'); onClose(); },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not add the task'),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) add.mutate(); }} className="space-y-4">
      <Input label="Task" required value={form.title} onChange={set('title')} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Due" type="date" required value={form.dueDate} onChange={set('dueDate')} />
        <div>
          <label htmlFor="launcher-priority" className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
          <select id="launcher-priority" className={field} value={form.priority} onChange={set('priority')}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
          </select>
        </div>
      </div>
      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button type="submit" className="flex-1" loading={add.isPending}>Add task</Button>
      </div>
    </form>
  );
}

/**
 * Carries out a next-best-action recommendation: EMAIL opens the composer with the
 * action as its first point, CALL/MEETING the activity form with that type, TASK a
 * task due tomorrow. Render it once and pass the recommendation as `request`.
 */
export default function ActionLauncher({ request, onClose, contact, dealId, onEmailSaved }) {
  const kind = !request ? null : request.type === 'EMAIL' ? 'email' : request.type === 'TASK' ? 'task' : 'activity';
  return (
    <>
      <SlideOver isOpen={kind === 'email'} onClose={onClose} title="Compose with AI" width="sm:max-w-lg">
        {kind === 'email' && (
          <EmailComposer contactId={contact.id} dealId={dealId} initialBullets={[request.action]}
            onSaved={(email) => { onClose(); onEmailSaved?.(email); }} />
        )}
      </SlideOver>
      <LogActivityModal isOpen={kind === 'activity'} onClose={onClose} contact={contact} dealId={dealId}
        initial={kind === 'activity' ? { type: request.type, subject: request.action } : undefined} />
      <Modal isOpen={kind === 'task'} onClose={onClose} title="Add task" size="sm">
        {kind === 'task' && <TaskForm contactId={contact.id} dealId={dealId} title={request.action} onClose={onClose} />}
      </Modal>
    </>
  );
}
