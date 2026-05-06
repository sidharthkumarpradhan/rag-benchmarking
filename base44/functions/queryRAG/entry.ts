import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// RAG Query Engine — uses HuggingFace connector for embeddings

const QDRANT_URL = 'https://b14ca50b-03f6-488b-b732-df87fdc22880.us-west-1-0.aws.cloud.qdrant.io:6333';
const QDRANT_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6NjMyNTlhNjktNmI1OS00NmZkLWIwZjAtNjAzYzk4NDA3YjExIn0.0jCAkhCn1Hz2TPdbQvfkE0tBfT6J3V1AJfUsszL6VyU';
const COLLECTION_NAME = 'fairfield_docs';

async function getEmbedding(text, hfToken) {
  // 1. Try HuggingFace (primary)
  try {
    const res = await fetch(
      'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2',
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: text, options: { wait_for_model: true } })
      }
    );
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data[0]) ? data[0] : data;
    }
  } catch (_) {}

  // 2. Fallback: Fireworks embeddings (same model — vectors are compatible with Qdrant index)
  const fireworksKey = Deno.env.get('FIREWORKS_API_KEY');
  if (fireworksKey) {
    const res = await fetch('https://api.fireworks.ai/inference/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${fireworksKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: 'BAAI/bge-small-en-v1.5' })
    });
    if (res.ok) {
      const data = await res.json();
      return data.data?.[0]?.embedding;
    }
    const errBody = await res.text();
    throw new Error(`Fireworks embedding failed (${res.status}): ${errBody.substring(0, 300)}`);
  }

  throw new Error('No embedding provider available. HF credits depleted and FIREWORKS_API_KEY not set.');
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

async function generateLLMResponse(prompt, model, hfToken) {
  const hfModel = 'meta-llama/Llama-3.1-8B-Instruct';
  const messages = [{ role: 'user', content: prompt }];

  let hfError = 'not tried', orError = 'not tried', fwError = 'not tried';

  // 1. Try HuggingFace Inference API (primary — uses OAuth, no extra key needed)
  try {
    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: hfModel, messages, max_tokens: 512 })
    });
    const hfBody = await res.text();
    if (res.ok) {
      const data = JSON.parse(hfBody);
      const text = data.choices?.[0]?.message?.content || '';
      if (text) return text;
      hfError = 'empty response';
    } else {
      hfError = `${res.status}: ${hfBody.substring(0, 200)}`;
    }
  } catch (e) { hfError = e.message; }

  // 2. Fallback: OpenRouter
  const openrouterKey = Deno.env.get('LLM_API_KEY');
  if (openrouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'meta-llama/llama-3.1-8b-instruct', messages, max_tokens: 512 })
      });
      const orBody = await res.text();
      if (res.ok) {
        const data = JSON.parse(orBody);
        const text = data.choices?.[0]?.message?.content || '';
        if (text) return text;
        orError = 'empty response';
      } else {
        orError = `${res.status}: ${orBody.substring(0, 200)}`;
      }
    } catch (e) { orError = e.message; }
  } else { orError = 'LLM_API_KEY not set'; }

  // 3. Fallback: Fireworks AI
  const fireworksKey = Deno.env.get('FIREWORKS_API_KEY');
  if (fireworksKey) {
    try {
      const res = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${fireworksKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'accounts/fireworks/models/llama-v3p1-8b-instruct', messages, max_tokens: 512 })
      });
      const fwBody = await res.text();
      if (res.ok) {
        const data = JSON.parse(fwBody);
        return data.choices?.[0]?.message?.content || '';
      } else {
        fwError = `${res.status}: ${fwBody.substring(0, 200)}`;
      }
    } catch (e) { fwError = e.message; }
  } else { fwError = 'FIREWORKS_API_KEY not set'; }

  throw new Error(`All LLM providers failed. HF: ${hfError} | OpenRouter: ${orError} | Fireworks: ${fwError}`);
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

