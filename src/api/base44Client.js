const makeEntityAPI = (entity) => ({
  list: (orderBy, limit) => fetch(`http://localhost:3001/api/entities/${entity}?orderBy=${encodeURIComponent(orderBy || '')}&limit=${limit || ''}`).then(r => r.json()),
  filter: (query, orderBy, limit) => fetch(`http://localhost:3001/api/entities/${entity}/filter`, { 
    method: 'POST', 
    body: JSON.stringify({query, orderBy, limit}), 
    headers: {'Content-Type': 'application/json'} 
  }).then(r => r.json()),
  create: (data) => fetch(`http://localhost:3001/api/entities/${entity}`, { 
    method: 'POST', 
    body: JSON.stringify(data), 
    headers: {'Content-Type': 'application/json'} 
  }).then(r => r.json()),
  update: (id, data) => fetch(`http://localhost:3001/api/entities/${entity}/${id}`, { 
    method: 'PATCH', 
    body: JSON.stringify(data), 
    headers: {'Content-Type': 'application/json'} 
  }).then(r => r.json()),
  delete: (id) => fetch(`http://localhost:3001/api/entities/${entity}/${id}`, { 
    method: 'DELETE' 
  }).then(r => r.json()),
});

export const base44 = {
  entities: {
    PipelineSession: makeEntityAPI('PipelineSession'),
    AgentRun: makeEntityAPI('AgentRun'),
    CrawlJob: makeEntityAPI('CrawlJob'),
    CrawledDocument: makeEntityAPI('CrawledDocument'),
    TestRun: makeEntityAPI('TestRun'),
    QueryBenchmark: makeEntityAPI('QueryBenchmark'),
    ChatSession: makeEntityAPI('ChatSession'),
    ChatMessage: makeEntityAPI('ChatMessage'),
  },
  functions: {
    invoke: (fn, data) => fetch(`http://localhost:3001/api/functions/${fn}`, { 
      method: 'POST', 
      body: JSON.stringify(data || {}), 
      headers: {'Content-Type': 'application/json'} 
    }).then(r => r.json())
  },
  auth: {
    me: () => Promise.resolve({ id: 'local-user', email: 'dev@local' })
  }
};
