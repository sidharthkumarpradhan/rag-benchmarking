import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Helpers to format dynamic SQLite queries
const getTable = (entity) => {
  const allowed = ['PipelineSession', 'AgentRun', 'CrawlJob', 'CrawledDocument', 'TestRun', 'QueryBenchmark', 'ChatSession', 'ChatMessage'];
  if (!allowed.includes(entity)) throw new Error('Invalid entity');
  return entity;
};

// Generic list
app.get('/api/entities/:entity', (req, res) => {
  try {
    const table = getTable(req.params.entity);
    const limit = parseInt(req.query.limit) || 100;
    const orderBy = req.query.orderBy || '-created_date';
    
    const direction = orderBy.startsWith('-') ? 'DESC' : 'ASC';
    const sortField = orderBy.replace('-', '');
    
    // Whitelist sort fields to prevent injection
    const allowedSortFields = ['created_date', 'updated_date', 'started_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_date';

    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${safeSortField} ${direction} LIMIT ?`).all(limit);
    
    // Parse JSON fields back to objects
    const jsonFields = ['shared_state', 'agents_completed', 'tool_calls', 'input_message', 'output_message', 'urls', 'sources', 'final_output'];
    const parsedRows = rows.map(row => {
      const parsed = { ...row };
      for (const key of jsonFields) {
        if (parsed[key] !== undefined && parsed[key] !== null) {
          try { parsed[key] = JSON.parse(parsed[key]); } catch (e) { /* ignore */ }
        }
      }
      return parsed;
    });

    res.json(parsedRows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generic filter
app.post('/api/entities/:entity/filter', (req, res) => {
  try {
    const table = getTable(req.params.entity);
    const { query, orderBy = '-created_date', limit = 100 } = req.body;
    
    let sql = `SELECT * FROM ${table}`;
    const params = [];
    
    if (query && Object.keys(query).length > 0) {
      const conditions = [];
      for (const [key, value] of Object.entries(query)) {
        conditions.push(`${key} = ?`);
        params.push(value);
      }
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    const direction = orderBy.startsWith('-') ? 'DESC' : 'ASC';
    const sortField = orderBy.replace('-', '');
    const allowedSortFields = ['created_date', 'updated_date', 'started_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_date';
    
    sql += ` ORDER BY ${safeSortField} ${direction} LIMIT ?`;
    params.push(parseInt(limit));

    const rows = db.prepare(sql).all(...params);

    const jsonFields = ['shared_state', 'agents_completed', 'tool_calls', 'input_message', 'output_message', 'urls', 'sources', 'final_output'];
    const parsedRows = rows.map(row => {
      const parsed = { ...row };
      for (const key of jsonFields) {
        if (parsed[key] !== undefined && parsed[key] !== null) {
          try { parsed[key] = JSON.parse(parsed[key]); } catch (e) { /* ignore */ }
        }
      }
      return parsed;
    });

    res.json(parsedRows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generic create
app.post('/api/entities/:entity', (req, res) => {
  try {
    const table = getTable(req.params.entity);
    const data = req.body;
    
    if (!data.id) {
      data.id = uuidv4();
    }
    
    const jsonFields = ['shared_state', 'agents_completed', 'tool_calls', 'input_message', 'output_message', 'urls', 'sources', 'final_output'];
    for (const key of jsonFields) {
      if (data[key] && typeof data[key] === 'object') {
        data[key] = JSON.stringify(data[key]);
      }
    }

    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(',');
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
    
    db.prepare(sql).run(Object.values(data));
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generic update
app.patch('/api/entities/:entity/:id', (req, res) => {
  try {
    const table = getTable(req.params.entity);
    const data = req.body;
    const { id } = req.params;
    
    const jsonFields = ['shared_state', 'agents_completed', 'tool_calls', 'input_message', 'output_message', 'urls', 'sources', 'final_output'];
    for (const key of jsonFields) {
      if (data[key] && typeof data[key] === 'object') {
        data[key] = JSON.stringify(data[key]);
      }
    }
    
    const keys = Object.keys(data);
    if (keys.length === 0) return res.json({ id });
    
    const assignments = keys.map(k => `${k} = ?`).join(',');
    const sql = `UPDATE ${table} SET ${assignments} WHERE id = ?`;
    
    db.prepare(sql).run(...Object.values(data), id);
    
    res.json({ ...data, id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generic delete
app.delete('/api/entities/:entity/:id', (req, res) => {
  try {
    const table = getTable(req.params.entity);
    const { id } = req.params;
    
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    
    res.json({ id, deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

import functionsRouter from './routes/functions.js';

// --- Function Invocation Routes ---
app.use('/api/functions', functionsRouter);

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Local backend running on http://localhost:${PORT}`);
});
