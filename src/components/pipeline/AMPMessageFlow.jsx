/**
 * AMP Message Flow Diagram
 * Shows agent-to-agent message passing in real time (ai-maestro AMP protocol style)
 */
import { cn } from '@/lib/utils';
import { Brain, Globe, Database, Search, Gavel, FileText, ArrowRight } from 'lucide-react';

const AGENTS = [
  { name: 'Orchestrator', icon: Brain, color: 'bg-violet-100 text-violet-700 border-violet-300' },
  { name: 'Crawler',      icon: Globe, color: 'bg-amber-100 text-amber-700 border-amber-300' },
  { name: 'Indexer',      icon: Database, color: 'bg-blue-100 text-blue-700 border-blue-300' },
  { name: 'RAGQuery',     icon: Search, color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  { name: 'LLMJudge',     icon: Gavel, color: 'bg-rose-100 text-rose-700 border-rose-300' },
  { name: 'Reporter',     icon: FileText, color: 'bg-cyan-100 text-cyan-700 border-cyan-300' },
];

const STATUS_GLOW = {
  running:   'ring-2 ring-blue-400 ring-offset-1 shadow-lg shadow-blue-100',
  completed: 'ring-2 ring-emerald-300 ring-offset-1',
  failed:    'ring-2 ring-rose-400 ring-offset-1',
};

export default function AMPMessageFlow({ runs = [], currentAgent }) {
  const runMap = {};
  for (const r of runs) runMap[r.agent_name] = r;

  return (
    <div className="bg-card border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-sm">Agent Messaging Protocol (AMP) Flow</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Real-time agent-to-agent communication — state shared via persistent memory</p>
        </div>
        <span className="text-xs bg-violet-50 border border-violet-200 text-violet-700 px-2.5 py-1 rounded-full font-medium">ai-maestro AMP v1.0</span>
      </div>

      {/* Agent Nodes Row */}
      <div className="flex items-center gap-1 flex-wrap">
        {AGENTS.map((agent, idx) => {
          const run = runMap[agent.name];
          const status = run?.status || 'pending';
          const isActive = currentAgent === agent.name;
          const Icon = agent.icon;

          return (
            <div key={agent.name} className="flex items-center gap-1">
              <div className={cn(
                'flex flex-col items-center gap-1 px-3 py-2 rounded-xl border text-xs font-medium transition-all',
                agent.color,
                status !== 'pending' && STATUS_GLOW[status],
                status === 'pending' && 'opacity-40',
              )}>
                <Icon className="w-4 h-4" />
                <span>{agent.name}</span>
                {status !== 'pending' && (
                  <span className={cn('px-1.5 py-0.5 rounded-full text-xs', {
                    'bg-blue-200 text-blue-800': status === 'running',
                    'bg-emerald-200 text-emerald-800': status === 'completed',
                    'bg-rose-200 text-rose-800': status === 'failed',
                  })}>
                    {status}
                  </span>
                )}
              </div>
              {idx < AGENTS.length - 1 && (
                <ArrowRight className={cn(
                  'w-4 h-4 flex-shrink-0 transition-colors',
                  runMap[AGENTS[idx + 1]?.name]?.status && runMap[AGENTS[idx + 1]?.name]?.status !== 'pending'
                    ? 'text-emerald-500' : 'text-muted-foreground/30'
                )} />
              )}
            </div>
          );
        })}
      </div>

      {/* AMP Correlation ID */}
      {runs[0]?.input_message?.correlation_id && (
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Correlation ID:</span>
          <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
            {runs[0].input_message.correlation_id}
          </code>
          <span className="text-xs text-muted-foreground">— all agents share this session context</span>
        </div>
      )}
    </div>
  );
}