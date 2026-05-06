import { cn } from '@/lib/utils';
import {
  Brain, Globe, Database, Search, Gavel, FileText,
  CheckCircle2, Loader2, Clock, AlertCircle, ChevronDown, ChevronRight
} from 'lucide-react';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

const AGENT_CONFIG = {
  Orchestrator: { icon: Brain, color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-200', dot: 'bg-violet-500' },
  Crawler:      { icon: Globe, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
  Indexer:      { icon: Database, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500' },
  RAGQuery:     { icon: Search, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  LLMJudge:     { icon: Gavel, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200', dot: 'bg-rose-500' },
  Reporter:     { icon: FileText, color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-200', dot: 'bg-cyan-500' },
};

const STATUS_ICON = {
  pending:           { Icon: Clock, class: 'text-muted-foreground' },
  running:           { Icon: Loader2, class: 'text-blue-500 animate-spin' },
  completed:         { Icon: CheckCircle2, class: 'text-emerald-500' },
  failed:            { Icon: AlertCircle, class: 'text-rose-500' },
  waiting_for_agent: { Icon: Clock, class: 'text-amber-500 animate-pulse' },
};

export default function AgentCard({ run, isActive }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = AGENT_CONFIG[run.agent_name] || AGENT_CONFIG.Orchestrator;
  const st = STATUS_ICON[run.status] || STATUS_ICON.pending;
  const Icon = cfg.icon;
  const StatusIcon = st.Icon;

  const inMsg = run.input_message;
  const outMsg = run.output_message;

  return (
    <div className={cn(
      'border rounded-2xl overflow-hidden transition-all',
      isActive && run.status === 'running' ? 'border-blue-300 shadow-md shadow-blue-100' : 'border-border',
    )}>
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className={cn('w-full flex items-center gap-3 p-4 text-left', cfg.bg)}
      >
        <div className={cn('p-2 rounded-xl border', cfg.bg, cfg.border)}>
          <Icon className={cn('w-5 h-5', cfg.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">{run.agent_name}</span>
            <span className="text-xs text-muted-foreground capitalize">{run.agent_role?.replace('_', ' ')}</span>
          </div>
          {run.reasoning && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{run.reasoning}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {run.tokens_used > 0 && (
            <span className="text-xs text-muted-foreground bg-white/60 px-1.5 py-0.5 rounded-md border">
              {run.tokens_used} tok
            </span>
          )}
          {run.latency_ms > 0 && (
            <span className="text-xs text-muted-foreground bg-white/60 px-1.5 py-0.5 rounded-md border">
              {run.latency_ms}ms
            </span>
          )}
          <StatusIcon className={cn('w-4 h-4', st.class)} />
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="p-4 space-y-4 bg-card">

          {/* AMP Message Flow */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {inMsg && (
              <div className="bg-muted/40 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-xs font-semibold text-muted-foreground">AMP IN — from {inMsg.from_agent}</span>
                  <span className="ml-auto text-xs text-muted-foreground bg-amber-50 border border-amber-200 px-1.5 rounded">{inMsg.message_type}</span>
                </div>
                <p className="text-xs text-foreground">
                  {inMsg.payload?.message || inMsg.payload?.goal || inMsg.payload?.instruction || JSON.stringify(inMsg.payload).substring(0, 120)}
                </p>
              </div>
            )}
            {outMsg && (
              <div className="bg-muted/40 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-semibold text-muted-foreground">AMP OUT — to {outMsg.to_agent}</span>
                  <span className="ml-auto text-xs text-muted-foreground bg-emerald-50 border border-emerald-200 px-1.5 rounded">{outMsg.message_type}</span>
                </div>
                <p className="text-xs text-foreground">
                  {outMsg.payload?.message || JSON.stringify(outMsg.payload).substring(0, 120)}
                </p>
              </div>
            )}
          </div>

          {/* Tool Calls */}
          {run.tool_calls?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">🔧 Tool Calls</p>
              <div className="flex flex-wrap gap-2">
                {run.tool_calls.map((tc, i) => (
                  <div key={i} className="bg-muted rounded-lg px-2.5 py-1 text-xs">
                    <span className="font-mono font-medium">{tc.tool}</span>
                    {tc.count !== undefined && <span className="text-muted-foreground ml-1">→ {tc.count} records</span>}
                    {tc.vectors !== undefined && <span className="text-muted-foreground ml-1">→ {tc.vectors} vectors</span>}
                    {tc.query && <span className="text-muted-foreground ml-1 truncate max-w-[100px]">"{tc.query?.substring(0, 30)}"</span>}
                    {tc.score && <span className="text-muted-foreground ml-1">score:{tc.score}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="flex gap-4 text-xs text-muted-foreground">
            {run.started_at && <span>Started: {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}</span>}
            {run.completed_at && <span>Completed: {formatDistanceToNow(new Date(run.completed_at), { addSuffix: true })}</span>}
          </div>

          {run.error && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-700">{run.error}</div>
          )}
        </div>
      )}
    </div>
  );
}