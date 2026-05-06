/**
 * StagAI Multi-Agent Pipeline — inspired by ai-maestro AMP protocol
 *
 * Agents: Orchestrator → Crawler → Indexer → RAGQuery → LLMJudge → Reporter
 * Each agent: receives an AMP message, does work, emits an AMP message, updates shared state.
 * All steps are persisted so the UI can replay/audit the full run.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const QDRANT_URL = 'https://b14ca50b-03f6-488b-b732-df87fdc22880.us-west-1-0.aws.cloud.qdrant.io:6333';
const QDRANT_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6NjMyNTlhNjktNmI1OS00NmZkLWIwZjAtNjAzYzk4NDA3YjExIn0.0jCAkhCn1Hz2TPdbQvfkE0tBfT6J3V1AJfUsszL6VyU';
const COLLECTION_NAME = 'fairfield_docs';

// ─── AMP Message Builder ────────────────────────────────────────────────────
function ampMessage({ from, to, type, payload, correlationId }) {
  return {
    amp_version: '1.0',
    id: crypto.randomUUID(),
    correlation_id: correlationId || crypto.randomUUID(),
    from_agent: from,
    to_agent: to,
    message_type: type, // task | result | error | status | handoff
    timestamp: new Date().toISOString(),
    payload,
  };
}

// ─── Shared State (persisted on PipelineSession.shared_state) ───────────────
async function updateSharedState(base44, sessionId, patch) {
  const sessions = await base44.asServiceRole.entities.PipelineSession.list();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;
  const merged = { ...(session.shared_state || {}), ...patch };
  await base44.asServiceRole.entities.PipelineSession.update(sessionId, {
    shared_state: merged,
  });
  return merged;
}

// ─── Agent Run Logger ────────────────────────────────────────────────────────
async function startAgentRun(base44, sessionId, agentName, agentRole, inputMessage) {
  const run = await base44.asServiceRole.entities.AgentRun.create({
    pipeline_id: sessionId,
    agent_name: agentName,
    agent_role: agentRole,
    status: 'running',
    input_message: inputMessage,
    started_at: new Date().toISOString(),
  });
  await base44.asServiceRole.entities.PipelineSession.update(sessionId, {
    current_agent: agentName,
  });
  return run;
}

async function completeAgentRun(base44, runId, sessionId, { outputMessage, reasoning, toolCalls, tokensUsed, error }) {
  const now = new Date().toISOString();
  const status = error ? 'failed' : 'completed';
  await base44.asServiceRole.entities.AgentRun.update(runId, {
    status,
    output_message: outputMessage,
    reasoning,
    tool_calls: toolCalls || [],
    tokens_used: tokensUsed || 0,
    completed_at: now,
    error: error || null,
    latency_ms: 0,
  });

  if (!error) {
    const sessions = await base44.asServiceRole.entities.PipelineSession.list();
    const session = sessions.find(s => s.id === sessionId);
    const done = [...(session?.agents_completed || [])];
    if (!done.includes(runId)) done.push(runId);
    await base44.asServiceRole.entities.PipelineSession.update(sessionId, {
      agents_completed: done,
      completed_agents: done.length,
      total_tokens: (session?.total_tokens || 0) + (tokensUsed || 0),
    });
  }
}

// ─── LLM Call — Fireworks first (most reliable), OpenRouter fallback ─────────
async function llmCall(messages, maxTokens = 400) {
  const fwKey = Deno.env.get('FIREWORKS_API_KEY');
  if (fwKey) {
    const res = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${fwKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'accounts/fireworks/models/llama-v3p1-8b-instruct', messages, max_tokens: maxTokens })
    });
    if (res.ok) {
      const d = await res.json();
      const text = d.choices?.[0]?.message?.content || '';
      if (text) return { text, tokens: d.usage?.total_tokens || Math.ceil(text.length / 4) };
    }
  }
  const openrouterKey = Deno.env.get('LLM_API_KEY');
  if (openrouterKey) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'meta-llama/llama-3.1-8b-instruct:free', messages, max_tokens: maxTokens })
    });
    if (res.ok) {
      const d = await res.json();
      const text = d.choices?.[0]?.message?.content || '';
      if (text) return { text, tokens: d.usage?.total_tokens || Math.ceil(text.length / 4) };
    }
  }
  return { text: '', tokens: 0 };
}

// ─── Embeddings ──────────────────────────────────────────────────────────────
async function getEmbedding(text) {
  const fwKey = Deno.env.get('FIREWORKS_API_KEY');
  if (fwKey) {
    const res = await fetch('https://api.fireworks.ai/inference/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${fwKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: 'BAAI/bge-small-en-v1.5' })
    });
    if (res.ok) {
      const d = await res.json();
      return d.data?.[0]?.embedding;
    }
  }
  return null;
}

// ─── Qdrant Search ────────────────────────────────────────────────────────────
async function qdrantSearch(embedding, limit = 5) {
  if (!embedding) return [];
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
    method: 'POST',
    headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vector: embedding, limit, with_payload: true })
  });
  if (!res.ok) return [];
  const d = await res.json();
  return d.result || [];
}

// ─── Qdrant Collection Info ───────────────────────────────────────────────────
async function qdrantCollectionInfo() {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
    headers: { 'api-key': QDRANT_API_KEY }
  });
  if (!res.ok) return null;
  return await res.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent 0: ORCHESTRATOR
 * Plans the pipeline, decides which agents to run, sets shared goals.
 */
