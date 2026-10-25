import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { DollarSign, TrendingUp, Target, Award } from 'lucide-react';
import api from '../api/axiosInstance';
import Skeleton from '../components/ui/Skeleton';
import ErrorBoundary from '../components/ErrorBoundary';
import RevenueForecastChart from '../components/charts/RevenueForecastChart';
import { formatCurrency, formatDate, formatPercent, humanize } from '../lib/format';
import { qk } from '../hooks/queries/keys';
import { useAuthStore } from '../store/authStore';

const RANGES = [['30d', 'Last 30 days', 30], ['90d', 'Last 90 days', 90], ['6mo', 'Last 6 months', 182], ['1yr', 'Last 12 months', 365]];
const FUNNEL_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#f59e0b', '#f97316', '#10b981'];
const day = (d) => d.toISOString().slice(0, 10);

/** `range` from the URL → { from, to } as UTC days. Custom ranges look like "custom:2026-01-01,2026-03-31". */
function resolveRange(range) {
  if (range?.startsWith('custom:')) {
    const [from, to] = range.slice(7).split(',');
    if (from && to) return { from, to };
  }
  const days = (RANGES.find(([key]) => key === range) ?? RANGES[3])[2];
  const now = new Date();
  return { from: day(new Date(now.getTime() - days * 86_400_000)), to: day(now) };
}

function useReport(name, range) {
  return useQuery({
    queryKey: qk.analytics.report(name, range),
    queryFn: () => api.get(`/api/analytics/${name}`, { params: range }).then((r) => r.data),
  });
}

function StatCard({ label, value, sub, icon: Icon, color = 'indigo' }) {
  const bg = { indigo: 'bg-indigo-50 text-indigo-600', green: 'bg-green-50 text-green-600', amber: 'bg-amber-50 text-amber-600', purple: 'bg-purple-50 text-purple-600' };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${bg[color]}`}><Icon size={18} /></div>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

const Panel = ({ title, sub, loading, children, className = '' }) => (
  <section className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-6 ${className}`}>
    <h2 className="text-base font-semibold text-gray-900">{title}</h2>
    <p className="text-sm text-gray-400 mb-4">{sub}</p>
    {loading ? <Skeleton className="h-56 w-full" /> : children}
  </section>
);

