/**
 * runFullBenchmark
 *
 * Full end-to-end benchmark pipeline:
 *   1. Crawl a demo website (using seeded demo docs if no Firecrawl key)
 *   2. Index into Qdrant (Vector RAG)
 *   3. Use existing docs in-memory (Vectorless / BM25 RAG)
 *   4. Query via FalkorDB graph relationships (Graph+Vector RAG)
 *   5. Run 10 queries x 3 RAG types with TRACe LLM-judge scoring
 *   6. Return side-by-side benchmark findings
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const QDRANT_URL = 'https://b14ca50b-03f6-488b-b732-df87fdc22880.us-west-1-0.aws.cloud.qdrant.io:6333';
const QDRANT_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6NjMyNTlhNjktNmI1OS00NmZkLWIwZjAtNjAzYzk4NDA3YjExIn0.0jCAkhCn1Hz2TPdbQvfkE0tBfT6J3V1AJfUsszL6VyU';
const COLLECTION_NAME = 'fairfield_docs';
const FALKORDB_URL = Deno.env.get('FALKORDB_URL') || '';

// ── Embeddings ────────────────────────────────────────────────────────────────
async function getEmbedding(text, hfToken) {
  try {
    const res = await fetch(
      'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2',
      { method: 'POST', headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }) }
    );
    if (res.ok) { const d = await res.json(); if (!d.error) return Array.isArray(d[0]) ? d[0] : d; }
  } catch (_) {}

  const fwKey = Deno.env.get('FIREWORKS_API_KEY');
  if (fwKey) {
    const res = await fetch('https://api.fireworks.ai/inference/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${fwKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: 'BAAI/bge-small-en-v1.5' })
    });
    if (res.ok) { const d = await res.json(); return d.data?.[0]?.embedding; }
  }
  throw new Error('No embedding provider available');
}

// ── LLM ───────────────────────────────────────────────────────────────────────
async function llmCall(messages, maxTokens = 400) {
  const fwKey = Deno.env.get('FIREWORKS_API_KEY');
  if (fwKey) {
    const res = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${fwKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'accounts/fireworks/models/llama-v3p1-8b-instruct', messages, max_tokens: maxTokens })
    });
    if (res.ok) { const d = await res.json(); const t = d.choices?.[0]?.message?.content || ''; if (t) return { text: t, tokens: d.usage?.total_tokens || 0 }; }
  }
  const orKey = Deno.env.get('LLM_API_KEY');
  if (orKey) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${orKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'meta-llama/llama-3.1-8b-instruct:free', messages, max_tokens: maxTokens })
    });
    if (res.ok) { const d = await res.json(); const t = d.choices?.[0]?.message?.content || ''; if (t) return { text: t, tokens: d.usage?.total_tokens || 0 }; }
  }
  return { text: '', tokens: 0 };
}

// ── TRACe LLM Judge ───────────────────────────────────────────────────────────
async function judgeResponse(query, context, response) {
  const prompt = `You are a RAG quality evaluator. Score this response 0-10 on each metric and return ONLY JSON.

QUERY: ${query}
CONTEXT: ${(context || '').substring(0, 1200)}
RESPONSE: ${(response || '').substring(0, 600)}

Return exactly: {"context_relevance": <0-10>, "faithfulness": <0-10>, "completeness": <0-10>, "utilization": <0-10>}`;

  const { text } = await llmCall([{ role: 'user', content: prompt }], 150);
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const s = JSON.parse(m[0]);
    for (const k of ['context_relevance', 'faithfulness', 'completeness', 'utilization']) {
      s[k] = Math.max(0, Math.min(10, Number(s[k]) || 0));
    }
    return s;
  } catch (_) { return null; }
}

// ── Qdrant helpers ────────────────────────────────────────────────────────────
async function ensureQdrantCollection() {
  const check = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, { headers: { 'api-key': QDRANT_API_KEY } });
  if (check.status === 404) {
    await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
      method: 'PUT', headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors: { size: 384, distance: 'Cosine' } })
    });
  }
}

async function qdrantSearch(embedding, limit = 5) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
    method: 'POST', headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vector: embedding, limit, with_payload: true })
  });
  if (!res.ok) return [];
  return (await res.json()).result || [];
}

async function upsertQdrant(points) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
    method: 'PUT', headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ points })
  });
  if (!res.ok) throw new Error(`Qdrant upsert failed: ${await res.text()}`);
}

function chunkText(text, size = 400, overlap = 50) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const c = words.slice(i, i + size).join(' ');
    if (c.trim().length > 50) chunks.push(c);
    if (i + size >= words.length) break;
  }
  return chunks;
}

// ── FalkorDB graph query ───────────────────────────────────────────────────────
async function graphSearch(vectorHits) {
  if (!FALKORDB_URL || vectorHits.length === 0) return [];
  try {
    const urls = vectorHits.map(h => `'${h.payload?.url}'`).join(',');
    const q = `MATCH (d:Document)-[:RELATED_TO*1..2]->(r:Document) WHERE d.url IN [${urls}] RETURN r.title, r.content, r.url LIMIT 8`;
    const res = await fetch(`${FALKORDB_URL}/graph/crawlect/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q })
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.results || []).map(r => ({ url: r['r.url'], title: r['r.title'], text: r['r.content']?.substring(0, 600) }));
  } catch (_) { return []; }
}

// ── RAG query per type ────────────────────────────────────────────────────────
async function runQuery(query, ragType, docs, hfToken) {
  const start = Date.now();
  let context = '', sources = [];

  if (ragType === 'vector') {
    const emb = await getEmbedding(query, hfToken);
    const hits = await qdrantSearch(emb, 5);
    sources = hits.map(h => ({ url: h.payload?.url, title: h.payload?.title, score: h.score }));
    context = hits.map((h, i) => `[Source ${i+1}: ${h.payload?.title || h.payload?.url}]\n${h.payload?.text}`).join('\n\n---\n\n');

  } else if (ragType === 'vectorless') {
    const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const scored = docs
      .filter(d => d.content)
      .map(d => {
        const text = ((d.title || '') + ' ' + d.content).toLowerCase();
        const score = qWords.reduce((s, w) => s + (text.match(new RegExp(w, 'g')) || []).length, 0);
        return { d, score };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    sources = scored.map(s => ({ url: s.d.url, title: s.d.title, score: s.score }));
    context = scored.map((s, i) => `[Source ${i+1}: ${s.d.title || s.d.url}]\n${s.d.content?.substring(0, 700)}`).join('\n\n---\n\n');

  } else if (ragType === 'graph_vector') {
    const emb = await getEmbedding(query, hfToken);
    const vectorHits = await qdrantSearch(emb, 3);
    const graphHits = await graphSearch(vectorHits);
    sources = [
      ...vectorHits.map(h => ({ url: h.payload?.url, title: h.payload?.title, score: h.score, source: 'vector' })),
      ...graphHits.map(h => ({ url: h.url, title: h.title, score: 0, source: 'graph' })),
    ];
    const vectorCtx = vectorHits.map((h, i) => `[Vector ${i+1}: ${h.payload?.title || h.payload?.url}]\n${h.payload?.text}`).join('\n\n');
    const graphCtx = graphHits.length > 0
      ? '\n\n=== Graph-connected related pages ===\n' + graphHits.map((h, i) => `[Graph ${i+1}: ${h.title || h.url}]\n${h.text || ''}`).join('\n\n')
      : '';
    context = vectorCtx + graphCtx;
  }

  const prompt = `Answer the question using ONLY the context below. Be concise and accurate.\n\nContext:\n${context || 'No context available.'}\n\nQuestion: ${query}\nAnswer:`;
  const { text: response, tokens } = await llmCall([{ role: 'user', content: prompt }], 350);
  const scores = await judgeResponse(query, context, response);

  return {
    query, rag_type: ragType, response, sources,
    context_snippet: context.substring(0, 500),
    latency_ms: Date.now() - start,
    tokens_used: tokens,
    scores,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { test_run_id, crawl_job_id } = await req.json();
    if (!test_run_id) return Response.json({ error: 'test_run_id required' }, { status: 400 });

    const { accessToken: hfToken } = await base44.asServiceRole.connectors.getConnection('hugging_face');

    // Mark running
    await base44.asServiceRole.entities.TestRun.update(test_run_id, {
      status: 'running', started_at: new Date().toISOString(),
      rag_types_tested: ['vector', 'vectorless', 'graph_vector'],
    });

    // Step 1: Ensure vector collection exists
    await ensureQdrantCollection();

    // Step 2: Load docs — from specific crawl job or all indexed docs
    let allDocs = await base44.asServiceRole.entities.CrawledDocument.list('-created_date', 500);
    if (crawl_job_id) allDocs = allDocs.filter(d => d.crawl_job_id === crawl_job_id);

    // Step 3: Index raw docs into Qdrant (vector only — vectorless uses raw text, graph uses FalkorDB)
    const rawDocs = allDocs.filter(d => d.status === 'raw' || (d.status === 'indexed' && !d.vector_indexed));
    let vectorIndexed = 0;
    for (const doc of rawDocs) {
      try {
        const chunks = chunkText(doc.content || '', 400, 50);
        const points = [];
        for (let i = 0; i < chunks.length; i++) {
          const emb = await getEmbedding(chunks[i], hfToken);
          const idBytes = new TextEncoder().encode(`${doc.id}_${i}`);
          const hashBuf = await crypto.subtle.digest('SHA-1', idBytes);
          const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
          const uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
          points.push({ id: uuid, vector: emb, payload: { doc_id: doc.id, url: doc.url, title: doc.title, page_type: doc.page_type, chunk_index: i, text: chunks[i] } });
        }
        for (let b = 0; b < points.length; b += 50) await upsertQdrant(points.slice(b, b + 50));
        await base44.asServiceRole.entities.CrawledDocument.update(doc.id, { status: 'indexed', vector_indexed: true, chunk_count: chunks.length });
        vectorIndexed++;
      } catch (e) {
        console.error(`Index error for ${doc.id}: ${e.message}`);
      }
    }

    // All docs now available (re-fetch to get updated status)
    const indexedDocs = await base44.asServiceRole.entities.CrawledDocument.list('-created_date', 500);
    const docsForQuery = crawl_job_id ? indexedDocs.filter(d => d.crawl_job_id === crawl_job_id) : indexedDocs;

    // Step 4: Define benchmark queries based on crawled content
    const domainDocs = docsForQuery.slice(0, 3);
    const domainHint = domainDocs.map(d => d.title || d.url).join(', ');
    const { text: queryListText } = await llmCall([{
      role: 'user',
      content: `Generate 8 diverse factual questions a user might ask about a website whose pages include: ${domainHint}. Return ONLY a JSON array of strings, no explanation.`
    }], 400);

    let queries = [];
    try { queries = JSON.parse(queryListText.match(/\[[\s\S]*\]/)?.[0] || '[]'); } catch (_) {}
    if (queries.length < 4) {
      queries = [
        'What is the main purpose of this website?',
        'What key topics are covered on this site?',
        'What resources or services are available here?',
        'What contact information is provided?',
        'What are the main highlights or features mentioned?',
      ];
    }
    queries = queries.slice(0, 8);

    // Step 5: Run all queries x 3 RAG types
    const ragTypes = ['vector', 'vectorless', 'graph_vector'];
    const allResults = [];
    const agg = { vector: { lat: [], cr: [], f: [], c: [], u: [] }, vectorless: { lat: [], cr: [], f: [], c: [], u: [] }, graph_vector: { lat: [], cr: [], f: [], c: [], u: [] } };

    for (const query of queries) {
      for (const ragType of ragTypes) {
        const result = await runQuery(query, ragType, docsForQuery, hfToken);

        await base44.asServiceRole.entities.QueryBenchmark.create({
          query_text: query,
          query_category: 'general',
          rag_type: ragType,
          response_text: result.response,
          sources_cited: result.sources.map(s => s.url).filter(Boolean),
          latency_ms: result.latency_ms,
          tokens_used: result.tokens_used,
          model_used: 'llama-3.1-8b',
          test_run_id,
          relevance_score: result.scores?.context_relevance ?? null,
          faithfulness_score: result.scores?.faithfulness ?? null,
          completeness_score: result.scores?.completeness ?? null,
          human_notes: result.scores ? `utilization:${result.scores.utilization.toFixed(1)}` : null,
        });

        if (result.scores) {
          agg[ragType].lat.push(result.latency_ms);
          agg[ragType].cr.push(result.scores.context_relevance);
          agg[ragType].f.push(result.scores.faithfulness);
          agg[ragType].c.push(result.scores.completeness);
          agg[ragType].u.push(result.scores.utilization);
        }
        allResults.push(result);
      }
    }

    // Step 6: Compute aggregates & winner
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const r1 = v => Math.round(v * 10) / 10;

    const summary = {};
    for (const rt of ragTypes) {
      const a = agg[rt];
      summary[rt] = {
        avg_latency_ms: Math.round(avg(a.lat)),
        context_relevance: r1(avg(a.cr)),
        faithfulness: r1(avg(a.f)),
        completeness: r1(avg(a.c)),
        utilization: r1(avg(a.u)),
        composite: r1((avg(a.cr) + avg(a.f) + avg(a.c) + avg(a.u)) / 4),
      };
    }

    const winner = ragTypes
      .map(rt => ({ rt, score: summary[rt].composite - Math.min(3, summary[rt].avg_latency_ms / 3000) }))
      .sort((a, b) => b.score - a.score)[0]?.rt || 'vector';

    await base44.asServiceRole.entities.TestRun.update(test_run_id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      rag_types_tested: ragTypes,
      winner,
      query_count: queries.length * ragTypes.length,
      avg_latency_vector: summary.vector.avg_latency_ms,
      avg_latency_vectorless: summary.vectorless.avg_latency_ms,
      avg_latency_graph: summary.graph_vector.avg_latency_ms,
      avg_relevance_vector: summary.vector.context_relevance,
      avg_relevance_vectorless: summary.vectorless.context_relevance,
      avg_relevance_graph: summary.graph_vector.context_relevance,
      notes: ragTypes.map(rt =>
        `${rt}: composite=${summary[rt].composite}, lat=${summary[rt].avg_latency_ms}ms, CR=${summary[rt].context_relevance}, F=${summary[rt].faithfulness}, C=${summary[rt].completeness}`
      ).join(' | '),
    });

    return Response.json({ success: true, test_run_id, winner, summary, queries_run: queries.length, docs_indexed: vectorIndexed });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});