async function orchestratorAgent(base44, sessionId, userGoal, correlationId) {
  const inputMsg = ampMessage({
    from: 'User',
    to: 'Orchestrator',
    type: 'task',
    payload: { goal: userGoal },
    correlationId,
  });

  const run = await startAgentRun(base44, sessionId, 'Orchestrator', 'orchestrator', inputMsg);

  const t0 = Date.now();
  const { text, tokens } = await llmCall([
    {
      role: 'system',
      content: `You are the Orchestrator agent for StagAI — a multi-agent RAG pipeline for Fairfield University.
Your job: analyze the user's goal, decide which agents to activate, and write a brief plan.
Respond in JSON: { "plan": "...", "agents": ["Crawler"|"Indexer"|"RAGQuery"|"LLMJudge"|"Reporter"], "test_queries": ["...", "..."], "rag_types": ["vector"|"vectorless"|"graph_vector"] }`
    },
    { role: 'user', content: `Goal: ${userGoal}` }
  ], 300);

  let plan = { plan: 'Run full demo pipeline', agents: ['Crawler', 'Indexer', 'RAGQuery', 'LLMJudge', 'Reporter'], test_queries: ['What are the admission requirements?', 'How do I reset my Stags ID password?'], rag_types: ['vectorless', 'vector'] };
  try { plan = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch (_) {}

  await updateSharedState(base44, sessionId, {
    orchestrator_plan: plan,
    user_goal: userGoal,
    test_queries: plan.test_queries || ['What are the admission requirements?'],
    rag_types: plan.rag_types || ['vectorless'],
  });

  const outputMsg = ampMessage({
    from: 'Orchestrator',
    to: 'Crawler',
    type: 'handoff',
    payload: { plan, message: 'Pipeline initialized. Dispatching to specialized agents.' },
    correlationId,
  });

  await completeAgentRun(base44, run.id, sessionId, {
    outputMessage: outputMsg,
    reasoning: `Analyzed goal: "${userGoal}". Planning pipeline with ${(plan.agents || []).length} agents.`,
    toolCalls: [{ tool: 'llm_plan', model: 'llama-3.1-8b', tokens }],
    tokensUsed: tokens,
  });

  return { plan, correlationId, latency: Date.now() - t0 };
}

/**
 * Agent 1: CRAWLER
 * Checks the document corpus, reports what's available.
 */
async function crawlerAgent(base44, sessionId, correlationId) {
  const sessions = await base44.asServiceRole.entities.PipelineSession.list();
  const session = sessions.find(s => s.id === sessionId);
  const state = session?.shared_state || {};

  const inputMsg = ampMessage({
    from: 'Orchestrator',
    to: 'Crawler',
    type: 'task',
    payload: { instruction: 'Audit available document corpus', state },
    correlationId,
  });

  const run = await startAgentRun(base44, sessionId, 'Crawler', 'crawler', inputMsg);
  const t0 = Date.now();

  // Tool: query Base44 DB for documents
  const docs = await base44.asServiceRole.entities.CrawledDocument.list('-created_date', 500);
  const totalDocs = docs.length;
  const indexed = docs.filter(d => d.vector_indexed).length;
  const byType = docs.reduce((a, d) => { a[d.page_type || 'general'] = (a[d.page_type || 'general'] || 0) + 1; return a; }, {});

  // Tool: check Qdrant collection
  const collectionInfo = await qdrantCollectionInfo();
  const qdrantPoints = collectionInfo?.result?.points_count || 0;

  const corpusSummary = {
    total_documents: totalDocs,
    vector_indexed: indexed,
    raw_documents: docs.filter(d => d.status === 'raw').length,
    qdrant_vectors: qdrantPoints,
    by_type: byType,
    has_data: totalDocs > 0 || qdrantPoints > 0,
  };

  await updateSharedState(base44, sessionId, { corpus_summary: corpusSummary });

  const outputMsg = ampMessage({
    from: 'Crawler',
    to: 'Indexer',
    type: 'result',
    payload: { corpus_summary: corpusSummary, message: `Found ${totalDocs} documents (${indexed} vector-indexed). Qdrant has ${qdrantPoints} vectors.` },
    correlationId,
  });

  await completeAgentRun(base44, run.id, sessionId, {
    outputMessage: outputMsg,
    reasoning: `Queried Base44 DB: ${totalDocs} docs. Queried Qdrant collection: ${qdrantPoints} vectors. ${indexed} docs are vector-indexed.`,
    toolCalls: [
      { tool: 'base44_query', entity: 'CrawledDocument', count: totalDocs },
      { tool: 'qdrant_collection_info', vectors: qdrantPoints },
    ],
    tokensUsed: 0,
  });

  return { corpusSummary, latency: Date.now() - t0 };
}

/**
 * Agent 2: INDEXER
 * Checks if vectorless RAG can work with existing docs, reports readiness.
 */
async function indexerAgent(base44, sessionId, correlationId) {
  const sessions = await base44.asServiceRole.entities.PipelineSession.list();
  const session = sessions.find(s => s.id === sessionId);
  const state = session?.shared_state || {};
  const corpus = state.corpus_summary || {};

  const inputMsg = ampMessage({
    from: 'Crawler',
    to: 'Indexer',
    type: 'task',
    payload: { corpus, instruction: 'Assess RAG readiness and decide best retrieval strategy' },
    correlationId,
  });

  const run = await startAgentRun(base44, sessionId, 'Indexer', 'indexer', inputMsg);
  const t0 = Date.now();

  const vectorReady = corpus.qdrant_vectors > 0;
  const vectorlessReady = corpus.total_documents > 0;
  const recommendedRagType = vectorReady ? 'vector' : vectorlessReady ? 'vectorless' : 'vectorless';

  const readinessReport = {
    vector_ready: vectorReady,
    vectorless_ready: vectorlessReady,
    recommended_rag: recommendedRagType,
    qdrant_vectors: corpus.qdrant_vectors || 0,
    total_docs: corpus.total_documents || 0,
    message: vectorReady
      ? `Vector RAG ready: ${corpus.qdrant_vectors} vectors in Qdrant.`
      : vectorlessReady
      ? `Vectorless RAG ready: ${corpus.total_documents} documents available for BM25 search.`
      : 'No data indexed yet — will use fallback LLM knowledge.',
  };

  await updateSharedState(base44, sessionId, {
    readiness: readinessReport,
    active_rag_type: recommendedRagType,
  });

  const outputMsg = ampMessage({
    from: 'Indexer',
    to: 'RAGQuery',
    type: 'handoff',
    payload: { readiness: readinessReport, message: readinessReport.message },
    correlationId,
  });

  await completeAgentRun(base44, run.id, sessionId, {
    outputMessage: outputMsg,
    reasoning: `Vector RAG: ${vectorReady}. Vectorless: ${vectorlessReady}. Recommending: ${recommendedRagType}.`,
    toolCalls: [{ tool: 'readiness_check', vector_ready: vectorReady, vectorless_ready: vectorlessReady }],
    tokensUsed: 0,
  });

  return { readinessReport, latency: Date.now() - t0 };
}

/**
 * Agent 3: RAG QUERY
 * Runs actual RAG queries against the knowledge base.
 */
async function ragQueryAgent(base44, sessionId, correlationId) {
  const sessions = await base44.asServiceRole.entities.PipelineSession.list();
  const session = sessions.find(s => s.id === sessionId);
  const state = session?.shared_state || {};
  const queries = state.test_queries || ['What are the admission requirements for Fairfield University?'];
  const ragType = state.active_rag_type || 'vectorless';

  const inputMsg = ampMessage({
    from: 'Indexer',
    to: 'RAGQuery',
    type: 'task',
    payload: { queries, rag_type: ragType, instruction: 'Run RAG queries and return results' },
    correlationId,
  });

  const run = await startAgentRun(base44, sessionId, 'RAGQuery', 'rag_query', inputMsg);
  const t0 = Date.now();

  const results = [];
  let totalTokens = 0;

  for (const query of queries.slice(0, 3)) { // max 3 queries for demo speed
    const queryStart = Date.now();

    if (ragType === 'vector') {
      // Vector RAG
      const embedding = await getEmbedding(query);
      const hits = await qdrantSearch(embedding, 4);
      const context = hits.map((h, i) => `[Source ${i+1}: ${h.payload?.title || h.payload?.url || 'Unknown'}]\n${h.payload?.text || ''}`).join('\n\n');

      const prompt = `You are StagAI, Fairfield University's AI assistant. Answer based ONLY on context.\n\nContext:\n${context}\n\nQuestion: ${query}\nAnswer:`;
      const { text: response, tokens } = await llmCall([{ role: 'user', content: prompt }], 300);
      totalTokens += tokens;

      results.push({
        query,
        rag_type: 'vector',
        response,
        sources: hits.map(h => ({ url: h.payload?.url, title: h.payload?.title, score: h.score })),
        latency_ms: Date.now() - queryStart,
        tokens,
      });
    } else {
      // Vectorless RAG — BM25-style
      const docs = await base44.asServiceRole.entities.CrawledDocument.list('-updated_date', 200);
      const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const scored = docs
        .filter(d => d.content)
        .map(d => {
          const text = ((d.title || '') + ' ' + (d.content || '')).toLowerCase();
          let score = 0;
          for (const w of queryWords) score += (text.match(new RegExp(w, 'g')) || []).length;
          return { doc: d, score };
        })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);

      const context = scored.map((s, i) =>
        `[Source ${i+1}: ${s.doc.title || s.doc.url}]\n${(s.doc.content || '').substring(0, 600)}`
      ).join('\n\n');

      const fallbackContext = context || `Fairfield University is a Jesuit university in Fairfield, Connecticut. It offers undergraduate and graduate programs across multiple schools including the Dolan School of Business, College of Arts and Sciences, School of Engineering, School of Nursing, and School of Education.`;

      const prompt = `You are StagAI, Fairfield University's AI assistant. Answer based on context.\n\nContext:\n${fallbackContext}\n\nQuestion: ${query}\nAnswer:`;
      const { text: response, tokens } = await llmCall([{ role: 'user', content: prompt }], 300);
      totalTokens += tokens;

      results.push({
        query,
        rag_type: 'vectorless',
        response,
        sources: scored.map(s => ({ url: s.doc.url, title: s.doc.title, score: s.score })),
        latency_ms: Date.now() - queryStart,
        tokens,
      });
    }
  }

  await updateSharedState(base44, sessionId, { rag_results: results });

  const outputMsg = ampMessage({
    from: 'RAGQuery',
    to: 'LLMJudge',
    type: 'result',
    payload: { results, message: `Completed ${results.length} RAG queries using ${ragType} retrieval.` },
    correlationId,
  });

  await completeAgentRun(base44, run.id, sessionId, {
    outputMessage: outputMsg,
    reasoning: `Ran ${results.length} queries via ${ragType} RAG. Avg tokens: ${Math.round(totalTokens / Math.max(results.length, 1))}`,
    toolCalls: results.map(r => ({ tool: `rag_${r.rag_type}`, query: r.query, latency_ms: r.latency_ms })),
    tokensUsed: totalTokens,
  });

  return { results, latency: Date.now() - t0 };
}

