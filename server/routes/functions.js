import express from 'express';
import fetch from 'node-fetch'; // requires npm install node-fetch if Node < 18
import db from '../db.js';

const router = express.Router();

// Fallback logic from Deno functions

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION_NAME = 'fairfield_docs';

async function getEmbedding(text) {
  const hfToken = process.env.HUGGING_FACE_TOKEN;
  if (hfToken) {
    try {
      const res = await fetch('https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: text, options: { wait_for_model: true } })
      });
      if (res.ok) {
        const data = await res.json();
        return Array.isArray(data[0]) ? data[0] : data;
      }
    } catch (e) {}
  }

  const fireworksKey = process.env.FIREWORKS_API_KEY;
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
  }

  throw new Error('No embedding provider available.');
}

async function generateLLMResponse(prompt) {
  const messages = [{ role: 'user', content: prompt }];
  const llmKey = process.env.LLM_API_KEY;
  
  if (llmKey) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${llmKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'meta-llama/llama-3.1-8b-instruct', messages, max_tokens: 512 })
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }
  }
  
  return "Mock LLM Response. Please configure LLM_API_KEY in .env.";
}

router.post('/queryRAG', async (req, res) => {
  try {
    const { query, rag_type = 'vector', session_id } = req.body;
    
    // Simplistic vector search
    let responseText = '';
    let sources = [];
    
    if (rag_type === 'vector') {
      try {
        const queryEmbedding = await getEmbedding(query);
        const qRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
          method: 'POST',
          headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ vector: queryEmbedding, limit: 3, with_payload: true })
        });
        if (qRes.ok) {
          const data = await qRes.json();
          const results = data.result || [];
          const context = results.map(r => r.payload.text).join('\n');
          responseText = await generateLLMResponse(`Context: ${context}\n\nQuestion: ${query}`);
          sources = results.map(r => ({ title: r.payload.title, url: r.payload.url }));
        } else {
          responseText = await generateLLMResponse(query);
        }
      } catch (e) {
        responseText = `Error: ${e.message}`;
      }
    } else {
      responseText = await generateLLMResponse(query);
    }
    
    // Save chat message
    if (session_id) {
      db.prepare(`INSERT INTO ChatMessage (id, session_id, role, content, rag_mode, latency_ms, sources) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        require('uuid').v4(), session_id, 'assistant', responseText, rag_type, 100, JSON.stringify(sources)
      );
    }

    res.json({ response: responseText, sources, rag_type });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/crawlWebsite', async (req, res) => {
  res.json({ message: 'Mock crawler running in local backend' });
});

router.post('/indexDocuments', async (req, res) => {
  res.json({ message: 'Mock indexer running in local backend' });
});

export default router;
