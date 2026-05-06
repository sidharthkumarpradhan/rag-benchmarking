import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Benchmark runner — runs a set of queries against all 3 RAG types and computes metrics

const DEFAULT_TEST_QUERIES = [
  { text: "What are the admission requirements for Fairfield University?", category: "admissions" },
  { text: "How do I reset my Fairfield University password?", category: "it_support" },
  { text: "What undergraduate programs does Fairfield offer?", category: "academic" },
  { text: "What is the tuition cost for 2024-2025?", category: "financial" },
  { text: "Where is the Dolan School of Business located?", category: "campus_life" },
  { text: "How do I connect to Fairfield WiFi?", category: "it_support" },
  { text: "What are the library hours?", category: "campus_life" },
  { text: "How do I apply for financial aid?", category: "financial" },
  { text: "Who are the faculty in the Computer Science department?", category: "faculty" },
  { text: "What graduate programs are available in the College of Arts and Sciences?", category: "academic" }
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      test_run_id,
      queries = DEFAULT_TEST_QUERIES,
      rag_types = ['vector', 'vectorless', 'graph_vector'],
      model = 'meta-llama/llama-3.1-8b-instruct:free',
      provider = 'openrouter'
    } = await req.json();

    if (!test_run_id) return Response.json({ error: 'test_run_id required' }, { status: 400 });

    // Update test run to running
    await base44.asServiceRole.entities.TestRun.update(test_run_id, {
      status: 'running',
      started_at: new Date().toISOString(),
      rag_types_tested: rag_types,
      model_used: model,
      query_count: queries.length
    });

    const results = { vector: [], vectorless: [], graph_vector: [] };

    for (const q of queries) {
      for (const ragType of rag_types) {
        try {
          const res = await base44.asServiceRole.functions.invoke('queryRAG', {
            query: q.text,
            rag_type: ragType,
            model,
            provider,
            save_benchmark: true,
            test_run_id,
            query_category: q.category
          });

          if (res.data && !res.data.error) {
            results[ragType].push({
              latency: res.data.latency_ms || 0,
              tokens: res.data.tokens_used || 0
            });
          }
        } catch (err) {
          console.error(`Failed ${ragType} for "${q.text}": ${err.message}`);
        }
      }
    }

    // Compute aggregate metrics
    const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const updates = {
      status: 'completed',
      completed_at: new Date().toISOString()
    };

    for (const ragType of rag_types) {
      const latencies = results[ragType].map(r => r.latency);
      const key = ragType === 'graph_vector' ? 'graph' : ragType;
      updates[`avg_latency_${key}`] = Math.round(avg(latencies));
    }

    // Determine winner by lowest latency (will be refined by human ratings)
    const latencyMap = {
      vector: updates.avg_latency_vector || 9999,
      vectorless: updates.avg_latency_vectorless || 9999,
      graph_vector: updates.avg_latency_graph || 9999
    };
    updates.winner = Object.entries(latencyMap).sort((a, b) => a[1] - b[1])[0][0];

    await base44.asServiceRole.entities.TestRun.update(test_run_id, updates);

    return Response.json({ success: true, results: updates });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});