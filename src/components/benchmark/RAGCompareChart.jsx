import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, LineChart, Line
} from 'recharts';

const RAG_COLORS = {
  vector: '#3b82f6',
  vectorless: '#10b981',
  graph_vector: '#8b5cf6',
};

export function LatencyChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} unit="ms" />
        <Tooltip formatter={(v) => [`${v}ms`, 'Avg Latency']} />
        <Bar dataKey="vector" name="Vector RAG" fill={RAG_COLORS.vector} radius={[4, 4, 0, 0]} />
        <Bar dataKey="vectorless" name="Vectorless" fill={RAG_COLORS.vectorless} radius={[4, 4, 0, 0]} />
        <Bar dataKey="graph_vector" name="Graph Vector" fill={RAG_COLORS.graph_vector} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RadarCompareChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data}>
        <PolarGrid stroke="#e5e7eb" />
        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
        <Radar name="Vector RAG" dataKey="vector" stroke={RAG_COLORS.vector} fill={RAG_COLORS.vector} fillOpacity={0.15} />
        <Radar name="Vectorless" dataKey="vectorless" stroke={RAG_COLORS.vectorless} fill={RAG_COLORS.vectorless} fillOpacity={0.15} />
        <Radar name="Graph Vector" dataKey="graph_vector" stroke={RAG_COLORS.graph_vector} fill={RAG_COLORS.graph_vector} fillOpacity={0.15} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Tooltip />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function TimelineChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="query" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 11 }} unit="ms" />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="vector" name="Vector" stroke={RAG_COLORS.vector} dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="vectorless" name="Vectorless" stroke={RAG_COLORS.vectorless} dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="graph_vector" name="Graph" stroke={RAG_COLORS.graph_vector} dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}