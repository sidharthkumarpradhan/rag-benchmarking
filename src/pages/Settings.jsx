import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  CheckCircle2, XCircle, Key, Database, Globe, GitBranch,
  Search, Zap, ExternalLink, Copy, Info
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SECTIONS = [
  {
    id: 'qdrant',
    title: 'Qdrant Vector Database',
    icon: Database,
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-200',
    desc: 'Cloud-hosted vector store for semantic search. Already configured with your credentials.',
    status: 'configured',
    fields: [
      { key: 'QDRANT_URL', label: 'Qdrant URL', placeholder: 'https://....qdrant.io:6333', readonly: true, value: 'https://b14ca50b-03f6-....aws.cloud.qdrant.io:6333' },
      { key: 'QDRANT_API_KEY', label: 'API Key', placeholder: '...', type: 'password', note: 'Set in backend environment variables' },
    ],
    links: [{ label: 'Qdrant Cloud Console', url: 'https://cloud.qdrant.io' }],
  },
  {
    id: 'huggingface',
    title: 'HuggingFace',
    icon: Zap,
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-200',
    desc: 'Used for embedding model (all-MiniLM-L6-v2) to convert text chunks to vectors.',
    status: 'needs_key',
    envKey: 'HF_API_KEY',
    fields: [
      { key: 'HF_API_KEY', label: 'HuggingFace API Key', placeholder: 'hf_...', note: 'Set in Settings → Environment Variables in Base44 dashboard' },
    ],
    links: [
      { label: 'Get API Key', url: 'https://huggingface.co/settings/tokens' },
      { label: 'Inference API Docs', url: 'https://huggingface.co/docs/api-inference' },
    ],
  },
  {
    id: 'llm',
    title: 'LLM Provider (OpenRouter / Fireworks)',
    icon: Zap,
    color: 'text-purple-600',
    bg: 'bg-purple-50 border-purple-200',
    desc: 'Powers the RAG response generation. OpenRouter gives free access to Llama, Gemma, etc.',
    status: 'needs_key',
    envKey: 'LLM_API_KEY',
    fields: [
      { key: 'LLM_API_KEY', label: 'OpenRouter / Fireworks API Key', placeholder: 'sk-or-...', note: 'Set in Settings → Environment Variables in Base44 dashboard' },
    ],
    links: [
      { label: 'OpenRouter (Free Models)', url: 'https://openrouter.ai/keys' },
      { label: 'Fireworks AI', url: 'https://fireworks.ai' },
    ],
  },
  {
    id: 'firecrawl',
    title: 'Firecrawl (Web Crawler)',
    icon: Globe,
    color: 'text-rose-600',
    bg: 'bg-rose-50 border-rose-200',
    desc: 'Agent 1 uses Firecrawl to crawl any website URL you configure in the Data Pipeline.',
    status: 'needs_key',
    envKey: 'FIRECRAWL_API_KEY',
    fields: [
      { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl API Key', placeholder: 'fc-...', note: 'Set in Settings → Environment Variables in Base44 dashboard' },
    ],
    links: [
      { label: 'Firecrawl Dashboard', url: 'https://firecrawl.dev' },
      { label: 'Firecrawl Docs', url: 'https://docs.firecrawl.dev' },
    ],
  },
  {
    id: 'falkordb',
    title: 'FalkorDB (Graph Vector DB)',
    icon: GitBranch,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-200',
    desc: 'Optional: enables Graph Vector RAG with relationship-aware retrieval. Can use FalkorDB Cloud or self-hosted.',
    status: 'optional',
    envKey: 'FALKORDB_URL',
    fields: [
      { key: 'FALKORDB_URL', label: 'FalkorDB URL', placeholder: 'redis://localhost:6379', note: 'Set in Settings → Environment Variables in Base44 dashboard' },
    ],
    links: [
      { label: 'FalkorDB GitHub', url: 'https://github.com/FalkorDB/FalkorDB' },
      { label: 'FalkorDB Cloud', url: 'https://app.falkordb.cloud' },
    ],
  },
  {
    id: 'pageindex',
    title: 'PageIndex (Vectorless RAG)',
    icon: Search,
    color: 'text-cyan-600',
    bg: 'bg-cyan-50 border-cyan-200',
    desc: 'PageIndex-style BM25 keyword retrieval — no embedding needed. Built-in, no extra key required.',
    status: 'built_in',
    fields: [],
    links: [
      { label: 'PageIndex GitHub', url: 'https://github.com/VectifyAI/PageIndex' },
    ],
  },
];

const STATUS_LABELS = {
  configured: { label: 'Configured', icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  needs_key: { label: 'Needs API Key', icon: XCircle, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  optional: { label: 'Optional', icon: Info, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  built_in: { label: 'Built-in', icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
};

export default function Settings() {
  return (
    <div className="h-screen overflow-y-auto bg-background scrollbar-thin">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Settings & Configuration</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure API keys and services for all three RAG architectures. Set secrets in the{' '}
            <strong>Base44 Dashboard → Settings → Environment Variables</strong>.
          </p>
        </div>

        {/* Setup Guide */}
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4">
          <h3 className="font-semibold text-sm text-primary mb-2 flex items-center gap-2">
            <Key className="w-4 h-4" /> Quick Setup Guide
          </h3>
          <ol className="space-y-1.5 text-sm text-muted-foreground">
            <li className="flex gap-2"><span className="font-bold text-primary">1.</span> Get a <a href="https://huggingface.co/settings/tokens" target="_blank" className="text-primary underline">HuggingFace token</a> → set as <code className="bg-muted px-1 rounded text-xs">HF_API_KEY</code></li>
            <li className="flex gap-2"><span className="font-bold text-primary">2.</span> Get a <a href="https://openrouter.ai/keys" target="_blank" className="text-primary underline">free OpenRouter key</a> → set as <code className="bg-muted px-1 rounded text-xs">LLM_API_KEY</code></li>
            <li className="flex gap-2"><span className="font-bold text-primary">3.</span> Get a <a href="https://firecrawl.dev" target="_blank" className="text-primary underline">Firecrawl API key</a> → set as <code className="bg-muted px-1 rounded text-xs">FIRECRAWL_API_KEY</code></li>
            <li className="flex gap-2"><span className="font-bold text-primary">4.</span> (Optional) Set up <code className="bg-muted px-1 rounded text-xs">FALKORDB_URL</code> for Graph Vector RAG</li>
            <li className="flex gap-2"><span className="font-bold text-primary">5.</span> Go to <strong>Data Pipeline</strong> → Start Crawl → Index to Qdrant → Run Benchmarks!</li>
          </ol>
        </div>

        {/* Service Cards */}
        <div className="space-y-4">
          {SECTIONS.map(section => {
            const statusCfg = STATUS_LABELS[section.status];
            return (
              <div key={section.id} className={cn('border rounded-2xl p-5', section.bg)}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={cn('p-2 bg-white rounded-xl shadow-sm', section.color)}>
                      <section.icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-foreground">{section.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{section.desc}</p>
                    </div>
                  </div>
                  <span className={cn('flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0', statusCfg.color)}>
                    <statusCfg.icon className="w-3 h-3" />
                    {statusCfg.label}
                  </span>
                </div>

                {section.fields.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {section.fields.map(field => (
                      <div key={field.key}>
                        <label className="text-xs font-medium text-foreground mb-1 block">{field.label}</label>
                        <div className="flex gap-2">
                          <Input
                            type={field.type || 'text'}
                            placeholder={field.placeholder}
                            defaultValue={field.value}
                            readOnly={field.readonly}
                            className="text-xs h-8 bg-white/80"
                          />
                        </div>
                        {field.note && (
                          <p className="text-xs text-muted-foreground mt-1">
                            ⚠️ {field.note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {section.links.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {section.links.map(link => (
                      <a
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" /> {link.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Architecture Summary */}
        <div className="bg-card border rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-3">RAG Architecture Comparison</h3>
          <div className="space-y-3">
            {[
              { name: 'Vector RAG', color: 'bg-blue-500', stack: ['HuggingFace Embeddings', 'Qdrant Vector DB', 'OpenRouter LLM'], desc: 'Classic semantic search: embed query → cosine similarity → LLM generate' },
              { name: 'Vectorless RAG', color: 'bg-emerald-500', stack: ['BM25 Keyword Index', 'Base44 Storage', 'OpenRouter LLM'], desc: 'No embeddings needed: PageIndex-style keyword scoring → LLM generate. Faster, cheaper.' },
              { name: 'Graph Vector RAG', color: 'bg-purple-500', stack: ['Qdrant (anchor nodes)', 'FalkorDB Graph DB', 'OpenRouter LLM'], desc: 'Hybrid: vector search finds anchors, graph traversal finds related documents, richer context' },
            ].map(arch => (
              <div key={arch.name} className="flex gap-3">
                <div className={cn('w-1.5 rounded-full flex-shrink-0', arch.color)} />
                <div>
                  <p className="text-sm font-semibold text-foreground">{arch.name}</p>
                  <p className="text-xs text-muted-foreground mb-1">{arch.desc}</p>
                  <div className="flex flex-wrap gap-1">
                    {arch.stack.map(s => (
                      <span key={s} className="text-xs bg-muted px-2 py-0.5 rounded-md text-muted-foreground">{s}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}