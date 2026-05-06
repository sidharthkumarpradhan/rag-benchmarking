import { cn } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const CATEGORIES = ['admissions', 'it_support', 'academic', 'financial', 'campus_life', 'faculty', 'events', 'general'];
const RAG_COLORS = { vector: '#3b82f6', vectorless: '#10b981', graph_vector: '#8b5cf6' };
const RAG_LABELS = { vector: 'Vector', vectorless: 'Vectorless', graph_vector: 'Graph' };

export default function CategoryBreakdown({ benchmarks }) {
  // Build category x RAG composite score data
  const cats = CATEGORIES.filter(cat => benchmarks.some(b => b.query_category === cat));

  const chartData = cats.map(cat => {
    const row = { category: cat.replace('_', ' ') };
    for (const rag of ['vector', 'vectorless', 'graph_vector']) {
      const items = benchmarks.filter(b => b.query_category === cat && b.rag_type === rag);
      if (items.length === 0) continue;
      const hasScores = items.some(b => b.relevance_score != null);
      if (hasScores) {
        const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        const cr = avg(items.map(b => b.relevance_score).filter(v => v != null));
        const f = avg(items.map(b => b.faithfulness_score).filter(v => v != null));
        const c = avg(items.map(b => b.completeness_score).filter(v => v != null));
        // Utilization stored in human_notes as "utilization:X.X"
        const utils = items
          .map(b => { const m = b.human_notes?.match(/utilization:([\d.]+)/); return m ? parseFloat(m[1]) : null; })
          .filter(v => v != null);
        const u = avg(utils);
        const composite = (cr + f + c + (utils.length > 0 ? u : (cr + f + c) / 3)) / 4;
        row[rag] = Math.round(composite * 10) / 10;
      } else {
        row[rag] = null;
      }
    }
    return row;
  });

  const activeRags = ['vector', 'vectorless', 'graph_vector'].filter(rag =>
    chartData.some(d => d[rag] != null)
  );

  if (chartData.length === 0 || activeRags.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Run benchmark to see category breakdown
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis
          dataKey="category"
          tick={{ fontSize: 10, fill: '#6b7280' }}
          angle={-30}
          textAnchor="end"
          interval={0}
        />
        <YAxis domain={[0, 10]} tick={{ fontSize: 10, fill: '#9ca3af' }} tickCount={5} />
        <Tooltip
          formatter={(value, name) => [value != null ? value.toFixed(1) : '—', RAG_LABELS[name] || name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        {activeRags.map(rag => (
          <Bar key={rag} dataKey={rag} name={RAG_LABELS[rag]} fill={RAG_COLORS[rag]} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}