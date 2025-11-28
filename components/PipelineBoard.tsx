
import React from 'react';
import { Lead, LeadStatus } from '../types';
import { generateMailtoLink } from '../services/emailService';

interface Props {
  leads: Lead[];
  onAnalyze: (lead: Lead) => void;
  onMarkContacted?: (lead: Lead) => void;
  onDeleteLead?: (leadId: string) => void;
  analyzingIds: Set<string>;
}

export const PipelineBoard: React.FC<Props> = ({ leads, onAnalyze, onMarkContacted, onDeleteLead, analyzingIds }) => {
  const columns = [
    { id: LeadStatus.NEW, label: 'Identified', color: 'bg-slate-100', text: 'text-slate-600' },
    { id: LeadStatus.ANALYZING, label: 'Processing', color: 'bg-yellow-50', text: 'text-yellow-700' },
    { id: LeadStatus.QUALIFIED, label: 'Qualified', color: 'bg-green-50', text: 'text-green-700' },
    { id: LeadStatus.CONTACTED, label: 'Contacted', color: 'bg-blue-50', text: 'text-blue-700' },
    { id: LeadStatus.UNQUALIFIED, label: 'Disqualified', color: 'bg-red-50', text: 'text-red-700' },
  ];

  return (
    <div className="h-full overflow-x-auto pb-4 scrollbar-hide">
        <div className="flex gap-4 min-w-[1200px] h-full">
            {columns.map(col => {
                const colLeads = leads.filter(l => l.status === col.id);
                return (
                    <div key={col.id} className="w-72 flex flex-col h-full bg-slate-50/50 rounded-xl border border-slate-200/60 shrink-0">
                         {/* Header */}
                        <div className={`p-3 border-b border-slate-100 flex justify-between items-center rounded-t-xl ${col.color}`}>
                            <h3 className={`text-xs font-bold uppercase tracking-wider ${col.text}`}>{col.label}</h3>
                            <span className="text-[10px] font-bold bg-white/60 px-2 py-0.5 rounded-full">{colLeads.length}</span>
                        </div>
                        
                        {/* Cards */}
                        <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {colLeads.length === 0 && (
                                <div className="text-center py-10 opacity-50">
                                    <p className="text-[10px] uppercase font-bold text-slate-400">Empty</p>
                                </div>
                            )}
                            {colLeads.map(lead => (
                                <div key={lead.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow group flex flex-col gap-2 relative">
                                    <div className="flex justify-between items-start">
                                        <div className="w-6 h-6 rounded bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-[10px] shrink-0 uppercase">
                                            {lead.companyName.substring(0,1)}
                                        </div>
                                        {lead.analysis?.score !== undefined && (
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${lead.analysis.score > 65 ? 'bg-green-100 text-green-700' : lead.analysis.score < 40 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                                                {lead.analysis.score}
                                            </span>
                                        )}
                                    </div>
                                    
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm leading-tight truncate pr-4" title={lead.companyName}>{lead.companyName}</h4>
                                        <p className="text-[10px] text-slate-400 line-clamp-2 mt-0.5">{lead.description}</p>
                                    </div>
                                    
                                    {/* Trigger Badge */}
                                    {lead.triggers && lead.triggers.length > 0 && (
                                        <div>
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-50 text-red-600 rounded border border-red-100 text-[9px] font-bold uppercase tracking-wide">
                                                🔥 {lead.triggers[0].type}
                                            </span>
                                        </div>
                                    )}

                                    {/* Decision Maker */}
                                    {lead.decisionMaker && (
                                        <div className="flex items-center gap-2 bg-purple-50 p-1.5 rounded border border-purple-100">
                                            <div className="w-4 h-4 rounded-full bg-purple-200 flex items-center justify-center text-[8px] text-purple-700 font-bold">
                                                {lead.decisionMaker.name[0]}
                                            </div>
                                            <div className="overflow-hidden">
                                                <p className="text-[10px] font-bold text-purple-900 truncate">{lead.decisionMaker.name}</p>
                                                <p className="text-[8px] text-purple-600 truncate">{lead.decisionMaker.role}</p>
                                            </div>
                                        </div>
                                    )}

                                    {lead.emailSequence && lead.emailSequence.length > 0 && lead.status !== LeadStatus.CONTACTED && (
                                        <div className="p-1.5 bg-blue-50/50 rounded border border-blue-50">
                                            <p className="text-[10px] text-blue-800 font-medium truncate">
                                                <span className="font-bold mr-1">Draft:</span> 
                                                "{lead.emailSequence[0]?.context || 'Intro'}"
                                            </p>
                                        </div>
                                    )}

                                    <div className="flex justify-between items-center pt-2 border-t border-slate-50 mt-1">
                                        <a href={lead.website} target="_blank" className="text-[10px] text-slate-400 hover:text-blue-500 truncate max-w-[80px]">
                                            Website ↗
                                        </a>
                                        
                                        {lead.status === LeadStatus.NEW && (
                                            <button 
                                                onClick={() => onAnalyze(lead)}
                                                disabled={analyzingIds.has(lead.id)}
                                                className="text-[10px] font-bold bg-slate-900 text-white px-2 py-1 rounded hover:bg-slate-700 disabled:opacity-50"
                                            >
                                                {analyzingIds.has(lead.id) ? '...' : 'Analyze'}
                                            </button>
                                        )}

                                        {lead.emailSequence && lead.emailSequence.length > 0 && lead.status !== LeadStatus.CONTACTED && (
                                            <a 
                                                href={generateMailtoLink(lead.decisionMaker?.email || "", lead.emailSequence[0].subject, lead.emailSequence[0].body)}
                                                onClick={() => { if(onMarkContacted) onMarkContacted(lead); }}
                                                target="_blank"
                                                className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1 bg-blue-50 px-2 py-1 rounded"
                                            >
                                                Send ✉️
                                            </a>
                                        )}
                                        {lead.status === LeadStatus.CONTACTED && (
                                            <span className="text-[10px] font-bold text-green-600 flex items-center gap-1 bg-green-50 px-2 py-1 rounded">
                                                ✓ Sent
                                            </span>
                                        )}
                                    </div>
                                    
                                    {onDeleteLead && (
                                        <button 
                                            onClick={() => onDeleteLead(lead.id)} 
                                            className="absolute top-2 right-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Delete"
                                        >
                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                    )}
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
