import Badge from '../ui/Badge';
import { formatPercent, toPercent } from '../../lib/format';

const SCORE_VARIANT = { HOT: 'red', WARM: 'amber', COLD: 'blue' };
const SENTIMENT_VARIANT = { POSITIVE: 'green', NEUTRAL: 'gray', NEGATIVE: 'amber', AT_RISK: 'red' };

/** HOT / WARM / COLD with points out of 120; the explanation shows on hover. */
export function ScoreBadge({ label, score, explanation }) {
  if (!label) return <span className="text-gray-300">—</span>;
  return (
    <span title={explanation || `${score}/120 points`}>
      <Badge variant={SCORE_VARIANT[label] || 'gray'}>{label} · {score}</Badge>
    </span>
  );
}

/** Churn risk 0–1: green below 30 %, amber to 60 %, red above. */
export function ChurnBar({ value, showLabel = true }) {
  const pct = toPercent(value);
  const color = value > 0.6 ? 'bg-red-500' : value >= 0.3 ? 'bg-amber-500' : 'bg-green-500';
  const text = value > 0.6 ? 'text-red-600' : value >= 0.3 ? 'text-amber-600' : 'text-green-600';
  return (
    <div className="flex items-center gap-2 min-w-[90px]" title={`${formatPercent(value)} churn risk`}>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Churn risk">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && <span className={`text-xs font-medium ${text} w-9 text-right`}>{pct}%</span>}
    </div>
  );
}

/** Win probability 0–1: red below 30 %, amber to 60 %, green above. */
export function WinProbabilityBar({ value, showLabel = true }) {
  const pct = toPercent(value);
  const color = pct > 60 ? 'bg-green-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2" title={`${pct}% win probability`}>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Win probability">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>}
    </div>
  );
}

export function SentimentBadge({ value }) {
  if (!value) return null;
  return <Badge variant={SENTIMENT_VARIANT[value] || 'gray'}>{value.replace('_', ' ').toLowerCase()}</Badge>;
}