export default function Analytics() {
  const [params, setParams] = useSearchParams();
  const rangeKey = params.get('range') || '1yr';
  const range = resolveRange(rangeKey);
  const isPrivileged = useAuthStore((s) => ['ADMIN', 'MANAGER'].includes(s.user?.role));
  const setRange = (value) => setParams(value === '1yr' ? {} : { range: value }, { replace: true });
  const custom = rangeKey.startsWith('custom:');
  const rangeLabel = `${formatDate(`${range.from}T00:00:00Z`, { dateOnly: true })} – ${formatDate(`${range.to}T00:00:00Z`, { dateOnly: true })}`;

  const revenue = useReport('revenue', range);
  const pipeline = useReport('pipeline', {});
  const winLoss = useReport('win-loss', range);
  const reps = useReport('rep-performance', range);
  const sentiment = useReport('sentiment-trends', range);
  const funnel = useReport('funnel', range);
  const sources = useReport('lead-sources', range);

  const winPie = winLoss.data ? [
    { name: 'Won', value: winLoss.data.won, fill: '#10b981' },
    { name: 'Lost', value: winLoss.data.lost, fill: '#ef4444' },
  ] : [];
  const lostReasons = Object.entries(winLoss.data?.lostReasons || {}).sort((a, b) => b[1] - a[1]);
  const funnelData = (funnel.data?.baseStages || []).map((s) => ({ name: humanize(s.baseStage), count: s.count }));
  const sentimentData = (sentiment.data?.trends || []).map((t) => ({ week: t.week, avg: t.avgScore, count: t.count }));
  const repData = (reps.data?.reps || []).map((r) => ({ name: `${r.user.firstName} ${r.user.lastName[0]}.`, revenue: r.revenue, won: r.wonDeals }));
  const sourceData = (sources.data?.sources || []).filter((s) => s.count > 0);

  return (
    <div className="space-y-6">
      {/* Date range (applies to every report) */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-gray-500">{rangeLabel}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1" role="group" aria-label="Date range">
            {RANGES.map(([key, label]) => (
              <button key={key} onClick={() => setRange(key)} aria-pressed={rangeKey === key}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${rangeKey === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                {label.replace('Last ', '')}
              </button>
            ))}
          </div>
          <label className="text-xs text-gray-500 flex items-center gap-1">From
            <input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange(`custom:${e.target.value},${range.to}`)}
              className={`text-sm border rounded-lg px-2 py-1.5 ${custom ? 'border-indigo-400' : 'border-gray-300'}`} />
          </label>
          <label className="text-xs text-gray-500 flex items-center gap-1">to
            <input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange(`custom:${range.from},${e.target.value}`)}
              className={`text-sm border rounded-lg px-2 py-1.5 ${custom ? 'border-indigo-400' : 'border-gray-300'}`} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Revenue" color="green" value={revenue.data ? formatCurrency(revenue.data.totalRevenue) : '–'}
          sub={revenue.data ? `Avg ${formatCurrency(revenue.data.avgMonthly)} / month` : ''} />
        <StatCard icon={TrendingUp} label="Open pipeline" color="indigo" value={pipeline.data ? formatCurrency(pipeline.data.totalPipelineValue) : '–'} sub="All open deals today" />
        <StatCard icon={Target} label="Win rate" color="amber" value={winLoss.data ? formatPercent(winLoss.data.winRate) : '–'}
          sub={winLoss.data ? `${winLoss.data.won} won / ${winLoss.data.lost} lost` : ''} />
        <StatCard icon={Award} label="Deals created" color="purple" value={funnel.data ? funnel.data.total.toLocaleString() : '–'} sub="Entered the funnel in this range" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ErrorBoundary compact>
          <Panel title="Revenue" sub="Won deals per month, with a 3-month forecast" loading={revenue.isLoading} className="xl:col-span-2">
            <RevenueForecastChart historical={revenue.data?.historical} forecast={revenue.data?.forecast} height={260} />
          </Panel>
        </ErrorBoundary>
        <ErrorBoundary compact>
          <Panel title="Win / loss" sub="Deals closed in this range" loading={winLoss.isLoading}>
            {winLoss.data?.total ? (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={winPie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={65} paddingAngle={2}>
                      {winPie.map((d) => <Cell key={d.name} fill={d.fill} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="mt-3 space-y-1">
                  {lostReasons.map(([reason, count]) => (
                    <li key={reason} className="flex justify-between text-xs text-gray-600"><span>{reason}</span><span className="font-medium">{count}</span></li>
                  ))}
                </ul>
              </>
            ) : <p className="text-sm text-gray-400 text-center py-12">No deals closed in this range</p>}
          </Panel>
        </ErrorBoundary>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ErrorBoundary compact>
          <Panel title="Pipeline funnel" sub="Of the deals created in this range, how many reached each stage" loading={funnel.isLoading}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={funnelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={36} />
                <Tooltip formatter={(v) => [v, 'Deals']} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>{funnelData.map((_, i) => <Cell key={i} fill={FUNNEL_COLORS[i]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </ErrorBoundary>
        <ErrorBoundary compact>
          <Panel title="Rep performance" sub={isPrivileged ? 'Revenue and deals won per rep' : 'Your revenue and deals won'} loading={reps.isLoading}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={repData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="revenue" tickFormatter={(v) => formatCurrency(v)} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={56} />
                <YAxis yAxisId="won" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={30} />
                <Tooltip formatter={(v, n) => (n === 'Revenue' ? [formatCurrency(v), n] : [v, n])} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="revenue" dataKey="revenue" name="Revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="won" dataKey="won" name="Deals won" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </ErrorBoundary>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ErrorBoundary compact>
          <Panel title="Sentiment trend" sub="Average sentiment of scored activities per week (0–1)" loading={sentiment.isLoading} className="xl:col-span-2">
            {sentimentData.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={sentimentData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="week" tickFormatter={(w) => formatDate(`${w}T00:00:00Z`, { dateOnly: true, year: undefined })} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip labelFormatter={(w) => `Week of ${formatDate(`${w}T00:00:00Z`, { dateOnly: true })}`}
                    formatter={(v, n, p) => [`${v.toFixed(2)} (${p.payload.count} activities)`, 'Average']} />
                  <Line type="monotone" dataKey="avg" stroke="#8b5cf6" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-gray-400 text-center py-12">No scored activities in this range</p>}
          </Panel>
        </ErrorBoundary>
        <ErrorBoundary compact>
          <Panel title="Lead sources" sub="New contacts by source tag" loading={sources.isLoading}>
            {sourceData.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={sourceData} dataKey="count" nameKey="tag" outerRadius={80} label={({ tag }) => tag}>
                    {sourceData.map((s, i) => <Cell key={s.tag} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [v, 'Contacts']} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-gray-400 text-center py-12">No new contacts with a source tag</p>}
          </Panel>
        </ErrorBoundary>
      </div>

      <ErrorBoundary compact>
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <h2 className="text-base font-semibold text-gray-900 px-6 pt-5">Pipeline by stage</h2>
          <p className="text-sm text-gray-400 px-6 mb-3">Today's snapshot; weighted value = sum of deal value × win probability</p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-y border-gray-100">
                  {['Stage', 'Deals', 'Total value', 'Weighted value', 'Avg win probability'].map((h) => (
                    <th key={h} scope="col" className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(pipeline.data?.stages || []).map((s) => (
                  <tr key={s.stage} className="even:bg-gray-50/50">
                    <td className="px-6 py-3 text-sm font-medium text-gray-900">{humanize(s.stage)}</td>
                    <td className="px-6 py-3 text-sm text-gray-600">{s.count}</td>
                    <td className="px-6 py-3 text-sm text-gray-600">{formatCurrency(s.totalValue)}</td>
                    <td className="px-6 py-3 text-sm text-gray-600">{formatCurrency(s.weightedValue)}</td>
                    <td className="px-6 py-3 text-sm text-gray-600">{formatPercent(s.avgWinProb)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </ErrorBoundary>
    </div>
  );
}
