import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// RAG Query Engine — handles Vector, Vectorless, and Graph Vector queries

const QDRANT_URL = 'https://b14ca50b-03f6-488b-b732-df87fdc22880.us-west-1-0.aws.cloud.qdrant.io:6333';
const QDRANT_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6NjMyNTlhNjktNmI1OS00NmZkLWIwZjAtNjAzYzk4NDA3YjExIn0.0jCAkhCn1Hz2TPdbQvfkE0tBfT6J3V1AJfUsszL6VyU';
const COLLECTION_NAME = 'fairfield_docs';

async function getEmbedding(text, hfApiKey) {
  const res = await fetch(
    'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hfApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } })
    }
  );
  if (!res.ok) throw new Error('Embedding failed');
  const data = await res.json();
  return Array.isArray(data[0]) ? data[0] : data;
}

async function vectorSearch(queryEmbedding, limit = 5) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
    method: 'POST',
    headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vector: queryEmbedding,
      limit,
      with_payload: true
    })
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.result || [];
}

async function generateLLMResponse(prompt, model, apiKey, provider) {
  let url, headers, body;

  if (provider === 'huggingface') {
    url = `https://api-inference.huggingface.co/models/${model}`;
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    body = JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 512, temperature: 0.3 } });
  } else if (provider === 'openrouter') {
    url = 'https://openrouter.ai/api/v1/chat/completions';
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    body = JSON.stringify({
      model: model || 'meta-llama/llama-3.1-8b-instruct:free',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512
    });
  } else {
    // Fireworks fallback
    url = 'https://api.fireworks.ai/inference/v1/chat/completions';
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    body = JSON.stringify({
      model: model || 'accounts/fireworks/models/llama-v3p1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512
    });
  }

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`LLM call failed: ${await res.text()}`);
  const data = await res.json();

  if (provider === 'huggingface') {
    return data[0]?.generated_text?.replace(prompt, '').trim() || data[0]?.generated_text || '';
  }
  return data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
}

// VECTOR RAG: embed query → search Qdrant → LLM generate
async function vectorRAG(query, hfApiKey, llmApiKey, llmModel, llmProvider) {
  const startTime = Date.now();
  const queryEmbedding = await getEmbedding(query, hfApiKey);
  const results = await vectorSearch(queryEmbedding, 6);

  const context = results.map((r, i) =>
    `[Source ${i + 1}: ${r.payload.title || r.payload.url}]\n${r.payload.text}`
  ).join('\n\n---\n\n');

  const prompt = `You are the Fairfield University StagAI assistant. Answer the question based ONLY on the provided context. Be concise and accurate.

Context:
${context}

Question: ${query}

Answer:`;

  const response = await generateLLMResponse(prompt, llmModel, llmApiKey, llmProvider);
  const latency = Date.now() - startTime;

  return {
    response,
    sources: results.map(r => ({ url: r.payload.url, title: r.payload.title, score: r.score })),
    latency_ms: latency,
    tokens_used: Math.ceil((prompt.length + response.length) / 4)
  };
}

