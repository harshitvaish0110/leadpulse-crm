/**
 * Display formatting. Probabilities from the API are always 0–1; only this
 * module turns them into percentages.
 */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** $950 · $12K · $1.2M (compact by default; `{ compact: false }` for full amounts). */
export function formatCurrency(value, { compact = true } = {}) {
  const n = Number(value) || 0;
  if (!compact) return usd.format(n);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return usd.format(n);
}

/** 0–1 probability → whole-number percentage (for widths, gauges, thresholds). */
export const toPercent = (probability) => Math.round(Math.min(1, Math.max(0, Number(probability) || 0)) * 100);

/** 0.456 → "46%". */
export const formatPercent = (probability) => `${toPercent(probability)}%`;

/** Tailwind colour for a win probability: green > 60 %, amber 30–60 %, red below. */
export function probabilityColor(probability) {
  const pct = toPercent(probability);
  return pct > 60 ? 'bg-green-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-400';
}

/**
 * Formats a date. Date-only values (e.g. expected close dates stored as midnight
 * UTC) pass `{ dateOnly: true }` so they never shift a day in western time zones.
 */
export function formatDate(value, { dateOnly = false, ...options } = {}) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    ...options,
    ...(dateOnly && { timeZone: 'UTC' }),
  });
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const STEPS = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];

/** "just now", "5 minutes ago", "yesterday", "2 weeks ago". */
export function timeAgo(value, now = Date.now()) {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const seconds = Math.round((t - now) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return 'just now';
}

/** "LEAD" → "Lead", "CLOSED_WON" → "Closed won". */
export function humanize(value) {
  if (!value) return '';
  const s = String(value).replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
