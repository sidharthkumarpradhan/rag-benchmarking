import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  GitBranch, Plus, Star, GitFork, CircleDot, CheckCircle2,
  ExternalLink, RefreshCw, Loader2, AlertCircle, Tag
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const LABEL_COLORS = {
  bug: 'bg-rose-100 text-rose-700',
  enhancement: 'bg-blue-100 text-blue-700',
  documentation: 'bg-amber-100 text-amber-700',
  question: 'bg-purple-100 text-purple-700',
  research: 'bg-emerald-100 text-emerald-700',
  rag: 'bg-cyan-100 text-cyan-700',
};

export default function GitHubTracker() {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [configured, setConfigured] = useState(false);
  const [stateFilter, setStateFilter] = useState('open');
  const [createOpen, setCreateOpen] = useState(false);
  const [newIssue, setNewIssue] = useState({ title: '', body: '', labels: '' });
  const qc = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['githubStats', owner, repo],
    queryFn: async () => {
      const res = await base44.functions.invoke('githubIssues', { action: 'stats', owner, repo });
      return res.data;
    },
    enabled: configured,
    refetchInterval: 60000,
  });

  const { data: issuesData, isLoading: issuesLoading } = useQuery({
    queryKey: ['githubIssues', owner, repo, stateFilter],
    queryFn: async () => {
      const res = await base44.functions.invoke('githubIssues', { action: 'list', owner, repo, state: stateFilter });
      return res.data;
    },
    enabled: configured,
    refetchInterval: 30000,
  });

  const createIssue = useMutation({
    mutationFn: async () => {
      const labels = newIssue.labels ? newIssue.labels.split(',').map(l => l.trim()).filter(Boolean) : [];
      return base44.functions.invoke('githubIssues', {
        action: 'create', owner, repo,
        title: newIssue.title,
        body: newIssue.body,
        labels
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['githubIssues'] });
      qc.invalidateQueries({ queryKey: ['githubStats'] });
      setCreateOpen(false);
      setNewIssue({ title: '', body: '', labels: '' });
    }
  });

  const closeIssue = useMutation({
    mutationFn: async (issue_number) => {
      return base44.functions.invoke('githubIssues', { action: 'close', owner, repo, issue_number });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['githubIssues'] });
      qc.invalidateQueries({ queryKey: ['githubStats'] });
    }
  });

  const issues = issuesData?.issues || [];

  if (!configured) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="bg-card border rounded-2xl p-8 max-w-sm w-full mx-4 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold">GitHub Tracker</h2>
              <p className="text-xs text-muted-foreground">StagAI Development Issues</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Repository Owner</label>
              <Input value={owner} onChange={e => setOwner(e.target.value)} placeholder="e.g. fairfield-university" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Repository Name</label>
              <Input value={repo} onChange={e => setRepo(e.target.value)} placeholder="e.g. stagai" />
            </div>
            <Button className="w-full" onClick={() => setConfigured(true)} disabled={!owner || !repo}>
              Connect Repository
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-background scrollbar-thin">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-foreground">{owner}/{repo}</h1>
              <p className="text-sm text-muted-foreground">StagAI Development Tracker</p>
            </div>
            {stats?.html_url && (
              <a href={stats.html_url} target="_blank" rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary transition-colors">
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfigured(false)} className="text-xs text-muted-foreground">
              Change Repo
            </Button>
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="w-4 h-4" /> New Issue
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create GitHub Issue</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Title</label>
                    <Input
                      value={newIssue.title}
                      onChange={e => setNewIssue(p => ({ ...p, title: e.target.value }))}
                      placeholder="Issue title..."
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Description</label>
                    <Textarea
                      value={newIssue.body}
                      onChange={e => setNewIssue(p => ({ ...p, body: e.target.value }))}
                      placeholder="Describe the issue..."
                      className="h-28"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Labels (comma-separated)</label>
                    <Input
                      value={newIssue.labels}
                      onChange={e => setNewIssue(p => ({ ...p, labels: e.target.value }))}
                      placeholder="e.g. bug, rag, enhancement"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => createIssue.mutate()}
                    disabled={!newIssue.title || createIssue.isPending}
                  >
                    {createIssue.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Create Issue
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Open Issues', value: stats.open_issues, icon: CircleDot, color: 'text-emerald-600 bg-emerald-50' },
              { label: 'Closed Issues', value: stats.closed_issues, icon: CheckCircle2, color: 'text-purple-600 bg-purple-50' },
              { label: 'Stars', value: stats.stars, icon: Star, color: 'text-amber-600 bg-amber-50' },
              { label: 'Forks', value: stats.forks, icon: GitFork, color: 'text-blue-600 bg-blue-50' },
            ].map(s => (
              <div key={s.label} className="bg-card border rounded-xl p-4 flex items-center gap-3">
                <div className={cn('p-2 rounded-lg', s.color)}>
                  <s.icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{s.value ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Issue List */}
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">Issues</h3>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-28 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {issuesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No {stateFilter} issues found.</p>
            </div>
          ) : (
            <div className="divide-y">
              {issues.map(issue => (
                <div key={issue.id} className="px-4 py-3 hover:bg-muted/20 flex items-start gap-3">
                  {issue.state === 'open'
                    ? <CircleDot className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    : <CheckCircle2 className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <a
                        href={issue.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {issue.title}
                      </a>
                      {(issue.labels || []).map(label => (
                        <span
                          key={label.id}
                          className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium',
                            LABEL_COLORS[label.name] || 'bg-muted text-muted-foreground'
                          )}
                        >
                          {label.name}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground">#{issue.number}</span>
                      <span className="text-xs text-muted-foreground">
                        {issue.created_at ? formatDistanceToNow(new Date(issue.created_at), { addSuffix: true }) : ''}
                      </span>
                      {issue.user?.login && (
                        <span className="text-xs text-muted-foreground">by {issue.user.login}</span>
                      )}
                      {issue.comments > 0 && (
                        <span className="text-xs text-muted-foreground">{issue.comments} comments</span>
                      )}
                    </div>
                  </div>
                  {issue.state === 'open' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
                      onClick={() => closeIssue.mutate(issue.number)}
                      disabled={closeIssue.isPending}
                    >
                      Close
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}