import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Agent 2: Document Indexer — chunks documents and sends to vector/graph DBs

const QDRANT_URL = 'https://b14ca50b-03f6-488b-b732-df87fdc22880.us-west-1-0.aws.cloud.qdrant.io:6333';
const QDRANT_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6NjMyNTlhNjktNmI1OS00NmZkLWIwZjAtNjAzYzk4NDA3YjExIn0.0jCAkhCn1Hz2TPdbQvfkE0tBfT6J3V1AJfUsszL6VyU';
const COLLECTION_NAME = 'fairfield_docs';

function chunkText(text, chunkSize = 512, overlap = 64) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 50) chunks.push(chunk);
    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}

async function ensureQdrantCollection() {
  // Check if collection exists
  const checkRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
    headers: { 'api-key': QDRANT_API_KEY }
  });

  if (checkRes.status === 404) {
    // Create collection with 384 dims (all-MiniLM-L6-v2)
    const createRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
      method: 'PUT',
      headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vectors: { size: 384, distance: 'Cosine' }
      })
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create Qdrant collection: ${err}`);
    }
  }
}

async function getEmbedding(text, hfApiKey) {
  const res = await fetch(
    'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hfApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } })
    }
  );
  if (!res.ok) throw new Error(`HuggingFace embedding failed: ${await res.text()}`);
  const data = await res.json();
  // HF returns array of arrays for batch, or flat array for single
  return Array.isArray(data[0]) ? data[0] : data;
}

async function upsertToQdrant(points) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
    method: 'PUT',
    headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ points })
  });
  if (!res.ok) throw new Error(`Qdrant upsert failed: ${await res.text()}`);
  return res.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const HF_API_KEY = Deno.env.get('HF_API_KEY');
    if (!HF_API_KEY) return Response.json({ error: 'HF_API_KEY not configured' }, { status: 500 });

    const { document_ids, index_targets = ['vector'] } = await req.json();

    // Ensure Qdrant collection exists
    if (index_targets.includes('vector')) {
      await ensureQdrantCollection();
    }

    // Fetch documents
    const allDocs = await base44.asServiceRole.entities.CrawledDocument.list();
    const docs = document_ids
      ? allDocs.filter(d => document_ids.includes(d.id))
      : allDocs.filter(d => d.status === 'raw');

    let indexed = 0;
    const errors = [];

    for (const doc of docs) {
      try {
        const chunks = chunkText(doc.content || '', 400, 50);
        const qdrantPoints = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];

          if (index_targets.includes('vector')) {
            const embedding = await getEmbedding(chunk, HF_API_KEY);
            qdrantPoints.push({
              id: `${doc.id}_${i}`,
              vector: embedding,
              payload: {
                doc_id: doc.id,
                url: doc.url,
                title: doc.title,
                page_type: doc.page_type,
                chunk_index: i,
                text: chunk
              }
            });
          }
        }

        // Batch upsert to Qdrant
        if (qdrantPoints.length > 0) {
          // Upsert in batches of 50
          for (let b = 0; b < qdrantPoints.length; b += 50) {
            await upsertToQdrant(qdrantPoints.slice(b, b + 50));
          }
        }

        // Mark document as indexed
        const updates = { status: 'indexed', chunk_count: chunks.length };
        if (index_targets.includes('vector')) updates.vector_indexed = true;

        await base44.asServiceRole.entities.CrawledDocument.update(doc.id, updates);
        indexed++;

      } catch (docErr) {
        errors.push(`Doc ${doc.id}: ${docErr.message}`);
        await base44.asServiceRole.entities.CrawledDocument.update(doc.id, {
          status: 'failed'
        });
      }
    }

    return Response.json({ success: true, indexed, errors });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});