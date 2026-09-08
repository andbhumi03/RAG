import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import Layout from "../components/Layout";

const mockStats = {
  totalDocs: 2,
  totalQuestions: 14,
  mostQueriedDoc: "attendance-policy.pdf",
};

const mockChartData = [
  { name: "attendance-policy.pdf", queries: 9 },
  { name: "semester-notes.pdf", queries: 5 },
];

export default function Dashboard() {
  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-600 mb-2">Workspace overview</p><h1 className="text-3xl font-semibold text-slate-900">Good to see you.</h1><p className="text-slate-500 mt-2">A quick view of the knowledge base powering your assistant.</p></div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard label="Documents" value={mockStats.totalDocs} />
          <StatCard label="Questions Asked" value={mockStats.totalQuestions} />
          <StatCard label="Most Queried" value={mockStats.mostQueriedDoc} small />
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5"><div><h2 className="text-base font-semibold text-slate-800">Queries per document</h2><p className="text-xs text-slate-500 mt-1">Recent retrieval activity</p></div><span className="text-xs px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-100">Live workspace</span></div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={mockChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="queries" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Layout>
  );
}

function StatCard({ label, value, small }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={small ? "text-sm font-medium text-slate-800" : "text-2xl font-semibold text-slate-800"}>
        {value}
      </p>
    </div>
  );
}