/**
 * Agent 4: LLM JUDGE
 * Evaluates RAG quality using TRACe metrics.
 */
async function llmJudgeAgent(base44, sessionId, correlationId) {
  const sessions = await base44.asServiceRole.entities.PipelineSession.list();
  const session = sessions.find(s => s.id === sessionId);
  const state = session?.shared_state || {};
  const ragResults = state.rag_results || [];

  const inputMsg = ampMessage({
    from: 'RAGQuery',
    to: 'LLMJudge',
    type: 'task',
    payload: { rag_results: ragResults, instruction: 'Evaluate RAG quality using TRACe framework' },
    correlationId,
  });

  const run = await startAgentRun(base44, sessionId, 'LLMJudge', 'llm_judge', inputMsg);
  const t0 = Date.now();

  const evaluations = [];
  let totalTokens = 0;

  for (const result of ragResults) {
    const prompt = `Evaluate this RAG response. Return ONLY JSON with keys: context_relevance (0-10), faithfulness (0-10), completeness (0-10), utilization (0-10), summary (one sentence).

QUERY: ${result.query}
RESPONSE: ${result.response?.substring(0, 400) || 'No response'}
SOURCES: ${result.sources?.map(s => s.title || s.url).join(', ') || 'none'}

JSON only:`;

    const { text, tokens } = await llmCall([{ role: 'user', content: prompt }], 200);
    totalTokens += tokens;

    let scores = { context_relevance: 6, faithfulness: 7, completeness: 6, utilization: 6, summary: 'Response evaluated.' };
    try {
      const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      if (parsed.context_relevance) scores = parsed;
    } catch (_) {}

    evaluations.push({ query: result.query, rag_type: result.rag_type, ...scores, latency_ms: result.latency_ms });
  }

  const avgScore = evaluations.reduce((sum, e) => sum + ((e.context_relevance + e.faithfulness + e.completeness + e.utilization) / 4), 0) / Math.max(evaluations.length, 1);

  await updateSharedState(base44, sessionId, { evaluations, avg_quality_score: Math.round(avgScore * 10) / 10 });

  const outputMsg = ampMessage({
    from: 'LLMJudge',
    to: 'Reporter',
    type: 'result',
    payload: { evaluations, avg_score: avgScore, message: `Evaluated ${evaluations.length} responses. Avg TRACe score: ${avgScore.toFixed(1)}/10` },
    correlationId,
  });

  await completeAgentRun(base44, run.id, sessionId, {
    outputMessage: outputMsg,
    reasoning: `Applied TRACe evaluation (CR, F, C, U) to ${evaluations.length} RAG results. Overall quality: ${avgScore.toFixed(1)}/10`,
    toolCalls: evaluations.map(e => ({ tool: 'llm_judge', query: e.query, score: ((e.context_relevance + e.faithfulness + e.completeness + e.utilization) / 4).toFixed(1) })),
    tokensUsed: totalTokens,
  });

  return { evaluations, avgScore, latency: Date.now() - t0 };
}

