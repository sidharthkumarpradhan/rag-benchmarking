import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// RAG Query Engine — uses HuggingFace connector for embeddings

const QDRANT_URL = 'https://b14ca50b-03f6-488b-b732-df87fdc22880.us-west-1-0.aws.cloud.qdrant.io:6333';
const QDRANT_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6NjMyNTlhNjktNmI1OS00NmZkLWIwZjAtNjAzYzk4NDA3YjExIn0.0jCAkhCn1Hz2TPdbQvfkE0tBfT6J3V1AJfUsszL6VyU';
const COLLECTION_NAME = 'fairfield_docs';

async function getEmbedding(text, hfToken) {
  const res = await fetch(
    'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } })
    }
  );
  if (!res.ok) throw new Error('Embedding failed');
  const data = await res.json();
  return Array.isArray(data[0]) ? data[0] : data;
}

async function vectorSearch(queryEmbedding, limit = 6) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
    method: 'POST',
    headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vector: queryEmbedding, limit, with_payload: true })
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.result || [];
}

async function generateLLMResponse(prompt, model, apiKey) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'meta-llama/llama-3.1-8b-instruct:free',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512
    })
  });
  if (!res.ok) throw new Error(`LLM call failed: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function vectorRAG(query, hfToken, llmApiKey, model) {
  const startTime = Date.now();
  const queryEmbedding = await getEmbedding(query, hfToken);
  const results = await vectorSearch(queryEmbedding, 6);

  const context = results.map((r, i) =>
    `[Source ${i + 1}: ${r.payload.title || r.payload.url}]\n${r.payload.text}`
  ).join('\n\n---\n\n');

  const prompt = `You are the Fairfield University StagAI assistant. Answer the question based ONLY on the provided context. Be concise and accurate.

Context:
${context}

Question: ${query}

Answer:`;

  const response = await generateLLMResponse(prompt, model, llmApiKey);
  return {
    response,
    context_text: context,
    sources: results.map(r => ({ url: r.payload.url, title: r.payload.title, score: r.score, text: r.payload.text })),
    latency_ms: Date.now() - startTime,
    tokens_used: Math.ceil((prompt.length + response.length) / 4)
  };
}

async function vectorlessRAG(query, base44, llmApiKey, model) {
  const startTime = Date.now();
  const docs = await base44.asServiceRole.entities.CrawledDocument.list('-updated_date', 200);
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  const scored = docs
    .filter(d => d.content)
    .map(doc => {
      const text = (doc.title + ' ' + doc.content).toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        const matches = (text.match(new RegExp(word, 'g')) || []).length;
        score += matches / (text.length / 1000 + 1);
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

  const response = await generateLLMResponse(prompt, model, llmApiKey);
  return {
    response,
    context_text: context,
    sources: scored.map(s => ({ url: s.doc.url, title: s.doc.title, score: s.score, text: s.doc.content?.substring(0, 400) })),
    latency_ms: Date.now() - startTime,
    tokens_used: Math.ceil((prompt.length + response.length) / 4)
  };
}

async function graphVectorRAG(query, hfToken, llmApiKey, model, base44) {
  const startTime = Date.now();
  const queryEmbedding = await getEmbedding(query, hfToken);
  const vectorResults = await vectorSearch(queryEmbedding, 3);

  const FALKORDB_URL = Deno.env.get('FALKORDB_URL');
  let graphContext = '';

  if (FALKORDB_URL) {
    try {
      const graphQuery = `MATCH (d:Document)-[:RELATED_TO*1..2]->(related:Document)
        WHERE d.url IN [${vectorResults.map(r => `'${r.payload.url}'`).join(',')}]
        RETURN related.title, related.content, related.url LIMIT 10`;
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
    } catch (_) {}
  }

  const vectorContext = vectorResults.map((r, i) =>
    `[Vector Source ${i + 1}: ${r.payload.title || r.payload.url}]\n${r.payload.text}`
  ).join('\n\n---\n\n');

  const fullContext = [vectorContext, graphContext].filter(Boolean).join('\n\n=== Graph Related ===\n\n');

  const prompt = `You are the Fairfield University StagAI assistant. You have access to both directly relevant content AND graph-connected related information. Synthesize these to give the most complete and accurate answer.

Context:
${fullContext}

Question: ${query}

Answer:`;

  const response = await generateLLMResponse(prompt, model, llmApiKey);
  return {
    response,
    sources: vectorResults.map(r => ({ url: r.payload.url, title: r.payload.title, score: r.score })),
    latency_ms: Date.now() - startTime,
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
      session_id,
      save_benchmark = false,
      test_run_id,
      query_category = 'general'
    } = await req.json();

    if (!query) return Response.json({ error: 'query is required' }, { status: 400 });

    // Get HuggingFace token via OAuth connector
    const { accessToken: hfToken } = await base44.asServiceRole.connectors.getConnection('hugging_face');
    const LLM_API_KEY = Deno.env.get('LLM_API_KEY');
    if (!LLM_API_KEY) return Response.json({ error: 'LLM_API_KEY not configured' }, { status: 500 });

    let result;
    if (rag_type === 'vector') {
      result = await vectorRAG(query, hfToken, LLM_API_KEY, model);
    } else if (rag_type === 'vectorless') {
      result = await vectorlessRAG(query, base44, LLM_API_KEY, model);
    } else if (rag_type === 'graph_vector') {
      result = await graphVectorRAG(query, hfToken, LLM_API_KEY, model, base44);
    } else {
      return Response.json({ error: 'Invalid rag_type' }, { status: 400 });
    }

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