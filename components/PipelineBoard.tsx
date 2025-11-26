
import React from 'react';
import { Lead, LeadStatus } from '../types';

interface Props {
  leads: Lead[];
  onAnalyze: (lead: Lead) => void;
  onMarkContacted?: (lead: Lead) => void;
  analyzingIds: Set<string>;
}

export const PipelineBoard: React.FC<Props> = ({ leads, onAnalyze, onMarkContacted, analyzingIds }) => {
  const columns = [
    { id: LeadStatus.NEW, label: 'Identified', color: 'bg-slate-100', text: 'text-slate-600' },
    { id: LeadStatus.ANALYZING, label: 'Processing', color: 'bg-yellow-50', text: 'text-yellow-700' },
    { id: LeadStatus.QUALIFIED, label: 'Qualified Opportunities', color: 'bg-green-50', text: 'text-green-700' },
    { id: LeadStatus.CONTACTED, label: 'Contacted', color: 'bg-blue-50', text: 'text-blue-700' },
    { id: LeadStatus.UNQUALIFIED, label: 'Disqualified', color: 'bg-red-50', text: 'text-red-700' },
  ];

  return (
    <div className="h-full overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-[1200px] h-full">
            {columns.map(col => {
                const colLeads = leads.filter(l => l.status === col.id);
                return (
                    <div key={col.id} className="w-72 flex flex-col h-full bg-slate-50/50 rounded-xl border border-slate-200/60 shrink-0">
                         {/* Header */}
                        <div className={`p-3 border-b border-slate-100 flex justify-between items-center rounded-t-xl ${col.color}`}>
                            <h3 className={`text-xs font-bold uppercase tracking-wider ${col.text}`}>{col.label}</h3>
                            <span className="text-[10px] font-bold bg-white/50 px-2 py-0.5 rounded-full">{colLeads.length}</span>
                        </div>
                        
                        {/* Cards */}
                        <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {colLeads.map(lead => (
                                <div key={lead.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow group">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="w-6 h-6 rounded bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-[10px] shrink-0">
                                            {lead.companyName.substring(0,1).toUpperCase()}
                                        </div>
                                        {lead.analysis?.score && (
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${lead.analysis.score > 65 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                                {lead.analysis.score}%
                                            </span>
                                        )}
                                    </div>
                                    
                                    <h4 className="font-bold text-slate-800 text-sm mb-1 leading-tight">{lead.companyName}</h4>
                                    <p className="text-[10px] text-slate-400 line-clamp-2 mb-2">{lead.description}</p>
                                    
                                    {/* Trigger Badge */}
                                    {lead.triggers && lead.triggers.length > 0 && (
                                        <div className="mb-2">
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-50 text-red-600 rounded border border-red-100 text-[9px] font-bold uppercase tracking-wide">
                                                🚨 {lead.triggers[0].type}
                                            </span>
                                        </div>
                                    )}

                                    {/* Tech Stack Tags */}
                                    {lead.techStack && lead.techStack.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mb-2">
                                            {lead.techStack.slice(0,3).map((t,i) => (
                                                <span key={i} className="text-[9px] px-1 bg-slate-50 border border-slate-100 text-slate-400 rounded">{t}</span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Decision Maker */}
                                    {lead.decisionMaker && (
                                        <div className="flex items-center gap-2 mb-2 bg-purple-50 p-1.5 rounded border border-purple-100">
                                            <div className="w-4 h-4 rounded-full bg-purple-200 flex items-center justify-center text-[8px] text-purple-700 font-bold">
                                                {lead.decisionMaker.name.substring(0,1)}
                                            </div>
                                            <div className="overflow-hidden">
                                                <p className="text-[10px] font-bold text-purple-900 truncate">{lead.decisionMaker.name}</p>
                                                <p className="text-[8px] text-purple-600 truncate">{lead.decisionMaker.role}</p>
                                            </div>
                                        </div>
                                    )}

                                    {lead.emailSequence && lead.emailSequence.length > 0 && lead.status !== LeadStatus.CONTACTED && (
                                        <div className="mb-2 p-1.5 bg-blue-50/50 rounded border border-blue-50">
                                            <p className="text-[10px] text-blue-800 font-medium truncate">
                                                <span className="font-bold mr-1">3-Step Campaign:</span> 
                                                "{lead.emailSequence[0].context}"
                                            </p>
                                        </div>
                                    )}

                                    <div className="flex justify-between items-center pt-2 border-t border-slate-50 mt-1">
                                        <a href={lead.website} target="_blank" className="text-[10px] text-slate-400 hover:text-blue-500 truncate max-w-[100px] block">
                                            Website ↗
                                        </a>
                                        
                                        {lead.status === LeadStatus.NEW && (
                                            <button 
                                                onClick={() => onAnalyze(lead)}
                                                disabled={analyzingIds.has(lead.id)}
                                                className="text-[10px] font-bold bg-slate-900 text-white px-2 py-1 rounded hover:bg-slate-700 disabled:opacity-50"
                                            >
                                                {analyzingIds.has(lead.id) ? 'Scanning...' : 'Analyze'}
                                            </button>
                                        )}

                                        {lead.emailSequence && lead.status !== LeadStatus.CONTACTED && (
                                            <div className="flex gap-2">
                                                <a 
                                                    href={`mailto:${lead.decisionMaker ? '' : ''}?subject=${encodeURIComponent(lead.emailSequence[0].subject)}&body=${encodeURIComponent(lead.emailSequence[0].body)}`}
                                                    onClick={() => { if(onMarkContacted) onMarkContacted(lead); }}
                                                    target="_blank"
                                                    className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1"
                                                >
                                                    Send ✉️
                                                </a>
                                            </div>
                                        )}
                                        {lead.status === LeadStatus.CONTACTED && (
                                            <span className="text-[10px] font-bold text-blue-400 flex items-center gap-1">
                                                ✓ Sent
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            })}
        </div>
    </div>
  );
};
