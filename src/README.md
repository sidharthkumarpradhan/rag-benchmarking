# Crawlect AI — Multi-RAG Benchmarking Platform

**Crawlect AI** is an advanced RAG (Retrieval-Augmented Generation) benchmarking platform that enables side-by-side performance evaluation of three distinct retrieval architectures:

1. **Vector RAG** — Semantic search using embeddings (Qdrant + BAAI)
2. **PageIndex RAG** — Hierarchical tree-based document reasoning (no vector DB required)
3. **Graph+Vector RAG** — Knowledge graph expansion + vector search (FalkorDB + Qdrant)

The platform automates crawling, indexing, multi-RAG querying, and LLM-as-Judge evaluation using the **TRACe framework** (Context Relevance, Utilization, Faithfulness, Completeness).

---

## Features

- **🌐 Website Crawler** — Native fetch-based crawler with depth control and page limits
- **📑 Smart Indexing** — Automatic chunking, embedding, and hierarchical tree construction
- **⚡ 3-RAG Comparison** — Benchmark vector, vectorless (PageIndex), and graph architectures simultaneously
- **🤖 LLM-as-Judge Scoring** — Automated TRACe evaluation (0–10 scales)
- **💬 Interactive Chat** — Query indexed knowledge bases with RAG mode selection
- **📊 Benchmark Dashboard** — Visualize TRACe scores, latency, and per-query results
- **🔄 Multi-Agent Pipeline** — Orchestrated E2E workflow with audit trail
- **🔗 GitHub Integration** — Track issues and repository metrics
- **📚 Document Explorer** — Search and inspect crawled content

---

## Architecture

### RAG Retrieval Strategies

**Vector RAG:**
- Uses HuggingFace embeddings (sentence-transformers/all-MiniLM-L6-v2)
- Stores vectors in Qdrant cloud
- Fast semantic search with cosine similarity

**PageIndex RAG:**
- Builds hierarchical tree indexes from HTML headings (h1–h4)
- Step 1: LLM reasons over Table of Contents to select relevant node IDs
- Step 2: Retrieves text from selected sections for final answer generation
- No vector database required — pure LLM reasoning over document structure

**Graph+Vector RAG:**
- Performs vector search first
- Expands results using FalkorDB knowledge graph relations
- Combines direct retrieval with contextual graph traversal

### Tech Stack

**Frontend:**
- React 18 + React Router
- Tailwind CSS + Radix UI components
- Recharts for data visualization
- React Query for state management
- Framer Motion for animations

**Backend (Local Deno Functions):**
- Deno 2.x runtime
- native `fetch` API for crawling
- HuggingFace Inference API (with Fireworks fallback)
- Qdrant vector database
- FalkorDB knowledge graph (optional)
- LLM providers: OpenRouter, HuggingFace, Fireworks

**Database:**
- Base44 (removed for local dev — uses in-memory store)
- Supabase (optional, for production metadata)

---

## Setup & Installation

### Prerequisites

