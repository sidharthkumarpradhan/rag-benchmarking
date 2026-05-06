import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Search, FileText, Globe, ExternalLink, Database, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const PAGE_TYPE_COLORS = {
  general: 'bg-slate-100 text-slate-600',
  course: 'bg-blue-100 text-blue-700',
  faculty: 'bg-purple-100 text-purple-700',
  policy: 'bg-amber-100 text-amber-700',
  it_kb: 'bg-emerald-100 text-emerald-700',
  catalog: 'bg-rose-100 text-rose-700',
  news: 'bg-orange-100 text-orange-700',
  event: 'bg-cyan-100 text-cyan-700',
};

export default function Documents() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const { data: documents = [] } = useQuery({
    queryKey: ['allDocuments'],
    queryFn: () => base44.entities.CrawledDocument.list('-created_date', 500),
    refetchInterval: 15000,
  });

  const filtered = documents.filter(doc => {
    const matchSearch = !search ||
      (doc.title || '').toLowerCase().includes(search.toLowerCase()) ||
      (doc.url || '').toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || doc.page_type === typeFilter;
    const matchStatus = statusFilter === 'all' || doc.status === statusFilter;
    return matchSearch && matchType && matchStatus;
  });

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-card flex-shrink-0">
        <h1 className="font-display text-xl font-bold text-foreground">Document Explorer</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Browse all crawled Fairfield University content</p>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b bg-muted/30 flex flex-wrap gap-3 items-center flex-shrink-0">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="pl-9 h-8 text-sm"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder="Page Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {['general', 'course', 'faculty', 'policy', 'it_kb', 'catalog', 'news', 'event'].map(t => (
              <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="raw">Raw</SelectItem>
            <SelectItem value="indexed">Indexed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} documents</span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FileText className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground text-sm">No documents found. Run a crawl job from the Pipeline page.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.slice(0, 150).map(doc => (
              <button
                key={doc.id}
                onClick={() => setSelected(doc)}
                className="text-left bg-card border rounded-xl p-4 hover:border-primary hover:shadow-sm transition-all group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className={cn('text-xs px-1.5 py-0.5 rounded-md font-medium', PAGE_TYPE_COLORS[doc.page_type] || PAGE_TYPE_COLORS.general)}>
                    {doc.page_type || 'general'}
                  </span>
                  <div className="flex gap-1">
                    {doc.vector_indexed && <Database className="w-3 h-3 text-blue-500" title="Vector indexed" />}
                    {doc.graph_indexed && <GitBranch className="w-3 h-3 text-purple-500" title="Graph indexed" />}
                  </div>
                </div>
                <h3 className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                  {doc.title || '(no title)'}
                </h3>
                <p className="text-xs text-muted-foreground mt-1 truncate">{doc.url}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted-foreground">
                    {doc.word_count?.toLocaleString() || 0} words
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {doc.created_date ? formatDistanceToNow(new Date(doc.created_date), { addSuffix: true }) : ''}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        {selected && (
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-base">{selected.title || '(no title)'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', PAGE_TYPE_COLORS[selected.page_type])}>
                  {selected.page_type}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {selected.status}
                </span>
                {selected.vector_indexed && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Vector Indexed</span>
                )}
                {selected.chunk_count > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {selected.chunk_count} chunks
                  </span>
                )}
              </div>
              <a
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="w-3 h-3" /> {selected.url}
              </a>
              <div className="bg-muted rounded-xl p-4 text-xs text-foreground leading-relaxed max-h-64 overflow-y-auto scrollbar-thin font-mono whitespace-pre-wrap">
                {selected.content?.substring(0, 3000) || 'No content'}
                {(selected.content?.length || 0) > 3000 && '...'}
              </div>
              <p className="text-xs text-muted-foreground">
                {selected.word_count?.toLocaleString()} words · {selected.source_domain}
              </p>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}