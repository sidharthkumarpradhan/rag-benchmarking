import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// RAGBench-inspired benchmark runner using TRACe evaluation framework
// Metrics: Context Relevance (CR), Utilization (U), Adherence/Faithfulness (A), Completeness (C)
// Reference: arxiv.org/html/2407.11005v2 and langchain-ai.github.io/langchain-benchmarks

const DEFAULT_TEST_QUERIES = [
  { text: "What are the admission requirements for Fairfield University?", category: "admissions", reference: "Fairfield University requires SAT/ACT scores, high school transcripts, recommendations, and a personal essay for undergraduate admission." },
  { text: "How do I reset my Fairfield University password?", category: "it_support", reference: "Students can reset their Fairfield University password through the IT Help Desk portal or by contacting the IT department directly." },
  { text: "What undergraduate programs does Fairfield offer?", category: "academic", reference: "Fairfield University offers undergraduate programs through the College of Arts and Sciences, Dolan School of Business, School of Engineering, School of Nursing, and School of Education." },
  { text: "What is the tuition cost for Fairfield University?", category: "financial", reference: "Fairfield University tuition varies by program; undergraduate tuition is approximately $60,000 per year including fees." },
  { text: "Where is the Dolan School of Business located?", category: "campus_life", reference: "The Dolan School of Business is located on the Fairfield University main campus in Fairfield, Connecticut." },
  { text: "How do I connect to Fairfield WiFi?", category: "it_support", reference: "Students connect to Fairfield WiFi using their university credentials through the eduroam or FairfieldU-Secure networks." },
  { text: "What are the library hours at Fairfield University?", category: "campus_life", reference: "The DiMenna-Nyselius Library at Fairfield University has varying hours during the semester and exam periods." },
  { text: "How do I apply for financial aid at Fairfield University?", category: "financial", reference: "Students apply for financial aid at Fairfield University by completing the FAFSA and submitting required documents to the Financial Aid Office." },
  { text: "Who are the faculty in the Computer Science department?", category: "faculty", reference: "The Computer Science department at Fairfield University has faculty members with expertise in algorithms, AI, systems, and software engineering." },
  { text: "What graduate programs are available at Fairfield University?", category: "academic", reference: "Fairfield University offers graduate programs in business (MBA), education, engineering, nursing, and social work among others." },
];

async function callLLM(messages, hfToken, maxTokens = 200) {
  // 1. HuggingFace (primary)
  try {
    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', messages, max_tokens: maxTokens })
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (text) return text;
    }
  } catch (_) {}

  // 2. OpenRouter fallback
  const openrouterKey = Deno.env.get('LLM_API_KEY');
  if (openrouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'meta-llama/llama-3.1-8b-instruct:free', messages, max_tokens: maxTokens, temperature: 0 })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        if (text) return text;
      }
    } catch (_) {}
  }

  // 3. Fireworks fallback
  const fireworksKey = Deno.env.get('FIREWORKS_API_KEY');
  if (fireworksKey) {
    const res = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${fireworksKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'accounts/fireworks/models/llama-v3p1-8b-instruct', messages, max_tokens: maxTokens, temperature: 0 })
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }
  }

  return null;
}

