import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { Bot, User, ExternalLink, Clock, Zap } from 'lucide-react';

const RAG_COLORS = {
  vector: 'text-blue-600 bg-blue-50 border-blue-200',
  vectorless: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  graph_vector: 'text-purple-600 bg-purple-50 border-purple-200',
};

const RAG_LABELS = {
  vector: 'Vector RAG',
  vectorless: 'Vectorless',
  graph_vector: 'Graph Vector',
};

export default function ChatMessageBubble({ message }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-3 group', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div className={cn(
        'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5',
        isUser ? 'gradient-gold' : 'gradient-primary'
      )}>
        {isUser
          ? <User className="w-4 h-4 text-white" />
          : <Bot className="w-4 h-4 text-white" />
        }
      </div>

      {/* Bubble */}
      <div className={cn('max-w-[75%] space-y-1.5', isUser && 'items-end flex flex-col')}>
        {isUser ? (
          <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm text-white gradient-primary">
            {message.content}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
            <ReactMarkdown
              className="prose prose-sm max-w-none text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              components={{
                p: ({ children }) => <p className="text-sm leading-relaxed my-1">{children}</p>,
                ul: ({ children }) => <ul className="text-sm my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
                li: ({ children }) => <li className="text-sm">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                code: ({ children }) => <code className="bg-muted px-1 py-0.5 rounded text-xs">{children}</code>,
              }}
            >
              {message.content}
            </ReactMarkdown>

            {/* Meta info */}
            {(message.rag_type_used || message.latency_ms) && (
              <div className="flex items-center gap-3 mt-2.5 pt-2 border-t border-border">
                {message.rag_type_used && (
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full border font-medium',
                    RAG_COLORS[message.rag_type_used] || 'text-muted-foreground bg-muted border-border'
                  )}>
                    {RAG_LABELS[message.rag_type_used] || message.rag_type_used}
                  </span>
                )}
                {message.latency_ms && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />{message.latency_ms}ms
                  </span>
                )}
                {message.tokens_used && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Zap className="w-3 h-3" />{message.tokens_used} tokens
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sources */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="space-y-1">
            {message.sources.slice(0, 3).map((src, i) => (
              <a
                key={i}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors group/link"
              >
                <ExternalLink className="w-3 h-3 group-hover/link:text-primary" />
                <span className="truncate max-w-xs">{src.title || src.url}</span>
                {src.score && (
                  <span className="opacity-50">({(src.score * 100).toFixed(0)}%)</span>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}