import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarClock, Hourglass, RefreshCw, Sparkles, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axiosInstance';
import { completeTask } from '../api/tasks';
import Badge from '../components/ui/Badge';
import Skeleton from '../components/ui/Skeleton';
import { qk } from '../hooks/queries/keys';
import { useAuthStore } from '../store/authStore';
import { apiError } from '../lib/apiError';
import { formatCurrency, formatDate, formatPercent, humanize, timeAgo } from '../lib/format';

const PRIORITY_VARIANT = { HIGH: 'red', MEDIUM: 'amber', LOW: 'gray' };
const URGENCY_VARIANT = { HIGH: 'red', MEDIUM: 'amber', LOW: 'green' };

const Card = ({ title, icon: Icon, action, children }) => (
  <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
    <div className="flex items-center justify-between gap-2 mb-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">{Icon && <Icon size={15} className="text-gray-400" aria-hidden="true" />}{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

const Empty = ({ children }) => <p className="text-sm text-gray-400 py-3">{children}</p>;

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Briefing({ briefing }) {
  const qc = useQueryClient();
  const write = useMutation({
    mutationFn: () => api.post('/api/ai/briefing').then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData(qk.myDay, (day) => day && { ...day, briefing: data.briefing });
      if (!data.briefing) toast(data.reason);
    },
    onError: (err) => toast.error(apiError(err, 'The briefing could not be written right now')),
  });
  return (
    <section className="rounded-2xl p-5 bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm" aria-live="polite">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} aria-hidden="true" /> Today's briefing</h2>
        <button type="button" onClick={() => write.mutate()} disabled={write.isPending}
          className="inline-flex items-center gap-1.5 text-xs text-indigo-100 hover:text-white disabled:opacity-60">
          <RefreshCw size={12} className={write.isPending ? 'animate-spin' : ''} aria-hidden="true" />
          {write.isPending ? 'Writing…' : briefing ? 'Rewrite' : 'Write it now'}
        </button>
      </div>
      {briefing ? (
        <>
          <p className="text-sm leading-relaxed">{briefing.content}</p>
          <p className="text-[11px] text-indigo-200 mt-2">Written by AI {timeAgo(briefing.createdAt)} from your tasks, deals and accounts.</p>
        </>
      ) : (
        <p className="text-sm text-indigo-100">No briefing yet today. It is written overnight; you can also write it now.</p>
      )}
    </section>
  );
}

function TaskRow({ task, tone }) {
  const qc = useQueryClient();
  const done = useMutation({
    mutationFn: () => completeTask(task.id, true),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.myDay }); qc.invalidateQueries({ queryKey: qk.tasks.all }); toast.success('Task completed'); },
    onError: (err) => toast.error(apiError(err, 'Could not complete the task')),
  });
  return (
    <li className="flex items-start gap-3 py-2">
      <input type="checkbox" className="mt-1" aria-label={`Complete "${task.title}"`} disabled={done.isPending} onChange={() => done.mutate()} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900">{task.title}</p>
        <p className="text-xs text-gray-400">
          <span className={tone}>{formatDate(task.dueDate, { month: 'short', day: 'numeric' })}</span>
          {task.contact && <> · <Link to={`/contacts/${task.contact.id}`} className="hover:text-indigo-600">{task.contact.name}</Link></>}
          {task.deal && <> · <Link to={`/deals/${task.deal.id}`} className="hover:text-indigo-600">{task.deal.title}</Link></>}
        </p>
      </div>
      {task.priority === 'HIGH' && <Badge variant={PRIORITY_VARIANT.HIGH}>High</Badge>}
    </li>
  );
}

function TasksCard({ tasks }) {
  const groups = [
    ['Overdue', tasks.overdue, 'text-red-600 font-medium'],
    ['Today', tasks.today, 'text-indigo-600 font-medium'],
    ['Next 7 days', tasks.upcoming, ''],
  ].filter(([, list]) => list.length);
  return (
    <Card title="Tasks" icon={CalendarClock} action={<Link to="/tasks" className="text-xs text-indigo-600 hover:text-indigo-700">All tasks</Link>}>
      {groups.length === 0 ? <Empty>Nothing due this week.</Empty> : groups.map(([label, list, tone]) => (
        <div key={label} className="mb-2 last:mb-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label} · {list.length}</h3>
          <ul className="divide-y divide-gray-50">{list.map((t) => <TaskRow key={t.id} task={t} tone={tone} />)}</ul>
        </div>
      ))}
    </Card>
  );
}