// ── PageIndex helpers (mirroring VectifyAI/PageIndex open-source algorithm) ──
function buildPageIndex(title, htmlContent) {
  const text = htmlContent
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const headingRe = /<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const nodes = [];
  let match;
  while ((match = headingRe.exec(text)) !== null) {
    const headingText = match[2].replace(/<[^>]+>/g, '').trim();
    if (headingText.length < 3) continue;
    nodes.push({ level: parseInt(match[1]), title: headingText, pos: match.index });
  }

  for (let i = 0; i < nodes.length; i++) {
    const start = nodes[i].pos;
    const end = i + 1 < nodes.length ? nodes[i + 1].pos : text.length;
    const segment = text.slice(start, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    nodes[i].text = segment.substring(0, 1200);
    nodes[i].node_id = String(i + 1).padStart(4, '0');
  }

  if (nodes.length === 0) {
    const plainText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return [{ node_id: '0001', title: title || 'Document', text: plainText.substring(0, 2000), nodes: [] }];
  }

  const stack = [];
  const roots = [];
  for (const node of nodes) {
    const treeNode = { node_id: node.node_id, title: node.title, text: node.text, nodes: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (!stack.length) {
      roots.push({ ...treeNode, level: node.level });
      stack.push({ level: node.level, treeNode: roots[roots.length - 1] });
    } else {
      const parent = stack[stack.length - 1].treeNode;
      parent.nodes.push({ ...treeNode, level: node.level });
      stack.push({ level: node.level, treeNode: parent.nodes[parent.nodes.length - 1] });
    }
  }

  function cleanTree(nodeList) {
    return nodeList.map(n => {
      const c = { node_id: n.node_id, title: n.title, text: n.text };
      if (n.nodes && n.nodes.length) c.nodes = cleanTree(n.nodes);
      return c;
    });
  }
  return cleanTree(roots);
}

function flattenTree(tree) {
  const result = [];
  function traverse(nodes) {
    for (const n of nodes) {
      result.push({ node_id: n.node_id, title: n.title, text: n.text || '' });
      if (n.nodes) traverse(n.nodes);
    }
  }
  traverse(tree);
  return result;
}

function treeTOC(tree, indent = 0) {
  return tree.map(n => {
    const line = `${'  '.repeat(indent)}[${n.node_id}] ${n.title}`;
    return n.nodes && n.nodes.length ? line + '\n' + treeTOC(n.nodes, indent + 1) : line;
  }).join('\n');
}

async function pageIndexRetrieve(query, pageIndexTree, flatNodes, llmApiKey, hfToken, model) {
  // Step 1: LLM reasons over the TOC to select relevant node IDs
  const toc = treeTOC(pageIndexTree);
  const selectPrompt = `You are a precise document retrieval system using the PageIndex method.
Given this document tree (Table of Contents) and a user query, identify the 3-5 most relevant node IDs.

DOCUMENT TREE:
${toc}

QUERY: ${query}

Reply ONLY with a JSON array of node_ids. Example: ["0001","0003","0007"]
JSON only:`;

  const selectionText = await generateLLMResponse(selectPrompt, model, llmApiKey);
  let selectedIds = [];
  try {
    const m = selectionText.match(/\[[\s\S]*?\]/);
    if (m) selectedIds = JSON.parse(m[0]).map(id => String(id).padStart(4, '0'));
  } catch (_) {}

  if (!selectedIds.length) {
    const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    selectedIds = flatNodes
      .map(n => ({ id: n.node_id, score: qWords.reduce((s, w) => s + (n.title.toLowerCase().includes(w) ? 2 : 0) + ((n.text || '').toLowerCase().includes(w) ? 1 : 0), 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(n => n.id);
  }

  return selectedIds.map(id => flatNodes.find(n => n.node_id === id)).filter(Boolean);
}

async function vectorlessRAG(query, base44, llmApiKey, hfToken, model) {
  const startTime = Date.now();
  const docs = await base44.asServiceRole.entities.CrawledDocument.list('-updated_date', 100);

  const contextParts = [];
  const sources = [];

  for (const doc of docs.filter(d => d.content)) {
    // Build PageIndex tree on-the-fly from stored content
    // Use a markdown-style parse if no HTML available: treat the content as plain text with simple sections
    const fakeHtml = `<h2>${doc.title || 'Document'}</h2>\n` + doc.content;
    const tree = buildPageIndex(doc.title || '', fakeHtml);
    const flatNodes = flattenTree(tree);

    const selectedNodes = await pageIndexRetrieve(query, tree, flatNodes, llmApiKey, hfToken, model);
    for (const node of selectedNodes) {
      if (node.text && node.text.trim().length > 50) {
        contextParts.push(`[${doc.title || doc.url} › ${node.title}]\n${node.text.substring(0, 700)}`);
        sources.push({ url: doc.url, title: doc.title, score: 1, text: node.text.substring(0, 300) });
      }
    }
    if (contextParts.length >= 6) break; // cap at 6 context sections
  }

  const context = contextParts.join('\n\n---\n\n');

  const prompt = `You are the Fairfield University StagAI assistant. Using the PageIndex reasoning-based retrieval below (structured document sections), answer the question accurately and cite the source sections.

Context (PageIndex retrieved sections):
${context || 'No relevant sections found.'}

Question: ${query}

Answer:`;

  const response = await generateLLMResponse(prompt, model, llmApiKey);
  return {
    response,
    context_text: context,
    sources,
    latency_ms: Date.now() - startTime,
    tokens_used: Math.ceil((prompt.length + response.length) / 4),
    retrieval_method: 'pageindex'
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

    // Get HuggingFace token via OAuth connector (used for embeddings AND LLM inference)
    const { accessToken: hfToken } = await base44.asServiceRole.connectors.getConnection('hugging_face');

    let result;
    if (rag_type === 'vector') {
      result = await vectorRAG(query, hfToken, hfToken, model);
    } else if (rag_type === 'vectorless') {
      result = await vectorlessRAG(query, base44, hfToken, hfToken, model);
    } else if (rag_type === 'graph_vector') {
      result = await graphVectorRAG(query, hfToken, hfToken, model, base44);
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