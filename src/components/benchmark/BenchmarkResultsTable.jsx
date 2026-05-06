import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

const RAG_STYLES = {
  vector: { label: 'Vector RAG', color: 'text-blue-600', bg: 'bg-blue-50' },
  vectorless: { label: 'Vectorless', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  graph_vector: { label: 'Graph Vector', color: 'text-purple-600', bg: 'bg-purple-50' },
};

function ScorePill({ value }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  const color = value >= 7 ? 'text-emerald-600 bg-emerald-50' : value >= 4 ? 'text-amber-600 bg-amber-50' : 'text-rose-600 bg-rose-50';
  return (
    <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded-md', color)}>
      {value.toFixed(1)}
    </span>
  );
}

function ExpandedRow({ benchmark }) {
  const utilMatch = benchmark.human_notes?.match(/utilization:([\d.]+)/);
  const utilization = utilMatch ? parseFloat(utilMatch[1]) : null;

  return (
    <tr className="bg-muted/20">
      <td colSpan={8} className="px-6 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-medium text-xs text-muted-foreground mb-1">Response</p>
            <p className="text-xs text-foreground leading-relaxed bg-card border rounded-lg p-3 max-h-32 overflow-y-auto">
              {benchmark.response_text || 'No response recorded'}
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <p className="font-medium text-xs text-muted-foreground mb-1">TRACe Scores</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Context Relevance', value: benchmark.relevance_score },
                  { label: 'Faithfulness', value: benchmark.faithfulness_score },
                  { label: 'Completeness', value: benchmark.completeness_score },
                  { label: 'Utilization', value: utilization },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between bg-card border rounded-lg px-2 py-1.5">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <ScorePill value={s.value} />
                  </div>
                ))}
              </div>
            </div>
            {benchmark.sources_cited?.length > 0 && (
              <div>
                <p className="font-medium text-xs text-muted-foreground mb-1">Sources ({benchmark.sources_cited.length})</p>
                <div className="space-y-1">
                  {benchmark.sources_cited.slice(0, 3).map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline block truncate">
                      {url}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function BenchmarkResultsTable({ benchmarks }) {
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all' ? benchmarks : benchmarks.filter(b => b.rag_type === filter);

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-3">
        {['all', 'vector', 'vectorless', 'graph_vector'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'text-xs px-3 py-1 rounded-full font-medium transition-colors',
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {f === 'all' ? 'All' : RAG_STYLES[f]?.label}
            <span className="ml-1 opacity-70">({f === 'all' ? benchmarks.length : benchmarks.filter(b => b.rag_type === f).length})</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="w-6 px-3 py-2" />
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Query</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">RAG</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">CR</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">F</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">C</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">U</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Latency</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60).map(b => {
              const s = RAG_STYLES[b.rag_type];
              const isExpanded = expanded === b.id;
              const utilMatch = b.human_notes?.match(/utilization:([\d.]+)/);
              const utilization = utilMatch ? parseFloat(utilMatch[1]) : null;
              return (
                <>
                  <tr
                    key={b.id}
                    className={cn('border-b hover:bg-muted/20 cursor-pointer transition-colors', isExpanded && 'bg-muted/10')}
                    onClick={() => setExpanded(isExpanded ? null : b.id)}
                  >
                    <td className="px-3 py-2">
                      {isExpanded
                        ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                        : <ChevronRight className="w-3 h-3 text-muted-foreground" />
                      }
                    </td>
                    <td className="px-3 py-2 max-w-[200px]">
                      <p className="truncate text-xs">{b.query_text}</p>
                      <p className="text-xs text-muted-foreground capitalize">{b.query_category}</p>
                    </td>
                    <td className="px-3 py-2">
                      {s && (
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', s.color, s.bg)}>
                          {s.label}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2"><ScorePill value={b.relevance_score} /></td>
                    <td className="px-3 py-2"><ScorePill value={b.faithfulness_score} /></td>
                    <td className="px-3 py-2"><ScorePill value={b.completeness_score} /></td>
                    <td className="px-3 py-2"><ScorePill value={utilization} /></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {b.latency_ms ? `${b.latency_ms}ms` : '—'}
                    </td>
                  </tr>
                  {isExpanded && <ExpandedRow key={`${b.id}-exp`} benchmark={b} />}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}