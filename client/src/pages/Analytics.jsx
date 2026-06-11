import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, PieChart, Pie, Legend } from 'recharts';
import { TrendingUp, DollarSign, Target, Award } from 'lucide-react';
import { getRevenue, getPipeline, getWinLoss, getRepPerformance, getSentimentTrends } from '../api/analytics';
import Skeleton from '../components/ui/Skeleton';
import Avatar from '../components/ui/Avatar';
import Badge from '../components/ui/Badge';

const STAGE_COLORS = {
  LEAD: '#6366f1', CONTACTED: '#8b5cf6', DEMO: '#a78bfa',
  PROPOSAL: '#f59e0b', NEGOTIATION: '#f97316',
  CLOSED_WON: '#10b981', CLOSED_LOST: '#ef4444',
};

function StatCard({ label, value, sub, color = 'indigo', icon: Icon }) {
  const bg = { indigo: 'bg-indigo-50 text-indigo-600', green: 'bg-green-50 text-green-600', amber: 'bg-amber-50 text-amber-600', purple: 'bg-purple-50 text-purple-600' };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${bg[color]}`}>
          <Icon size={18} />
        </div>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function formatCurrency(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n || 0}`;
}

const SentimentTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-3">
      <p className="text-xs text-gray-500 mb-1">Week of {label}</p>
      <p className="text-sm font-bold text-gray-900">Avg: {payload[0].value.toFixed(2)}</p>
      <p className="text-xs text-gray-400">{payload[1]?.value} interactions</p>
    </div>
  );
};

export default function Analytics() {
  const [activeTab, setActiveTab] = useState('overview');

  const { data: revenueData, isLoading: rl } = useQuery({ queryKey: ['analytics','revenue'], queryFn: () => getRevenue().then(r => r.data) });
  const { data: pipelineData, isLoading: pl } = useQuery({ queryKey: ['analytics','pipeline'], queryFn: () => getPipeline().then(r => r.data) });
  const { data: winLossData, isLoading: wl } = useQuery({ queryKey: ['analytics','win-loss'], queryFn: () => getWinLoss().then(r => r.data) });
  const { data: repsData, isLoading: repsL } = useQuery({ queryKey: ['analytics','reps'], queryFn: () => getRepPerformance().then(r => r.data) });
  const { data: sentimentData } = useQuery({ queryKey: ['analytics','sentiment'], queryFn: () => getSentimentTrends().then(r => r.data) });

  const chartData = (revenueData?.historical || []).map(m => ({
    month: new Date(m.ds).toLocaleString('default', { month: 'short' }), revenue: m.y,
  }));

  const pipelineStages = (pipelineData?.stages || []).map(s => ({
    name: s.stage.replace('_', ' '), count: s.count, value: s.totalValue,
  }));

  const sentimentChart = (sentimentData?.trends || []).map(t => ({
    week: t.week.slice(5), avg: t.avgScore, count: t.count,
  }));

  const pieData = winLossData ? [
    { name: 'Won', value: winLossData.won, fill: '#10b981' },
    { name: 'Lost', value: winLossData.lost, fill: '#ef4444' },
  ] : [];

  const TABS = ['overview', 'pipeline', 'team', 'sentiment'];

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize
              ${activeTab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stats Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard icon={DollarSign} label="Total Revenue" color="green"
              value={revenueData ? formatCurrency(revenueData.totalRevenue) : '–'}
              sub={`Avg ${formatCurrency(revenueData?.avgMonthly ?? 0)}/mo`} />
            <StatCard icon={TrendingUp} label="Pipeline Value" color="indigo"
              value={pipelineData ? formatCurrency(pipelineData.totalPipelineValue) : '–'}
              sub="All active deals" />
            <StatCard icon={Target} label="Win Rate" color="amber"
              value={winLossData ? `${winLossData.winRate}%` : '–'}
              sub={`${winLossData?.won ?? 0} won / ${winLossData?.lost ?? 0} lost`} />
            <StatCard icon={Award} label="Avg Monthly Rev" color="purple"
              value={revenueData ? formatCurrency(revenueData.avgMonthly) : '–'}
              sub="12-month average" />
          </div>

          {/* Revenue + Win/Loss */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-1">Monthly Revenue</h2>
              <p className="text-sm text-gray-400 mb-5">Closed-won deals last 12 months</p>
              {rl ? <Skeleton className="h-52 w-full" /> : (
                <ResponsiveContainer width="100%" height={208}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="revGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v) => [formatCurrency(v), 'Revenue']} />
                    <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#revGrad2)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-1">Win / Loss</h2>
              <p className="text-sm text-gray-400 mb-5">Last 12 months</p>
              {wl ? <Skeleton className="h-52 w-full" /> : (
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={pieData} innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                        {pieData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex gap-6 mt-2">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-green-600">{winLossData?.won}</p>
                      <p className="text-xs text-gray-400">Won</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-gray-900">{winLossData?.winRate}%</p>
                      <p className="text-xs text-gray-400">Win Rate</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-red-500">{winLossData?.lost}</p>
                      <p className="text-xs text-gray-400">Lost</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PIPELINE TAB */}
      {activeTab === 'pipeline' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-5">Pipeline by Stage</h2>
            {pl ? <Skeleton className="h-72 w-full" /> : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={pipelineStages}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v, n) => [n === 'count' ? v : formatCurrency(v), n === 'count' ? 'Deals' : 'Value']} />
                  <Bar dataKey="count" name="count" radius={[4,4,0,0]}>
                    {pipelineStages.map((e, i) => <Cell key={i} fill={STAGE_COLORS[e.name.replace(' ','_')] || '#6366f1'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Stage breakdown table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-gray-100">
                {['Stage','Deals','Total Value','Weighted Value','Avg Win Prob'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3 uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {(pipelineData?.stages || []).map(s => (
                  <tr key={s.stage} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <span className="text-sm font-medium text-gray-800">{s.stage.replace('_',' ')}</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">{s.count}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{formatCurrency(s.totalValue)}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{formatCurrency(s.weightedValue)}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{s.avgWinProb}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TEAM TAB */}
      {activeTab === 'team' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">Rep Performance</h2>
            <p className="text-sm text-gray-400">Last 12 months</p>
          </div>
          {repsL ? <div className="p-6"><Skeleton lines={6} /></div> : (
            <table className="w-full">
              <thead><tr className="border-b border-gray-100">
                {['Rep','Won Deals','Revenue','Open Deals','Contacts','Activities'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3 uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {(repsData?.reps || []).map((r, i) => (
                  <tr key={r.user.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {i === 0 && <span className="text-amber-500">🥇</span>}
                        {i === 1 && <span>🥈</span>}
                        {i === 2 && <span>🥉</span>}
                        <Avatar firstName={r.user.firstName} lastName={r.user.lastName} size="sm" />
                        <span className="text-sm font-medium text-gray-900">{r.user.firstName} {r.user.lastName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3"><Badge variant="green">{r.wonDeals}</Badge></td>
                    <td className="px-5 py-3 text-sm font-medium text-gray-900">{formatCurrency(r.revenue)}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{r.openDeals}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{r.contacts}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{r.activities}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* SENTIMENT TAB */}
      {activeTab === 'sentiment' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Sentiment Trends</h2>
            <p className="text-sm text-gray-400 mb-5">Weekly average sentiment score (ML-powered)</p>
            {sentimentChart.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-12">No sentiment data yet — log notes and activities to build trends</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={sentimentChart}>
                  <defs>
                    <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[-1, 1]} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SentimentTooltip />} />
                  <Area type="monotone" dataKey="avg" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#sentGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
