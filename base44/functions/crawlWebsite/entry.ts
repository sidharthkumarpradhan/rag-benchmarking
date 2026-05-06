import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Agent 1: Web Crawler using Firecrawl API
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { job_id, urls, max_depth = 3, max_pages = 500 } = await req.json();

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    if (!FIRECRAWL_API_KEY) {
      return Response.json({ error: 'FIRECRAWL_API_KEY not configured' }, { status: 500 });
    }

    // Update job status to running
    await base44.asServiceRole.entities.CrawlJob.update(job_id, {
      status: 'running',
      started_at: new Date().toISOString(),
      pages_total: max_pages
    });

    let totalCrawled = 0;
    const errors = [];

    for (const seedUrl of urls) {
      try {
        // Start Firecrawl crawl job
        const crawlResponse = await fetch('https://api.firecrawl.dev/v1/crawl', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: seedUrl,
            limit: Math.floor(max_pages / urls.length),
            maxDepth: max_depth,
            scrapeOptions: {
              formats: ['markdown', 'html'],
              onlyMainContent: true
            },
            includePaths: [],
            excludePaths: ['/cdn-cgi/', '/wp-content/uploads/']
          })
        });

        const crawlData = await crawlResponse.json();

        if (!crawlResponse.ok) {
          errors.push(`Failed to start crawl for ${seedUrl}: ${crawlData.error || 'Unknown error'}`);
          continue;
        }

        const crawlId = crawlData.id;

        // Poll for completion (with timeout)
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes max polling

        while (attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, 5000)); // wait 5s
          attempts++;

          const statusRes = await fetch(`https://api.firecrawl.dev/v1/crawl/${crawlId}`, {
            headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` }
          });

          const statusData = await statusRes.json();

          if (statusData.status === 'completed' || statusData.status === 'failed') {
            if (statusData.data && statusData.data.length > 0) {
              // Store each crawled page
              for (const page of statusData.data) {
                if (!page.markdown && !page.content) continue;

                const content = page.markdown || page.content || '';
                const wordCount = content.split(/\s+/).length;

                // Detect page type from URL
                let page_type = 'general';
                const url = page.metadata?.sourceURL || page.url || '';
                if (url.includes('catalog.fairfield')) page_type = 'catalog';
                else if (url.includes('itskb') || url.includes('atlassian')) page_type = 'it_kb';
                else if (url.includes('/faculty') || url.includes('/staff')) page_type = 'faculty';
                else if (url.includes('/course') || url.includes('/academics')) page_type = 'course';
                else if (url.includes('/news') || url.includes('/events')) page_type = 'news';
                else if (url.includes('/admission')) page_type = 'admissions';

                await base44.asServiceRole.entities.CrawledDocument.create({
                  url: url,
                  title: page.metadata?.title || '',
                  content: content.substring(0, 50000), // cap at 50k chars
                  source_domain: new URL(url).hostname,
                  crawl_job_id: job_id,
                  status: 'raw',
                  word_count: wordCount,
                  page_type
                });

                totalCrawled++;
              }
            }
            break;
          }

          // Update progress
          if (statusData.completed) {
            await base44.asServiceRole.entities.CrawlJob.update(job_id, {
              pages_crawled: totalCrawled + (statusData.completed || 0)
            });
          }
        }

      } catch (urlError) {
        errors.push(`Error crawling ${seedUrl}: ${urlError.message}`);
      }
    }

    // Mark job complete
    await base44.asServiceRole.entities.CrawlJob.update(job_id, {
      status: errors.length > 0 && totalCrawled === 0 ? 'failed' : 'completed',
      pages_crawled: totalCrawled,
      completed_at: new Date().toISOString(),
      error_message: errors.join('; ')
    });

    return Response.json({
      success: true,
      pages_crawled: totalCrawled,
      errors
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});