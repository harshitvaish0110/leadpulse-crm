import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Plus, Trash2, ChevronLeft, ChevronRight, ChevronDown, List, CalendarDays } from 'lucide-react';
import { getTasks, createTask, completeTask, deleteTask } from '../api/tasks';
import { getDeals } from '../api/deals';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Avatar from '../components/ui/Avatar';
import SlideOver from '../components/ui/SlideOver';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import ContactPicker from '../components/contacts/ContactPicker';
import { TASK_PRIORITIES } from '../constants/crm';
import { formatDate, humanize } from '../lib/format';
import { TASK_GROUPS, groupTasks, monthGrid, sameDay } from '../lib/taskGroups';
import { qk } from '../hooks/queries/keys';
import { useDirectory } from '../hooks/queries/lookups';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { apiError } from '../lib/apiError';
import { useUrlFlag } from '../hooks/useUrlFlag';

const PRIORITY_VARIANT = { HIGH: 'red', MEDIUM: 'amber', LOW: 'gray' };
const PRIORITY_DOT = { HIGH: 'bg-red-500', MEDIUM: 'bg-amber-500', LOW: 'bg-gray-400' };
const FILTER_DEFAULTS = { view: 'mine', mode: 'list', priority: '' };
const control = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function AddTaskForm({ onClose, defaultDue }) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isPrivileged = ['ADMIN', 'MANAGER'].includes(user?.role);
  const { data: directory = [] } = useDirectory();
  const [contact, setContact] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', priority: 'MEDIUM', dueDate: defaultDue ?? '', dealId: '', assignedToId: user?.id ?? '' });
  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const dealParams = { view: 'list', contactId: contact?.id, limit: 100 };
  const { data: deals = [] } = useQuery({
    queryKey: qk.deals.list(dealParams),
    queryFn: () => getDeals(dealParams).then(r => r.data.deals),
    enabled: Boolean(contact),
  });

  const { mutate, isPending } = useMutation({
    mutationFn: createTask,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.tasks.all }); toast.success('Task created'); onClose(); },
    onError: err => toast.error(apiError(err, 'Failed to create task')),
  });

  const submit = (e) => {
    e.preventDefault();
    mutate({
      ...form,
      contactId: contact?.id, dealId: form.dealId || undefined,
      dueDate: form.dueDate ? new Date(`${form.dueDate}T09:00:00`).toISOString() : undefined,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Task title" required value={form.title} onChange={set('title')} />
      <div>
        <label htmlFor="task-description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea id="task-description" className={`${control} resize-none`} rows={3} value={form.description} onChange={set('description')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Due date" type="date" value={form.dueDate} onChange={set('dueDate')} />
        <div>
          <label htmlFor="task-priority" className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
          <select id="task-priority" className={control} value={form.priority} onChange={set('priority')}>
            {[...TASK_PRIORITIES].reverse().map(p => <option key={p} value={p}>{humanize(p)}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="task-contact" className="block text-sm font-medium text-gray-700 mb-1">Contact (optional)</label>
        <ContactPicker id="task-contact" value={contact} onChange={(c) => { setContact(c); setForm(p => ({ ...p, dealId: '' })); }} />
      </div>
      {contact && (
        <div>
          <label htmlFor="task-deal" className="block text-sm font-medium text-gray-700 mb-1">Deal (optional)</label>
          <select id="task-deal" className={control} value={form.dealId} onChange={set('dealId')}>
            <option value="">No deal</option>
            {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </div>
      )}
      {isPrivileged && (
        <div>
          <label htmlFor="task-assignee" className="block text-sm font-medium text-gray-700 mb-1">Assignee</label>
          <select id="task-assignee" className={control} value={form.assignedToId} onChange={set('assignedToId')}>
            {directory.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        </div>
      )}
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Create Task</Button>
      </div>
    </form>
  );
}

function TaskRow({ task, showAssignee, onToggle, onDelete }) {
  const overdue = !task.completed && task.dueDate && new Date(task.dueDate) < new Date();
  return (
    <li className={`bg-white rounded-xl border p-4 flex items-start gap-3 ${overdue ? 'border-red-200 bg-red-50/30' : 'border-gray-100'} ${task.completed ? 'opacity-60' : ''}`}>
      <input type="checkbox" className="mt-1 rounded" checked={task.completed} onChange={() => onToggle(task)}
        aria-label={`Mark "${task.title}" ${task.completed ? 'not done' : 'done'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-sm font-medium ${task.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{task.title}</p>
          <Badge variant={PRIORITY_VARIANT[task.priority]}>{humanize(task.priority)}</Badge>
        </div>
        {task.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{task.description}</p>}
        <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs">
          {task.dueDate && <span className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{formatDate(task.dueDate)}</span>}
          {task.contact && <Link to={`/contacts/${task.contact.id}`} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700">{task.contact.firstName} {task.contact.lastName}</Link>}
          {task.deal && <Link to={`/deals/${task.deal.id}`} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700">{task.deal.title}</Link>}
          {showAssignee && task.assignedTo && (
            <span className="inline-flex items-center gap-1 text-gray-500 ml-auto"><Avatar firstName={task.assignedTo.firstName} lastName={task.assignedTo.lastName} size="xs" /> {task.assignedTo.firstName}</span>
          )}
        </div>
      </div>
      <button onClick={() => onDelete(task)} aria-label={`Delete "${task.title}"`} className="p-1.5 text-gray-300 hover:text-red-600 rounded-lg hover:bg-red-50">
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function CalendarView({ tasks, month, setMonth, onPickDay, selected }) {
  const days = monthGrid(month);
  const today = new Date();
  const byDay = (d) => tasks.filter(t => t.dueDate && sameDay(new Date(t.dueDate), d));
  const label = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const shift = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => shift(-1)} aria-label="Previous month" className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronLeft size={16} /></button>
        <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
        <button onClick={() => shift(1)} aria-label="Next month" className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={label}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="text-xs font-semibold text-gray-400 py-1" role="columnheader">{d}</div>)}
        {days.map(d => {
          const items = byDay(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isSelected = selected && sameDay(d, selected);
          return (
            <button key={d.toISOString()} role="gridcell" onClick={() => onPickDay(d)} aria-selected={Boolean(isSelected)}
              aria-label={`${d.toDateString()}, ${items.length} task${items.length === 1 ? '' : 's'}`}
              className={`h-16 rounded-lg p-1 text-left flex flex-col transition-colors ${isSelected ? 'bg-indigo-50 ring-2 ring-indigo-300' : 'hover:bg-gray-50'} ${inMonth ? '' : 'opacity-40'}`}>
              <span className={`text-xs ${sameDay(d, today) ? 'bg-indigo-600 text-white rounded-full w-5 h-5 flex items-center justify-center' : 'text-gray-600'}`}>{d.getDate()}</span>
              <span className="flex flex-wrap gap-0.5 mt-1">
                {items.slice(0, 6).map(t => <span key={t.id} className={`w-1.5 h-1.5 rounded-full ${t.completed ? 'bg-gray-300' : PRIORITY_DOT[t.priority]}`} />)}
                {items.length > 6 && <span className="text-[10px] text-gray-400">+{items.length - 6}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Tasks() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isPrivileged = ['ADMIN', 'MANAGER'].includes(user?.role);
  const [filters, setFilters] = useUrlFilters(FILTER_DEFAULTS);
  const view = isPrivileged && filters.view === 'all' ? 'all' : 'mine';
  const calendar = filters.mode === 'calendar';
  const [showForm, setShowForm] = useUrlFlag('new');
  const [showCompleted, setShowCompleted] = useState(false);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [day, setDay] = useState(null);

  const base = { assignedToId: view === 'mine' ? user?.id : undefined, priority: filters.priority || undefined, limit: 100 };
  const openParams = { ...base, completed: 'false', sortBy: 'dueDate', sortDir: 'asc' };
  const doneParams = { ...base, completed: 'true', sortBy: 'dueDate', sortDir: 'desc', limit: 30 };
  const grid = monthGrid(month);
  const calParams = { ...base, dueFrom: grid[0].toISOString(), dueTo: new Date(grid[41].getTime() + 86_399_999).toISOString() };
  const keyOpen = qk.tasks.list({ ...openParams, view });
  const keyDone = qk.tasks.list({ ...doneParams, view });

  const { data: open = [], isLoading } = useQuery({ queryKey: keyOpen, queryFn: () => getTasks(openParams).then(r => r.data.tasks), enabled: !calendar });
  const { data: done = [] } = useQuery({ queryKey: keyDone, queryFn: () => getTasks(doneParams).then(r => r.data.tasks), enabled: !calendar && showCompleted });
  const { data: monthTasks = [] } = useQuery({
    queryKey: qk.tasks.list({ ...calParams, view }), queryFn: () => getTasks(calParams).then(r => r.data.tasks), enabled: calendar,
  });

  // Optimistic: the checkbox flips at once and the task moves between groups.
  const toggle = useMutation({
    mutationFn: (task) => completeTask(task.id, !task.completed),
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: qk.tasks.all });
      const snapshot = qc.getQueriesData({ queryKey: qk.tasks.all });
      qc.setQueriesData({ queryKey: qk.tasks.all }, (list) => (Array.isArray(list)
        ? list.map(t => (t.id === task.id ? { ...t, completed: !task.completed } : t))
        : list));
      return { snapshot };
    },
    onError: (_err, _task, ctx) => { ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)); toast.error('Could not update the task'); },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks.all }),
  });
  const remove = useMutation({
    mutationFn: (task) => deleteTask(task.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.tasks.all }); toast.success('Task deleted'); },
  });

  const rowProps = { showAssignee: view === 'all', onToggle: (t) => toggle.mutate(t), onDelete: (t) => { if (confirm('Delete this task?')) remove.mutate(t); } };
  const groups = groupTasks(open.filter(t => !t.completed));
  const dayTasks = day ? monthTasks.filter(t => t.dueDate && sameDay(new Date(t.dueDate), day)) : [];

  const tab = (key, label) => (
    <button key={key} role="tab" aria-selected={view === key} onClick={() => setFilters({ view: key })}
      className={`px-4 py-2 rounded-lg text-sm font-medium ${view === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1" role="tablist" aria-label="Whose tasks">
          {tab('mine', 'My Tasks')}
          {isPrivileged && tab('all', 'All Tasks')}
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Priority" value={filters.priority} onChange={e => setFilters({ priority: e.target.value })}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All priorities</option>
            {[...TASK_PRIORITIES].reverse().map(p => <option key={p} value={p}>{humanize(p)}</option>)}
          </select>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5" role="group" aria-label="Layout">
            <button onClick={() => setFilters({ mode: 'list' })} aria-pressed={!calendar}
              className={`px-2.5 py-1.5 rounded-md text-sm flex items-center gap-1 ${!calendar ? 'bg-indigo-600 text-white' : 'text-gray-500'}`}><List size={14} /> List</button>
            <button onClick={() => setFilters({ mode: 'calendar' })} aria-pressed={calendar}
              className={`px-2.5 py-1.5 rounded-md text-sm flex items-center gap-1 ${calendar ? 'bg-indigo-600 text-white' : 'text-gray-500'}`}><CalendarDays size={14} /> Calendar</button>
          </div>
        </div>
      </div>

      {calendar ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
          <CalendarView tasks={monthTasks} month={month} setMonth={(m) => { setMonth(m); setDay(null); }} selected={day} onPickDay={setDay} />
          <section className="space-y-2" aria-live="polite">
            <h3 className="text-sm font-semibold text-gray-700">{day ? formatDate(day, { weekday: 'long' }) : 'Pick a day'}</h3>
            {day && (dayTasks.length
              ? <ul className="space-y-2">{dayTasks.map(t => <TaskRow key={t.id} task={t} {...rowProps} />)}</ul>
              : <p className="text-sm text-gray-400">Nothing due this day.</p>)}
          </section>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : open.length === 0 && !showCompleted ? (
        <EmptyState icon={CheckSquare} title="You're all caught up" description="No open tasks. Add one with the + button." />
      ) : (
        <div className="space-y-6">
          {TASK_GROUPS.filter(g => groups[g.key].length).map(g => (
            <section key={g.key} aria-labelledby={`group-${g.key}`}>
              <h3 id={`group-${g.key}`} className={`text-xs font-semibold uppercase tracking-wider mb-2 ${g.key === 'overdue' ? 'text-red-600' : 'text-gray-500'}`}>
                {g.label} · {groups[g.key].length}
              </h3>
              <ul className="space-y-2">{groups[g.key].map(t => <TaskRow key={t.id} task={t} {...rowProps} />)}</ul>
            </section>
          ))}
          <section>
            <button onClick={() => setShowCompleted(v => !v)} aria-expanded={showCompleted}
              className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1 mb-2">
              {showCompleted ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Completed
            </button>
            {showCompleted && <ul className="space-y-2">{done.map(t => <TaskRow key={t.id} task={t} {...rowProps} />)}</ul>}
          </section>
        </div>
      )}

      {/* Floating quick-add */}
      <button onClick={() => setShowForm(true)} aria-label="Add task"
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 flex items-center justify-center z-40">
        <Plus size={24} />
      </button>

      <SlideOver isOpen={showForm} onClose={() => setShowForm(false)} title="New Task">
        {showForm && <AddTaskForm onClose={() => setShowForm(false)}
          defaultDue={calendar && day ? `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}` : ''} />}
      </SlideOver>
    </div>
  );
}
