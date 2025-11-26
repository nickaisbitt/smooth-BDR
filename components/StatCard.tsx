import React from 'react';

interface Props {
  title: string;
  value: string | number;
  trend: string;
  trendUp?: boolean;
  colorTheme: 'blue' | 'purple' | 'pink';
  icon?: React.ReactNode;
}

export const StatCard: React.FC<Props> = ({ title, value, trend, trendUp, colorTheme, icon }) => {
  const themes = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-900', trendBg: 'bg-blue-200', trendText: 'text-blue-800' },
    purple: { bg: 'bg-purple-50', text: 'text-purple-900', trendBg: 'bg-purple-200', trendText: 'text-purple-800' },
    pink: { bg: 'bg-pink-50', text: 'text-pink-900', trendBg: 'bg-pink-200', trendText: 'text-pink-800' },
  };

  const theme = themes[colorTheme];

  return (
    <div className={`${theme.bg} rounded-3xl p-6 relative overflow-hidden transition-all hover:shadow-lg`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-500 mb-1">{title}</h3>
          <div className={`text-4xl font-bold ${theme.text} tracking-tight`}>{value}</div>
        </div>
        {icon && <div className="p-2 bg-white/60 rounded-xl">{icon}</div>}
      </div>
      
      <div className="flex items-center gap-2">
         <span className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 ${theme.trendBg} ${theme.trendText}`}>
           {trendUp ? (
             <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
           ) : (
             <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg>
           )}
           {trend}
         </span>
         <span className="text-xs text-slate-400 font-medium">vs last session</span>
      </div>

      {/* Decorative blobs */}
      <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-white/20 rounded-full blur-2xl" />
      <div className="absolute top-4 right-10 w-12 h-12 bg-white/20 rounded-full blur-xl" />
    </div>
  );
};