async function llmJudge(query, context, response, reference, hfToken) {
  const prompt = `You are an expert RAG system evaluator. Score the following RAG response on 4 metrics (0-10 scale each).

QUERY: ${query}
RETRIEVED CONTEXT: ${context?.substring(0, 1500) || 'No context provided'}
GENERATED RESPONSE: ${response?.substring(0, 800) || 'No response'}
REFERENCE ANSWER: ${reference || 'No reference provided'}

Evaluate and return ONLY a JSON object with these exact keys:
{
  "context_relevance": <0-10, how relevant is the retrieved context to the query>,
  "utilization": <0-10, how well the response uses information from the context>,
  "faithfulness": <0-10, how faithful/grounded the response is to the context without hallucinating>,
  "completeness": <0-10, how completely the response addresses the query compared to the reference>
}

Return ONLY valid JSON, no explanation.`;

  try {
    const content = await callLLM([{ role: 'user', content: prompt }], hfToken, 200);
    if (!content) return null;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const scores = JSON.parse(jsonMatch[0]);
    const keys = ['context_relevance', 'utilization', 'faithfulness', 'completeness'];
    for (const k of keys) {
      if (typeof scores[k] !== 'number') return null;
      scores[k] = Math.max(0, Math.min(10, scores[k]));
    }
    return scores;
  } catch (_) {
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      test_run_id,
      queries = DEFAULT_TEST_QUERIES,
      rag_types = ['vector', 'vectorless'],
      model = 'meta-llama/llama-3.1-8b-instruct:free',
      provider = 'openrouter',
      use_llm_judge = true
    } = await req.json();

    if (!test_run_id) return Response.json({ error: 'test_run_id required' }, { status: 400 });

    // HuggingFace token (primary LLM provider via OAuth — no extra key needed)
    const { accessToken: hfToken } = await base44.asServiceRole.connectors.getConnection('hugging_face');

    // Mark test run as running
    await base44.asServiceRole.entities.TestRun.update(test_run_id, {
      status: 'running',
      started_at: new Date().toISOString(),
      rag_types_tested: rag_types,
      model_used: model,
      query_count: queries.length * rag_types.length
    });

    // Aggregate metrics per RAG type
    const agg = {};
    for (const rt of rag_types) {
      agg[rt] = { latencies: [], tokens: [], cr: [], util: [], faith: [], comp: [] };
    }

    for (const q of queries) {
      for (const ragType of rag_types) {
        try {
          const res = await base44.asServiceRole.functions.invoke('queryRAG', {
            query: q.text,
            rag_type: ragType,
            model,
            provider,
            save_benchmark: false, // we'll save with scores below
            query_category: q.category
          });

          if (!res.data || res.data.error) {
            console.error(`queryRAG error for ${ragType}: ${res.data?.error}`);
            continue;
          }

          const { response, sources, latency_ms, tokens_used, context_text } = res.data;

          // Compute TRACe metrics via LLM judge
          let scores = null;
          if (use_llm_judge) {
            const contextForJudge = sources?.map(s => s.text || s.title || s.url).join('\n') || context_text || '';
            scores = await llmJudge(q.text, contextForJudge, response, q.reference, hfToken);
          }

          // Save benchmark record with TRACe scores
          await base44.asServiceRole.entities.QueryBenchmark.create({
            query_text: q.text,
            query_category: q.category || 'general',
            rag_type: ragType,
            response_text: response,
            sources_cited: (sources || []).map(s => s.url).filter(Boolean),
            latency_ms: latency_ms || 0,
            tokens_used: tokens_used || 0,
            model_used: model,
            test_run_id,
            // TRACe metrics mapped to existing schema fields
            relevance_score: scores?.context_relevance ?? null,
            faithfulness_score: scores?.faithfulness ?? null,
            completeness_score: scores?.completeness ?? null,
            // Store utilization in human_notes as extra field
            human_notes: scores ? `utilization:${scores.utilization.toFixed(1)}` : null
          });

          // Accumulate for aggregate
          agg[ragType].latencies.push(latency_ms || 0);
          agg[ragType].tokens.push(tokens_used || 0);
          if (scores) {
            agg[ragType].cr.push(scores.context_relevance);
            agg[ragType].util.push(scores.utilization);
            agg[ragType].faith.push(scores.faithfulness);
            agg[ragType].comp.push(scores.completeness);
          }

        } catch (err) {
          console.error(`Failed ${ragType} for "${q.text}": ${err.message}`);
        }
      }
    }

    const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const round1 = v => Math.round(v * 10) / 10;

    // Build update object
    const updates = {
      status: 'completed',
      completed_at: new Date().toISOString()
    };

    for (const rt of rag_types) {
      const key = rt === 'graph_vector' ? 'graph' : rt;
      updates[`avg_latency_${key}`] = Math.round(avg(agg[rt].latencies));
      // Store avg scores in the relevance fields
      if (agg[rt].cr.length > 0) {
        updates[`avg_relevance_${key}`] = round1(avg(agg[rt].cr));
      }
    }

    // Determine winner by composite score (relevance + faithfulness + completeness - latency_penalty)
    const compositeScore = (rt) => {
      const a = agg[rt];
      if (a.latencies.length === 0) return -1;
      const qualityScore = (avg(a.cr) + avg(a.faith) + avg(a.comp) + avg(a.util)) / 4;
      const latencyPenalty = Math.min(5, avg(a.latencies) / 2000); // penalize up to 5 points for 10s latency
      return qualityScore - latencyPenalty;
    };

    const winnerEntry = rag_types
      .map(rt => ({ rt, score: compositeScore(rt) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score)[0];

    updates.winner = winnerEntry?.rt || rag_types[0];
    updates.notes = rag_types.map(rt => {
      const a = agg[rt];
      if (a.latencies.length === 0) return `${rt}: no data`;
      return `${rt}: CR=${round1(avg(a.cr))}, F=${round1(avg(a.faith))}, C=${round1(avg(a.comp))}, U=${round1(avg(a.util))}, lat=${Math.round(avg(a.latencies))}ms`;
    }).join(' | ');

    await base44.asServiceRole.entities.TestRun.update(test_run_id, updates);

    return Response.json({
      success: true,
      test_run_id,
      queries_run: queries.length,
      rag_types,
      aggregate: Object.fromEntries(rag_types.map(rt => [rt, {
        count: agg[rt].latencies.length,
        avg_latency_ms: Math.round(avg(agg[rt].latencies)),
        avg_context_relevance: round1(avg(agg[rt].cr)),
        avg_utilization: round1(avg(agg[rt].util)),
        avg_faithfulness: round1(avg(agg[rt].faith)),
        avg_completeness: round1(avg(agg[rt].comp)),
      }])),
      winner: updates.winner
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});