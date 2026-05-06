import { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Send, Plus, Loader2, Sparkles, ChevronDown, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import ChatMessageBubble from '@/components/chat/ChatMessage';
import RAGSelector from '@/components/chat/RAGSelector';
import { cn } from '@/lib/utils';

const SUGGESTED_QUESTIONS = [
  "What topics does this knowledge base cover?",
  "Summarize the most important information available.",
  "What are the key services or features described?",
  "How can I get support or find help?",
  "What recent updates or news are available?",
  "Give me an overview of the content indexed.",
];

const MODELS = [
  { value: 'meta-llama/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B (Free)' },
  { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (Free)' },
  { value: 'google/gemma-3-9b-it:free', label: 'Gemma 3 9B (Free)' },
];

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ragMode, setRagMode] = useState('vector');
  const [model, setModel] = useState(MODELS[0].value);
  const [sessionId, setSessionId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startNewSession = async () => {
    const session = await base44.entities.ChatSession.create({
      session_name: `Session ${new Date().toLocaleString()}`,
      rag_mode: ragMode,
      model
    });
    setSessionId(session.id);
    return session.id;
  };

  const sendMessage = async (text) => {
    const userText = text || input.trim();
    if (!userText || loading) return;
    setInput('');

    const sid = sessionId || await startNewSession();

    const userMsg = { role: 'user', content: userText, id: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // Save user message
    await base44.entities.ChatMessage.create({
      session_id: sid,
      role: 'user',
      content: userText
    });

    const activeRag = ragMode === 'auto' ? 'vector' : ragMode;

    const res = await base44.functions.invoke('queryRAG', {
      query: userText,
      rag_type: activeRag,
      model,
      provider: 'openrouter',
      session_id: sid,
      save_benchmark: false
    });

    setLoading(false);

    if (res.data && !res.data.error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.data.response,
        rag_type_used: res.data.rag_type,
        sources: res.data.sources,
        latency_ms: res.data.latency_ms,
        tokens_used: res.data.tokens_used,
        id: Date.now()
      }]);
    } else {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I encountered an issue: ${res.data?.error || 'Unknown error'}. Please ensure the data pipeline has been run and API keys are configured in Settings.`,
        id: Date.now()
      }]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setSessionId(null);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-card shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 gradient-primary rounded-xl flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-foreground">Crawlect AI</h1>
            <p className="text-xs text-muted-foreground">Your intelligent RAG assistant — powered by your web data</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className="gap-2 text-muted-foreground"
          >
            <Settings2 className="w-4 h-4" />
            <span className="hidden sm:inline">Settings</span>
          </Button>
          <Button variant="outline" size="sm" onClick={clearChat} className="gap-2">
            <Plus className="w-4 h-4" />
            New Chat
          </Button>
        </div>
      </div>

      {/* Settings Bar */}
      {showSettings && (
        <div className="px-6 py-3 bg-muted/50 border-b flex flex-wrap items-center gap-4">
          <RAGSelector selected={ragMode} onChange={setRagMode} />
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Model:</span>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-7 text-xs w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map(m => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-20 h-20 gradient-primary rounded-3xl flex items-center justify-center mb-6 shadow-lg">
              <Sparkles className="w-10 h-10 text-white" />
            </div>
            <h2 className="font-display text-2xl font-bold text-foreground mb-2">
              Welcome to Crawlect AI
            </h2>
            <p className="text-muted-foreground max-w-md mb-8 text-sm leading-relaxed">
              Ask anything about your indexed knowledge base. Crawlect turns any website into an intelligent RAG-powered assistant.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
              {SUGGESTED_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-left px-4 py-3 rounded-xl border bg-card hover:border-primary hover:bg-accent transition-all text-sm text-foreground group"
                >
                  <span className="group-hover:text-primary transition-colors">{q}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0 mt-0.5">
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div className="px-4 pb-6 pt-3 bg-background border-t">
        <div className="max-w-3xl mx-auto">
          {/* RAG mode quick select */}
          {!showSettings && (
            <div className="mb-2">
              <RAGSelector selected={ragMode} onChange={setRagMode} />
            </div>
          )}
          <div className="flex gap-3 items-end bg-card border rounded-2xl shadow-sm px-4 py-3 focus-within:ring-2 focus-within:ring-primary/30">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your knowledge base..."
              className="flex-1 resize-none border-0 shadow-none focus-visible:ring-0 bg-transparent min-h-[40px] max-h-32 text-sm p-0"
              rows={1}
            />
            <Button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="rounded-xl h-9 w-9 p-0 gradient-primary border-0 flex-shrink-0"
            >
              <Send className="w-4 h-4 text-white" />
            </Button>
          </div>
          <p className="text-xs text-center text-muted-foreground mt-2">
            Crawlect AI uses AI and may make mistakes. Always verify critical information from the original source.
          </p>
        </div>
      </div>
    </div>
  );
}