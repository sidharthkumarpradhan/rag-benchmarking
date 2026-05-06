import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, '..', 'crawlect.db'));

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS PipelineSession (
    id TEXT PRIMARY KEY,
    name TEXT,
    pipeline_type TEXT,
    status TEXT,
    shared_state TEXT,
    agents_completed TEXT,
    total_agents INTEGER,
    completed_agents INTEGER,
    current_agent TEXT,
    total_tokens INTEGER,
    final_output TEXT,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS AgentRun (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT,
    agent_name TEXT,
    agent_role TEXT,
    status TEXT,
    input_message TEXT,
    output_message TEXT,
    reasoning TEXT,
    tool_calls TEXT,
    tokens_used INTEGER,
    error TEXT,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS CrawlJob (
    id TEXT PRIMARY KEY,
    name TEXT,
    urls TEXT,
    max_depth INTEGER,
    max_pages INTEGER,
    crawl_type TEXT,
    status TEXT,
    pages_crawled INTEGER DEFAULT 0,
    pages_total INTEGER DEFAULT 0,
    started_at DATETIME,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS CrawledDocument (
    id TEXT PRIMARY KEY,
    url TEXT,
    title TEXT,
    content TEXT,
    page_type TEXT,
    status TEXT,
    chunk_count INTEGER DEFAULT 0,
    vector_indexed INTEGER DEFAULT 0,
    word_count INTEGER DEFAULT 0,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS TestRun (
    id TEXT PRIMARY KEY,
    url TEXT,
    status TEXT,
    pages_crawled INTEGER,
    indexed INTEGER,
    winner TEXT,
    summary TEXT,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS QueryBenchmark (
    id TEXT PRIMARY KEY,
    test_run_id TEXT,
    query_text TEXT,
    rag_type TEXT,
    response TEXT,
    sources TEXT,
    relevance_score REAL,
    faithfulness_score REAL,
    completeness_score REAL,
    human_notes TEXT,
    latency_ms INTEGER,
    tokens_used INTEGER,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ChatSession (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ChatMessage (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    role TEXT,
    content TEXT,
    rag_mode TEXT,
    latency_ms INTEGER,
    sources TEXT,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;
