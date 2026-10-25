import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../api/axiosInstance';
import Skeleton from '../ui/Skeleton';
import { formatDate, formatPercent } from '../../lib/format';
import { qk } from '../../hooks/queries/keys';

const CHARTS = [
  { metric: 'leadScore', title: 'Lead score', domain: [0, 120], color: '#6366f1', step: true, format: (v) => `${Math.round(v)}` },
  { metric: 'churnRisk', title: 'Churn risk', domain: [0, 1], color: '#ef4444', format: formatPercent },
  { metric: 'sentimentScore', title: 'Sentiment', domain: [0, 1], color: '#10b981', format: (v) => v.toFixed(2) },
];

function MetricChart({ contactId, metric, title, domain, color, step, format, days }) {
  const { data, isLoading } = useQuery({
    queryKey: [...qk.contacts.detail(contactId), 'snapshots', metric, days],
    queryFn: () => api.get(`/api/contacts/${contactId}/snapshots`, { params: { metric, days } }).then((r) => r.data.points),
  });
  const points = (data || []).map((p) => ({ t: new Date(p.takenAt).getTime(), value: p.value }));

  return (
    <figure className="bg-white rounded-xl border border-gray-100 p-4">
      <figcaption className="text-sm font-semibold text-gray-700 mb-3">{title} · last {days} days</figcaption>
      {isLoading ? <Skeleton className="h-40 w-full" /> : points.length < 2 ? (
        <p className="text-sm text-gray-400 py-12 text-center">Not enough history yet</p>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickFormatter={(t) => formatDate(t, { year: undefined })} axisLine={false} tickLine={false} />
            <YAxis domain={domain} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={format} axisLine={false} tickLine={false} width={40} />
            <Tooltip labelFormatter={(t) => formatDate(t)} formatter={(v) => [format(v), title]} />
            <Line type={step ? 'stepAfter' : 'monotone'} dataKey="value" stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </figure>
  );
}

/** Score, churn and sentiment history for a contact. */
export default function ContactInsights({ contactId, days = 90 }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {CHARTS.map((c) => <MetricChart key={c.metric} contactId={contactId} days={days} {...c} />)}
    </div>
  );
}