// VECTORLESS RAG: keyword/BM25-style + LLM
async function vectorlessRAG(query, base44, llmApiKey, llmModel, llmProvider) {
  const startTime = Date.now();

  // Fetch all documents and do simple keyword matching (PageIndex-style)
  const docs = await base44.asServiceRole.entities.CrawledDocument.list('-updated_date', 200);
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  // Score documents by keyword frequency (BM25-like)
  const scored = docs
    .filter(d => d.content)
    .map(doc => {
      const text = (doc.title + ' ' + doc.content).toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        const matches = (text.match(new RegExp(word, 'g')) || []).length;
        score += matches / (text.length / 1000 + 1); // TF normalization
      }
      return { doc, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const context = scored.map((s, i) =>
    `[Source ${i + 1}: ${s.doc.title || s.doc.url}]\n${s.doc.content?.substring(0, 800)}`
  ).join('\n\n---\n\n');

  const prompt = `You are the Fairfield University StagAI assistant. Answer the question based ONLY on the provided context. Be concise and accurate.

Context:
${context}

Question: ${query}

Answer:`;

  const response = await generateLLMResponse(prompt, llmModel, llmApiKey, llmProvider);
  const latency = Date.now() - startTime;

  return {
    response,
    sources: scored.map(s => ({ url: s.doc.url, title: s.doc.title, score: s.score })),
    latency_ms: latency,
    tokens_used: Math.ceil((prompt.length + response.length) / 4)
  };
}

// GRAPH VECTOR RAG: hybrid vector + graph traversal (FalkorDB)
async function graphVectorRAG(query, hfApiKey, llmApiKey, llmModel, llmProvider, base44) {
  const startTime = Date.now();

  // Step 1: Vector search for anchor nodes
  const queryEmbedding = await getEmbedding(query, hfApiKey);
  const vectorResults = await vectorSearch(queryEmbedding, 3);

  // Step 2: Use FalkorDB for graph traversal (if configured)
  const FALKORDB_URL = Deno.env.get('FALKORDB_URL');
  let graphContext = '';

  if (FALKORDB_URL) {
    // Query FalkorDB for related nodes
    const graphQuery = `MATCH (d:Document)-[:RELATED_TO*1..2]->(related:Document)
      WHERE d.url IN [${vectorResults.map(r => `'${r.payload.url}'`).join(',')}]
      RETURN related.title, related.content, related.url LIMIT 10`;

    try {
      const graphRes = await fetch(`${FALKORDB_URL}/graph/fairfield/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: graphQuery })
      });
      if (graphRes.ok) {
        const graphData = await graphRes.json();
        graphContext = (graphData.results || [])
          .map(r => `[Related: ${r['related.title']}]\n${r['related.content']?.substring(0, 400)}`)
          .join('\n\n');
      }
    } catch {}
  }

  // Combine vector + graph context
  const vectorContext = vectorResults.map((r, i) =>
    `[Vector Source ${i + 1}: ${r.payload.title || r.payload.url}]\n${r.payload.text}`
  ).join('\n\n---\n\n');

  const fullContext = [vectorContext, graphContext].filter(Boolean).join('\n\n=== Graph Related ===\n\n');

  const prompt = `You are the Fairfield University StagAI assistant. You have access to both directly relevant content AND graph-connected related information. Synthesize these to give the most complete and accurate answer.

Context:
${fullContext}

Question: ${query}

Answer:`;

  const response = await generateLLMResponse(prompt, llmModel, llmApiKey, llmProvider);
  const latency = Date.now() - startTime;

  return {
    response,
    sources: vectorResults.map(r => ({ url: r.payload.url, title: r.payload.title, score: r.score })),
    latency_ms: latency,
    tokens_used: Math.ceil((prompt.length + response.length) / 4)
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      query,
      rag_type = 'vector',
      model = 'meta-llama/llama-3.1-8b-instruct:free',
      provider = 'openrouter',
      session_id,
      save_benchmark = false,
      test_run_id,
      query_category = 'general'
    } = await req.json();

    if (!query) return Response.json({ error: 'query is required' }, { status: 400 });

    const HF_API_KEY = Deno.env.get('HF_API_KEY');
    const LLM_API_KEY = Deno.env.get('LLM_API_KEY');

    if (!HF_API_KEY) return Response.json({ error: 'HF_API_KEY not configured' }, { status: 500 });
    if (!LLM_API_KEY) return Response.json({ error: 'LLM_API_KEY not configured' }, { status: 500 });

    let result;
    if (rag_type === 'vector') {
      result = await vectorRAG(query, HF_API_KEY, LLM_API_KEY, model, provider);
    } else if (rag_type === 'vectorless') {
      result = await vectorlessRAG(query, base44, LLM_API_KEY, model, provider);
    } else if (rag_type === 'graph_vector') {
      result = await graphVectorRAG(query, HF_API_KEY, LLM_API_KEY, model, provider, base44);
    } else {
      return Response.json({ error: 'Invalid rag_type' }, { status: 400 });
    }

    // Save to benchmark if requested
    if (save_benchmark) {
      await base44.asServiceRole.entities.QueryBenchmark.create({
        query_text: query,
        query_category,
        rag_type,
        response_text: result.response,
        sources_cited: result.sources.map(s => s.url),
        latency_ms: result.latency_ms,
        tokens_used: result.tokens_used,
        model_used: model,
        session_id,
        test_run_id
      });
    }

    // Save chat message if session provided
    if (session_id) {
      await base44.asServiceRole.entities.ChatMessage.create({
        session_id,
        role: 'assistant',
        content: result.response,
        rag_type_used: rag_type,
        sources: result.sources,
        latency_ms: result.latency_ms,
        tokens_used: result.tokens_used,
        model
      });

      // Update session stats
      const sessions = await base44.asServiceRole.entities.ChatSession.list();
      const session = sessions.find(s => s.id === session_id);
      if (session) {
        await base44.asServiceRole.entities.ChatSession.update(session_id, {
          message_count: (session.message_count || 0) + 2,
          last_message_at: new Date().toISOString(),
          total_tokens: (session.total_tokens || 0) + (result.tokens_used || 0)
        });
      }
    }

    return Response.json({ ...result, rag_type, model });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});