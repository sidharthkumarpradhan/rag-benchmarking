import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend, Tooltip
} from 'recharts';

const RAG_COLORS = {
  vector: '#3b82f6',
  vectorless: '#10b981',
  graph_vector: '#8b5cf6',
};

// Build radar data from per-RAG metric objects
// metricsMap: { vector: { context_relevance, utilization, faithfulness, completeness }, ... }
export default function TRACeRadarChart({ metricsMap }) {
  const data = [
    { metric: 'Context Relevance', short: 'CR' },
    { metric: 'Utilization', short: 'U' },
    { metric: 'Faithfulness', short: 'F' },
    { metric: 'Completeness', short: 'C' },
  ];

  const fieldMap = {
    'Context Relevance': 'context_relevance',
    'Utilization': 'utilization',
    'Faithfulness': 'faithfulness',
    'Completeness': 'completeness',
  };

  const chartData = data.map(d => {
    const row = { metric: d.short };
    for (const [rag, metrics] of Object.entries(metricsMap)) {
      row[rag] = metrics?.[fieldMap[d.metric]] ?? 0;
    }
    return row;
  });

  const activeRags = Object.entries(metricsMap).filter(([, m]) => m?.count > 0).map(([rt]) => rt);

  const RAG_LABELS = { vector: 'Vector RAG', vectorless: 'Vectorless', graph_vector: 'Graph Vector' };

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={chartData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid stroke="#e5e7eb" />
        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: '#6b7280' }} />
        <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fontSize: 9, fill: '#9ca3af' }} tickCount={4} />
        {activeRags.map(rag => (
          <Radar
            key={rag}
            name={RAG_LABELS[rag] || rag}
            dataKey={rag}
            stroke={RAG_COLORS[rag]}
            fill={RAG_COLORS[rag]}
            fillOpacity={0.15}
            strokeWidth={2}
          />
        ))}
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value, name) => [value?.toFixed(1), name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}