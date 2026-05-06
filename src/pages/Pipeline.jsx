import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import {
  Plus, Play, Globe, Database, FileText, CheckCircle2,
  AlertCircle, Loader2, Clock, ChevronRight, Layers, RefreshCw, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';

const FAIRFIELD_URLS = [
  'https://www.fairfield.edu',
  'https://catalog.fairfield.edu',
  'https://fairfield-university.atlassian.net/wiki/spaces/ITSKB/overview',
];

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-700', icon: Clock },
  running: { label: 'Running', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-rose-100 text-rose-700', icon: AlertCircle },
};

const DOC_STATUS_CONFIG = {
  raw: { color: 'bg-amber-100 text-amber-700' },
  processed: { color: 'bg-blue-100 text-blue-700' },
  indexed: { color: 'bg-emerald-100 text-emerald-700' },
  failed: { color: 'bg-rose-100 text-rose-700' },
};

const PAGE_TYPE_COLORS = {
  general: 'text-slate-500',
  course: 'text-blue-600',
  faculty: 'text-purple-600',
  policy: 'text-amber-600',
  it_kb: 'text-emerald-600',
  catalog: 'text-rose-600',
  news: 'text-orange-500',
  event: 'text-cyan-600',
};

export default function Pipeline() {
  const [crawlOpen, setCrawlOpen] = useState(false);
  const [newJob, setNewJob] = useState({
    name: 'Fairfield University Full Crawl',
    urls: FAIRFIELD_URLS,
    max_depth: 3,
    max_pages: 500,
  });
  const [urlInput, setUrlInput] = useState('');
  const qc = useQueryClient();

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

  const createAndCrawl = useMutation({
    mutationFn: async () => {
      const job = await base44.entities.CrawlJob.create({
        name: newJob.name,
        urls: newJob.urls,
        max_depth: newJob.max_depth,
        max_pages: newJob.max_pages,
        crawl_type: 'manual',
        status: 'pending',
      });
      return base44.functions.invoke('crawlWebsite', {
        job_id: job.id,
        urls: newJob.urls,
        max_depth: newJob.max_depth,
        max_pages: newJob.max_pages,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crawlJobs'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      setCrawlOpen(false);
    }
  });

  const indexDocs = useMutation({
    mutationFn: async () => {
      return base44.functions.invoke('indexDocuments', {
        index_targets: ['vector']
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] })
  });

  const addUrl = () => {
    if (urlInput.trim() && !newJob.urls.includes(urlInput.trim())) {
      setNewJob(p => ({ ...p, urls: [...p.urls, urlInput.trim()] }));
      setUrlInput('');
    }
  };

  const removeUrl = (url) => {
    setNewJob(p => ({ ...p, urls: p.urls.filter(u => u !== url) }));
  };

  // Stats
  const totalDocs = documents.length;
  const indexedDocs = documents.filter(d => d.vector_indexed).length;
  const rawDocs = documents.filter(d => d.status === 'raw').length;

  const pageTypeCounts = documents.reduce((acc, d) => {
    acc[d.page_type || 'general'] = (acc[d.page_type || 'general'] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="h-screen overflow-y-auto bg-background scrollbar-thin">
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">Data Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Agent 1: Web Crawling → Agent 2: Indexing to Vector/Graph DBs
            </p>
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
              variant="outline"
              size="sm"
              onClick={() => indexDocs.mutate()}
              disabled={indexDocs.isPending || rawDocs === 0}
              className="gap-2"
            >
              {indexDocs.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              Index to Qdrant ({rawDocs})
            </Button>
            <Dialog open={crawlOpen} onOpenChange={setCrawlOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Globe className="w-4 h-4" /> Start Crawl
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>New Crawl Job</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Job Name</label>
                    <Input
                      value={newJob.name}
                      onChange={e => setNewJob(p => ({ ...p, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Seed URLs</label>
                    <div className="space-y-1.5 mb-2">
                      {newJob.urls.map(url => (
                        <div key={url} className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5">
                          <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs flex-1 truncate">{url}</span>
                          <button
                            onClick={() => removeUrl(url)}
                            className="text-muted-foreground hover:text-destructive text-xs"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        placeholder="https://..."
                        className="text-xs h-8"
                        onKeyDown={e => e.key === 'Enter' && addUrl()}
                      />
                      <Button size="sm" variant="outline" onClick={addUrl} className="h-8">
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Max Depth</label>
                      <Input
                        type="number"
                        value={newJob.max_depth}
                        onChange={e => setNewJob(p => ({ ...p, max_depth: parseInt(e.target.value) }))}
                        min={1} max={10}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Max Pages</label>
                      <Input
                        type="number"
                        value={newJob.max_pages}
                        onChange={e => setNewJob(p => ({ ...p, max_pages: parseInt(e.target.value) }))}
                        min={10} max={5000}
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => createAndCrawl.mutate()}
                    disabled={!newJob.name || newJob.urls.length === 0 || createAndCrawl.isPending}
                  >
                    {createAndCrawl.isPending
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Play className="w-4 h-4" />
                    }
                    Start Crawling
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Documents', value: totalDocs, color: 'text-primary', icon: FileText },
            { label: 'Vector Indexed', value: indexedDocs, color: 'text-blue-600', icon: Database },
            { label: 'Awaiting Index', value: rawDocs, color: 'text-amber-600', icon: Clock },
            { label: 'Crawl Jobs', value: crawlJobs.length, color: 'text-purple-600', icon: Globe },
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

        {/* Pipeline Flow Diagram */}
        <div className="bg-card border rounded-2xl p-6">
          <h3 className="font-semibold text-sm mb-4">Pipeline Architecture</h3>
          <div className="flex items-center gap-3 flex-wrap">
            {[
              { label: 'Agent 1', sub: 'Firecrawl Web Crawler', icon: Globe, color: 'bg-amber-100 text-amber-700 border-amber-200' },
              { arrow: true },
              { label: 'Central Store', sub: 'Base44 Database', icon: Database, color: 'bg-blue-100 text-blue-700 border-blue-200' },
              { arrow: true },
              { label: 'Agent 2', sub: 'Chunking + Embedding', icon: Zap, color: 'bg-purple-100 text-purple-700 border-purple-200' },
              { arrow: true },
              { label: 'Qdrant', sub: 'Vector Store', icon: Database, color: 'bg-blue-100 text-blue-700 border-blue-200' },
            ].map((step, i) => {
              if (step.arrow) {
                return <ChevronRight key={i} className="w-5 h-5 text-muted-foreground flex-shrink-0" />;
              }
              return (
                <div key={i} className={cn('flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium', step.color)}>
                  <step.icon className="w-4 h-4" />
                  <div>
                    <p className="font-semibold text-xs">{step.label}</p>
                    <p className="text-xs opacity-70">{step.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Crawl Jobs */}
        {crawlJobs.length > 0 && (
          <div className="bg-card border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">Crawl Jobs</h3>
            </div>
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
                      <p className="text-sm font-medium text-foreground">{job.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {job.pages_crawled || 0} / {job.pages_total || '?'} pages
                        </span>
                        {job.started_at && (
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(job.started_at), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                      {job.status === 'running' && job.pages_total > 0 && (
                        <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', sc.color)}>
                      {sc.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Document Sample */}
        {documents.length > 0 && (
          <div className="bg-card border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-sm">Crawled Documents ({totalDocs})</h3>
              <div className="flex gap-1.5 flex-wrap">
                {Object.entries(pageTypeCounts).map(([type, count]) => (
                  <span key={type} className={cn('text-xs font-medium', PAGE_TYPE_COLORS[type])}>
                    {type}: {count}
                  </span>
                ))}
              </div>
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
                      <td className="px-4 py-2">
                        <span className={cn('text-xs font-medium capitalize', PAGE_TYPE_COLORS[doc.page_type])}>
                          {doc.page_type}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {doc.word_count?.toLocaleString() || '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', DOC_STATUS_CONFIG[doc.status]?.color)}>
                          {doc.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}