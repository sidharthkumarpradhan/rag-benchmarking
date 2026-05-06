import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Agent 2: Document Indexer — uses HuggingFace connector for embeddings, Supabase connector for storage

const QDRANT_URL = 'https://b14ca50b-03f6-488b-b732-df87fdc22880.us-west-1-0.aws.cloud.qdrant.io:6333';
const QDRANT_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6NjMyNTlhNjktNmI1OS00NmZkLWIwZjAtNjAzYzk4NDA3YjExIn0.0jCAkhCn1Hz2TPdbQvfkE0tBfT6J3V1AJfUsszL6VyU';
const COLLECTION_NAME = 'fairfield_docs';

function chunkText(text, chunkSize = 400, overlap = 50) {
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
  const checkRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
    headers: { 'api-key': QDRANT_API_KEY }
  });
  if (checkRes.status === 404) {
    const createRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
      method: 'PUT',
      headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors: { size: 384, distance: 'Cosine' } })
    });
    if (!createRes.ok) throw new Error(`Failed to create Qdrant collection: ${await createRes.text()}`);
  }
}

async function getEmbedding(text, hfToken) {
  // Use HuggingFace connector via router.huggingface.co
  const res = await fetch(
    'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hfToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } })
    }
  );
  if (!res.ok) throw new Error(`HuggingFace embedding failed: ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data[0]) ? data[0] : data;
}

async function upsertToQdrant(points) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
    method: 'PUT',
    headers: { 'api-key': QDRANT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ points })
  });
  if (!res.ok) throw new Error(`Qdrant upsert failed: ${await res.text()}`);
}

async function getSupabaseProjectRef(supabaseToken) {
  const res = await fetch('https://api.supabase.com/v1/projects', {
    headers: { 'Authorization': `Bearer ${supabaseToken}` }
  });
  if (!res.ok) return null;
  const projects = await res.json();
  return projects[0]?.ref || null;
}

async function storeDocumentInSupabase(projectRef, serviceRoleKey, doc, chunkCount) {
  if (!projectRef || !serviceRoleKey) return;
  // Upsert document metadata into Supabase
  await fetch(`https://${projectRef}.supabase.co/rest/v1/crawled_documents`, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({
      doc_id: doc.id,
      url: doc.url,
      title: doc.title,
      page_type: doc.page_type,
      word_count: doc.word_count,
      chunk_count: chunkCount,
      vector_indexed: true,
      indexed_at: new Date().toISOString()
    })
  });
}

async function getSupabaseServiceKey(projectRef, supabaseToken) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
    headers: { 'Authorization': `Bearer ${supabaseToken}` }
  });
  if (!res.ok) return null;
  const keys = await res.json();
  return keys.find(k => k.name === 'service_role')?.api_key || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get HuggingFace token via connector
    const { accessToken: hfToken } = await base44.asServiceRole.connectors.getConnection('hugging_face');

    // Get Supabase token via connector (optional — gracefully skip if unavailable)
    let supabaseProjectRef = null;
    let supabaseServiceKey = null;
    try {
      const { accessToken: sbToken } = await base44.asServiceRole.connectors.getConnection('supabase');
      supabaseProjectRef = await getSupabaseProjectRef(sbToken);
      if (supabaseProjectRef) {
        supabaseServiceKey = await getSupabaseServiceKey(supabaseProjectRef, sbToken);
      }
    } catch (_) { /* Supabase optional */ }

    const { document_ids, index_targets = ['vector'] } = await req.json();

    if (index_targets.includes('vector')) {
      await ensureQdrantCollection();
    }

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
            const embedding = await getEmbedding(chunk, hfToken);
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

        if (qdrantPoints.length > 0) {
          for (let b = 0; b < qdrantPoints.length; b += 50) {
            await upsertToQdrant(qdrantPoints.slice(b, b + 50));
          }
        }

        // Mirror metadata to Supabase if connected
        await storeDocumentInSupabase(supabaseProjectRef, supabaseServiceKey, doc, chunks.length);

        const updates = { status: 'indexed', chunk_count: chunks.length };
        if (index_targets.includes('vector')) updates.vector_indexed = true;
        await base44.asServiceRole.entities.CrawledDocument.update(doc.id, updates);
        indexed++;

      } catch (docErr) {
        errors.push(`Doc ${doc.id}: ${docErr.message}`);
        await base44.asServiceRole.entities.CrawledDocument.update(doc.id, { status: 'failed' });
      }
    }

    return Response.json({ success: true, indexed, errors, supabase_mirrored: !!supabaseProjectRef });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});