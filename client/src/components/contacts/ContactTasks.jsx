import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Plus } from 'lucide-react';
import { getTasks, createTask, completeTask } from '../../api/tasks';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { TASK_PRIORITIES } from '../../constants/crm';
import { formatDate, humanize } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';
import toast from 'react-hot-toast';

const PRIORITY_VARIANT = { HIGH: 'red', MEDIUM: 'amber', LOW: 'gray' };
const field = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

/** A contact's tasks with an inline quick-add form. `dealId` links new tasks to a deal too. */
export default function ContactTasks({ contactId, dealId }) {
  const qc = useQueryClient();
  const params = { contactId, ...(dealId && { dealId }), limit: 100, sortBy: 'dueDate', sortDir: 'asc' };
  const [form, setForm] = useState({ title: '', dueDate: '', priority: 'MEDIUM' });

  const { data: tasks = [] } = useQuery({
    queryKey: qk.tasks.list(params),
    queryFn: () => getTasks(params).then((r) => r.data.tasks),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: qk.tasks.all });

  const add = useMutation({
    mutationFn: createTask,
    onSuccess: () => { refresh(); setForm({ title: '', dueDate: '', priority: 'MEDIUM' }); },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not add the task'),
  });
  const toggle = useMutation({
    mutationFn: ({ id, completed }) => completeTask(id, completed),
    onSuccess: refresh,
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    add.mutate({ ...form, contactId, dealId, dueDate: form.dueDate ? new Date(`${form.dueDate}T09:00:00`).toISOString() : undefined });
  };

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex gap-2 flex-wrap items-end">
        <label className="flex-1 min-w-[200px]">
          <span className="sr-only">New task</span>
          <input className={`${field} w-full`} placeholder="Add a task…" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
        </label>
        <label>
          <span className="sr-only">Due date</span>
          <input type="date" className={field} value={form.dueDate} onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))} />
        </label>
        <label>
          <span className="sr-only">Priority</span>
          <select className={field} value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
          </select>
        </label>
        <Button type="submit" size="sm" loading={add.isPending} disabled={!form.title.trim()}><Plus size={13} className="mr-1" /> Add</Button>
      </form>

      {tasks.length === 0 ? (
        <EmptyState icon={CheckSquare} title="No tasks" description="Add a follow-up so nothing slips." />
      ) : (
        <ul className="divide-y divide-gray-50">
          {[...open, ...done].map((t) => {
            const overdue = !t.completed && t.dueDate && new Date(t.dueDate) < new Date();
            return (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <input type="checkbox" className="rounded" checked={t.completed} aria-label={`Mark "${t.title}" ${t.completed ? 'not done' : 'done'}`}
                  onChange={() => toggle.mutate({ id: t.id, completed: !t.completed })} />
                <span className={`flex-1 text-sm ${t.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>{t.title}</span>
                {t.dueDate && <span className={`text-xs ${overdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{formatDate(t.dueDate)}</span>}
                <Badge variant={PRIORITY_VARIANT[t.priority]}>{humanize(t.priority)}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
