/**
 * End-to-End Demo — Crawl → Index → Benchmark (3 RAG types)
 * Single guided flow with live status tracking
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Globe, Database, BarChart3, CheckCircle2, Loader2, AlertCircle,
  ArrowRight, Play, RefreshCw, ExternalLink, Trophy, Zap, FileText,
  ChevronDown, ChevronUp
} from 'lucide-react';

// ── Step config ──────────────────────────────────────────────────────────────
const STEPS = [
  { id: 'crawl',     label: 'Crawl Website',    icon: Globe,     desc: 'Scrape pages from a target URL' },
  { id: 'index',     label: 'Index Documents',  icon: Database,  desc: 'Chunk & embed into Qdrant' },
  { id: 'benchmark', label: 'Run Benchmark',    icon: BarChart3, desc: 'Compare Vector vs Vectorless vs Graph RAG' },
  { id: 'results',   label: 'View Results',     icon: Trophy,    desc: 'TRACe scores & latency comparison' },
];

const RAG_STYLES = {
  vector:       { label: 'Vector RAG',    color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-200',    dot: 'bg-blue-500'    },
  vectorless:   { label: 'Vectorless',    color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  graph_vector: { label: 'Graph+Vector',  color: 'text-purple-600',  bg: 'bg-purple-50',  border: 'border-purple-200',  dot: 'bg-purple-500'  },
};

const DEMO_URLS = [
  { label: 'Fairfield University', url: 'https://www.fairfield.edu' },
  { label: 'MIT (homepage)',        url: 'https://www.mit.edu' },
  { label: 'Wikipedia — RAG',       url: 'https://en.wikipedia.org/wiki/Retrieval-augmented_generation' },
];

// ── Score badge ───────────────────────────────────────────────────────────────
function ScoreBadge({ value }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  const color = value >= 7 ? 'text-emerald-600' : value >= 4 ? 'text-amber-600' : 'text-rose-600';
  return <span className={cn('font-bold text-sm', color)}>{value.toFixed(1)}</span>;
}

// ── Metric row ────────────────────────────────────────────────────────────────
function MetricRow({ label, values }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 text-xs text-muted-foreground font-medium whitespace-nowrap">{label}</td>
      {['vector', 'vectorless', 'graph_vector'].map(r => (
        <td key={r} className="py-2 text-center"><ScoreBadge value={values[r]} /></td>
      ))}
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Demo() {
  const qc = useQueryClient();

  // — State —
  const [url, setUrl]                   = useState('https://www.fairfield.edu');
  const [maxPages, setMaxPages]         = useState(20);
  const [currentStep, setCurrentStep]   = useState('crawl');
  const [crawlJobId, setCrawlJobId]     = useState(null);
  const [testRunId, setTestRunId]       = useState(null);
  const [stepStatus, setStepStatus]     = useState({ crawl: 'idle', index: 'idle', benchmark: 'idle' });
  const [stepError, setStepError]       = useState({});
  const [expandedQuery, setExpandedQuery] = useState(null);
  const [ragTypes, setRagTypes]         = useState(['vector', 'vectorless', 'graph_vector']);

  // — Live data —
  const { data: crawlJob } = useQuery({
    queryKey: ['demoCrawlJob', crawlJobId],
    queryFn: () => base44.entities.CrawlJob.filter({ id: crawlJobId }).then(r => r[0]),
    enabled: !!crawlJobId,
    refetchInterval: stepStatus.crawl === 'running' ? 2000 : false,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['demoDocuments', crawlJobId],
    queryFn: () => base44.entities.CrawledDocument.filter({ crawl_job_id: crawlJobId }),
    enabled: !!crawlJobId,
    refetchInterval: stepStatus.index === 'running' ? 3000 : 10000,
  });

  const { data: testRun } = useQuery({
    queryKey: ['demoTestRun', testRunId],
    queryFn: () => base44.entities.TestRun.filter({ id: testRunId }).then(r => r[0]),
    enabled: !!testRunId,
    refetchInterval: stepStatus.benchmark === 'running' ? 3000 : false,
  });

  const { data: benchmarks = [] } = useQuery({
    queryKey: ['demoBenchmarks', testRunId],
    queryFn: () => base44.entities.QueryBenchmark.filter({ test_run_id: testRunId }),
    enabled: !!testRunId,
    refetchInterval: stepStatus.benchmark === 'running' ? 3000 : false,
  });

  // — Watch crawl job for completion —
  useEffect(() => {
    if (!crawlJob) return;
    if (crawlJob.status === 'completed' && stepStatus.crawl === 'running') {
      setStepStatus(p => ({ ...p, crawl: 'done' }));
      setCurrentStep('index');
    } else if (crawlJob.status === 'failed') {
      setStepStatus(p => ({ ...p, crawl: 'error' }));
      setStepError(p => ({ ...p, crawl: crawlJob.error_message || 'Crawl failed' }));
    }
  }, [crawlJob?.status]);

  // — Watch test run for completion —
  useEffect(() => {
    if (!testRun) return;
    if (testRun.status === 'completed' && stepStatus.benchmark === 'running') {
      setStepStatus(p => ({ ...p, benchmark: 'done' }));
      setCurrentStep('results');
    } else if (testRun.status === 'failed') {
      setStepStatus(p => ({ ...p, benchmark: 'error' }));
    }
  }, [testRun?.status]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  async function handleCrawl() {
    setStepError({});
    setStepStatus(p => ({ ...p, crawl: 'running' }));
    const job = await base44.entities.CrawlJob.create({
      name: `Demo — ${new URL(url).hostname}`,
      urls: [url], max_depth: 2, max_pages: maxPages, crawl_type: 'manual', status: 'pending',
    });
    setCrawlJobId(job.id);
    base44.functions.invoke('crawlWebsite', {
      job_id: job.id, urls: [url], max_depth: 2, max_pages: maxPages,
    }).catch(e => {
      setStepStatus(p => ({ ...p, crawl: 'error' }));
      setStepError(p => ({ ...p, crawl: e.message }));
    });
  }

  async function handleIndex() {
    setStepStatus(p => ({ ...p, index: 'running' }));
    const docIds = documents.filter(d => d.status === 'raw').map(d => d.id);
    try {
      const res = await base44.functions.invoke('indexDocuments', {
        document_ids: docIds.length > 0 ? docIds : undefined,
        index_targets: ['vector'],
      });
      if (res.data?.success) {
        setStepStatus(p => ({ ...p, index: 'done' }));
        setCurrentStep('benchmark');
        qc.invalidateQueries({ queryKey: ['demoDocuments', crawlJobId] });
      } else {
        throw new Error(res.data?.errors?.[0] || 'Indexing failed');
      }
    } catch (e) {
      setStepStatus(p => ({ ...p, index: 'error' }));
      setStepError(p => ({ ...p, index: e.message }));
    }
  }

  async function handleBenchmark() {
    setStepStatus(p => ({ ...p, benchmark: 'running' }));
    const run = await base44.entities.TestRun.create({
      name: `Demo Benchmark — ${new URL(url).hostname}`,
      status: 'pending',
      rag_types_tested: ragTypes,
      model_used: 'meta-llama/llama-3.1-8b-instruct',
    });
    setTestRunId(run.id);
    base44.functions.invoke('runBenchmark', {
      test_run_id: run.id,
      rag_types: ragTypes,
      use_llm_judge: true,
    }).catch(e => {
      setStepStatus(p => ({ ...p, benchmark: 'error' }));
      setStepError(p => ({ ...p, benchmark: e.message }));
    });
  }

  function handleReset() {
    setUrl('https://www.fairfield.edu');
    setMaxPages(20);
    setCurrentStep('crawl');
    setCrawlJobId(null);
    setTestRunId(null);
    setStepStatus({ crawl: 'idle', index: 'idle', benchmark: 'idle' });
    setStepError({});
    setExpandedQuery(null);
  }

  // ── Derived metrics ─────────────────────────────────────────────────────────
  function getMetrics() {
    const result = {};
    for (const rag of ragTypes) {
      const items = benchmarks.filter(b => b.rag_type === rag);
      if (!items.length) { result[rag] = null; continue; }
      const avg = arr => arr.filter(v => v != null).length
        ? arr.filter(v => v != null).reduce((a, b) => a + b, 0) / arr.filter(v => v != null).length
        : null;
      const utils = items.map(b => {
        const m = b.human_notes?.match(/utilization:([\d.]+)/);
        return m ? parseFloat(m[1]) : null;
      });
      result[rag] = {
        avg_latency: Math.round(avg(items.map(b => b.latency_ms)) || 0),
        context_relevance: avg(items.map(b => b.relevance_score)),
        faithfulness: avg(items.map(b => b.faithfulness_score)),
        completeness: avg(items.map(b => b.completeness_score)),
        utilization: avg(utils),
        count: items.length,
      };
    }
    return result;
  }

  const metrics = getMetrics();
  const indexedCount = documents.filter(d => d.vector_indexed).length;
  const rawCount = documents.filter(d => d.status === 'raw').length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
              <Zap className="w-6 h-6 text-secondary" />
              End-to-End RAG Demo
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Crawl any website → index → benchmark all 3 RAG architectures
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Reset
          </Button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2">
          {STEPS.map((step, i) => {
            const status = step.id === 'results' ? (stepStatus.benchmark === 'done' ? 'done' : 'idle') : stepStatus[step.id];
            const isActive = currentStep === step.id;
            return (
              <div key={step.id} className="flex items-center gap-2 flex-1">
                <div className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium flex-1 transition-all',
                  isActive ? 'bg-primary text-primary-foreground border-primary shadow-md' :
                  status === 'done' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  status === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                  status === 'running' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                  'bg-muted text-muted-foreground border-transparent'
                )}>
                  {status === 'running' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                  ) : status === 'done' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  ) : status === 'error' ? (
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  ) : (
                    <step.icon className="w-3.5 h-3.5 flex-shrink-0" />
                  )}
                  <span className="hidden sm:block truncate">{step.label}</span>
                </div>
                {i < STEPS.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
              </div>
            );
          })}
        </div>

        {/* ── STEP 1: CRAWL ── */}
        {currentStep === 'crawl' && (
          <div className="bg-card border rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-base">Step 1 — Crawl a Website</h2>
            </div>

            {/* Quick picks */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Quick demos:</p>
              <div className="flex flex-wrap gap-2">
                {DEMO_URLS.map(d => (
                  <button
                    key={d.url}
                    onClick={() => setUrl(d.url)}
                    className={cn(
                      'text-xs px-3 py-1.5 rounded-full border font-medium transition-colors',
                      url === d.url
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground hover:text-foreground border-transparent'
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Target URL</label>
                <Input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="font-mono text-sm"
                />
              </div>
              <div className="w-32">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Max Pages</label>
                <Input
                  type="number"
                  value={maxPages}
                  onChange={e => setMaxPages(parseInt(e.target.value))}
                  min={5} max={100}
                />
              </div>
            </div>

            {/* RAG types to benchmark */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">RAG architectures to benchmark:</label>
              <div className="flex gap-2 flex-wrap">
                {['vector', 'vectorless', 'graph_vector'].map(rt => (
                  <button
                    key={rt}
                    onClick={() => setRagTypes(p =>
                      p.includes(rt) ? p.filter(x => x !== rt) : [...p, rt]
                    )}
                    className={cn(
                      'text-xs px-3 py-1.5 rounded-full border font-medium transition-colors',
                      ragTypes.includes(rt)
                        ? `${RAG_STYLES[rt].color} ${RAG_STYLES[rt].bg} ${RAG_STYLES[rt].border}`
                        : 'bg-muted text-muted-foreground border-transparent'
                    )}
                  >
                    {RAG_STYLES[rt].label}
                  </button>
                ))}
              </div>
            </div>

            {stepError.crawl && (
              <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {stepError.crawl}
              </p>
            )}

            <Button
              className="w-full gap-2"
              onClick={handleCrawl}
              disabled={!url || stepStatus.crawl === 'running' || ragTypes.length === 0}
            >
              {stepStatus.crawl === 'running'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Play className="w-4 h-4" />}
              {stepStatus.crawl === 'running' ? 'Crawling...' : 'Start Crawl'}
            </Button>

            {/* Live crawl progress */}
            {crawlJob && (
              <div className="bg-muted/40 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{crawlJob.name}</span>
                  <span className={cn(
                    'px-2 py-0.5 rounded-full font-medium',
                    crawlJob.status === 'running' ? 'bg-blue-100 text-blue-700' :
                    crawlJob.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                    'bg-rose-100 text-rose-700'
                  )}>{crawlJob.status}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    {crawlJob.pages_crawled || 0} pages crawled
                  </span>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                    <ExternalLink className="w-3 h-3" /> View site
                  </a>
                </div>
                {crawlJob.status === 'running' && (
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: INDEX ── */}
        {currentStep === 'index' && (
          <div className="bg-card border rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-base">Step 2 — Index into Vector DB</h2>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Documents crawled', value: documents.length, color: 'text-foreground' },
                { label: 'Ready to index', value: rawCount, color: 'text-amber-600' },
                { label: 'Already indexed', value: indexedCount, color: 'text-emerald-600' },
              ].map(s => (
                <div key={s.label} className="bg-muted/40 rounded-xl p-3 text-center">
                  <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
              Documents will be chunked (400 words / 50 overlap) and embedded using
              <strong> BAAI/bge-small-en-v1.5</strong> (384-dim) then stored in Qdrant.
            </div>

            {stepError.index && (
              <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {stepError.index}
              </p>
            )}

            {stepStatus.index === 'running' && (
              <div className="flex items-center gap-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-xl p-4">
                <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                <div>
                  <p className="font-medium">Embedding & indexing...</p>
                  <p className="text-xs mt-0.5">This may take 30–90s depending on document count</p>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                className="flex-1 gap-2"
                onClick={handleIndex}
                disabled={stepStatus.index === 'running' || (rawCount === 0 && indexedCount === 0)}
              >
                {stepStatus.index === 'running'
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Database className="w-4 h-4" />}
                {stepStatus.index === 'running' ? 'Indexing...' : `Index ${rawCount > 0 ? rawCount : 'All'} Documents`}
              </Button>
              {indexedCount > 0 && stepStatus.index !== 'running' && (
                <Button variant="outline" onClick={() => { setStepStatus(p => ({ ...p, index: 'done' })); setCurrentStep('benchmark'); }}>
                  Skip (already indexed) →
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 3: BENCHMARK ── */}
        {currentStep === 'benchmark' && (
          <div className="bg-card border rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-base">Step 3 — Run 3-Way RAG Benchmark</h2>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {ragTypes.map(rt => (
                <div key={rt} className={cn('rounded-xl border p-3', RAG_STYLES[rt].bg, RAG_STYLES[rt].border)}>
                  <div className={cn('font-semibold text-xs', RAG_STYLES[rt].color)}>{RAG_STYLES[rt].label}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {rt === 'vector' && 'Qdrant semantic search + LLM'}
                    {rt === 'vectorless' && 'BM25-style keyword matching'}
                    {rt === 'graph_vector' && 'Vector + graph expansion'}
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
              Runs <strong>10 test queries</strong> × {ragTypes.length} RAG types with LLM-as-Judge TRACe scoring.
              Estimated time: <strong>3–6 minutes</strong>.
            </div>

            {stepStatus.benchmark === 'running' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                  <div>
                    <p className="font-medium">Benchmark running...</p>
                    <p className="text-xs mt-0.5">{benchmarks.length} queries scored so far</p>
                  </div>
                </div>
                {benchmarks.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {ragTypes.map(rt => {
                      const c = benchmarks.filter(b => b.rag_type === rt).length;
                      return <span key={rt} className={cn('mr-3', RAG_STYLES[rt].color)}>{RAG_STYLES[rt].label}: {c}</span>;
                    })}
                  </div>
                )}
              </div>
            )}

            {stepError.benchmark && (
              <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {stepError.benchmark}
              </p>
            )}

            <Button
              className="w-full gap-2"
              onClick={handleBenchmark}
              disabled={stepStatus.benchmark === 'running'}
            >
              {stepStatus.benchmark === 'running'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Play className="w-4 h-4" />}
              {stepStatus.benchmark === 'running' ? 'Benchmark Running...' : 'Run Benchmark'}
            </Button>
          </div>
        )}

        {/* ── STEP 4: RESULTS ── */}
        {currentStep === 'results' && testRun && (
          <div className="space-y-5">
            {/* Winner banner */}
            {testRun.winner && (
              <div className={cn(
                'rounded-2xl border-2 p-5 flex items-center gap-4',
                RAG_STYLES[testRun.winner]?.bg, RAG_STYLES[testRun.winner]?.border
              )}>
                <Trophy className={cn('w-8 h-8 flex-shrink-0', RAG_STYLES[testRun.winner]?.color)} />
                <div>
                  <p className={cn('font-bold text-lg', RAG_STYLES[testRun.winner]?.color)}>
                    {RAG_STYLES[testRun.winner]?.label} wins!
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Best composite TRACe score</p>
                </div>
              </div>
            )}

            {/* Metrics table */}
            <div className="bg-card border rounded-2xl p-5">
              <h3 className="font-semibold text-sm mb-4">TRACe Metrics Comparison (0–10)</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 text-xs text-muted-foreground">Metric</th>
                      {['vector', 'vectorless', 'graph_vector'].filter(r => ragTypes.includes(r)).map(r => (
                        <th key={r} className={cn('text-center py-2 text-xs font-semibold', RAG_STYLES[r].color)}>
                          {RAG_STYLES[r].label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <MetricRow label="Context Relevance" values={Object.fromEntries(ragTypes.map(r => [r, metrics[r]?.context_relevance]))} />
                    <MetricRow label="Faithfulness" values={Object.fromEntries(ragTypes.map(r => [r, metrics[r]?.faithfulness]))} />
                    <MetricRow label="Completeness" values={Object.fromEntries(ragTypes.map(r => [r, metrics[r]?.completeness]))} />
                    <MetricRow label="Utilization" values={Object.fromEntries(ragTypes.map(r => [r, metrics[r]?.utilization]))} />
                    <tr>
                      <td className="py-2 pr-4 text-xs text-muted-foreground font-medium">Avg Latency</td>
                      {['vector', 'vectorless', 'graph_vector'].filter(r => ragTypes.includes(r)).map(r => (
                        <td key={r} className="py-2 text-center text-xs font-semibold text-foreground">
                          {metrics[r]?.avg_latency ? `${metrics[r].avg_latency}ms` : '—'}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-xs text-muted-foreground font-medium">Queries</td>
                      {['vector', 'vectorless', 'graph_vector'].filter(r => ragTypes.includes(r)).map(r => (
                        <td key={r} className="py-2 text-center text-xs text-muted-foreground">
                          {metrics[r]?.count ?? '—'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Latency bar visual */}
            <div className="bg-card border rounded-2xl p-5">
              <h3 className="font-semibold text-sm mb-4">Latency Comparison</h3>
              <div className="space-y-3">
                {ragTypes.map(r => {
                  const lat = metrics[r]?.avg_latency || 0;
                  const maxLat = Math.max(...ragTypes.map(rt => metrics[rt]?.avg_latency || 0), 1);
                  return (
                    <div key={r} className="flex items-center gap-3">
                      <span className={cn('text-xs font-medium w-24 flex-shrink-0', RAG_STYLES[r].color)}>
                        {RAG_STYLES[r].label}
                      </span>
                      <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all duration-700', RAG_STYLES[r].dot)}
                          style={{ width: `${(lat / maxLat) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-16 text-right">{lat ? `${lat}ms` : '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Query-level results */}
            <div className="bg-card border rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b">
                <h3 className="font-semibold text-sm">Query-Level Results ({benchmarks.length})</h3>
              </div>
              <div className="divide-y max-h-[500px] overflow-y-auto scrollbar-thin">
                {benchmarks.map((b, i) => {
                  const isExp = expandedQuery === b.id;
                  return (
                    <div key={b.id}>
                      <button
                        className="w-full text-left px-5 py-3 hover:bg-muted/40 flex items-start gap-3"
                        onClick={() => setExpandedQuery(isExp ? null : b.id)}
                      >
                        <span className={cn('mt-0.5 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0',
                          RAG_STYLES[b.rag_type]?.bg, RAG_STYLES[b.rag_type]?.color, RAG_STYLES[b.rag_type]?.border, 'border'
                        )}>
                          {RAG_STYLES[b.rag_type]?.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground">{b.query_text}</p>
                          <div className="flex gap-3 mt-1 flex-wrap">
                            {b.relevance_score != null && <span className="text-xs text-muted-foreground">CR: <span className="font-medium">{b.relevance_score.toFixed(1)}</span></span>}
                            {b.faithfulness_score != null && <span className="text-xs text-muted-foreground">F: <span className="font-medium">{b.faithfulness_score.toFixed(1)}</span></span>}
                            {b.completeness_score != null && <span className="text-xs text-muted-foreground">C: <span className="font-medium">{b.completeness_score.toFixed(1)}</span></span>}
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
                              {b.sources_cited.map((s, si) => (
                                <a key={si} href={s} target="_blank" rel="noopener noreferrer"
                                  className="text-xs text-primary hover:underline flex items-center gap-0.5">
                                  <ExternalLink className="w-2.5 h-2.5" />
                                  {new URL(s).pathname.slice(0, 40)}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Run again */}
            <div className="flex justify-center gap-3 pb-4">
              <Button variant="outline" onClick={() => { setCurrentStep('benchmark'); setTestRunId(null); setStepStatus(p => ({ ...p, benchmark: 'idle' })); }}>
                Re-run Benchmark
              </Button>
              <Button variant="outline" onClick={handleReset}>
                New Demo
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}