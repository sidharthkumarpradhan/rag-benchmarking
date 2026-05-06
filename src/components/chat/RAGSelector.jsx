import { cn } from '@/lib/utils';
import { Database, Search, GitBranch, Zap } from 'lucide-react';

const RAG_OPTIONS = [
  {
    id: 'auto',
    label: 'Auto',
    icon: Zap,
    desc: 'Smart selection',
    color: 'border-amber-300 bg-amber-50 text-amber-700',
    activeColor: 'border-amber-500 bg-amber-100 text-amber-800',
    dot: 'bg-amber-400',
  },
  {
    id: 'vector',
    label: 'Vector',
    icon: Database,
    desc: 'Qdrant semantic',
    color: 'border-blue-200 bg-blue-50 text-blue-700',
    activeColor: 'border-blue-500 bg-blue-100 text-blue-800',
    dot: 'bg-blue-400',
  },
  {
    id: 'vectorless',
    label: 'Vectorless',
    icon: Search,
    desc: 'PageIndex BM25',
    color: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    activeColor: 'border-emerald-500 bg-emerald-100 text-emerald-800',
    dot: 'bg-emerald-400',
  },
  {
    id: 'graph_vector',
    label: 'Graph+Vector',
    icon: GitBranch,
    desc: 'FalkorDB hybrid',
    color: 'border-purple-200 bg-purple-50 text-purple-700',
    activeColor: 'border-purple-500 bg-purple-100 text-purple-800',
    dot: 'bg-purple-400',
  },
];

export default function RAGSelector({ selected, onChange }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground">RAG Mode:</span>
      <div className="flex gap-1.5 flex-wrap">
        {RAG_OPTIONS.map(opt => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onChange(opt.id)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all duration-150',
                active ? opt.activeColor : opt.color,
                'hover:opacity-90'
              )}
            >
              <div className={cn('w-1.5 h-1.5 rounded-full', opt.dot)} />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}