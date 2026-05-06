import { cn } from '@/lib/utils';
import { Trophy, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';

function ScoreBadge({ score }) {
  const val = typeof score === 'number' ? score : parseFloat(score);
  const color = val >= 7 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : val >= 5 ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-rose-600 bg-rose-50 border-rose-200';
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-sm font-bold px-2 py-0.5 rounded-full border', color)}>
      {val.toFixed(1)}<span className="font-normal text-xs">/10</span>
    </span>
  );
}

export default function FinalReportCard({ report }) {
  if (!report) return null;

  return (
    <div className="bg-card border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b gradient-primary">
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="w-5 h-5 text-secondary" />
          <h3 className="font-display font-bold text-white">Pipeline Complete — Final Report</h3>
        </div>
        <p className="text-sm text-white/70">Synthesized by Reporter Agent</p>
      </div>

      <div className="p-5 space-y-5">
        {/* Executive Summary */}
        {report.executive_summary && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">EXECUTIVE SUMMARY</p>
            <p className="text-sm text-foreground leading-relaxed">{report.executive_summary}</p>
          </div>
        )}

        {/* Scores */}
        {report.evaluations?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">TRACe QUALITY SCORES</p>
            <div className="space-y-2">
              {report.evaluations.map((e, i) => (
                <div key={i} className="flex items-start gap-3 bg-muted/30 rounded-xl p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">"{e.query}"</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{e.summary || ''}</p>
                  </div>
                  <div className="flex gap-1.5 items-center flex-shrink-0">
                    <span className="text-xs text-muted-foreground">CR:{e.context_relevance}</span>
                    <span className="text-xs text-muted-foreground">F:{e.faithfulness}</span>
                    <span className="text-xs text-muted-foreground">C:{e.completeness}</span>
                    <ScoreBadge score={(e.context_relevance + e.faithfulness + e.completeness + e.utilization) / 4} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Overall Score */}
        {report.avg_quality_score && (
          <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
            <TrendingUp className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Overall Pipeline Quality</p>
              <ScoreBadge score={report.avg_quality_score} />
            </div>
          </div>
        )}

        {/* Recommendations */}
        {report.recommendations?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">RECOMMENDATIONS</p>
            <div className="space-y-1.5">
              {report.recommendations.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                  {r}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}