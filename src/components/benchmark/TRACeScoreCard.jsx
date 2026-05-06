import { cn } from '@/lib/utils';

const TRACE_METRICS = [
  {
    key: 'context_relevance',
    label: 'Context Relevance',
    abbr: 'CR',
    description: 'How relevant is retrieved context to the query',
    color: 'blue',
  },
  {
    key: 'utilization',
    label: 'Utilization',
    abbr: 'U',
    description: 'How well the response uses the retrieved context',
    color: 'purple',
  },
  {
    key: 'faithfulness',
    label: 'Faithfulness',
    abbr: 'F',
    description: 'How grounded the response is — no hallucinations',
    color: 'emerald',
  },
  {
    key: 'completeness',
    label: 'Completeness',
    abbr: 'C',
    description: 'How completely the response addresses the query',
    color: 'amber',
  },
];

const COLOR_MAP = {
  blue: { bar: 'bg-blue-500', text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  purple: { bar: 'bg-purple-500', text: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
  emerald: { bar: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  amber: { bar: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
};

function ScoreBar({ value, color }) {
  const pct = value != null ? Math.round((value / 10) * 100) : 0;
  const c = COLOR_MAP[color];
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', c.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('text-xs font-bold w-8 text-right', c.text)}>
        {value != null ? value.toFixed(1) : '—'}
      </span>
    </div>
  );
}

export default function TRACeScoreCard({ ragLabel, ragColor, metrics }) {
  // metrics: { context_relevance, utilization, faithfulness, completeness, avg_latency, count }
  const composite = metrics && (
    metrics.context_relevance != null &&
    metrics.utilization != null &&
    metrics.faithfulness != null &&
    metrics.completeness != null
  )
    ? ((metrics.context_relevance + metrics.utilization + metrics.faithfulness + metrics.completeness) / 4).toFixed(1)
    : null;

  return (
    <div className="bg-card border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-2.5 h-2.5 rounded-full', ragColor)} />
          <span className="font-semibold text-sm text-foreground">{ragLabel}</span>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-foreground">{composite ?? '—'}</p>
          <p className="text-xs text-muted-foreground">/ 10 composite</p>
        </div>
      </div>

      <div className="space-y-2.5">
        {TRACE_METRICS.map(m => (
          <div key={m.key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{m.label}</span>
              <span className="text-xs font-medium text-muted-foreground">{m.abbr}</span>
            </div>
            <ScoreBar value={metrics?.[m.key] ?? null} color={m.color} />
          </div>
        ))}
      </div>

      <div className="pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
        <span>{metrics?.count ?? 0} queries</span>
        <span>{metrics?.avg_latency != null ? `${metrics.avg_latency}ms avg` : '—'}</span>
      </div>
    </div>
  );
}