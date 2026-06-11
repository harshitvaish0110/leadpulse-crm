import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell
} from 'recharts';
import {
  Users, TrendingUp, DollarSign, Target, PhoneCall,
  Mail, Calendar, MessageSquare, FileText, Activity, ArrowUpRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getRevenue, getPipeline, getWinLoss, getOverview } from '../api/analytics';
import { getContacts } from '../api/contacts';
import { getActivities } from '../api/activities';
import Skeleton from '../components/ui/Skeleton';
import Avatar from '../components/ui/Avatar';
import Badge from '../components/ui/Badge';

const STAGE_COLORS = {
  LEAD: '#6366f1', CONTACTED: '#8b5cf6', DEMO: '#a78bfa',
  PROPOSAL: '#f59e0b', NEGOTIATION: '#f97316',
  CLOSED_WON: '#10b981', CLOSED_LOST: '#ef4444',
};

const ACTIVITY_ICONS = {
  CALL: PhoneCall, EMAIL: Mail, MEETING: Calendar,
  NOTE: FileText, TRANSCRIPT: MessageSquare,
};

function MetricCard({ icon: Icon, label, value, sub, color = 'indigo', loading }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600',
    green:  'bg-green-50 text-green-600',
    amber:  'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{label}</p>
          {loading ? (
            <Skeleton className="h-9 w-28 mt-2" />
          ) : (
            <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
          )}
          {sub && !loading && (
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
          )}
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}

function formatCurrency(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

const CustomAreaTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-lg px-4 py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-base font-bold text-gray-900">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();

  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => getOverview().then(r => r.data),
  });
  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ['analytics', 'revenue'],
    queryFn: () => getRevenue().then(r => r.data),
  });
  const { data: pipelineData, isLoading: pipelineLoading } = useQuery({
    queryKey: ['analytics', 'pipeline'],
    queryFn: () => getPipeline().then(r => r.data),
  });
  const { data: winLossData } = useQuery({
    queryKey: ['analytics', 'win-loss'],
    queryFn: () => getWinLoss().then(r => r.data),
  });
  const { data: activitiesData, isLoading: activitiesLoading } = useQuery({
    queryKey: ['activities', 'recent'],
    queryFn: () => getActivities({ limit: 15 }).then(r => r.data),
  });
  const { data: atRiskData, isLoading: atRiskLoading } = useQuery({
    queryKey: ['contacts', 'at-risk'],
    queryFn: () => getContacts({ limit: 5, churnRisk: 'high' }).then(r => r.data),
  });

  const stats = overviewData?.stats || {};
  const chartData = (revenueData?.historical || []).map(m => ({
    month: new Date(m.ds).toLocaleString('default', { month: 'short' }),
    revenue: m.y,
  }));
  const pipelineChartData = (pipelineData?.stages || [])
    .filter(s => !['CLOSED_WON', 'CLOSED_LOST'].includes(s.stage))
    .map(s => ({ name: s.stage, count: s.count, value: s.totalValue }));

  return (
    <div className="space-y-6">

      {/* ── KPI Cards ────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          icon={Users} label="Total Contacts" color="indigo"
          value={stats.totalContacts?.toLocaleString() ?? '–'}
          sub={`+${stats.newContacts30d ?? 0} this month`}
          loading={overviewLoading}
        />
        <MetricCard
          icon={TrendingUp} label="Open Deals" color="purple"
          value={stats.openDeals?.toLocaleString() ?? '–'}
          sub={`of ${stats.totalDeals ?? 0} total`}
          loading={overviewLoading}
        />
        <MetricCard
          icon={DollarSign} label="Revenue (30d)" color="green"
          value={stats.revenue30d != null ? formatCurrency(stats.revenue30d) : '–'}
          sub="Closed won this month"
          loading={overviewLoading}
        />
        <MetricCard
          icon={Target} label="Win Rate" color="amber"
          value={winLossData ? `${winLossData.winRate}%` : '–'}
          sub={`${winLossData?.won ?? 0} won / ${winLossData?.lost ?? 0} lost`}
          loading={!winLossData}
        />
      </div>

      {/* ── Charts Row ────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">

        {/* Revenue Area Chart — 60% */}
        <div className="xl:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Revenue Trend</h2>
              <p className="text-sm text-gray-400">Last 12 months</p>
            </div>
            {revenueData && (
              <span className="text-sm font-medium text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
                {formatCurrency(revenueData.totalRevenue)} total
              </span>
            )}
          </div>
          {revenueLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                <Tooltip content={<CustomAreaTooltip />} />
                <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2.5} fill="url(#revenueGrad)" dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Pipeline Health — 40% */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Pipeline Health</h2>
          <p className="text-sm text-gray-400 mb-6">Active deals by stage</p>
          {pipelineLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pipelineChartData} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={(v) => [v, 'Deals']} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {pipelineChartData.map((entry, i) => (
                    <Cell key={i} fill={STAGE_COLORS[entry.name] || '#6366f1'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Bottom Row: At-Risk + Activity Feed ─────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">

        {/* At-Risk Contacts */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">At-Risk Contacts</h2>
          {atRiskLoading ? (
            <Skeleton lines={5} />
          ) : atRiskData?.contacts?.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No high-risk contacts 🎉</p>
          ) : (
            <div className="space-y-3">
              {(atRiskData?.contacts || []).map(c => {
                const risk = c.churnRisk ?? 0;
                const riskColor = risk > 0.6 ? 'red' : risk > 0.3 ? 'amber' : 'green';
                const riskPct = `${(risk * 100).toFixed(0)}%`;
                return (
                  <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/contacts/${c.id}`)}>
                    <Avatar firstName={c.firstName} lastName={c.lastName} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.firstName} {c.lastName}</p>
                      <p className="text-xs text-gray-400 truncate">{c.company?.name || c.email}</p>
                    </div>
                    <Badge variant={riskColor}>{riskPct} risk</Badge>
                    <ArrowUpRight size={14} className="text-gray-300 flex-shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <div className="xl:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Recent Activity</h2>
          {activitiesLoading ? (
            <Skeleton lines={8} />
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
              {(activitiesData?.activities || []).map((a, idx) => {
                const Icon = ACTIVITY_ICONS[a.type] || Activity;
                const timeAgo = new Date(a.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return (
                  <div key={a.id} className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
                    <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon size={14} className="text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700">
                        <span className="font-medium text-gray-900 cursor-pointer hover:text-indigo-600"
                          onClick={() => navigate(`/contacts/${a.contactId}`)}>
                          {a.contact?.firstName} {a.contact?.lastName}
                        </span>
                        {' · '}
                        <span className="text-gray-500 capitalize">{a.type.toLowerCase()}</span>
                        {a.subject ? ` — ${a.subject}` : ''}
                      </p>
                      {a.notes && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{a.notes}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{timeAgo}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
