/**
 * crawlAndBenchmark — Full E2E pipeline (no Firecrawl needed)
 * 1. Fetch pages from a website using native fetch (BFS crawl)
 * 2. Store as CrawledDocument records + embed + upsert to Qdrant inline
 * 3. Create TestRun + QueryBenchmark records for all 3 RAG types
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const QDRANT_URL = 'https://b14ca50b-03f6-488b-b732-df87fdc22880.us-west-1-0.aws.cloud.qdrant.io:6333';
const QDRANT_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6NjMyNTlhNjktNmI1OS00NmZkLWIwZjAtNjAzYzk4NDA3YjExIn0.0jCAkhCn1Hz2TPdbQvfkE0tBfT6J3V1AJfUsszL6VyU';
const COLLECTION_NAME = 'fairfield_docs';
const FETCH_TIMEOUT = 8000;
const MAX_PAGES = 25;

// ── HTML helpers ─────────────────────────────────────────────────────────────
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 8000);
}
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim().substring(0, 200) : '';
}
function extractLinks(html, baseUrl) {
  const links = new Set();
  const base = new URL(baseUrl);
  const re = /href=["']([^"'#?]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl).href.split('#')[0].split('?')[0];
      if (new URL(abs).hostname === base.hostname && abs.startsWith('http')) links.add(abs);
    } catch (_) {}
  }
  return [...links];
}
function detectPageType(url) {
  if (url.includes('/catalog')) return 'catalog';
  if (url.includes('/faculty') || url.includes('/staff')) return 'faculty';
  if (url.includes('/course') || url.includes('/academic')) return 'course';
  if (url.includes('/news') || url.includes('/event')) return 'news';
  if (url.includes('/it') || url.includes('/help') || url.includes('/support')) return 'it_kb';
  return 'general';
}
function chunkText(text, size = 400, overlap = 50) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk.trim().length > 80) chunks.push(chunk);
    if (i + size >= words.length) break;
  }
  return chunks;
}

// ── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchPage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CrawlectBot/1.0)',
        'Accept': 'text/html',
      }
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) return null;
    return await res.text();
  } catch (_) {
    clearTimeout(t);
    return null;
  }
}

// ── Embedding (Fireworks BAAI/bge-small-en-v1.5, dim=384) ──────────────────
async function getEmbedding(text) {
  const key = Deno.env.get('FIREWORKS_API_KEY');
  if (!key) return null;
  const res = await fetch('https://api.fireworks.ai/inference/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text, model: 'BAAI/bge-small-en-v1.5' })
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.data?.[0]?.embedding || null;
}

// ── Qdrant upsert ────────────────────────────────────────────────────────────
async function ensureCollection() {
  const check = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, { headers: { 'api-key': QDRANT_API_KEY } });
  if (check.status === 404) {
    await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
      method: 'PUT',
      headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors: { size: 384, distance: 'Cosine' } })
    });
  }
}
async function upsertPoints(points) {
  if (!points.length) return;
  await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
    method: 'PUT',
    headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ points })
  });
}
async function qdrantSearch(embedding, limit = 5) {
  if (!embedding) return [];
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
    method: 'POST',
    headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vector: embedding, limit, with_payload: true })
  });
  if (!res.ok) return [];
  return (await res.json()).result || [];
}

// ── LLM call ─────────────────────────────────────────────────────────────────
async function llmCall(prompt, maxTokens = 400) {
  const fwKey = Deno.env.get('FIREWORKS_API_KEY');
  if (fwKey) {
    const res = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${fwKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'accounts/fireworks/models/llama-v3p1-8b-instruct', messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens })
    });
    if (res.ok) {
      const d = await res.json();
      return d.choices?.[0]?.message?.content || '';
    }
  }
  const orKey = Deno.env.get('LLM_API_KEY');
  if (orKey) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${orKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'meta-llama/llama-3.1-8b-instruct', messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens })
    });
    if (res.ok) {
      const d = await res.json();
      return d.choices?.[0]?.message?.content || '';
    }
  }
  return '';
}

// ── TRACe judge ──────────────────────────────────────────────────────────────
async function judgeResponse(query, context, response) {
  const prompt = `You are an expert RAG evaluator. Score this RAG response. Return ONLY JSON with these keys (0-10 each):
{"context_relevance": N, "faithfulness": N, "completeness": N, "utilization": N}

QUERY: ${query}
CONTEXT: ${context.substring(0, 800)}
RESPONSE: ${response.substring(0, 600)}

JSON only:`;
  const text = await llmCall(prompt, 150);
  try {
    const m = text.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    const s = JSON.parse(m[0]);
    for (const k of ['context_relevance', 'faithfulness', 'completeness', 'utilization']) {
      if (typeof s[k] !== 'number') return null;
      s[k] = Math.max(0, Math.min(10, s[k]));
    }
    return s;
  } catch (_) { return null; }
}

// ── Default benchmark queries ─────────────────────────────────────────────────
const DEFAULT_QUERIES = [
  { text: 'What is this website about?', category: 'general' },
  { text: 'What are the main topics covered here?', category: 'general' },
  { text: 'Who is the target audience for this content?', category: 'general' },
  { text: 'What key information can I find here?', category: 'general' },
  { text: 'Summarize the most important content on this site.', category: 'general' },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { seed_url, max_pages = 15, rag_types = ['vector', 'vectorless', 'graph_vector'] } = await req.json();
    if (!seed_url) return Response.json({ error: 'seed_url required' }, { status: 400 });

    const limit = Math.min(max_pages, MAX_PAGES);

    // ── Step 1: CrawlJob record ───────────────────────────────────────────────
    const job = await base44.asServiceRole.entities.CrawlJob.create({
      name: `E2E — ${new URL(seed_url).hostname}`,
      urls: [seed_url], max_depth: 2, max_pages: limit,
      crawl_type: 'manual', status: 'running',
      started_at: new Date().toISOString(), pages_total: limit,
    });

    // ── Step 2: BFS fetch crawl ──────────────────────────────────────────────
    const visited = new Set();
    const queue = [seed_url];
    const crawledDocs = []; // { id, url, title, content }
    let crawled = 0;

    await ensureCollection();

    while (queue.length > 0 && crawled < limit) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      const html = await fetchPage(url);
      if (!html || html.length < 200) continue;

      const content = htmlToText(html);
      if (content.length < 100) continue;

      // Save to DB
      const doc = await base44.asServiceRole.entities.CrawledDocument.create({
        url, title: extractTitle(html), content,
        source_domain: new URL(url).hostname,
        crawl_job_id: job.id, status: 'raw',
        word_count: content.split(/\s+/).length,
        page_type: detectPageType(url),
      });
      crawledDocs.push({ id: doc.id, url, title: extractTitle(html), content });
      crawled++;

      // Enqueue links (max 4 per page)
      for (const link of extractLinks(html, url).slice(0, 4)) {
        if (!visited.has(link)) queue.push(link);
      }
    }

    await base44.asServiceRole.entities.CrawlJob.update(job.id, {
      status: 'completed', pages_crawled: crawled,
      completed_at: new Date().toISOString(),
    });

    // ── Step 3: Embed + index into Qdrant ────────────────────────────────────
    let indexedChunks = 0;
    for (const doc of crawledDocs) {
      const chunks = chunkText(doc.content);
      const points = [];
      for (let i = 0; i < chunks.length; i++) {
        const emb = await getEmbedding(chunks[i]);
        if (!emb) continue;
        const idBytes = new TextEncoder().encode(`${doc.id}_${i}`);
        const hashBuf = await crypto.subtle.digest('SHA-1', idBytes);
        const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        const pid = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
        points.push({ id: pid, vector: emb, payload: { doc_id: doc.id, url: doc.url, title: doc.title, chunk_index: i, text: chunks[i] } });
        indexedChunks++;
      }
      if (points.length) {
        for (let b = 0; b < points.length; b += 50) await upsertPoints(points.slice(b, b + 50));
        await base44.asServiceRole.entities.CrawledDocument.update(doc.id, { status: 'indexed', vector_indexed: true, chunk_count: chunks.length });
      }
    }

    // ── Step 4: Create TestRun ────────────────────────────────────────────────
    const testRun = await base44.asServiceRole.entities.TestRun.create({
      name: `3-RAG Benchmark — ${new URL(seed_url).hostname}`,
      description: `${crawled} pages crawled, ${indexedChunks} chunks indexed into Qdrant. Benchmarking: ${rag_types.join(', ')}.`,
      status: 'running',
      started_at: new Date().toISOString(),
      rag_types_tested: rag_types,
      model_used: 'llama-3.1-8b',
    });

    // ── Step 5: Run benchmark inline across all 3 RAG types ──────────────────
    const allDocs = crawledDocs.length > 0 ? crawledDocs
      : (await base44.asServiceRole.entities.CrawledDocument.list('-created_date', 200));

    const agg = {};
    for (const rt of rag_types) agg[rt] = { latencies: [], cr: [], f: [], c: [], u: [] };

    for (const q of DEFAULT_QUERIES) {
      for (const ragType of rag_types) {
        const t0 = Date.now();
        let response = '', context = '', sources = [];

        if (ragType === 'vector') {
          const emb = await getEmbedding(q.text);
          const hits = await qdrantSearch(emb, 5);
          context = hits.map((h, i) => `[${i+1}: ${h.payload?.title || h.payload?.url}]\n${h.payload?.text}`).join('\n\n');
          sources = hits.map(h => h.payload?.url).filter(Boolean);
          const prompt = `Answer the question using ONLY the context below. Be concise.\n\nContext:\n${context}\n\nQuestion: ${q.text}\nAnswer:`;
          response = await llmCall(prompt, 300);
        } else if (ragType === 'vectorless') {
          const qWords = q.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const scored = allDocs
            .filter(d => d.content)
            .map(d => {
              const txt = ((d.title || '') + ' ' + (d.content || '')).toLowerCase();
              let score = 0;
              for (const w of qWords) score += (txt.match(new RegExp(w, 'g')) || []).length;
              return { d, score };
            })
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
          context = scored.map((s, i) => `[${i+1}: ${s.d.title || s.d.url}]\n${(s.d.content || '').substring(0, 600)}`).join('\n\n');
          sources = scored.map(s => s.d.url).filter(Boolean);
          const prompt = `Answer the question using ONLY the context below. Be concise.\n\nContext:\n${context || 'No matching content found.'}\n\nQuestion: ${q.text}\nAnswer:`;
          response = await llmCall(prompt, 300);
        } else if (ragType === 'graph_vector') {
          // Graph+Vector: use vector results + try FalkorDB graph expansion
          const emb = await getEmbedding(q.text);
          const hits = await qdrantSearch(emb, 3);
          let graphContext = '';
          const falkorUrl = Deno.env.get('FALKORDB_URL');
          if (falkorUrl && hits.length > 0) {
            try {
              const docUrls = hits.map(h => `'${h.payload?.url}'`).join(',');
              const gRes = await fetch(`${falkorUrl}/graph/crawlect/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: `MATCH (d:Document)-[:RELATED_TO*1..2]->(r:Document) WHERE d.url IN [${docUrls}] RETURN r.title, r.content, r.url LIMIT 5` })
              });
              if (gRes.ok) {
                const gData = await gRes.json();
                graphContext = (gData.results || []).map(r => `[Graph: ${r['r.title']}]\n${(r['r.content'] || '').substring(0, 400)}`).join('\n\n');
              }
            } catch (_) {}
          }
          context = [
            hits.map((h, i) => `[Vector ${i+1}: ${h.payload?.title}]\n${h.payload?.text}`).join('\n\n'),
            graphContext
          ].filter(Boolean).join('\n\n--- Graph Context ---\n\n');
          sources = hits.map(h => h.payload?.url).filter(Boolean);
          const prompt = `Answer the question using vector + graph context. Be concise.\n\nContext:\n${context || 'No content found.'}\n\nQuestion: ${q.text}\nAnswer:`;
          response = await llmCall(prompt, 300);
        }

        const latency = Date.now() - t0;
        const scores = await judgeResponse(q.text, context, response);

        await base44.asServiceRole.entities.QueryBenchmark.create({
          query_text: q.text,
          query_category: q.category,
          rag_type: ragType,
          response_text: response,
          sources_cited: sources,
          latency_ms: latency,
          tokens_used: Math.ceil((context.length + response.length) / 4),
          model_used: 'llama-3.1-8b',
          test_run_id: testRun.id,
          relevance_score: scores?.context_relevance ?? null,
          faithfulness_score: scores?.faithfulness ?? null,
          completeness_score: scores?.completeness ?? null,
          human_notes: scores ? `utilization:${scores.utilization.toFixed(1)}` : null,
        });

        agg[ragType].latencies.push(latency);
        if (scores) {
          agg[ragType].cr.push(scores.context_relevance);
          agg[ragType].f.push(scores.faithfulness);
          agg[ragType].c.push(scores.completeness);
          agg[ragType].u.push(scores.utilization);
        }
      }
    }

    // ── Step 6: Finalize TestRun with winner ──────────────────────────────────
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const r1 = v => Math.round(v * 10) / 10;

    const compositeScore = rt => {
      const a = agg[rt];
      if (!a.latencies.length) return -1;
      return (avg(a.cr) + avg(a.f) + avg(a.c) + avg(a.u)) / 4 - Math.min(3, avg(a.latencies) / 3000);
    };

    const winner = rag_types
      .map(rt => ({ rt, s: compositeScore(rt) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)[0]?.rt || rag_types[0];

    const updates = {
      status: 'completed', completed_at: new Date().toISOString(), winner,
      notes: rag_types.map(rt => {
        const a = agg[rt];
        return `${rt}: CR=${r1(avg(a.cr))}, F=${r1(avg(a.f))}, C=${r1(avg(a.c))}, U=${r1(avg(a.u))}, lat=${Math.round(avg(a.latencies))}ms`;
      }).join(' | '),
    };
    for (const rt of rag_types) {
      const k = rt === 'graph_vector' ? 'graph' : rt;
      updates[`avg_latency_${k}`] = Math.round(avg(agg[rt].latencies));
      if (agg[rt].cr.length) updates[`avg_relevance_${k}`] = r1(avg(agg[rt].cr));
    }

    await base44.asServiceRole.entities.TestRun.update(testRun.id, updates);

    return Response.json({
      success: true,
      crawl_job_id: job.id,
      test_run_id: testRun.id,
      pages_crawled: crawled,
      indexed_chunks: indexedChunks,
      winner,
      summary: updates.notes,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});