# Crawlect AI — Multi-RAG Benchmarking & Management Platform

![Crawlect AI Banner](https://via.placeholder.com/1200x400/0f172a/ffffff?text=Crawlect+AI+%E2%80%94+Multi-RAG+Benchmarking+Platform)

**Crawlect AI** is a professional-grade Retrieval-Augmented Generation (RAG) management and benchmarking platform. It is engineered to evaluate, compare, and optimize distinct RAG architectures—ranging from traditional vector search to advanced hierarchical document reasoning and knowledge graph-augmented retrieval.

The platform automates the entire RAG lifecycle: from autonomous website crawling and intelligent indexing to multi-strategy querying and **LLM-as-a-Judge** evaluation using the industry-standard **TRACe framework**.

---

## 🌟 Key Features

### 🌐 Autonomous Data Acquisition
*   **Intelligent Crawler**: Native fetch-based crawler with configurable depth, domain-locking, and concurrency controls.
*   **Document Explorer**: A centralized hub for managing, searching, and inspecting crawled web content and metadata.

### ⚡ Multi-RAG Architecture Comparison
Benchmark three cutting-edge retrieval strategies side-by-side:
*   **Vector RAG**: High-speed semantic search using **Qdrant** and **HuggingFace** embeddings.
*   **PageIndex RAG (Vectorless)**: A revolutionary hierarchical approach that uses LLM reasoning to navigate document structures (H1-H4) without vector embeddings.
*   **Graph+Vector RAG (Hybrid)**: Contextual expansion that combines semantic similarity with relational insights from **FalkorDB** knowledge graphs.

### 🤖 Automated Evaluation (TRACe)
*   **LLM-as-Judge**: Automated scoring of RAG outputs on a 0–10 scale.
*   **Metric Depth**: Detailed analysis of Context Relevance, Utilization, Faithfulness, and Completeness.
*   **Audit Trails**: Full transparency into agentic tool calls and reasoning steps.

### 📊 Professional Insights
*   **Interactive Dashboard**: Real-time visualization of latency, metric scores, and performance trends.
*   **Comparative Analytics**: Radar charts and bar graphs for multi-strategy performance breakdown.
*   **GitHub Integration**: Built-in tracker for monitoring repository metrics and issue status.

---

## 🏗️ Technical Architecture

### Core Tech Stack
*   **Frontend**: React 18, Vite, Tailwind CSS, Radix UI, Framer Motion, Recharts.
*   **Backend**: Node.js/Express (Local Backend).
*   **Database**: SQLite (`better-sqlite3`) for relational metadata and session state.
*   **AI Orchestration**: OpenRouter, Fireworks AI, and HuggingFace Inference.
*   **Vector Engine**: Qdrant.
*   **Graph Engine**: FalkorDB.

### System Flow
1.  **Crawl**: Extract structured data from any URL.
2.  **Index**: Chunk, embed, and store data in Vector, Graph, or PageIndex formats.
3.  **Benchmark**: Execute queries across all active RAG pipelines.
4.  **Judge**: LLM evaluates responses using the TRACe framework.
5.  **Visualize**: Compare results in the analytics dashboard.

---

## 🚀 Getting Started

### Prerequisites
*   **Node.js** (v18+)
*   **Docker** (to run Qdrant and FalkorDB locally)
*   **API Keys**: You will need keys for HuggingFace and an LLM provider (OpenRouter/Fireworks).

### Installation

1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/your-username/rag-benchmarking.git
    cd rag-benchmarking
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Set Up Environment**:
    Create a `.env` file in the root:
    ```env
    # AI Providers
    LLM_API_KEY=sk-...
    HUGGING_FACE_TOKEN=hf_...
    FIREWORKS_API_KEY=sk-...

    # Databases
    QDRANT_URL=http://localhost:6333
    FALKORDB_URL=http://localhost:3000
    ```

4.  **Launch Dependencies (Docker)**:
    ```bash
    docker run -d -p 6333:6333 qdrant/qdrant
    docker run -d -p 3000:3000 falkordb/falkordb
    ```

5.  **Run the Platform**:
    ```bash
    npm run dev
    ```
    *   **Frontend**: `http://localhost:5173`
    *   **Backend**: `http://localhost:3001`

---

## 📖 The TRACe Evaluation Framework

Each RAG response is scored across four vital dimensions:

| Metric | Description |
| :--- | :--- |
| **Context Relevance** | Did the retrieval system find the right information for the query? |
| **Utilization** | How effectively did the LLM incorporate the retrieved context into its answer? |
| **Faithfulness** | Is the answer factually grounded in the provided context (no hallucinations)? |
| **Completeness** | Does the answer address all parts of the user's original question? |

---

## 🤝 Contributing
Contributions are welcome! Please follow the standard fork-and-pull-request workflow.

## 📄 License
Distributed under the MIT License.

---
<p align="center">
  <b>Built for AI Engineers & RAG Researchers.</b>
</p>
