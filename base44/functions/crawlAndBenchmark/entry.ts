/**
 * crawlAndBenchmark — Full E2E pipeline without Firecrawl
 * 1. Fetch pages from a website using native fetch (BFS crawl, no API key needed)
 * 2. Store as CrawledDocument records (status=raw)
 * 3. Index into Qdrant via indexDocuments
 * 4. Create a TestRun and run runBenchmark across all 3 RAG types
 * Returns { crawl_job_id, test_run_id, pages_crawled, status }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MAX_FETCH_PAGES = 30;
const FETCH_TIMEOUT_MS = 8000;

function extractLinks(html, baseUrl) {
  const links = new Set();
  const base = new URL(baseUrl);
  const re = /href=["']([^"'#?]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl).href;
      if (new URL(abs).hostname === base.hostname && abs.startsWith('http')) {
        links.add(abs.split('#')[0].split('?')[0]);
      }
    } catch (_) {}
  }
  return [...links];
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 8000); // keep under field size limit
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '';
}

function detectPageType(url) {
  if (url.includes('/catalog')) return 'catalog';
  if (url.includes('/faculty') || url.includes('/staff')) return 'faculty';
  if (url.includes('/course') || url.includes('/academic')) return 'course';
  if (url.includes('/news') || url.includes('/event')) return 'news';
  if (url.includes('/admission')) return 'general';
  if (url.includes('/it') || url.includes('/help') || url.includes('/support')) return 'it_kb';
  return 'general';
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CrawlectBot/1.0; research crawler)',
      'Accept': 'text/html,application/xhtml+xml',
    }
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) return null;
    return await res.text();
  } catch (_) {
    clearTimeout(timer);
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { seed_url, max_pages = 20, rag_types = ['vector', 'vectorless', 'graph_vector'] } = await req.json();
    if (!seed_url) return Response.json({ error: 'seed_url required' }, { status: 400 });

    const limit = Math.min(max_pages, MAX_FETCH_PAGES);

    // ── Step 1: Create CrawlJob ──────────────────────────────────────────────
    const job = await base44.asServiceRole.entities.CrawlJob.create({
      name: `E2E Benchmark — ${new URL(seed_url).hostname}`,
      urls: [seed_url],
      max_depth: 2,
      max_pages: limit,
      crawl_type: 'manual',
      status: 'running',
      started_at: new Date().toISOString(),
      pages_total: limit,
    });

    // ── Step 2: BFS Crawl ─────────────────────────────────────────────────────
    const visited = new Set();
    const queue = [seed_url];
    let crawled = 0;
    const docIds = [];

    while (queue.length > 0 && crawled < limit) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      const html = await fetchPage(url);
      if (!html) continue;

      const content = htmlToText(html);
      if (content.length < 100) continue;

      const doc = await base44.asServiceRole.entities.CrawledDocument.create({
        url,
        title: extractTitle(html),
        content,
        source_domain: new URL(url).hostname,
        crawl_job_id: job.id,
        status: 'raw',
        word_count: content.split(/\s+/).length,
        page_type: detectPageType(url),
      });
      docIds.push(doc.id);
      crawled++;

      // Enqueue discovered links (up to 5 per page to keep it breadth-limited)
      const links = extractLinks(html, url).slice(0, 5);
      for (const l of links) {
        if (!visited.has(l)) queue.push(l);
      }

      // Update progress
      if (crawled % 5 === 0) {
        await base44.asServiceRole.entities.CrawlJob.update(job.id, { pages_crawled: crawled });
      }
    }

    await base44.asServiceRole.entities.CrawlJob.update(job.id, {
      status: 'completed',
      pages_crawled: crawled,
      completed_at: new Date().toISOString(),
    });

    // ── Step 3: Index into Qdrant ─────────────────────────────────────────────
    const indexRes = await base44.asServiceRole.functions.invoke('indexDocuments', {
      document_ids: docIds,
      index_targets: ['vector'],
    });

    const indexed = indexRes?.data?.indexed || 0;

    // ── Step 4: Create TestRun + run benchmark across all 3 RAG types ─────────
    const testRun = await base44.asServiceRole.entities.TestRun.create({
      name: `3-RAG Benchmark — ${new URL(seed_url).hostname}`,
      description: `Auto-generated from E2E crawl of ${seed_url}. ${crawled} pages crawled, ${indexed} indexed.`,
      status: 'pending',
      rag_types_tested: rag_types,
      model_used: 'llama-3.1-8b',
    });

    // Fire benchmark async (don't await — it takes minutes)
    base44.asServiceRole.functions.invoke('runBenchmark', {
      test_run_id: testRun.id,
      rag_types,
      use_llm_judge: true,
    }).catch(e => console.error('Benchmark error:', e.message));

    return Response.json({
      success: true,
      crawl_job_id: job.id,
      test_run_id: testRun.id,
      pages_crawled: crawled,
      indexed,
      message: `Crawled ${crawled} pages, indexed ${indexed} chunks. Benchmark started across ${rag_types.join(', ')}.`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});