function DealList({ deals, detail }) {
  return (
    <ul className="divide-y divide-gray-50">
      {deals.map((d) => (
        <li key={d.id}>
          <Link to={`/deals/${d.id}`} className="flex items-center gap-3 py-2 group">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-900 truncate group-hover:text-indigo-600">{d.title}</p>
              <p className="text-xs text-gray-400 truncate">{d.contact.name} · {d.stage} · {detail(d)}</p>
            </div>
            <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(d.value)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function MyDay() {
  const firstName = useAuthStore((s) => s.user?.firstName);
  // staleTime 0: tasks completed or deals moved elsewhere should show as soon as the page opens.
  const { data: day, isLoading } = useQuery({ queryKey: qk.myDay, queryFn: () => api.get('/api/my-day').then((r) => r.data.day), staleTime: 0 });

  if (isLoading || !day) {
    return <div className="max-w-6xl mx-auto space-y-4"><Skeleton className="h-24 w-full rounded-2xl" /><Skeleton className="h-64 w-full rounded-2xl" /></div>;
  }

  const { tasks, pipeline } = day;
  const chips = [
    tasks.overdue.length && `${tasks.overdue.length} overdue`,
    tasks.today.length && `${tasks.today.length} due today`,
    day.closing.length && `${day.closing.length} closing in 2 weeks`,
    `${pipeline.count} open deals · ${formatCurrency(pipeline.value)} (${formatCurrency(pipeline.weighted)} weighted)`,
  ].filter(Boolean);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">{greeting()}, {firstName}</h1>
        <p className="text-sm text-gray-500">{formatDate(`${day.date}T00:00:00Z`, { weekday: 'long', month: 'long', day: 'numeric', year: undefined, dateOnly: true })}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {chips.map((c) => <span key={c} className="text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1">{c}</span>)}
        </div>
      </header>

      <Briefing briefing={day.briefing} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <TasksCard tasks={tasks} />

        <Card title="Next best actions" icon={Zap}>
          {day.nextActions.length === 0 ? <Empty>No recommendations yet; they are refreshed overnight.</Empty> : (
            <ul className="divide-y divide-gray-50">
              {day.nextActions.map(({ contact, recommendation }) => (
                <li key={contact.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900">{recommendation.action}</p>
                    <p className="text-xs text-gray-400">{contact.name}{contact.company ? ` · ${contact.company}` : ''}</p>
                  </div>
                  <Badge variant={URGENCY_VARIANT[recommendation.urgency] || 'gray'}>{humanize(recommendation.urgency)}</Badge>
                  <Link to={`/contacts/${contact.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 whitespace-nowrap">
                    Do it <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Closing in the next 2 weeks" icon={CalendarClock}>
          {day.closing.length === 0 ? <Empty>No deals expected to close soon.</Empty>
            : <DealList deals={day.closing} detail={(d) => `closes ${formatDate(d.expectedCloseDate, { month: 'short', day: 'numeric', dateOnly: true })} · ${formatPercent(d.winProbability)} likely`} />}
        </Card>

        <Card title="Stalled deals" icon={Hourglass}>
          {day.stalled.length === 0 ? <Empty>Every open deal has moved in the last two weeks.</Empty>
            : <DealList deals={day.stalled} detail={(d) => `${d.daysInStage} days in stage`} />}
        </Card>

        <Card title="Accounts at risk" icon={AlertTriangle}>
          {day.atRisk.length === 0 ? <Empty>No accounts at risk.</Empty> : (
            <ul className="divide-y divide-gray-50">
              {day.atRisk.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.company ?? 'No company'} · sentiment {c.sentimentScore.toFixed(2)}</p>
                  </div>
                  <Badge variant="red">{formatPercent(c.churnRisk)} churn</Badge>
                  <Link to={`/contacts/${c.id}?log=1`}
                    className="text-xs font-medium text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 whitespace-nowrap">Log a call</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
