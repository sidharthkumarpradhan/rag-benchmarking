/**
 * Live Shared Memory / State Panel
 * Shows what agents have written to shared state (like ai-maestro's persistent memory)
 */
import { cn } from '@/lib/utils';
import { Database, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

function StateSection({ label, data, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!data) return null;

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <pre className="text-xs bg-muted/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap text-foreground max-h-48">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function SharedStatePanel({ sharedState }) {
  if (!sharedState || Object.keys(sharedState).length === 0) {
    return (
      <div className="bg-card border rounded-2xl p-4 text-center text-sm text-muted-foreground">
        <Database className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
        Shared agent memory will appear here as agents run.
      </div>
    );
  }

  const { orchestrator_plan, corpus_summary, readiness, rag_results, evaluations, final_report } = sharedState;

  return (
    <div className="bg-card border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <Database className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Shared Agent Memory</h3>
        <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {Object.keys(sharedState).length} keys
        </span>
      </div>

      <StateSection label="🧠 Orchestrator Plan" data={orchestrator_plan} defaultOpen />
      <StateSection label="📄 Corpus Summary" data={corpus_summary} />
      <StateSection label="✅ Readiness Report" data={readiness} />
      <StateSection label="🔍 RAG Results" data={rag_results} />
      <StateSection label="⚖️ Evaluations" data={evaluations} />
      <StateSection label="📊 Final Report" data={final_report} defaultOpen />
    </div>
  );
}