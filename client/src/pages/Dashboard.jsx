import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Users, TrendingUp, DollarSign, Target, Zap, ArrowRight } from 'lucide-react';
import { getRevenue, getPipeline, getOverview, getAtRisk } from '../api/analytics';
import { getActivities } from '../api/activities';
import api from '../api/axiosInstance';
import Skeleton from '../components/ui/Skeleton';
import Avatar from '../components/ui/Avatar';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import ErrorBoundary from '../components/ErrorBoundary';
import ActivityTimeline from '../components/activities/ActivityTimeline';
import RevenueForecastChart from '../components/charts/RevenueForecastChart';
import { formatCurrency, formatPercent, humanize } from '../lib/format';
import { qk } from '../hooks/queries/keys';

const STAGE_COLORS = {
  LEAD: '#6366f1', CONTACTED: '#8b5cf6', DEMO: '#a78bfa', PROPOSAL: '#f59e0b', NEGOTIATION: '#f97316',
};
const URGENCY_VARIANT = { HIGH: 'red', MEDIUM: 'amber', LOW: 'green' };

function MetricCard({ icon: Icon, label, value, sub, color = 'indigo', loading }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600', green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600', purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{label}</p>
          {loading ? <Skeleton className="h-9 w-28 mt-2" /> : <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>}
          {sub && !loading && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}><Icon size={22} /></div>
      </div>
    </div>
  );
}

const Card = ({ title, sub, children, className = '' }) => (
  <section className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-6 ${className}`}>
    <h2 className="text-base font-semibold text-gray-900">{title}</h2>
    {sub && <p className="text-sm text-gray-400 mb-4">{sub}</p>}
    {!sub && <div className="mb-4" />}
    {children}
  </section>
);

function RevenueCard() {
  const { data, isLoading } = useQuery({ queryKey: qk.analytics.report('revenue'), queryFn: () => getRevenue().then(r => r.data) });
  return (
    <Card title="Revenue" sub="Last 12 months, with a 3-month forecast" className="xl:col-span-3">
      {isLoading ? <Skeleton className="h-56 w-full" /> : <RevenueForecastChart historical={data?.historical} forecast={data?.forecast} />}
    </Card>
  );
}

function PipelineCard() {
  const { data, isLoading } = useQuery({ queryKey: qk.analytics.report('pipeline'), queryFn: () => getPipeline().then(r => r.data) });
  const rows = (data?.stages || []).filter(s => STAGE_COLORS[s.stage]).map(s => ({ stage: s.stage, name: humanize(s.stage), count: s.count, value: s.totalValue }));
  return (
    <Card title="Pipeline health" sub={data ? `${formatCurrency(data.totalPipelineValue)} in open deals` : 'Open deals by stage'} className="xl:col-span-2">
      {isLoading ? <Skeleton className="h-56 w-full" /> : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} layout="vertical" barSize={14}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={86} />
            <Tooltip formatter={(v, n, p) => [n === 'count' ? `${v} deals · ${formatCurrency(p.payload.value)}` : v, 'Open']} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>{rows.map(r => <Cell key={r.stage} fill={STAGE_COLORS[r.stage]} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function AtRiskCard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: qk.analytics.report('at-risk', { limit: 5 }), queryFn: () => getAtRisk({ limit: 5 }).then(r => r.data) });
  const contacts = data?.contacts || [];
  return (
    <Card title="At-risk contacts" sub={data?.total ? `${data.total} contacts with churn risk above 60% or sentiment below 0.3` : 'Churn risk above 60% or sentiment below 0.3'}>
      {isLoading ? <Skeleton className="h-40 w-full" /> : contacts.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No at-risk contacts right now</p>
      ) : (
        <ul className="space-y-2">
          {contacts.map(c => (
            <li key={c.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50">
              <Avatar firstName={c.firstName} lastName={c.lastName} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{c.firstName} {c.lastName}</p>
                <p className="text-xs text-gray-400 truncate">{c.company?.name || c.email}</p>
              </div>
              <Badge variant={c.churnRisk > 0.6 ? 'red' : 'amber'}>{formatPercent(c.churnRisk)} churn</Badge>
              <Button size="sm" variant="secondary" onClick={() => navigate(`/contacts/${c.id}`)}>Take action</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NextActionsCard() {
  const { data = [], isLoading } = useQuery({
    queryKey: qk.analytics.report('next-actions', { limit: 5 }),
    queryFn: () => api.get('/api/analytics/next-actions', { params: { limit: 5 } }).then(r => r.data.items),
  });
  return (
    <Card title="Top next best actions" sub="AI recommendations for your highest-value contacts">
      {isLoading ? <Skeleton className="h-40 w-full" /> : data.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No recommendations yet. Open a contact and generate one.</p>
      ) : (
        <ul className="space-y-2">
          {data.map(({ contact, recommendation }) => (
            <li key={contact.id} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-gray-50">
              <Zap size={16} className="text-indigo-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">{recommendation?.action}</p>
                <p className="text-xs text-gray-400">{contact.name}{contact.company ? ` · ${contact.company.name}` : ''}</p>
              </div>
              {recommendation?.urgency && <Badge variant={URGENCY_VARIANT[recommendation.urgency] || 'gray'}>{humanize(recommendation.urgency)}</Badge>}
              <Link to={`/contacts/${contact.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 whitespace-nowrap">
                Do it <ArrowRight size={12} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityFeedCard() {
  const params = { limit: 20 };
  // Refreshed live: socket activity events invalidate the activity queries.
  const { data, isLoading } = useQuery({ queryKey: qk.activities.list(params), queryFn: () => getActivities(params).then(r => r.data.activities) });
  return (
    <Card title="Recent activity" sub="The latest 20, updated live" className="xl:col-span-2">
      {isLoading ? <Skeleton className="h-64 w-full" /> : (data || []).length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No activity yet</p>
      ) : (
        <div className="max-h-[28rem] overflow-y-auto pr-1"><ActivityTimeline activities={data} showContact /></div>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { data: overview, isLoading } = useQuery({ queryKey: qk.analytics.report('overview'), queryFn: () => getOverview().then(r => r.data.stats) });
  const s = overview || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard icon={Users} label="Total contacts" color="indigo" loading={isLoading}
          value={s.totalContacts?.toLocaleString() ?? '–'} sub={`+${s.newContactsThisMonth ?? 0} this month`} />
        <MetricCard icon={TrendingUp} label="Open deals" color="purple" loading={isLoading}
          value={s.openDeals?.toLocaleString() ?? '–'} sub={`of ${s.totalDeals ?? 0} total`} />
        <MetricCard icon={DollarSign} label="Revenue this month" color="green" loading={isLoading}
          value={s.revenueThisMonth != null ? formatCurrency(s.revenueThisMonth) : '–'} sub="Deals won since the 1st" />
        <MetricCard icon={Target} label="Win rate" color="amber" loading={isLoading}
          value={s.winRate != null ? formatPercent(s.winRate) : '–'} sub={`${s.won ?? 0} won / ${s.lost ?? 0} lost · last 12 months`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <ErrorBoundary compact title="Revenue could not be shown"><RevenueCard /></ErrorBoundary>
        <ErrorBoundary compact title="Pipeline health could not be shown"><PipelineCard /></ErrorBoundary>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="space-y-4">
          <ErrorBoundary compact><AtRiskCard /></ErrorBoundary>
          <ErrorBoundary compact><NextActionsCard /></ErrorBoundary>
        </div>
        <ErrorBoundary compact><ActivityFeedCard /></ErrorBoundary>
      </div>
    </div>
  );
}