- **Node.js** 18+ and npm
- **Deno** 2.x ([install](https://deno.land))
- **API Keys:**
  - `FIREWORKS_API_KEY` (LLM inference)
  - `LLM_API_KEY` (OpenRouter or alternative)
  - `HUGGING_FACE_TOKEN` (embeddings & inference)
  - `FALKORDB_URL` (optional, for graph RAG)

### Clone & Install

```bash
git clone <repo-url>
cd crawlect-ai
npm install
```

### Environment Setup

1. Copy the template file:
   ```bash
   cp .env.example .env
   ```

2. Fill in your API keys in `.env`:
   ```env
   VITE_BASE44_APP_ID=your_app_id
   VITE_BASE44_SERVICE_ROLE_KEY=your_key
   FIREWORKS_API_KEY=sk-...
   LLM_API_KEY=sk-...
   HUGGING_FACE_TOKEN=hf_...
   QDRANT_URL=https://your-qdrant-instance.aws.cloud.qdrant.io:6333
   QDRANT_API_KEY=your-api-key
   FALKORDB_URL=http://localhost:3000 (optional)
   ```

3. **Local Development (No Base44 Required):**
   - The app works independently without Base44
   - All data can be stored locally (memory or local SQLite)
   - API functions run as Deno workers

### Running Locally

#### Start the Frontend Dev Server

```bash
npm run dev
```

The app opens at `http://localhost:5173`

#### Run Backend Functions Locally (Deno)

Each backend function is a Deno worker. To test a function locally:

```bash
# Example: Test crawlAndBenchmark
deno run --allow-net --allow-env functions/crawlAndBenchmark.js
```

Or use the frontend UI to trigger functions (they'll invoke via HTTP endpoints).

#### Full Local Setup (with Local DB)

For local testing without Base44:

1. **Set up local Qdrant** (Docker):
   ```bash
   docker run -p 6333:6333 qdrant/qdrant
   ```
   Then update `.env`: `QDRANT_URL=http://localhost:6333`

2. **Set up local FalkorDB** (optional):
   ```bash
   docker run -p 3000:3000 falkordb/falkordb
   ```
   Then update `.env`: `FALKORDB_URL=http://localhost:3000`

3. **Use local in-memory data store:**
   - Modify `api/base44Client.js` to use localStorage or IndexedDB
   - All CRUD operations fall back to local storage

---

## Usage

### 1. Crawl a Website

**Menu → Data Pipeline → Start Crawl**

- Enter seed URLs
- Set max depth (1–5) and page limits (10–500)
- Monitor crawl progress
- Documents stored in database with status `raw`

### 2. Index Documents

**Menu → Data Pipeline → Index button**

Processes raw documents through:
- Text chunking (512 tokens, 256 overlap)
- Embedding generation (HuggingFace or Fireworks)
- Qdrant vector upsert
- Vectorless: PageIndex tree construction
- Graph: FalkorDB relation creation

### 3. Run E2E Benchmark

**Menu → E2E Benchmark**

- Enter target URL
- Select RAG types (Vector, PageIndex, Graph+Vector)
- System crawls → indexes → runs 10 benchmark queries
- LLM judge scores each response across TRACe metrics
- Displays: latency, Context Relevance, Faithfulness, Completeness, Utilization

**Results Overview:**
- TRACe Radar chart (multi-dimensional quality)
- Latency bar chart with legend
- Per-query breakdown by RAG type
- Winner determination (composite score)

### 4. Interactive Chat

**Menu → Crawlect Chat**

- Chat with the indexed knowledge base
- Select RAG mode: Vector / PageIndex / Graph+Vector / Auto
- View retrieved sources and response latency
- Save conversations

### 5. Benchmark Dashboard

**Menu → E2E Benchmark**

- Create test runs
- Run manual queries
- Track historical benchmark results
- Category-based performance analysis
- Query-level result inspection

---

## TRACe Evaluation Framework

Each RAG response is scored on four dimensions (0–10):

| Metric | Definition |
|--------|-----------|
| **CR** (Context Relevance) | Quality of retrieved context — does it contain answer material? |
| **U** (Utilization) | How much of the context is actually used in the answer? |
| **F** (Faithfulness) | Is the answer grounded in the context? No hallucinations? |
| **C** (Completeness) | Does the answer cover all aspects of the question? |

**Composite Score** = (CR + F + C) / 3 (ignoring U for winner determination)

**LLM Judge Prompt:**
- System role: Evaluate RAG quality without access to ground truth
- Input: Query + Retrieved context + Generated answer
- Output: JSON with CR, U, F, C scores and reasoning

---

## File Structure

```
crawlect-ai/
├── src/
│   ├── pages/
│   │   ├── Chat.jsx             # Chat interface with RAG mode selector
│   │   ├── Benchmark.jsx        # Dashboard for benchmark results
│   │   ├── Pipeline.jsx         # Data pipeline & E2E orchestration
│   │   ├── Documents.jsx        # Document explorer
│   │   ├── Settings.jsx         # API configuration
│   │   └── GitHubTracker.jsx    # GitHub integration
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx
│   │   │   └── AppLayout.jsx
│   │   ├── benchmark/
│   │   │   ├── RAGCompareChart.jsx  # Latency chart with legend
│   │   │   ├── TRACeRadarChart.jsx
│   │   │   ├── TRACeScoreCard.jsx
│   │   │   └── BenchmarkResultsTable.jsx
│   │   ├── chat/
│   │   │   ├── ChatMessage.jsx
│   │   │   └── RAGSelector.jsx
│   │   ├── pipeline/
│   │   │   ├── AgentCard.jsx
│   │   │   ├── AMPMessageFlow.jsx
│   │   │   └── SharedStatePanel.jsx
│   │   └── ui/             # shadcn/ui components
│   ├── functions/
│   │   ├── queryRAG.js          # Multi-RAG query engine
│   │   ├── crawlAndBenchmark.js # E2E crawl → index → benchmark
│   │   ├── crawlWebsite.js      # Website crawler
│   │   ├── indexDocuments.js    # Document indexing
│   │   ├── runBenchmark.js      # Benchmark orchestration
│   │   ├── runMultiAgentPipeline.js  # Multi-agent workflow
│   │   └── githubIssues.js      # GitHub API integration
│   ├── lib/
│   │   ├── AuthContext.jsx
│   │   ├── query-client.js
│   │   └── utils.js
│   ├── api/
│   │   └── base44Client.js      # SDK initialization
│   ├── App.jsx                  # Router configuration
│   ├── index.css               # Design tokens
│   └── main.jsx                # Entry point
├── functions/                  # Deno backend functions
├── entities/                   # Database schemas
├── .env.example               # Environment template
├── .gitignore                 # Git ignore rules
├── package.json
├── tailwind.config.js
├── vite.config.js
└── README.md
```

---

## API Functions (Deno Workers)

### `queryRAG`

Query the indexed knowledge base using one of three RAG architectures.

**Endpoint:** `POST /functions/queryRAG`

**Payload:**
```json
{
  "query": "What is RAG?",
  "rag_type": "vector|vectorless|graph_vector",
  "model": "meta-llama/llama-3.1-8b-instruct:free",
  "session_id": "optional_chat_session_id",
  "save_benchmark": true,
  "test_run_id": "optional_benchmark_run_id"
}
```

**Response:**
```json
{
  "response": "RAG is...",
  "sources": [{ "url": "...", "title": "...", "score": 0.95 }],
  "latency_ms": 1234,
  "tokens_used": 456,
  "rag_type": "vectorless",
  "retrieval_method": "pageindex"
}
```

### `crawlAndBenchmark`

Full E2E: crawl a website, index content, and benchmark all RAG types.

**Endpoint:** `POST /functions/crawlAndBenchmark`

**Payload:**
```json
{
  "seed_url": "https://example.com",
  "max_pages": 10,
  "rag_types": ["vector", "vectorless", "graph_vector"]
}
```

**Response:**
```json
{
  "success": true,
  "pages_crawled": 8,
  "indexed_chunks": 42,
  "test_run_id": "...",
  "winner": "vectorless",
  "summary": "vectorless: CR=8.2, F=8.8, C=7.0, U=7.2, lat=2489ms | ..."
}
```

### Other Functions

- `crawlWebsite(job_id, urls, max_depth, max_pages)` — Crawl and store documents
- `indexDocuments(index_targets)` — Index stored documents into Qdrant/PageIndex
- `runBenchmark(test_run_id, rag_types, model)` — Run benchmark on a test run
- `runMultiAgentPipeline(session_id, goal)` — Orchestrate multi-agent crawl/index/RAG/report workflow
- `githubIssues(repo, action, data)` — GitHub API integration

---

## Deployment

### Local Docker Compose

```yaml
version: '3.8'
services:
  qdrant:
    image: qdrant/qdrant
    ports:
      - "6333:6333"
    volumes:
      - qdrant_storage:/qdrant/storage

  falkordb:
    image: falkordb/falkordb
    ports:
      - "3000:3000"

  crawlect:
    build: .
    ports:
      - "5173:5173"
    environment:
      - VITE_BASE44_APP_ID=${APP_ID}
      - FIREWORKS_API_KEY=${FIREWORKS_API_KEY}
      - LLM_API_KEY=${LLM_API_KEY}
      - QDRANT_URL=http://qdrant:6333
      - FALKORDB_URL=http://falkordb:3000
    depends_on:
      - qdrant
      - falkordb

volumes:
  qdrant_storage:
```

Run:
```bash
docker-compose up -d
```

---

## Testing

### Unit Tests (Frontend)

```bash
npm run test
```

### E2E Function Testing

Test backend functions directly via Deno:

```bash
deno test --allow-net --allow-env functions/
```

Or via frontend UI (Benchmark Dashboard).

---

## Troubleshooting

### "HuggingFace credits depleted"
- Set `FIREWORKS_API_KEY` for embedding fallback
- Check HuggingFace token validity

### "Qdrant connection failed"
- Ensure Qdrant is running: `docker run -p 6333:6333 qdrant/qdrant`
- Verify `QDRANT_URL` and `QDRANT_API_KEY` in `.env`

### "LLM provider timeout"
- Fallbacks: HuggingFace → OpenRouter → Fireworks
- Check API key validity and rate limits

### "PageIndex RAG returns poor results"
- Ensure documents have clear heading structure (h1–h4)
- Increase `max_pages` in crawl for more training data

---

## Contributing

1. Create a feature branch: `git checkout -b feature/amazing-feature`
2. Commit changes: `git commit -m 'Add amazing feature'`
3. Push to remote: `git push origin feature/amazing-feature`
4. Open a Pull Request

---

## License

MIT License — See LICENSE file for details

---

## Support & Documentation

- **Issues:** [GitHub Issues](https://github.com/your-repo/issues)
- **Docs:** Full API docs and guides in `/docs`
- **Community:** Discussions on GitHub Discussions

---

**Built with ❤️ for RAG research and evaluation**