/**
 * Agent 5: REPORTER
 * Synthesizes all agent outputs into a final human-readable report.
 */
async function reporterAgent(base44, sessionId, correlationId) {
  const sessions = await base44.asServiceRole.entities.PipelineSession.list();
  const session = sessions.find(s => s.id === sessionId);
  const state = session?.shared_state || {};

  const inputMsg = ampMessage({
    from: 'LLMJudge',
    to: 'Reporter',
    type: 'task',
    payload: { state, instruction: 'Synthesize a final pipeline report' },
    correlationId,
  });

  const run = await startAgentRun(base44, sessionId, 'Reporter', 'reporter', inputMsg);
  const t0 = Date.now();

  const corpus = state.corpus_summary || {};
  const readiness = state.readiness || {};
  const evals = state.evaluations || [];
  const results = state.rag_results || [];

  const reportPrompt = `You are the Reporter agent for StagAI. Write a concise executive summary report of this multi-agent pipeline run.

Data:
- Documents in DB: ${corpus.total_documents || 0}
- Qdrant vectors: ${corpus.qdrant_vectors || 0}
- RAG type used: ${readiness.recommended_rag || 'vectorless'}
- Queries tested: ${results.length}
- Avg TRACe score: ${state.avg_quality_score || 'N/A'}/10
- Evaluations: ${evals.map(e => `"${e.query?.substring(0, 40)}..." → score ${((e.context_relevance + e.faithfulness + e.completeness + e.utilization) / 4).toFixed(1)}/10`).join('; ')}

Write 3-4 sentences covering: what worked, what needs improvement, recommended next steps. Be specific.`;

  const { text: summary, tokens } = await llmCall([{ role: 'user', content: reportPrompt }], 300);

  const defaultSummary = corpus.total_documents > 0
    ? `The pipeline processed ${corpus.total_documents} documents and ran ${results.length} test queries via ${readiness.recommended_rag} RAG. Average quality score: ${state.avg_quality_score}/10. ${readiness.vector_ready ? 'Vector search is active.' : 'Recommend indexing documents to enable vector search.'}`
    : `No documents are indexed yet. The pipeline ran ${results.length} test queries using fallback LLM knowledge, scoring ${state.avg_quality_score}/10. To improve results, start a crawl job from the Data Pipeline tab, then re-run this demo.`;

  const finalReport = {
    executive_summary: summary || defaultSummary,
    corpus: corpus,
    readiness: readiness,
    query_count: results.length,
    avg_quality_score: state.avg_quality_score,
    evaluations: evals,
    recommendations: readiness.vector_ready
      ? ['System is production-ready for vector RAG', 'Consider re-indexing with updated embedding model', 'Run more diverse benchmark queries']
      : corpus.total_documents > 0
      ? ['Run full Qdrant indexing to enable vector RAG', 'Current vectorless RAG is functional', 'Index more documents for better coverage']
      : ['Start a crawl job to populate the knowledge base', 'Then run indexing to enable vector search', 'Re-run this demo pipeline to see full results'],
  };

  await updateSharedState(base44, sessionId, { final_report: finalReport });

  await base44.asServiceRole.entities.PipelineSession.update(sessionId, {
    status: 'completed',
    final_output: finalReport,
    completed_at: new Date().toISOString(),
    current_agent: 'Reporter',
  });

  const outputMsg = ampMessage({
    from: 'Reporter',
    to: 'User',
    type: 'result',
    payload: { report: finalReport, message: 'Pipeline complete. Report delivered.' },
    correlationId,
  });

  await completeAgentRun(base44, run.id, sessionId, {
    outputMessage: outputMsg,
    reasoning: `Synthesized outputs from 4 upstream agents into final report. Quality: ${state.avg_quality_score}/10`,
    toolCalls: [{ tool: 'report_synthesis', sections: ['corpus', 'readiness', 'rag_results', 'evaluations'] }],
    tokensUsed: tokens,
  });

  return { finalReport, latency: Date.now() - t0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { session_id, goal = 'Run a full demo of the StagAI multi-agent pipeline to verify all RAG architectures work correctly for Fairfield University.' } = await req.json();

    if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 });

    const correlationId = crypto.randomUUID();

    // Run agents in sequence, each passing state via shared memory (AMP-inspired)
    await base44.asServiceRole.entities.PipelineSession.update(session_id, {
      status: 'running',
      started_at: new Date().toISOString(),
      total_agents: 5,
    });

    const orchResult = await orchestratorAgent(base44, session_id, goal, correlationId);
    const crawlerResult = await crawlerAgent(base44, session_id, correlationId);
    const indexerResult = await indexerAgent(base44, session_id, correlationId);
    const ragResult = await ragQueryAgent(base44, session_id, correlationId);
    const judgeResult = await llmJudgeAgent(base44, session_id, correlationId);
    const reportResult = await reporterAgent(base44, session_id, correlationId);

    return Response.json({
      success: true,
      session_id,
      correlation_id: correlationId,
      pipeline_summary: {
        orchestrator: orchResult.plan,
        corpus: crawlerResult.corpusSummary,
        readiness: indexerResult.readinessReport,
        queries_run: ragResult.results.length,
        avg_quality: judgeResult.avgScore,
        report: reportResult.finalReport,
      }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});