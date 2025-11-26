
import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { Lead, LeadStatus } from '../types';

interface Props {
  leads: Lead[];
}

export const AnalyticsView: React.FC<Props> = ({ leads }) => {
  // 1. Funnel Data
  const funnelData = [
    { name: 'Total Identified', value: leads.length, fill: '#64748b' },
    { name: 'Analyzed', value: leads.filter(l => l.status !== LeadStatus.NEW).length, fill: '#3b82f6' },
    { name: 'Qualified', value: leads.filter(l => l.status === LeadStatus.QUALIFIED).length, fill: '#22c55e' },
    { name: 'Campaigns Ready', value: leads.filter(l => !!l.emailSequence).length, fill: '#a855f7' },
  ];

  // 2. Strategy Performance (Top 5)
  const strategyStats = leads.reduce((acc, lead) => {
    const strategy = lead.foundVia || 'Manual';
    if (!acc[strategy]) acc[strategy] = { name: strategy, qualified: 0, total: 0 };
    acc[strategy].total += 1;
    if (lead.status === LeadStatus.QUALIFIED) acc[strategy].qualified += 1;
    return acc;
  }, {} as Record<string, { name: string, qualified: number, total: number }>);

  const strategyData = (Object.values(strategyStats) as { name: string, qualified: number, total: number }[])
    .sort((a, b) => b.qualified - a.qualified)
    .slice(0, 5);

  // 3. Score Distribution
  const scoreData = leads
    .filter(l => l.analysis?.score)
    .map(l => ({ name: l.companyName, score: l.analysis?.score || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

  return (
    <div className="space-y-6 pb-10">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* FUNNEL CHART */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700 uppercase mb-6 tracking-wider">Conversion Funnel</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={120} tick={{fontSize: 10, fill: '#64748b'}} interval={0} />
                <Tooltip 
                    cursor={{fill: '#f8fafc'}}
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {funnelData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* STRATEGY ROI */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700 uppercase mb-6 tracking-wider">Strategy ROI (Qualified Leads)</h3>
          {strategyData.length > 0 ? (
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                <BarChart data={strategyData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{fontSize: 10, fill: '#64748b'}} />
                    <YAxis tick={{fontSize: 10, fill: '#64748b'}} />
                    <Tooltip 
                        contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                    />
                    <Legend wrapperStyle={{fontSize: '12px', paddingTop: '10px'}}/>
                    <Bar dataKey="total" name="Total Leads" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="qualified" name="Qualified" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
                </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
                No strategy data available yet.
            </div>
          )}
        </div>

        {/* TOP SCORED LEADS */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2">
           <h3 className="text-sm font-bold text-slate-700 uppercase mb-6 tracking-wider">Fit Score Analysis (Top 20)</h3>
           {scoreData.length > 0 ? (
               <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={scoreData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="name" tick={{fontSize: 10, fill: '#64748b'}} interval={0} angle={-45} textAnchor="end" height={60} />
                        <YAxis domain={[0, 100]} tick={{fontSize: 10, fill: '#64748b'}} />
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                        <Area type="monotone" dataKey="score" stroke="#0ea5e9" fillOpacity={1} fill="url(#colorScore)" />
                    </AreaChart>
                </ResponsiveContainer>
               </div>
           ) : (
             <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
                 No analyzed leads yet.
             </div>
           )}
        </div>

      </div>
    </div>
  );
};
