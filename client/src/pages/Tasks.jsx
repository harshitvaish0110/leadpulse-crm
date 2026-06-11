import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Plus, Calendar, Trash2, Check, Clock, AlertCircle } from 'lucide-react';
import { getTasks, createTask, completeTask, deleteTask } from '../api/tasks';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import SlideOver from '../components/ui/SlideOver';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import toast from 'react-hot-toast';

const PRIORITY_VARIANT = { HIGH: 'red', MEDIUM: 'amber', LOW: 'gray' };
const PRIORITY_ICON = { HIGH: AlertCircle, MEDIUM: Clock, LOW: CheckSquare };

function AddTaskForm({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: '', description: '', priority: 'MEDIUM', dueDate: '' });
  const { mutate, isPending } = useMutation({
    mutationFn: createTask,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); toast.success('Task created'); onClose(); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to create task'),
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <form onSubmit={e => { e.preventDefault(); mutate(form); }} className="space-y-4">
      <Input label="Task title" required value={form.title} onChange={e => set('title', e.target.value)} />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
        <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.priority} onChange={e => set('priority', e.target.value)}>
          {['HIGH','MEDIUM','LOW'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <Input label="Due date" type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" loading={isPending} className="flex-1">Create Task</Button>
      </div>
    </form>
  );
}

export default function Tasks() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('active'); // active | completed | overdue
  const [priority, setPriority] = useState('');

  const queryParams = {
    completed: filter === 'completed' ? 'true' : filter === 'active' ? 'false' : undefined,
    priority: priority || undefined,
    limit: 50,
  };
  if (filter === 'overdue') {
    queryParams.completed = 'false';
    queryParams.dueTo = new Date().toISOString();
  }

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', filter, priority],
    queryFn: () => getTasks(queryParams).then(r => r.data),
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, completed }) => completeTask(id, completed),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); toast.success('Task deleted'); },
  });

  const tasks = data?.tasks || [];

  const isOverdue = (task) => task.dueDate && new Date(task.dueDate) < new Date() && !task.completed;

  const FILTERS = [
    { key: 'active', label: 'Active' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'completed', label: 'Completed' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Tasks</h2>
          <p className="text-sm text-gray-400">{data?.meta?.total ?? 0} tasks</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" /> New Task
        </Button>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                ${filter === f.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <select value={priority} onChange={e => setPriority(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
          <option value="">All priorities</option>
          {['HIGH','MEDIUM','LOW'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Tasks List */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)
        ) : tasks.length === 0 ? (
          <EmptyState icon={CheckSquare} title="No tasks found" description="Create a task to stay on top of your work"
            actionLabel="New Task" onAction={() => setShowForm(true)} />
        ) : tasks.map(task => {
          const Icon = PRIORITY_ICON[task.priority] || CheckSquare;
          const overdue = isOverdue(task);
          return (
            <div key={task.id} className={`bg-white rounded-xl border shadow-sm p-4 flex items-start gap-4 group transition-all
              ${task.completed ? 'opacity-60 border-gray-100' : overdue ? 'border-red-200 bg-red-50/30' : 'border-gray-100 hover:shadow-md'}`}>
              <button
                onClick={() => completeMutation.mutate({ id: task.id, completed: !task.completed })}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all
                  ${task.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-indigo-500'}`}>
                {task.completed && <Check size={12} className="text-white" />}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <p className={`text-sm font-medium ${task.completed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                    {task.title}
                  </p>
                  <Badge variant={PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
                  {overdue && <Badge variant="red">Overdue</Badge>}
                </div>
                {task.description && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{task.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5">
                  {task.contact && (
                    <span className="text-xs text-gray-400">{task.contact.firstName} {task.contact.lastName}</span>
                  )}
                  {task.deal && (
                    <span className="text-xs text-indigo-500">{task.deal.title}</span>
                  )}
                  {task.dueDate && (
                    <span className={`flex items-center gap-1 text-xs ${overdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                      <Calendar size={11} />
                      {new Date(task.dueDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              <button onClick={() => deleteMutation.mutate(task.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition-all">
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <SlideOver isOpen={showForm} onClose={() => setShowForm(false)} title="New Task">
        <AddTaskForm onClose={() => setShowForm(false)} />
      </SlideOver>
    </div>
  );
}
