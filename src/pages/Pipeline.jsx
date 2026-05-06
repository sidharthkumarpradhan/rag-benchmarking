/**
 * StagAI Data Pipeline — Multi-Agent Orchestrator Dashboard
 * Inspired by ai-maestro: AMP protocol, persistent shared state, full audit trail
 */
import { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import {
  Plus, Play, Globe, Database, FileText, CheckCircle2,
  AlertCircle, Loader2, Clock, ChevronRight, RefreshCw, Zap,
  Brain, Cpu, Network, Eye, Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';

import AgentCard from '@/components/pipeline/AgentCard';
import AMPMessageFlow from '@/components/pipeline/AMPMessageFlow';
import SharedStatePanel from '@/components/pipeline/SharedStatePanel';
import FinalReportCard from '@/components/pipeline/FinalReportCard';

const DEFAULT_URLS = [
  'https://www.example.com',
];

const STATUS_CONFIG = {
  pending:   { label: 'Pending',   color: 'bg-amber-100 text-amber-700',   icon: Clock },
  running:   { label: 'Running',   color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  failed:    { label: 'Failed',    color: 'bg-rose-100 text-rose-700',    icon: AlertCircle },
};

const PIPELINE_TABS = [
  { id: 'e2e',          label: '3-RAG Benchmark',  icon: Zap },
  { id: 'orchestrator', label: 'Multi-Agent Run',  icon: Brain },
  { id: 'crawl',        label: 'Data Pipeline',    icon: Globe },
  { id: 'audit',        label: 'Audit Trail',      icon: Eye },
];

const RAG_STYLES = {
  vector:       { label: 'Vector RAG',   color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-200',    dot: 'bg-blue-500',    desc: 'Qdrant semantic search + BAAI embeddings' },
  vectorless:   { label: 'Vectorless',   color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500', desc: 'BM25 keyword retrieval from Base44 DB' },
  graph_vector: { label: 'Graph+Vector', color: 'text-purple-600',  bg: 'bg-purple-50',  border: 'border-purple-200',  dot: 'bg-purple-500',  desc: 'FalkorDB graph expansion + Qdrant' },
};

export default function Pipeline() {
  const [activeTab, setActiveTab] = useState('e2e');
  const [e2eUrl, setE2eUrl] = useState('https://en.wikipedia.org/wiki/Retrieval-augmented_generation');
  const [e2eMaxPages, setE2eMaxPages] = useState(15);
  const [e2eRagTypes, setE2eRagTypes] = useState(['vector', 'vectorless', 'graph_vector']);
  const [e2eRunning, setE2eRunning] = useState(false);
  const [e2eResult, setE2eResult] = useState(null);
  const [e2eError, setE2eError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [demoGoal, setDemoGoal] = useState('Run a full demo of the Crawlect AI multi-agent pipeline to verify all RAG architectures work correctly on the indexed knowledge base.');
  const [crawlOpen, setCrawlOpen] = useState(false);
  const [newJob, setNewJob] = useState({ name: 'New Crawl Job', urls: DEFAULT_URLS, max_depth: 2, max_pages: 100 });
  const [urlInput, setUrlInput] = useState('');
  const qc = useQueryClient();

  const { data: sessions = [] } = useQuery({
    queryKey: ['pipelineSessions'],
    queryFn: () => base44.entities.PipelineSession.list('-created_date', 20),
    refetchInterval: 3000,
  });

  const { data: agentRuns = [] } = useQuery({
    queryKey: ['agentRuns', selectedSession?.id],
    queryFn: () => base44.entities.AgentRun.filter({ pipeline_id: selectedSession?.id }, 'created_date', 20),
    enabled: !!selectedSession?.id,
    refetchInterval: selectedSession?.status === 'running' ? 1500 : false,
  });

  const { data: crawlJobs = [] } = useQuery({
    queryKey: ['crawlJobs'],
    queryFn: () => base44.entities.CrawlJob.list('-created_date', 20),
    refetchInterval: 5000,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: () => base44.entities.CrawledDocument.list('-created_date', 100),
    refetchInterval: 10000,
  });

  const [e2eTestRunId, setE2eTestRunId] = useState(null);
  const { data: e2eTestRun } = useQuery({
    queryKey: ['e2eTestRun', e2eTestRunId],
    queryFn: () => base44.entities.TestRun.filter({ id: e2eTestRunId }).then(r => r[0]),
    enabled: !!e2eTestRunId,
    refetchInterval: e2eRunning ? 4000 : false,
  });
  const { data: e2eBenchmarks = [] } = useQuery({
    queryKey: ['e2eBenchmarks', e2eTestRunId],
    queryFn: () => base44.entities.QueryBenchmark.filter({ test_run_id: e2eTestRunId }),
    enabled: !!e2eTestRunId,
    refetchInterval: e2eRunning ? 4000 : false,
  });

  const selectedSessionLive = sessions.find(s => s.id === selectedSession?.id) || selectedSession;

  const startDemoRun = useMutation({
    mutationFn: async () => {
      const session = await base44.entities.PipelineSession.create({
        name: `Demo Run — ${format(new Date(), 'MMM d HH:mm')}`,
        pipeline_type: 'demo_run',
        status: 'pending',
        shared_state: {},
        agents_completed: [],
        total_agents: 5,
        completed_agents: 0,
      });
      setSelectedSession(session);
      return base44.functions.invoke('runMultiAgentPipeline', {
        session_id: session.id,
        goal: demoGoal,

      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelineSessions'] });
      qc.invalidateQueries({ queryKey: ['agentRuns'] });
    },
  });

  const createAndCrawl = useMutation({
    mutationFn: async () => {
      const job = await base44.entities.CrawlJob.create({
        name: newJob.name, urls: newJob.urls, max_depth: newJob.max_depth,
        max_pages: newJob.max_pages, crawl_type: 'manual', status: 'pending',
      });
      return base44.functions.invoke('crawlWebsite', {
        job_id: job.id, urls: newJob.urls, max_depth: newJob.max_depth, max_pages: newJob.max_pages,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crawlJobs'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      setCrawlOpen(false);
    }
  });

  const indexDocs = useMutation({
    mutationFn: () => base44.functions.invoke('indexDocuments', { index_targets: ['vector'] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] })
  });

  const deleteSession = useMutation({
    mutationFn: (id) => base44.entities.PipelineSession.delete(id),
    onSuccess: () => {
      setSelectedSession(null);
      qc.invalidateQueries({ queryKey: ['pipelineSessions'] });
    }
  });

  // Watch e2eTestRun for completion
  const prevE2eStatus = useRef(null);
  if (e2eTestRun?.status === 'completed' && e2eRunning) setE2eRunning(false);

  async function runE2EBenchmark() {
    setE2eRunning(true);
    setE2eResult(null);
    setE2eError(null);
    setE2eTestRunId(null);
    try {
      const res = await base44.functions.invoke('crawlAndBenchmark', {
        seed_url: e2eUrl,
        max_pages: e2eMaxPages,
        rag_types: e2eRagTypes,
      });
      if (res.data?.error) throw new Error(res.data.error);
      setE2eResult(res.data);
      setE2eTestRunId(res.data.test_run_id);
      qc.invalidateQueries({ queryKey: ['crawlJobs'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (e) {
      setE2eError(e.message);
      setE2eRunning(false);
    }
  }

  // Compute per-RAG metrics from benchmarks
  function computeE2eMetrics() {
    const result = {};
    for (const rag of e2eRagTypes) {
      const items = e2eBenchmarks.filter(b => b.rag_type === rag);
      if (!items.length) { result[rag] = null; continue; }
      const avg = arr => { const v = arr.filter(x => x != null); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; };
      const utils = items.map(b => { const m = b.human_notes?.match(/utilization:([\d.]+)/); return m ? parseFloat(m[1]) : null; });
      result[rag] = {
        count: items.length,
        avg_latency: Math.round(avg(items.map(b => b.latency_ms)) || 0),
        context_relevance: avg(items.map(b => b.relevance_score)),
        faithfulness: avg(items.map(b => b.faithfulness_score)),
        completeness: avg(items.map(b => b.completeness_score)),
        utilization: avg(utils),
      };
    }
    return result;
  }

  const addUrl = () => {
    if (urlInput.trim() && !newJob.urls.includes(urlInput.trim())) {
      setNewJob(p => ({ ...p, urls: [...p.urls, urlInput.trim()] }));
      setUrlInput('');
    }
  };

  const totalDocs = documents.length;
  const indexedDocs = documents.filter(d => d.vector_indexed).length;
  const rawDocs = documents.filter(d => d.status === 'raw').length;
  const pipelineProgress = selectedSessionLive
    ? Math.round(((selectedSessionLive.completed_agents || 0) / Math.max(selectedSessionLive.total_agents || 5, 1)) * 100)
    : 0;

  return (
    <div className="h-screen overflow-y-auto bg-background scrollbar-thin">
      <div className="p-6 space-y-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
              <Cpu className="w-6 h-6 text-primary" />
              Multi-Agent Pipeline
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Crawl any website → index → query with multi-agent RAG orchestration
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={() => indexDocs.mutate()}
              disabled={indexDocs.isPending || rawDocs === 0}
            >
              {indexDocs.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              Index ({rawDocs} raw)
            </Button>
            <Dialog open={crawlOpen} onOpenChange={setCrawlOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Globe className="w-4 h-4" /> Start Crawl
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>New Crawl Job</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Job Name</label>
                    <Input value={newJob.name} onChange={e => setNewJob(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Seed URLs</label>
                    <div className="space-y-1.5 mb-2">
                      {newJob.urls.map(url => (
                        <div key={url} className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5">
                          <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs flex-1 truncate">{url}</span>
                          <button onClick={() => setNewJob(p => ({ ...p, urls: p.urls.filter(u => u !== url) }))} className="text-muted-foreground hover:text-destructive text-xs">✕</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://..." className="text-xs h-8" onKeyDown={e => e.key === 'Enter' && addUrl()} />
                      <Button size="sm" variant="outline" onClick={addUrl} className="h-8"><Plus className="w-3 h-3" /></Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Max Depth</label>
                      <Input type="number" value={newJob.max_depth} onChange={e => setNewJob(p => ({ ...p, max_depth: parseInt(e.target.value) }))} min={1} max={5} />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Max Pages</label>
                      <Input type="number" value={newJob.max_pages} onChange={e => setNewJob(p => ({ ...p, max_pages: parseInt(e.target.value) }))} min={10} max={500} />
                    </div>
                  </div>
                  <Button className="w-full gap-2" onClick={() => createAndCrawl.mutate()} disabled={!newJob.name || newJob.urls.length === 0 || createAndCrawl.isPending}>
                    {createAndCrawl.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Start Crawling
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Documents', value: totalDocs, color: 'text-primary', icon: FileText },
            { label: 'Vector Indexed', value: indexedDocs, color: 'text-blue-600', icon: Database },
            { label: 'Awaiting Index', value: rawDocs, color: 'text-amber-600', icon: Clock },
            { label: 'Pipeline Runs', value: sessions.length, color: 'text-violet-600', icon: Network },
          ].map(s => (
            <div key={s.label} className="bg-card border rounded-2xl p-4 flex items-center gap-3">
              <div className={cn('p-2 rounded-xl bg-muted', s.color)}>
                <s.icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {PIPELINE_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── E2E BENCHMARK TAB ── */}
        {activeTab === 'e2e' && (
          <div className="space-y-6">
            {/* Config card */}
            <div className="bg-card border rounded-2xl p-5 space-y-4">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-secondary" />
                  Crawl any website → Index → Benchmark all 3 RAG architectures
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">No external API keys needed — uses native fetch crawler + Qdrant + FalkorDB + BM25</p>
              </div>

              {/* RAG Architecture cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {Object.entries(RAG_STYLES).map(([key, s]) => (
                  <div key={key} className={cn('rounded-xl border p-3', s.bg, s.border)}>
                    <div className={cn('font-semibold text-xs flex items-center gap-1.5', s.color)}>
                      <div className={cn('w-2 h-2 rounded-full', s.dot)} />
                      {s.label}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
                  </div>
                ))}
              </div>

              {/* Inputs */}
              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-64">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Target Website URL</label>
                  <Input
                    value={e2eUrl}
                    onChange={e => setE2eUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="font-mono text-sm"
                    disabled={e2eRunning}
                  />
                </div>
                <div className="w-32">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Max Pages</label>
                  <Input
                    type="number"
                    value={e2eMaxPages}
                    onChange={e => setE2eMaxPages(parseInt(e.target.value))}
                    min={5} max={30}
                    disabled={e2eRunning}
                  />
                </div>
              </div>

              {/* Quick picks */}
              <div className="flex flex-wrap gap-2">
                {[
                  'https://en.wikipedia.org/wiki/Retrieval-augmented_generation',
                  'https://www.fairfield.edu',
                  'https://docs.python.org/3/',
                ].map(u => (
                  <button
                    key={u}
                    disabled={e2eRunning}
                    onClick={() => setE2eUrl(u)}
                    className={cn(
                      'text-xs px-2.5 py-1 rounded-full border font-medium transition-colors',
                      e2eUrl === u ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground hover:text-foreground border-transparent'
                    )}
                  >
                    {new URL(u).hostname}
                  </button>
                ))}
              </div>

              {/* RAG type selector */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">RAG types to benchmark:</label>
                <div className="flex gap-2">
                  {Object.entries(RAG_STYLES).map(([key, s]) => (
                    <button
                      key={key}
                      disabled={e2eRunning}
                      onClick={() => setE2eRagTypes(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key])}
                      className={cn(
                        'text-xs px-3 py-1.5 rounded-full border font-medium transition-colors',
                        e2eRagTypes.includes(key) ? `${s.color} ${s.bg} ${s.border}` : 'bg-muted text-muted-foreground border-transparent'
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {e2eError && (
                <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{e2eError}</p>
              )}

              <Button
                className="w-full gap-2"
                onClick={runE2EBenchmark}
                disabled={e2eRunning || !e2eUrl || e2eRagTypes.length === 0}
              >
                {e2eRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {e2eRunning ? 'Running pipeline...' : 'Start E2E Benchmark'}
              </Button>
            </div>

            {/* Live progress */}
            {e2eResult && (
              <div className="bg-card border rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm">Pipeline Progress</h4>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                    e2eTestRun?.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                    e2eTestRun?.status === 'running' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                    'bg-amber-100 text-amber-700'
                  )}>
                    {e2eTestRun?.status || 'indexing'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-muted/40 rounded-xl p-3">
                    <p className="text-xl font-bold text-foreground">{e2eResult.pages_crawled}</p>
                    <p className="text-xs text-muted-foreground">Pages crawled</p>
                  </div>
                  <div className="bg-muted/40 rounded-xl p-3">
                    <p className="text-xl font-bold text-blue-600">{e2eResult.indexed_chunks ?? e2eResult.indexed ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Chunks indexed</p>
                  </div>
                  <div className="bg-muted/40 rounded-xl p-3">
                    <p className="text-xl font-bold text-emerald-600">{e2eBenchmarks.length}</p>
                    <p className="text-xs text-muted-foreground">Queries scored</p>
                  </div>
                </div>
                {e2eRunning && (
                  <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                    Benchmark running — 10 queries × {e2eRagTypes.length} RAG types with LLM-as-Judge scoring (~3–5 min)
                  </div>
                )}
              </div>
            )}

            {/* Results */}
            {e2eBenchmarks.length > 0 && (() => {
              const m = computeE2eMetrics();
              const winner = e2eTestRun?.winner;
              return (
                <div className="space-y-4">
                  {/* Winner */}
                  {winner && RAG_STYLES[winner] && (
                    <div className={cn('rounded-2xl border-2 p-4 flex items-center gap-3', RAG_STYLES[winner].bg, RAG_STYLES[winner].border)}>
                      <CheckCircle2 className={cn('w-6 h-6', RAG_STYLES[winner].color)} />
                      <div>
                        <p className={cn('font-bold text-base', RAG_STYLES[winner].color)}>{RAG_STYLES[winner].label} wins</p>
                        <p className="text-xs text-muted-foreground">Best composite TRACe score (Context Relevance + Faithfulness + Completeness + Utilization)</p>
                      </div>
                    </div>
                  )}

                  {/* Metrics table */}
                  <div className="bg-card border rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b"><h4 className="font-semibold text-sm">TRACe Scores (0–10)</h4></div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Metric</th>
                            {e2eRagTypes.map(r => (
                              <th key={r} className={cn('text-center px-4 py-2 text-xs font-semibold', RAG_STYLES[r]?.color)}>
                                {RAG_STYLES[r]?.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { key: 'context_relevance', label: 'Context Relevance' },
                            { key: 'faithfulness', label: 'Faithfulness' },
                            { key: 'completeness', label: 'Completeness' },
                            { key: 'utilization', label: 'Utilization' },
                          ].map(({ key, label }) => (
                            <tr key={key} className="border-b">
                              <td className="px-4 py-2 text-xs text-muted-foreground font-medium">{label}</td>
                              {e2eRagTypes.map(r => {
                                const v = m[r]?.[key];
                                const color = v == null ? '' : v >= 7 ? 'text-emerald-600' : v >= 4 ? 'text-amber-600' : 'text-rose-600';
                                return <td key={r} className="px-4 py-2 text-center"><span className={cn('font-bold text-sm', color)}>{v != null ? v.toFixed(1) : '—'}</span></td>;
                              })}
                            </tr>
                          ))}
                          <tr className="border-b bg-muted/10">
                            <td className="px-4 py-2 text-xs text-muted-foreground font-medium">Avg Latency</td>
                            {e2eRagTypes.map(r => (
                              <td key={r} className="px-4 py-2 text-center text-xs font-semibold text-foreground">
                                {m[r]?.avg_latency ? `${m[r].avg_latency}ms` : '—'}
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <td className="px-4 py-2 text-xs text-muted-foreground font-medium">Queries run</td>
                            {e2eRagTypes.map(r => (
                              <td key={r} className="px-4 py-2 text-center text-xs text-muted-foreground">{m[r]?.count ?? '—'}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Latency bars */}
                  <div className="bg-card border rounded-2xl p-4 space-y-3">
                    <h4 className="font-semibold text-sm">Latency Comparison</h4>
                    {e2eRagTypes.map(r => {
                      const lat = m[r]?.avg_latency || 0;
                      const maxLat = Math.max(...e2eRagTypes.map(rt => m[rt]?.avg_latency || 0), 1);
                      return (
                        <div key={r} className="flex items-center gap-3">
                          <span className={cn('text-xs font-medium w-24 flex-shrink-0', RAG_STYLES[r]?.color)}>{RAG_STYLES[r]?.label}</span>
                          <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                            <div className={cn('h-full rounded-full transition-all duration-700', RAG_STYLES[r]?.dot)} style={{ width: `${(lat / maxLat) * 100}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground w-16 text-right">{lat ? `${lat}ms` : '—'}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Query breakdown */}
                  <div className="bg-card border rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b"><h4 className="font-semibold text-sm">Per-Query Results ({e2eBenchmarks.length})</h4></div>
                    <div className="divide-y max-h-80 overflow-y-auto scrollbar-thin">
                      {e2eBenchmarks.map(b => (
                        <div key={b.id} className="px-4 py-3 flex items-start gap-3">
                          <span className={cn('mt-0.5 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 border',
                            RAG_STYLES[b.rag_type]?.bg, RAG_STYLES[b.rag_type]?.color, RAG_STYLES[b.rag_type]?.border
                          )}>
                            {RAG_STYLES[b.rag_type]?.label}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium">{b.query_text}</p>
                            <div className="flex gap-3 mt-1 flex-wrap text-xs text-muted-foreground">
                              {b.relevance_score != null && <span>CR: <b>{b.relevance_score.toFixed(1)}</b></span>}
                              {b.faithfulness_score != null && <span>F: <b>{b.faithfulness_score.toFixed(1)}</b></span>}
                              {b.completeness_score != null && <span>C: <b>{b.completeness_score.toFixed(1)}</b></span>}
                              {b.latency_ms && <span>{b.latency_ms}ms</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ORCHESTRATOR TAB */}
        {activeTab === 'orchestrator' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Launch Panel */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-card border rounded-2xl p-4 space-y-3">
                  <h3 className="font-semibold text-sm">Launch Demo Run</h3>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Pipeline Goal</label>
                    <Textarea
                      value={demoGoal}
                      onChange={e => setDemoGoal(e.target.value)}
                      className="h-24 text-xs resize-none"
                    />
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => startDemoRun.mutate()}
                    disabled={startDemoRun.isPending}
                  >
                    {startDemoRun.isPending
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Zap className="w-4 h-4" />}
                    {startDemoRun.isPending ? 'Agents Running...' : 'Run Multi-Agent Pipeline'}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    6 agents: Orchestrator → Crawler → Indexer → RAGQuery → LLMJudge → Reporter
                  </p>
                </div>

                {sessions.length > 0 && (
                  <div className="bg-card border rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b">
                      <h3 className="font-semibold text-sm">Pipeline Sessions</h3>
                    </div>
                    <div className="divide-y max-h-64 overflow-y-auto scrollbar-thin">
                      {sessions.map(s => {
                        const sc = STATUS_CONFIG[s.status] || STATUS_CONFIG.pending;
                        const Icon = sc.icon;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setSelectedSession(s)}
                            className={cn(
                              'w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors',
                              selectedSession?.id === s.id && 'bg-accent'
                            )}
                          >
                            <Icon className={cn('w-3.5 h-3.5 flex-shrink-0',
                              s.status === 'running' && 'animate-spin text-blue-500',
                              s.status === 'completed' && 'text-emerald-500'
                            )} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{s.name}</p>
                              <p className="text-xs text-muted-foreground">{s.completed_agents || 0}/{s.total_agents || 5} agents</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteSession.mutate(s.id); }}
                              className="text-muted-foreground hover:text-destructive p-1"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Run Detail Panel */}
              <div className="lg:col-span-2 space-y-4">
                {!selectedSessionLive ? (
                  <div className="bg-card border rounded-2xl p-12 text-center">
                    <Network className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-sm font-medium text-foreground">No session selected</p>
                    <p className="text-xs text-muted-foreground mt-1">Launch a pipeline run or select a previous session.</p>
                  </div>
                ) : (
                  <>
                    {/* Progress Bar */}
                    <div className="bg-card border rounded-2xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h3 className="font-semibold text-sm">{selectedSessionLive.name}</h3>
                          <p className="text-xs text-muted-foreground">
                            {selectedSessionLive.completed_agents || 0} / {selectedSessionLive.total_agents || 5} agents complete
                            {selectedSessionLive.total_tokens > 0 && ` · ${selectedSessionLive.total_tokens} tokens`}
                          </p>
                        </div>
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_CONFIG[selectedSessionLive.status]?.color)}>
                          {selectedSessionLive.status}
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${pipelineProgress}%` }}
                        />
                      </div>
                    </div>

                    {/* AMP Flow */}
                    <AMPMessageFlow runs={agentRuns} currentAgent={selectedSessionLive.current_agent} />

                    {/* Agent Cards */}
                    {agentRuns.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="font-semibold text-sm">Agent Execution Log</h3>
                        {agentRuns.map(run => (
                          <AgentCard
                            key={run.id}
                            run={run}
                            isActive={selectedSessionLive.current_agent === run.agent_name}
                          />
                        ))}
                      </div>
                    )}

                    {selectedSessionLive.status === 'running' && agentRuns.length === 0 && (
                      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center">
                        <Loader2 className="w-8 h-8 text-blue-500 mx-auto mb-2 animate-spin" />
                        <p className="text-sm font-medium text-blue-700">Agents initializing...</p>
                      </div>
                    )}

                    {selectedSessionLive.status === 'completed' && (
                      <FinalReportCard report={selectedSessionLive.final_output} />
                    )}
                  </>
                )}
              </div>
            </div>

            {selectedSessionLive?.shared_state && Object.keys(selectedSessionLive.shared_state).length > 0 && (
              <SharedStatePanel sharedState={selectedSessionLive.shared_state} />
            )}
          </div>
        )}

        {/* DATA PIPELINE TAB */}
        {activeTab === 'crawl' && (
          <div className="space-y-6">
            <div className="bg-card border rounded-2xl p-5">
              <h3 className="font-semibold text-sm mb-3">Pipeline Architecture</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { label: 'Agent 1', sub: 'Firecrawl Web Crawler', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: Globe },
                  null,
                  { label: 'Central Store', sub: 'Base44 Database', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Database },
                  null,
                  { label: 'Agent 2', sub: 'Chunking + Embedding', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: Zap },
                  null,
                  { label: 'Qdrant', sub: 'Vector Store', color: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: Database },
                ].map((step, i) => step === null
                  ? <ChevronRight key={i} className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  : (
                    <div key={i} className={cn('flex items-center gap-2 px-4 py-2.5 rounded-xl border font-medium', step.color)}>
                      <step.icon className="w-4 h-4" />
                      <div>
                        <p className="font-semibold text-xs">{step.label}</p>
                        <p className="text-xs opacity-70">{step.sub}</p>
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>

            {crawlJobs.length > 0 && (
              <div className="bg-card border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b"><h3 className="font-semibold text-sm">Crawl Jobs</h3></div>
                <div className="divide-y">
                  {crawlJobs.map(job => {
                    const sc = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending;
                    const progress = job.pages_total > 0 ? (job.pages_crawled / job.pages_total) * 100 : 0;
                    return (
                      <div key={job.id} className="px-4 py-3 flex items-center gap-4">
                        <div className={cn('p-1.5 rounded-lg', sc.color)}>
                          <sc.icon className={cn('w-3.5 h-3.5', job.status === 'running' && 'animate-spin')} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{job.name}</p>
                          <div className="flex gap-3 mt-0.5">
                            <span className="text-xs text-muted-foreground">{job.pages_crawled || 0} / {job.pages_total || '?'} pages</span>
                            {job.started_at && <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(job.started_at), { addSuffix: true })}</span>}
                          </div>
                          {job.status === 'running' && job.pages_total > 0 && (
                            <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                            </div>
                          )}
                        </div>
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', sc.color)}>{sc.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {documents.length > 0 ? (
              <div className="bg-card border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b">
                  <h3 className="font-semibold text-sm">Crawled Documents ({totalDocs})</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Title / URL</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Type</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Words</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.slice(0, 30).map(doc => (
                        <tr key={doc.id} className="border-b hover:bg-muted/20">
                          <td className="px-4 py-2">
                            <p className="text-xs font-medium truncate max-w-xs">{doc.title || '(no title)'}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-xs">{doc.url}</p>
                          </td>
                          <td className="px-4 py-2 text-xs capitalize text-muted-foreground">{doc.page_type}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{doc.word_count?.toLocaleString() || '—'}</td>
                          <td className="px-4 py-2">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                              doc.status === 'indexed' ? 'bg-emerald-100 text-emerald-700' :
                              doc.status === 'raw' ? 'bg-amber-100 text-amber-700' :
                              'bg-muted text-muted-foreground'
                            )}>{doc.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-card border border-dashed rounded-2xl p-10 text-center">
                <Globe className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No documents yet. Start a crawl job to populate the knowledge base.</p>
              </div>
            )}
          </div>
        )}

        {/* AUDIT TRAIL TAB */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Full Audit Trail — All Pipeline Sessions</h3>
            </div>
            {sessions.length === 0 ? (
              <div className="bg-card border border-dashed rounded-2xl p-10 text-center">
                <p className="text-sm text-muted-foreground">No pipeline runs yet. Go to "Multi-Agent Run" and launch a demo.</p>
              </div>
            ) : (
              sessions.map(session => (
                <div key={session.id} className="bg-card border rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{session.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {session.completed_agents || 0}/{session.total_agents || 5} agents · {session.total_tokens || 0} tokens · {format(new Date(session.created_date), 'MMM d HH:mm')}
                      </p>
                    </div>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_CONFIG[session.status]?.color)}>
                      {session.status}
                    </span>
                    <button
                      onClick={() => { setSelectedSession(session); setActiveTab('orchestrator'); }}
                      className="text-xs text-primary hover:underline"
                    >View →</button>
                  </div>
                  {session.final_output?.executive_summary && (
                    <div className="px-4 py-3">
                      <p className="text-xs text-muted-foreground">{session.final_output.executive_summary}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </div>
  );
}