import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency, formatDate } from '../../lib/format';

const monthLabel = (ds) => formatDate(ds, { dateOnly: true, day: undefined, year: '2-digit' });

/**
 * Monthly actuals (solid area) plus the forecast (dashed line with a shaded
 * confidence band). The forecast service may return daily points; only those on
 * the first of a month are used so the series lines up with the monthly actuals.
 */
export default function RevenueForecastChart({ historical = [], forecast = [], height = 240 }) {
  const actual = historical.map((m) => ({ ds: m.ds, actual: m.y }));
  const ahead = forecast
    .filter((f) => f.ds.endsWith('-01') && f.ds > (historical.at(-1)?.ds ?? ''))
    .slice(0, 3)
    .map((f) => ({ ds: f.ds, forecast: Math.max(0, Math.round(f.yhat)), band: [Math.max(0, Math.round(f.yhat_lower)), Math.round(f.yhat_upper)] }));

  // Join the forecast to the last actual month so the lines connect.
  if (ahead.length && actual.length) {
    const last = actual.at(-1);
    actual[actual.length - 1] = { ...last, forecast: last.actual, band: [last.actual, last.actual] };
  }
  const data = [...actual, ...ahead];

  if (!data.length) return <p className="text-sm text-gray-400 text-center py-16">No revenue in this period yet</p>;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data}>
        <defs>
          <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.18} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="ds" tickFormatter={monthLabel} tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => formatCurrency(v)} tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          labelFormatter={monthLabel}
          formatter={(value, name) => (name === 'Confidence range'
            ? [`${formatCurrency(value[0])} – ${formatCurrency(value[1])}`, name]
            : [formatCurrency(value), name])}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="actual" name="Revenue" stroke="#6366f1" strokeWidth={2.5} fill="url(#revenueGrad)" dot={false} connectNulls={false} />
        {ahead.length > 0 && <Area type="monotone" dataKey="band" name="Confidence range" stroke="none" fill="#a5b4fc" fillOpacity={0.25} />}
        {ahead.length > 0 && <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#6366f1" strokeDasharray="6 4" strokeWidth={2} dot={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
