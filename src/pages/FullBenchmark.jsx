/**
 * Full RAG Benchmark — Crawl any site → Index → Compare Vector / Vectorless / Graph+Vector
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Globe, Database, BarChart3, Play, Loader2, CheckCircle2,
  AlertCircle, Trophy, RefreshCw, ChevronDown, ChevronUp, Zap, ExternalLink
} from 'lucide-react';
import { format } from 'date-fns';

const RAG = {
  vector:       { label: 'Vector RAG',     sub: 'Qdrant semantic search',      color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-200',    dot: 'bg-blue-500'    },
  vectorless:   { label: 'Vectorless RAG', sub: 'BM25 keyword matching',        color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  graph_vector: { label: 'Graph+Vector',   sub: 'FalkorDB graph + Qdrant',      color: 'text-purple-600',  bg: 'bg-purple-50',  border: 'border-purple-200',  dot: 'bg-purple-500'  },
};

const DEMO_SITES = [
  { label: 'Fairfield University', url: 'https://www.fairfield.edu' },
  { label: 'MIT',                   url: 'https://www.mit.edu' },
  { label: 'Wikipedia — RAG',       url: 'https://en.wikipedia.org/wiki/Retrieval-augmented_generation' },
];

function Score({ v }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const color = v >= 7 ? 'text-emerald-600' : v >= 4 ? 'text-amber-600' : 'text-rose-600';
  return <span className={cn('font-bold', color)}>{v.toFixed(1)}</span>;
}

function LatencyBar({ value, max }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-16 text-right">{value ? `${value}ms` : '—'}</span>
    </div>
  );
}

export default function FullBenchmark() {
  const qc = useQueryClient();
  const [url, setUrl] = useState('https://www.fairfield.edu');
  const [maxPages, setMaxPages] = useState(15);
  const [phase, setPhase] = useState('idle'); // idle | crawling | indexing_and_benchmarking | done | error
  const [error, setError] = useState('');
  const [crawlJobId, setCrawlJobId] = useState(null);
  const [testRunId, setTestRunId] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  // Poll crawl job while crawling
  const { data: crawlJob } = useQuery({
    queryKey: ['fbCrawlJob', crawlJobId],
    queryFn: () => base44.entities.CrawlJob.filter({ id: crawlJobId }).then(r => r[0]),
    enabled: !!crawlJobId && phase === 'crawling',
    refetchInterval: 2500,
  });

  // Poll test run while benchmarking
  const { data: testRun } = useQuery({
    queryKey: ['fbTestRun', testRunId],
    queryFn: () => base44.entities.TestRun.filter({ id: testRunId }).then(r => r[0]),
    enabled: !!testRunId,
    refetchInterval: phase === 'indexing_and_benchmarking' ? 3000 : false,
  });

  const { data: benchmarks = [] } = useQuery({
    queryKey: ['fbBenchmarks', testRunId],
    queryFn: () => base44.entities.QueryBenchmark.filter({ test_run_id: testRunId }),
    enabled: !!testRunId,
    refetchInterval: phase === 'indexing_and_benchmarking' ? 3000 : false,
  });

  // Crawl job completion → kick off benchmark
  useEffect(() => {
    if (!crawlJob || phase !== 'crawling') return;
    if (crawlJob.status === 'completed') {
      startBenchmark(crawlJob.id);
    } else if (crawlJob.status === 'failed') {
      setPhase('error');
      setError(crawlJob.error_message || 'Crawl failed');
    }
  }, [crawlJob?.status]);

  // Test run completion
  useEffect(() => {
    if (!testRun) return;
    if (testRun.status === 'completed') setPhase('done');
    else if (testRun.status === 'failed') { setPhase('error'); setError('Benchmark failed'); }
  }, [testRun?.status]);

  async function handleStart() {
    setError('');
    setPhase('crawling');
    setCrawlJobId(null);
    setTestRunId(null);

    // Create crawl job record
    const job = await base44.entities.CrawlJob.create({
      name: `Benchmark crawl — ${new URL(url).hostname}`,
      urls: [url], max_depth: 2, max_pages: maxPages,
      crawl_type: 'manual', status: 'pending',
    });
    setCrawlJobId(job.id);

    // Fire crawl (non-blocking — we poll above)
    base44.functions.invoke('crawlWebsite', { job_id: job.id, urls: [url], max_depth: 2, max_pages: maxPages })
      .catch(e => { setPhase('error'); setError(e.message); });
  }

  async function startBenchmark(jobId) {
    setPhase('indexing_and_benchmarking');

    const run = await base44.entities.TestRun.create({
      name: `RAG Benchmark — ${new URL(url).hostname} — ${format(new Date(), 'MMM d HH:mm')}`,
      status: 'pending',
      rag_types_tested: ['vector', 'vectorless', 'graph_vector'],
      model_used: 'llama-3.1-8b',
    });
    setTestRunId(run.id);

    // Fire full benchmark (index + query + judge — non-blocking, polled above)
    base44.functions.invoke('runFullBenchmark', {
      test_run_id: run.id,
      crawl_job_id: jobId,
    }).catch(e => { setPhase('error'); setError(e.message); });
  }

  function reset() {
    setPhase('idle');
    setError('');
    setCrawlJobId(null);
    setTestRunId(null);
    setExpandedRow(null);
    qc.invalidateQueries({ queryKey: ['fbBenchmarks'] });
    qc.invalidateQueries({ queryKey: ['fbTestRun'] });
  }

  // Derived metrics
  function metrics(rag) {
    const items = benchmarks.filter(b => b.rag_type === rag);
    if (!items.length) return null;
    const avg = arr => arr.filter(v => v != null).reduce((a, b) => a + b, 0) / (arr.filter(v => v != null).length || 1);
    const utils = items.map(b => { const m = b.human_notes?.match(/utilization:([\d.]+)/); return m ? +m[1] : null; });
    return {
      count: items.length,
      avg_latency: Math.round(avg(items.map(b => b.latency_ms))),
      context_relevance: avg(items.map(b => b.relevance_score)),
      faithfulness: avg(items.map(b => b.faithfulness_score)),
      completeness: avg(items.map(b => b.completeness_score)),
      utilization: avg(utils),
      composite: avg([
        avg(items.map(b => b.relevance_score)),
        avg(items.map(b => b.faithfulness_score)),
        avg(items.map(b => b.completeness_score)),
        avg(utils),
      ].filter(v => v != null)),
    };
  }

  const vm = metrics('vector');
  const bm = metrics('vectorless');
  const gm = metrics('graph_vector');
  const maxLat = Math.max(vm?.avg_latency || 0, bm?.avg_latency || 0, gm?.avg_latency || 0, 1);

  const phaseLabel = {
    idle: null,
    crawling: `Crawling ${url}… (${crawlJob?.pages_crawled || 0} pages)`,
    indexing_and_benchmarking: `Indexing into Qdrant + running ${benchmarks.length} queries across 3 RAG types…`,
    done: 'Benchmark complete',
    error: 'Error',
  }[phase];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
              <Zap className="w-6 h-6 text-secondary" />
              RAG Architecture Benchmark
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Crawl any website → index → compare Vector / Vectorless / Graph+Vector RAG side-by-side
            </p>
          </div>
          {phase !== 'idle' && (
            <Button variant="outline" size="sm" onClick={reset}>
              <RefreshCw className="w-4 h-4 mr-1.5" /> New Run
            </Button>
          )}
        </div>

        {/* Input panel — only shown when idle */}
        {phase === 'idle' && (
          <div className="bg-card border rounded-2xl p-6 space-y-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Quick demos:</p>
              <div className="flex flex-wrap gap-2">
                {DEMO_SITES.map(s => (
                  <button key={s.url} onClick={() => setUrl(s.url)}
                    className={cn('text-xs px-3 py-1.5 rounded-full border font-medium transition-colors',
                      url === s.url ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent hover:text-foreground'
                    )}>{s.label}</button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Website URL to crawl</label>
                <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" className="font-mono text-sm" />
              </div>
              <div className="w-28">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Max pages</label>
                <Input type="number" value={maxPages} onChange={e => setMaxPages(+e.target.value)} min={5} max={50} />
              </div>
            </div>

            {/* What will happen */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: Globe,    step: '1', label: 'Crawl',     desc: `Scrape up to ${maxPages} pages from the target site` },
                { icon: Database, step: '2', label: 'Index',     desc: 'Chunk & embed into Qdrant (384-dim vectors)' },
                { icon: BarChart3,step: '3', label: 'Benchmark', desc: '8 queries × 3 RAG types, LLM-judge TRACe scoring' },
              ].map(s => (
                <div key={s.step} className="bg-muted/40 rounded-xl p-3 flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold flex-shrink-0">{s.step}</div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{s.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <Button className="w-full gap-2 h-11 text-base" onClick={handleStart} disabled={!url}>
              <Play className="w-5 h-5" /> Start Benchmark Run
            </Button>
          </div>
        )}

        {/* Progress */}
        {phase !== 'idle' && phase !== 'done' && phase !== 'error' && (
          <div className="bg-card border rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <div>
                <p className="font-medium text-sm">{phaseLabel}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{new URL(url).hostname}</p>
              </div>
            </div>

            {/* Phase steps */}
            <div className="flex items-center gap-2">
              {[
                { id: 'crawl', label: 'Crawl', done: phase !== 'crawling', active: phase === 'crawling' },
                { id: 'index', label: 'Index + Embed', done: phase === 'done', active: phase === 'indexing_and_benchmarking' },
                { id: 'bench', label: 'Benchmark (3 RAGs)', done: phase === 'done', active: phase === 'indexing_and_benchmarking' },
              ].map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 flex-1">
                  <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-1 transition-all',
                    s.done ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    s.active ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                    'bg-muted text-muted-foreground'
                  )}>
                    {s.done ? <CheckCircle2 className="w-3 h-3" /> : s.active ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {s.label}
                  </div>
                  {i < 2 && <span className="text-muted-foreground text-xs">→</span>}
                </div>
              ))}
            </div>

            {benchmarks.length > 0 && (
              <p className="text-xs text-muted-foreground">{benchmarks.length} queries scored so far…</p>
            )}
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-rose-700">Something went wrong</p>
              <p className="text-xs text-rose-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* ── RESULTS ── */}
        {(phase === 'done' || (phase === 'indexing_and_benchmarking' && benchmarks.length > 0)) && (
          <div className="space-y-5">

            {/* Winner */}
            {testRun?.winner && phase === 'done' && (
              <div className={cn('rounded-2xl border-2 p-5 flex items-center gap-4', RAG[testRun.winner]?.bg, RAG[testRun.winner]?.border)}>
                <Trophy className={cn('w-9 h-9 flex-shrink-0', RAG[testRun.winner]?.color)} />
                <div>
                  <p className={cn('font-bold text-xl', RAG[testRun.winner]?.color)}>{RAG[testRun.winner]?.label} wins!</p>
                  <p className="text-sm text-muted-foreground">{RAG[testRun.winner]?.sub} — best composite TRACe score on {new URL(url).hostname}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-xs text-muted-foreground">Composite score</p>
                  <p className={cn('text-2xl font-bold', RAG[testRun.winner]?.color)}>
                    {metrics(testRun.winner)?.composite?.toFixed(1) ?? '—'}<span className="text-sm font-normal">/10</span>
                  </p>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex border-b gap-1">
              {[{ id: 'overview', label: 'Overview' }, { id: 'queries', label: `Query Results (${benchmarks.length})` }].map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={cn('px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                    activeTab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}>{t.label}</button>
              ))}
            </div>

            {activeTab === 'overview' && (
              <div className="space-y-5">
                {/* Score cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {['vector', 'vectorless', 'graph_vector'].map(r => {
                    const m = metrics(r);
                    const isWinner = testRun?.winner === r;
                    return (
                      <div key={r} className={cn('rounded-2xl border p-4 space-y-3', isWinner ? `${RAG[r].bg} ${RAG[r].border} border-2` : 'bg-card')}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className={cn('font-bold text-sm', RAG[r].color)}>{RAG[r].label}</p>
                            <p className="text-xs text-muted-foreground">{RAG[r].sub}</p>
                          </div>
                          {isWinner && <Trophy className={cn('w-5 h-5', RAG[r].color)} />}
                        </div>
                        {m ? (
                          <div className="space-y-1.5">
                            {[
                              { label: 'Context Relevance', v: m.context_relevance },
                              { label: 'Faithfulness',      v: m.faithfulness },
                              { label: 'Completeness',      v: m.completeness },
                              { label: 'Utilization',       v: m.utilization },
                            ].map(row => (
                              <div key={row.label} className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">{row.label}</span>
                                <Score v={row.v} />
                              </div>
                            ))}
                            <div className="border-t pt-1.5 flex justify-between items-center">
                              <span className="text-xs font-semibold text-foreground">Composite</span>
                              <span className={cn('text-base font-bold', RAG[r].color)}>{m.composite?.toFixed(1) ?? '—'}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No data yet</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Latency comparison */}
                <div className="bg-card border rounded-2xl p-5">
                  <h3 className="font-semibold text-sm mb-4">Average Latency Comparison</h3>
                  <div className="space-y-3">
                    {['vector', 'vectorless', 'graph_vector'].map(r => {
                      const m = metrics(r);
                      return (
                        <div key={r} className="flex items-center gap-3">
                          <span className={cn('text-xs font-medium w-28 flex-shrink-0', RAG[r].color)}>{RAG[r].label}</span>
                          <LatencyBar value={m?.avg_latency || 0} max={maxLat} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Summary table */}
                <div className="bg-card border rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 border-b"><h3 className="font-semibold text-sm">TRACe Metrics Summary</h3></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Metric</th>
                          {['vector', 'vectorless', 'graph_vector'].map(r => (
                            <th key={r} className={cn('text-center px-4 py-2 text-xs font-semibold', RAG[r].color)}>{RAG[r].label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: 'Context Relevance', key: 'context_relevance' },
                          { label: 'Faithfulness',      key: 'faithfulness' },
                          { label: 'Completeness',      key: 'completeness' },
                          { label: 'Utilization',       key: 'utilization' },
                          { label: 'Composite Score',   key: 'composite' },
                          { label: 'Avg Latency',       key: 'avg_latency', unit: 'ms' },
                          { label: 'Queries scored',    key: 'count', raw: true },
                        ].map(row => (
                          <tr key={row.key} className="border-b last:border-0">
                            <td className="px-4 py-2 text-xs font-medium text-muted-foreground">{row.label}</td>
                            {['vector', 'vectorless', 'graph_vector'].map(r => {
                              const m = metrics(r);
                              const v = m?.[row.key];
                              return (
                                <td key={r} className="px-4 py-2 text-center text-xs">
                                  {row.raw ? <span className="text-muted-foreground">{v ?? '—'}</span>
                                    : row.unit ? <span className="font-semibold">{v ? `${v}${row.unit}` : '—'}</span>
                                    : <Score v={v} />}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {testRun?.notes && (
                  <div className="bg-muted/40 rounded-xl px-4 py-3 text-xs text-muted-foreground font-mono">{testRun.notes}</div>
                )}
              </div>
            )}

            {activeTab === 'queries' && (
              <div className="bg-card border rounded-2xl overflow-hidden">
                <div className="divide-y max-h-[600px] overflow-y-auto scrollbar-thin">
                  {benchmarks.map(b => {
                    const isExp = expandedRow === b.id;
                    return (
                      <div key={b.id}>
                        <button className="w-full text-left px-5 py-3 hover:bg-muted/40 flex items-start gap-3"
                          onClick={() => setExpandedRow(isExp ? null : b.id)}>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border flex-shrink-0 mt-0.5',
                            RAG[b.rag_type]?.bg, RAG[b.rag_type]?.color, RAG[b.rag_type]?.border)}>
                            {RAG[b.rag_type]?.label}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground">{b.query_text}</p>
                            <div className="flex gap-3 mt-1 flex-wrap">
                              {b.relevance_score != null && <span className="text-xs text-muted-foreground">CR: <b>{b.relevance_score.toFixed(1)}</b></span>}
                              {b.faithfulness_score != null && <span className="text-xs text-muted-foreground">F: <b>{b.faithfulness_score.toFixed(1)}</b></span>}
                              {b.completeness_score != null && <span className="text-xs text-muted-foreground">C: <b>{b.completeness_score.toFixed(1)}</b></span>}
                              {b.latency_ms && <span className="text-xs text-muted-foreground">{b.latency_ms}ms</span>}
                            </div>
                          </div>
                          {isExp ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                        </button>
                        {isExp && (
                          <div className="px-5 pb-4 bg-muted/20">
                            <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{b.response_text}</p>
                            {b.sources_cited?.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {b.sources_cited.slice(0, 4).map((s, i) => {
                                  try {
                                    return (
                                      <a key={i} href={s} target="_blank" rel="noopener noreferrer"
                                        className="text-xs text-primary hover:underline flex items-center gap-0.5">
                                        <ExternalLink className="w-2.5 h-2.5" />{new URL(s).pathname.slice(0, 40)}
                                      </a>
                                    );
                                  } catch (_) { return null; }
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}