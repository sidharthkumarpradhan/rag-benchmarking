import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import TRACeScoreCard from '@/components/benchmark/TRACeScoreCard';
import TRACeRadarChart from '@/components/benchmark/TRACeRadarChart';
import CategoryBreakdown from '@/components/benchmark/CategoryBreakdown';
import BenchmarkResultsTable from '@/components/benchmark/BenchmarkResultsTable';
import { LatencyChart } from '@/components/benchmark/RAGCompareChart';
import {
  Play, Plus, RefreshCw, Trophy, ChevronRight, Loader2, BarChart3,
  Info, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const RAG_STYLES = {
  vector: { label: 'Vector RAG', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500' },
  vectorless: { label: 'Vectorless', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  graph_vector: { label: 'Graph Vector', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', dot: 'bg-purple-500' },
};

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-700',
  running: 'bg-blue-100 text-blue-700 animate-pulse',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
};

function computeMetrics(benchmarks) {
  const result = {};
  for (const rag of ['vector', 'vectorless', 'graph_vector']) {
    const items = benchmarks.filter(b => b.rag_type === rag);
    if (items.length === 0) { result[rag] = { count: 0 }; continue; }

    const avg = arr => arr.filter(v => v != null).length > 0
      ? arr.filter(v => v != null).reduce((a, b) => a + b, 0) / arr.filter(v => v != null).length
      : null;
    const round1 = v => v != null ? Math.round(v * 10) / 10 : null;

    const utils = items
      .map(b => { const m = b.human_notes?.match(/utilization:([\d.]+)/); return m ? parseFloat(m[1]) : null; })
      .filter(v => v != null);

    result[rag] = {
      count: items.length,
      avg_latency: Math.round(avg(items.map(b => b.latency_ms)) || 0),
      context_relevance: round1(avg(items.map(b => b.relevance_score))),
      faithfulness: round1(avg(items.map(b => b.faithfulness_score))),
      completeness: round1(avg(items.map(b => b.completeness_score))),
      utilization: round1(avg(utils)),
    };
  }
  return result;
}

export default function Benchmark() {
  const [selectedRun, setSelectedRun] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newRun, setNewRun] = useState({ name: '', description: '', model: 'meta-llama/llama-3.1-8b-instruct:free', rag_types: ['vector', 'vectorless'] });
  const [manualQuery, setManualQuery] = useState('');
  const [manualRag, setManualRag] = useState('vector');
  const [activeTab, setActiveTab] = useState('overview');
  const qc = useQueryClient();

  const { data: testRuns = [] } = useQuery({
    queryKey: ['testRuns'],
    queryFn: () => base44.entities.TestRun.list('-created_date', 20),
    refetchInterval: 5000,
  });

  const { data: benchmarks = [] } = useQuery({
    queryKey: ['benchmarks', selectedRun?.id],
    queryFn: () => base44.entities.QueryBenchmark.filter({ test_run_id: selectedRun?.id }),
    enabled: !!selectedRun?.id,
    refetchInterval: selectedRun?.status === 'running' ? 3000 : false,
  });

  const createRun = useMutation({
    mutationFn: async () => {
      return base44.entities.TestRun.create({
        name: newRun.name,
        description: newRun.description,
        model_used: newRun.model,
        status: 'pending',
        rag_types_tested: newRun.rag_types,
      });
    },
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['testRuns'] });
      setCreateOpen(false);
      setSelectedRun(run);
    }
  });

  const startBenchmark = useMutation({
    mutationFn: async (runId) => {
      const run = testRuns.find(r => r.id === runId) || selectedRun;
      return base44.functions.invoke('runBenchmark', {
        test_run_id: runId,
        model: run?.model_used || 'meta-llama/llama-3.1-8b-instruct:free',
        provider: 'openrouter',
        rag_types: run?.rag_types_tested || ['vector', 'vectorless'],
        use_llm_judge: true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['testRuns'] });
      qc.invalidateQueries({ queryKey: ['benchmarks', selectedRun?.id] });
    }
  });

  const runManualQuery = useMutation({
    mutationFn: async () => {
      return base44.functions.invoke('queryRAG', {
        query: manualQuery,
        rag_type: manualRag,
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        provider: 'openrouter',
        save_benchmark: true,
        test_run_id: selectedRun?.id,
        query_category: 'general'
      });
    },
    onSuccess: () => {
      setManualQuery('');
      qc.invalidateQueries({ queryKey: ['benchmarks', selectedRun?.id] });
    }
  });

  const metrics = computeMetrics(benchmarks);

  const latencyChartData = [{
    name: 'Avg Latency (ms)',
    vector: metrics.vector?.avg_latency || null,
    vectorless: metrics.vectorless?.avg_latency || null,
    graph_vector: metrics.graph_vector?.avg_latency || null,
  }];

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'categories', label: 'By Category' },
    { id: 'results', label: `Results (${benchmarks.length})` },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar: Test Runs */}
      <div className="w-64 border-r bg-card flex flex-col overflow-hidden flex-shrink-0">
        <div className="px-4 py-4 border-b flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-semibold text-sm text-foreground">Test Runs</h2>
            <p className="text-xs text-muted-foreground mt-0.5">RAGBench / TRACe</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-7 text-xs gap-1">
                <Plus className="w-3 h-3" /> New
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Test Run</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Run Name</label>
                  <Input
                    placeholder="e.g. Baseline Benchmark v1"
                    value={newRun.name}
                    onChange={e => setNewRun(p => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Description</label>
                  <Textarea
                    placeholder="Optional notes about this run..."
                    value={newRun.description}
                    onChange={e => setNewRun(p => ({ ...p, description: e.target.value }))}
                    className="h-20"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">LLM Model</label>
                  <Select value={newRun.model} onValueChange={v => setNewRun(p => ({ ...p, model: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="meta-llama/llama-3.1-8b-instruct:free">Llama 3.1 8B (Free)</SelectItem>
                      <SelectItem value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (Free)</SelectItem>
                      <SelectItem value="google/gemma-3-9b-it:free">Gemma 3 9B (Free)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">RAG Types to Test</label>
                  <div className="flex flex-wrap gap-2">
                    {['vector', 'vectorless', 'graph_vector'].map(rt => (
                      <button
                        key={rt}
                        onClick={() => setNewRun(p => ({
                          ...p,
                          rag_types: p.rag_types.includes(rt)
                            ? p.rag_types.filter(x => x !== rt)
                            : [...p.rag_types, rt]
                        }))}
                        className={cn(
                          'text-xs px-3 py-1.5 rounded-full border font-medium transition-colors',
                          newRun.rag_types.includes(rt)
                            ? `${RAG_STYLES[rt].color} ${RAG_STYLES[rt].bg} ${RAG_STYLES[rt].border}`
                            : 'bg-muted text-muted-foreground border-transparent'
                        )}
                      >
                        {RAG_STYLES[rt].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                  <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    Benchmark runs 10 queries × RAG types with LLM-judge scoring (TRACe). May take 2–5 mins. Ensure documents are indexed first.
                  </p>
                </div>
                <Button
                  className="w-full"
                  onClick={() => createRun.mutate()}
                  disabled={!newRun.name || newRun.rag_types.length === 0 || createRun.isPending}
                >
                  {createRun.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Create Test Run
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {testRuns.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No test runs yet. Create one to start benchmarking.
            </div>
          )}
          {testRuns.map(run => (
            <button
              key={run.id}
              onClick={() => setSelectedRun(run)}
              className={cn(
                'w-full text-left px-4 py-3 border-b hover:bg-muted/50 transition-colors',
                selectedRun?.id === run.id && 'bg-accent'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-foreground truncate pr-2">{run.name}</span>
                <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', STATUS_STYLES[run.status])}>
                  {run.status}
                </span>
                {run.winner && (
                  <span className="flex items-center gap-0.5 text-xs text-amber-600 font-medium">
                    <Trophy className="w-3 h-3" />
                    {RAG_STYLES[run.winner]?.label?.split(' ')[0]}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {format(new Date(run.created_date), 'MMM d, HH:mm')}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Main Panel */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!selectedRun ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <BarChart3 className="w-16 h-16 text-muted-foreground/30 mb-4" />
            <h2 className="font-display text-2xl font-bold text-foreground mb-2">RAG Benchmark Dashboard</h2>
            <p className="text-muted-foreground max-w-sm text-sm mb-4">
              Evaluate RAG architectures using the <strong>TRACe</strong> framework — measuring Context Relevance, Utilization, Faithfulness, and Completeness.
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-sm text-left">
              {[
                { abbr: 'CR', label: 'Context Relevance', desc: 'Retriever quality' },
                { abbr: 'U', label: 'Utilization', desc: 'Context usage' },
                { abbr: 'F', label: 'Faithfulness', desc: 'No hallucinations' },
                { abbr: 'C', label: 'Completeness', desc: 'Full answer coverage' },
              ].map(m => (
                <div key={m.abbr} className="bg-card border rounded-xl p-3">
                  <p className="text-base font-bold text-primary">{m.abbr}</p>
                  <p className="text-xs font-medium text-foreground">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-foreground">{selectedRun.name}</h2>
                {selectedRun.description && (
                  <p className="text-sm text-muted-foreground mt-0.5">{selectedRun.description}</p>
                )}
                <div className="flex items-center flex-wrap gap-2 mt-2">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_STYLES[selectedRun.status])}>
                    {selectedRun.status}
                  </span>
                  {selectedRun.model_used && (
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{selectedRun.model_used?.split('/').pop()}</span>
                  )}
                  {selectedRun.winner && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      <Trophy className="w-3 h-3" /> Winner: {RAG_STYLES[selectedRun.winner]?.label}
                    </span>
                  )}
                  {selectedRun.notes && (
                    <span className="text-xs text-muted-foreground hidden lg:block">{selectedRun.notes}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries()}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => startBenchmark.mutate(selectedRun.id)}
                  disabled={startBenchmark.isPending || selectedRun.status === 'running'}
                >
                  {startBenchmark.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Play className="w-4 h-4" />}
                  {selectedRun.status === 'completed' ? 'Re-run' : 'Run Benchmark'}
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b gap-1">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={cn(
                    'px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                    activeTab === t.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* TRACe Score Cards */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="font-semibold text-sm">TRACe Evaluation Scores</h3>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">LLM-as-Judge (0–10)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(selectedRun.rag_types_tested || ['vector', 'vectorless']).map(rag => (
                      <TRACeScoreCard
                        key={rag}
                        ragLabel={RAG_STYLES[rag]?.label || rag}
                        ragColor={RAG_STYLES[rag]?.dot || 'bg-gray-400'}
                        metrics={metrics[rag]}
                      />
                    ))}
                  </div>
                </div>

                {/* Charts */}
                {benchmarks.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-card border rounded-2xl p-4">
                      <h3 className="font-semibold text-sm mb-3">TRACe Radar — Multi-Dimensional Quality</h3>
                      <TRACeRadarChart metricsMap={metrics} />
                    </div>
                    <div className="bg-card border rounded-2xl p-4">
                      <h3 className="font-semibold text-sm mb-3">Latency Comparison (ms)</h3>
                      <LatencyChart data={latencyChartData} />
                    </div>
                  </div>
                )}

                {/* Manual Query */}
                <div className="bg-card border rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-sm">Manual Query Test</h3>
                    <span className="text-xs text-muted-foreground">(saves to this run with LLM scoring)</span>
                  </div>
                  <div className="flex gap-3">
                    <Input
                      value={manualQuery}
                      onChange={e => setManualQuery(e.target.value)}
                      placeholder="Enter a test query..."
                      className="flex-1"
                      onKeyDown={e => e.key === 'Enter' && manualQuery && runManualQuery.mutate()}
                    />
                    <Select value={manualRag} onValueChange={setManualRag}>
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vector">Vector RAG</SelectItem>
                        <SelectItem value="vectorless">Vectorless</SelectItem>
                        <SelectItem value="graph_vector">Graph Vector</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => runManualQuery.mutate()}
                      disabled={!manualQuery || runManualQuery.isPending}
                      className="gap-2"
                    >
                      {runManualQuery.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      Run
                    </Button>
                  </div>
                </div>

                {benchmarks.length === 0 && selectedRun.status !== 'running' && (
                  <div className="bg-muted/30 border border-dashed rounded-2xl p-8 text-center">
                    <BarChart3 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No benchmark data yet.</p>
                    <p className="text-xs text-muted-foreground mt-1">Click "Run Benchmark" to evaluate all RAG types automatically.</p>
                  </div>
                )}

                {selectedRun.status === 'running' && (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center">
                    <Loader2 className="w-8 h-8 text-blue-600 mx-auto mb-3 animate-spin" />
                    <p className="text-sm font-medium text-blue-700">Benchmark running…</p>
                    <p className="text-xs text-blue-500 mt-1">Running queries across RAG types and scoring with LLM judge. This may take a few minutes.</p>
                  </div>
                )}
              </div>
            )}

            {/* CATEGORIES TAB */}
            {activeTab === 'categories' && (
              <div className="space-y-4">
                <div className="bg-card border rounded-2xl p-4">
                  <h3 className="font-semibold text-sm mb-1">Composite Score by Query Category</h3>
                  <p className="text-xs text-muted-foreground mb-4">Average of CR + F + C + U across all queries in each category (0–10)</p>
                  <CategoryBreakdown benchmarks={benchmarks} />
                </div>

                {/* Category table summary */}
                {benchmarks.length > 0 && (
                  <div className="bg-card border rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b">
                      <h3 className="font-semibold text-sm">Category Summary</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Category</th>
                            {(selectedRun.rag_types_tested || ['vector', 'vectorless']).map(rag => (
                              <th key={rag} className={cn('text-left px-4 py-2 text-xs font-medium', RAG_STYLES[rag]?.color)}>
                                {RAG_STYLES[rag]?.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {['admissions', 'it_support', 'academic', 'financial', 'campus_life', 'faculty'].map(cat => {
                            const catBenchmarks = benchmarks.filter(b => b.query_category === cat);
                            if (catBenchmarks.length === 0) return null;
                            return (
                              <tr key={cat} className="border-b hover:bg-muted/20">
                                <td className="px-4 py-2 text-xs capitalize font-medium">{cat.replace('_', ' ')}</td>
                                {(selectedRun.rag_types_tested || ['vector', 'vectorless']).map(rag => {
                                  const items = catBenchmarks.filter(b => b.rag_type === rag);
                                  if (items.length === 0) return <td key={rag} className="px-4 py-2 text-xs text-muted-foreground">—</td>;
                                  const hasScores = items.some(b => b.relevance_score != null);
                                  if (!hasScores) return <td key={rag} className="px-4 py-2 text-xs text-muted-foreground">{items.length} queries</td>;
                                  const avg = arr => arr.filter(v => v != null).length > 0
                                    ? arr.filter(v => v != null).reduce((a, b) => a + b, 0) / arr.filter(v => v != null).length
                                    : null;
                                  const cr = avg(items.map(b => b.relevance_score));
                                  const f = avg(items.map(b => b.faithfulness_score));
                                  const c = avg(items.map(b => b.completeness_score));
                                  const composite = cr != null && f != null && c != null ? ((cr + f + c) / 3).toFixed(1) : '—';
                                  const color = composite >= 7 ? 'text-emerald-600' : composite >= 4 ? 'text-amber-600' : 'text-rose-600';
                                  return (
                                    <td key={rag} className="px-4 py-2">
                                      <span className={cn('text-sm font-bold', color)}>{composite}</span>
                                      <span className="text-xs text-muted-foreground ml-1">/ 10</span>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* RESULTS TAB */}
            {activeTab === 'results' && (
              <div className="space-y-4">
                {benchmarks.length === 0 ? (
                  <div className="bg-muted/30 border border-dashed rounded-2xl p-8 text-center">
                    <p className="text-sm text-muted-foreground">No results yet. Run the benchmark first.</p>
                  </div>
                ) : (
                  <div className="bg-card border rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <h3 className="font-semibold text-sm">Query-Level Results</h3>
                      <span className="text-xs text-muted-foreground">Click any row to expand response + TRACe scores</span>
                    </div>
                    <BenchmarkResultsTable benchmarks={benchmarks} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}