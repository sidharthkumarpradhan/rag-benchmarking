import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import MetricCard from '@/components/benchmark/MetricCard';
import { LatencyChart, RadarCompareChart, TimelineChart } from '@/components/benchmark/RAGCompareChart';
import {
  Play, Plus, RefreshCw, Trophy, Clock, Zap,
  Database, Search, GitBranch, Star, ChevronRight, Loader2, BarChart3
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const RAG_STYLES = {
  vector: { label: 'Vector RAG', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', Icon: Database },
  vectorless: { label: 'Vectorless', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500', Icon: Search },
  graph_vector: { label: 'Graph Vector', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', dot: 'bg-purple-500', Icon: GitBranch },
};

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
};

export default function Benchmark() {
  const [selectedRun, setSelectedRun] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newRun, setNewRun] = useState({ name: '', description: '', model: 'meta-llama/llama-3.1-8b-instruct:free' });
  const [manualQuery, setManualQuery] = useState('');
  const [manualRag, setManualRag] = useState('vector');
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
  });

  const createRun = useMutation({
    mutationFn: async () => {
      const run = await base44.entities.TestRun.create({
        name: newRun.name,
        description: newRun.description,
        model_used: newRun.model,
        status: 'pending',
        rag_types_tested: ['vector', 'vectorless', 'graph_vector'],
      });
      return run;
    },
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['testRuns'] });
      setCreateOpen(false);
      setSelectedRun(run);
    }
  });

  const startBenchmark = useMutation({
    mutationFn: async (runId) => {
      return base44.functions.invoke('runBenchmark', {
        test_run_id: runId,
        model: selectedRun?.model_used || 'meta-llama/llama-3.1-8b-instruct:free',
        provider: 'openrouter'
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

  // Compute aggregate metrics from benchmarks
  const metrics = {};
  for (const rag of ['vector', 'vectorless', 'graph_vector']) {
    const ragBenchmarks = benchmarks.filter(b => b.rag_type === rag);
    metrics[rag] = {
      count: ragBenchmarks.length,
      avg_latency: ragBenchmarks.length > 0
        ? Math.round(ragBenchmarks.reduce((a, b) => a + (b.latency_ms || 0), 0) / ragBenchmarks.length)
        : null,
      avg_tokens: ragBenchmarks.length > 0
        ? Math.round(ragBenchmarks.reduce((a, b) => a + (b.tokens_used || 0), 0) / ragBenchmarks.length)
        : null,
      avg_rating: ragBenchmarks.filter(b => b.human_rating).length > 0
        ? (ragBenchmarks.filter(b => b.human_rating).reduce((a, b) => a + b.human_rating, 0) / ragBenchmarks.filter(b => b.human_rating).length).toFixed(1)
        : null,
    };
  }

  const latencyChartData = [{
    name: 'Avg Latency',
    vector: metrics.vector?.avg_latency,
    vectorless: metrics.vectorless?.avg_latency,
    graph_vector: metrics.graph_vector?.avg_latency,
  }];

  const radarData = [
    { metric: 'Speed', vector: metrics.vector?.avg_latency ? Math.max(0, 10 - metrics.vector.avg_latency / 500) : 0, vectorless: metrics.vectorless?.avg_latency ? Math.max(0, 10 - metrics.vectorless.avg_latency / 500) : 0, graph_vector: metrics.graph_vector?.avg_latency ? Math.max(0, 10 - metrics.graph_vector.avg_latency / 500) : 0 },
    { metric: 'Queries', vector: Math.min(10, metrics.vector?.count), vectorless: Math.min(10, metrics.vectorless?.count), graph_vector: Math.min(10, metrics.graph_vector?.count) },
    { metric: 'Human Rating', vector: metrics.vector?.avg_rating ? parseFloat(metrics.vector.avg_rating) * 2 : 0, vectorless: metrics.vectorless?.avg_rating ? parseFloat(metrics.vectorless.avg_rating) * 2 : 0, graph_vector: metrics.graph_vector?.avg_rating ? parseFloat(metrics.graph_vector.avg_rating) * 2 : 0 },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left: Test Runs List */}
      <div className="w-72 border-r bg-card flex flex-col overflow-hidden">
        <div className="px-4 py-4 border-b flex items-center justify-between flex-shrink-0">
          <h2 className="font-semibold text-sm text-foreground">Test Runs</h2>
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
                    placeholder="e.g. Initial Benchmark v1"
                    value={newRun.name}
                    onChange={e => setNewRun(p => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Description</label>
                  <Textarea
                    placeholder="Optional notes..."
                    value={newRun.description}
                    onChange={e => setNewRun(p => ({ ...p, description: e.target.value }))}
                    className="h-20"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Model</label>
                  <Select value={newRun.model} onValueChange={v => setNewRun(p => ({ ...p, model: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="meta-llama/llama-3.1-8b-instruct:free">Llama 3.1 8B (Free)</SelectItem>
                      <SelectItem value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (Free)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={() => createRun.mutate()}
                  disabled={!newRun.name || createRun.isPending}
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
                <span className="text-sm font-medium text-foreground truncate">{run.name}</span>
                <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', STATUS_STYLES[run.status])}>
                  {run.status}
                </span>
                {run.query_count > 0 && (
                  <span className="text-xs text-muted-foreground">{run.query_count} queries</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {format(new Date(run.created_date), 'MMM d, yyyy')}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Dashboard */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!selectedRun ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <BarChart3 className="w-16 h-16 text-muted-foreground/30 mb-4" />
            <h2 className="font-display text-2xl font-bold text-foreground mb-2">
              RAG Benchmark Dashboard
            </h2>
            <p className="text-muted-foreground max-w-sm text-sm">
              Create a test run and benchmark all three RAG architectures — Vector, Vectorless, and Graph Vector — across real Fairfield University data.
            </p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold text-foreground">{selectedRun.name}</h2>
                {selectedRun.description && (
                  <p className="text-sm text-muted-foreground mt-0.5">{selectedRun.description}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_STYLES[selectedRun.status])}>
                    {selectedRun.status}
                  </span>
                  {selectedRun.model_used && (
                    <span className="text-xs text-muted-foreground">{selectedRun.model_used}</span>
                  )}
                  {selectedRun.winner && (
                    <span className="flex items-center gap-1 text-xs font-medium text-amber-600">
                      <Trophy className="w-3 h-3" /> Winner: {RAG_STYLES[selectedRun.winner]?.label || selectedRun.winner}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => qc.invalidateQueries()}
                  className="gap-2"
                >
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
                    : <Play className="w-4 h-4" />
                  }
                  Run Benchmark
                </Button>
              </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(['vector', 'vectorless', 'graph_vector']).map(rag => {
                const s = RAG_STYLES[rag];
                return (
                  <div key={rag} className={cn('rounded-2xl border p-4', s.bg, s.border)}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={cn('w-2.5 h-2.5 rounded-full', s.dot)} />
                      <span className={cn('text-sm font-semibold', s.color)}>{s.label}</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Avg Latency
                        </span>
                        <span className="text-sm font-bold text-foreground">
                          {metrics[rag]?.avg_latency != null ? `${metrics[rag].avg_latency}ms` : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Zap className="w-3 h-3" /> Avg Tokens
                        </span>
                        <span className="text-sm font-bold text-foreground">
                          {metrics[rag]?.avg_tokens ?? '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Star className="w-3 h-3" /> Human Rating
                        </span>
                        <span className="text-sm font-bold text-foreground">
                          {metrics[rag]?.avg_rating ?? '—'}{metrics[rag]?.avg_rating ? '/5' : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Queries Run</span>
                        <span className="text-sm font-bold text-foreground">{metrics[rag]?.count || 0}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Charts */}
            {benchmarks.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-card border rounded-2xl p-4">
                  <h3 className="font-semibold text-sm mb-3">Latency Comparison</h3>
                  <LatencyChart data={latencyChartData} />
                </div>
                <div className="bg-card border rounded-2xl p-4">
                  <h3 className="font-semibold text-sm mb-3">Overall Performance Radar</h3>
                  <RadarCompareChart data={radarData} />
                </div>
              </div>
            )}

            {/* Manual Query */}
            <div className="bg-card border rounded-2xl p-4">
              <h3 className="font-semibold text-sm mb-3">Run Manual Query</h3>
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

            {/* Results Table */}
            {benchmarks.length > 0 && (
              <div className="bg-card border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b">
                  <h3 className="font-semibold text-sm">Query Results ({benchmarks.length})</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Query</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">RAG Type</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Latency</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Tokens</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Rating</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarks.slice(0, 50).map(b => {
                        const s = RAG_STYLES[b.rag_type];
                        return (
                          <tr key={b.id} className="border-b hover:bg-muted/20">
                            <td className="px-4 py-2 max-w-xs">
                              <p className="truncate text-xs">{b.query_text}</p>
                            </td>
                            <td className="px-4 py-2">
                              {s && (
                                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', s.color, s.bg)}>
                                  {s.label}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              {b.latency_ms ? `${b.latency_ms}ms` : '—'}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              {b.tokens_used ?? '—'}
                            </td>
                            <td className="px-4 py-2 text-xs">
                              {b.human_rating
                                ? <span className="text-amber-500">{'★'.repeat(b.human_rating)}</span>
                                : <span className="text-muted-foreground">Unrated</span>
                              }
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground capitalize">
                              {b.query_category}
                            </td>
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
      </div>
    </div>
  );
}