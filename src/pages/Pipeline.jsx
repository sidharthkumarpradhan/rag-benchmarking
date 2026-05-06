/**
 * StagAI Data Pipeline — Multi-Agent Orchestrator Dashboard
 * Inspired by ai-maestro: AMP protocol, persistent shared state, full audit trail
 */
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

const FAIRFIELD_URLS = [
  'https://www.fairfield.edu',
  'https://catalog.fairfield.edu',
  'https://fairfield-university.atlassian.net/wiki/spaces/ITSKB/overview',
];

const STATUS_CONFIG = {
  pending:   { label: 'Pending',   color: 'bg-amber-100 text-amber-700',   icon: Clock },
  running:   { label: 'Running',   color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  failed:    { label: 'Failed',    color: 'bg-rose-100 text-rose-700',    icon: AlertCircle },
};

const PIPELINE_TABS = [
  { id: 'orchestrator', label: 'Multi-Agent Run', icon: Brain },
  { id: 'crawl',        label: 'Data Pipeline',   icon: Globe },
  { id: 'audit',        label: 'Audit Trail',     icon: Eye },
];

export default function Pipeline() {
  const [activeTab, setActiveTab] = useState('orchestrator');
  const [selectedSession, setSelectedSession] = useState(null);
  const [demoGoal, setDemoGoal] = useState('Run a full demo of the StagAI multi-agent pipeline to verify all RAG architectures work correctly for Fairfield University.');
  const [crawlOpen, setCrawlOpen] = useState(false);
  const [newJob, setNewJob] = useState({ name: 'Fairfield University Full Crawl', urls: FAIRFIELD_URLS, max_depth: 2, max_pages: 100 });
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
              AMP-style agent orchestration — persistent shared state, full audit trail
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