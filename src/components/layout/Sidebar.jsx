import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  MessageSquare, BarChart3, Database, Search,
  Settings, Home, Zap, Globe, ChevronRight, Bot, GitBranch
} from 'lucide-react';

const navItems = [
  { icon: MessageSquare, label: 'Crawlect Chat', path: '/', badge: null },
  { icon: BarChart3, label: 'Benchmark Dashboard', path: '/benchmark', badge: 'Research' },
  { icon: Database, label: 'Data Pipeline', path: '/pipeline', badge: null },
  { icon: Search, label: 'Document Explorer', path: '/documents', badge: null },
  { icon: GitBranch, label: 'GitHub Tracker', path: '/github', badge: null },
  { icon: Settings, label: 'Settings', path: '/settings', badge: null },
];

const ragTypes = [
  { label: 'Vector RAG', color: 'bg-blue-400', desc: 'Qdrant + Embeddings' },
  { label: 'Vectorless', color: 'bg-emerald-400', desc: 'PageIndex BM25' },
  { label: 'Graph Vector', color: 'bg-purple-400', desc: 'FalkorDB + Qdrant' },
];

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 min-h-screen flex flex-col" style={{ background: 'hsl(var(--sidebar-background))' }}>
      {/* Logo */}
      <div className="px-6 py-6 border-b" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl gradient-gold flex items-center justify-center flex-shrink-0">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold" style={{ color: 'hsl(var(--stag-gold))' }}>
              Crawlect AI
            </h1>
            <p className="text-xs" style={{ color: 'hsl(var(--sidebar-foreground))', opacity: 0.6 }}>
              Any website. Any knowledge.
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(item => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group',
                active
                  ? 'text-white'
                  : 'hover:text-white'
              )}
              style={{
                background: active ? 'hsl(var(--sidebar-accent))' : 'transparent',
                color: active ? 'white' : 'hsl(var(--sidebar-foreground))'
              }}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                  style={{ background: 'hsl(var(--stag-gold))', color: 'hsl(var(--stag-navy))' }}>
                  {item.badge}
                </span>
              )}
              {active && <ChevronRight className="w-3 h-3 opacity-60" />}
            </Link>
          );
        })}
      </nav>

      {/* RAG Status Panel */}
      <div className="px-3 pb-4">
        <div className="rounded-xl p-3" style={{ background: 'hsl(var(--sidebar-accent))' }}>
          <p className="text-xs font-semibold mb-2 uppercase tracking-wider"
            style={{ color: 'hsl(var(--stag-gold))' }}>
            RAG Architectures
          </p>
          <div className="space-y-1.5">
            {ragTypes.map(r => (
              <div key={r.label} className="flex items-center gap-2">
                <div className={cn('w-2 h-2 rounded-full', r.color)} />
                <div>
                  <p className="text-xs font-medium text-white">{r.label}</p>
                  <p className="text-xs opacity-50" style={{ color: 'hsl(var(--sidebar-foreground))' }}>
                    {r.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5" style={{ color: 'hsl(var(--sidebar-foreground))', opacity: 0.5 }} />
          <p className="text-xs" style={{ color: 'hsl(var(--sidebar-foreground))', opacity: 0.5 }}>
            crawlect.ai
          </p>
        </div>
      </div>
    </aside>
  );
}