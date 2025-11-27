
import React, { useState } from 'react';
import { Lead, LeadStatus, EmailDraft } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { generateMailtoLink } from '../services/emailService';

interface Props {
  leads: Lead[];
  onAnalyze: (lead: Lead) => void;
  onHunt?: (lead: Lead) => void;
  onMarkContacted?: (lead: Lead) => void;
  onAddManualLead?: (lead: Lead) => void;
  analyzingIds: Set<string>;
  onExport?: () => void;
}

const EmailSequenceViewer = ({ sequence, decisionMaker, onMarkContacted, lastContactedAt }: { sequence: EmailDraft[], decisionMaker?: any, onMarkContacted?: () => void, lastContactedAt?: number }) => {
    const [step, setStep] = useState(0);
    
    // Safety Guard
    if (!sequence || !Array.isArray(sequence) || sequence.length === 0) {
        return <span className="text-[10px] text-slate-300 italic">No campaign generated</span>;
    }

    const draft = sequence[step];
    if (!draft) return null;

    const daysSinceLastContact = lastContactedAt ? Math.floor((Date.now() - lastContactedAt) / (1000 * 60 * 60 * 24)) : 0;
    const isDue = lastContactedAt && daysSinceLastContact >= 3 && step > 0;

    return (
        <details className="relative inline-block text-left group">
            <summary className={`list-none cursor-pointer text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors shadow-sm whitespace-nowrap flex items-center justify-end gap-2 ${isDue ? 'bg-orange-100 text-orange-700 border border-orange-200' : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300'}`}>
                {isDue ? '⚠️ Follow-Up Due' : `View Campaign (${sequence.length})`}
                <svg className="w-3 h-3 text-slate-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </summary>
            
            <div className="absolute right-0 bottom-full mb-2 w-[85vw] md:w-[450px] bg-white rounded-xl shadow-2xl border border-slate-200 p-5 z-50 text-left hidden group-open:block ring-1 ring-black/5 animate-fadeIn">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Outreach Sequence</span>
                    <button onClick={onMarkContacted} className="text-[10px] font-bold text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200 hover:bg-green-100">
                        ✓ Mark as Sent
                    </button>
                </div>
                
                <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg">
                    {sequence.map((s, i) => (
                        <button key={i} onClick={(e) => { e.preventDefault(); setStep(i); }} className={`flex-1 text-[10px] font-bold py-1.5 rounded-md transition-all ${step === i ? 'bg-white shadow text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>
                            {i === 0 ? 'Initial' : `Day ${s.delayDays}`}
                        </button>
                    ))}
                </div>

                <div className="space-y-3">
                    {/* REFLECTIVE AI CRITIQUE */}
                    {draft.critique && (
                        <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 mb-2">
                             <div className="flex items-center gap-2 mb-1">
                                 <svg className="w-3 h-3 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                 <span className="text-[9px] font-bold text-purple-700 uppercase tracking-wide">AI Refinement</span>
                             </div>
                             <p className="text-[10px] text-purple-800 italic leading-snug">"{draft.critique}"</p>
                        </div>
                    )}

                    <div className="bg-slate-50 p-2 rounded border border-slate-200">
                        <span className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Subject</span>
                        <p className="text-xs font-semibold text-slate-800">{draft.subject || "(No Subject)"}</p>
                    </div>
                    
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 max-h-60 overflow-y-auto">
                        <span className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Body</span>
                        <div className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed font-sans">{draft.body || "(No Content)"}</div>
                    </div>

                    <div className="pt-3 flex gap-2">
                        <a 
                            href={generateMailtoLink(decisionMaker?.email || "", draft.subject, draft.body)}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 rounded-lg transition-colors"
                        >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                            Open in Mail
                        </a>
                        <button 
                            onClick={() => { navigator.clipboard.writeText(draft.body); }}
                            className="px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg border border-slate-200"
                            title="Copy Body"
                        >
                            📋
                        </button>
                    </div>
                </div>
            </div>
        </details>
    );
};

export const PipelineTable: React.FC<Props> = ({ leads, onAnalyze, onHunt, onMarkContacted, onAddManualLead, analyzingIds, onExport }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [page, setPage] = useState(0);
  const ITEMS_PER_PAGE = 50;

  // Pagination Logic
  const totalPages = Math.ceil(leads.length / ITEMS_PER_PAGE);
  const displayedLeads = leads.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  // Manual Add State
  const [manualCompany, setManualCompany] = useState('');
  const [manualWebsite, setManualWebsite] = useState('');
  const [manualDesc, setManualDesc] = useState('');

  const handleManualSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!manualCompany || !onAddManualLead) return;
      onAddManualLead({
          id: uuidv4(), companyName: manualCompany, website: manualWebsite || 'https://', description: manualDesc || 'Manual Entry', status: LeadStatus.NEW, foundVia: 'Manual', createdAt: Date.now(), lastUpdated: Date.now()
      });
      setManualCompany(''); setManualWebsite(''); setManualDesc(''); setIsAdding(false);
  };

  const getStatusBadge = (status: LeadStatus) => {
    const styles = {
        [LeadStatus.NEW]: "bg-slate-100 text-slate-600 border-slate-200",
        [LeadStatus.ANALYZING]: "bg-yellow-100 text-yellow-700 border-yellow-200 animate-pulse",
        [LeadStatus.QUALIFIED]: "bg-green-100 text-green-700 border-green-200",
        [LeadStatus.CONTACTED]: "bg-blue-100 text-blue-700 border-blue-200",
        [LeadStatus.UNQUALIFIED]: "bg-red-50 text-red-400 border-red-100"
    };
    return <span className={`px-2 py-0.5 rounded text-[9px] font-bold border uppercase tracking-wide ${styles[status]}`}>{status}</span>;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col h-full relative">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-2xl">
        <div className="flex items-center gap-3">
             <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Prospect Pipeline</h2>
             <span className="text-xs text-slate-500 font-medium bg-slate-200 px-2 py-0.5 rounded-full">{leads.length}</span>
        </div>
        <div className="flex gap-2">
            {onAddManualLead && <button onClick={() => setIsAdding(true)} className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors">+ Add Lead</button>}
            {onExport && <button onClick={onExport} className="text-xs font-bold text-slate-500 hover:text-slate-800 px-2 transition-colors">Export CSV</button>}
        </div>
      </div>
      
      {/* Manual Add Modal */}
      {isAdding && (
          <div className="absolute inset-0 bg-white/95 z-40 flex items-center justify-center p-4 rounded-2xl backdrop-blur-sm">
              <form onSubmit={handleManualSubmit} className="bg-white border border-slate-200 shadow-2xl rounded-2xl p-6 w-full max-w-md animate-fadeIn">
                  <h3 className="text-lg font-bold text-slate-800 mb-4">Add Lead Manually</h3>
                  <div className="space-y-3">
                      <input required className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={manualCompany} onChange={(e) => setManualCompany(e.target.value)} placeholder="Company Name" autoFocus />
                      <input className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={manualWebsite} onChange={(e) => setManualWebsite(e.target.value)} placeholder="Website URL" />
                      <textarea className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={manualDesc} onChange={(e) => setManualDesc(e.target.value)} placeholder="Notes / Description" rows={2} />
                  </div>
                  <div className="flex gap-2 pt-4">
                      <button type="button" onClick={() => setIsAdding(false)} className="flex-1 py-2 text-sm font-bold text-slate-500 bg-slate-50 rounded-lg hover:bg-slate-100">Cancel</button>
                      <button type="submit" className="flex-1 py-2 text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700">Add to Pipeline</button>
                  </div>
              </form>
          </div>
      )}

      {/* Responsive Table/Card View */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead className="hidden md:table-header-group sticky top-0 bg-white z-10 shadow-sm">
            <tr className="text-[10px] uppercase tracking-wider text-slate-400 font-bold bg-slate-50/50 border-b border-slate-100">
              <th className="px-6 py-3">Company</th>
              <th className="px-6 py-3">Fit Score</th>
              <th className="px-6 py-3">Key Contact</th>
              <th className="px-6 py-3">Source</th>
              <th className="px-6 py-3 text-right">Next Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {displayedLeads.length === 0 ? (
                <tr>
                    <td colSpan={5} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center justify-center text-slate-300">
                            <svg className="w-12 h-12 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                            <p className="text-sm font-medium">Pipeline is empty.</p>
                            <p className="text-xs">Start the Agent to find leads.</p>
                        </div>
                    </td>
                </tr>
            ) : (
                displayedLeads.map((lead) => (
                <tr key={lead.id} className="flex flex-col md:table-row border-b md:border-none p-4 md:p-0 relative hover:bg-slate-50/50 transition-colors group">
                    
                    {/* Mobile: Status Badge */}
                    <div className="md:hidden absolute top-4 right-4">{getStatusBadge(lead.status)}</div>

                    {/* Column 1: Company Info */}
                    <td className="md:px-6 md:py-4 align-top w-full md:w-[30%]">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 md:w-9 md:h-9 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center font-bold text-sm shrink-0 uppercase">
                                {lead.companyName.substring(0,1)}
                            </div>
                            <div className="min-w-0">
                                <div className="font-bold text-slate-800 text-sm leading-tight mb-0.5 truncate pr-8 md:pr-0">{lead.companyName}</div>
                                <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline block truncate mb-1">{lead.website}</a>
                                <p className="text-[10px] text-slate-400 line-clamp-2 md:line-clamp-1 leading-normal">{lead.description}</p>
                            </div>
                        </div>
                    </td>
                    
                    {/* Column 2: Analysis/Fit */}
                    <td className="md:px-6 md:py-4 align-top mt-2 md:mt-0">
                        <div className="hidden md:block mb-1.5">{getStatusBadge(lead.status)}</div>
                        {lead.analysis?.score !== undefined && (
                            <div className="flex items-center gap-2 max-w-[120px]">
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${lead.analysis.score > 70 ? 'bg-green-500' : lead.analysis.score < 40 ? 'bg-red-400' : 'bg-yellow-400'}`} style={{ width: `${lead.analysis.score}%` }}></div>
                                </div>
                                <span className="text-[10px] font-mono font-bold text-slate-600">{lead.analysis.score}</span>
                            </div>
                        )}
                        {/* Tech Stack Mini Tags */}
                        {lead.techStack && lead.techStack.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                                {lead.techStack.slice(0, 2).map((t, i) => (
                                    <span key={i} className="text-[9px] px-1.5 py-0.5 bg-slate-50 border border-slate-100 rounded text-slate-500">{t}</span>
                                ))}
                                {lead.techStack.length > 2 && <span className="text-[9px] text-slate-400">+{lead.techStack.length - 2}</span>}
                            </div>
                        )}
                    </td>

                    {/* Column 3: Decision Maker */}
                    <td className="md:px-6 md:py-4 align-top mt-2 md:mt-0">
                        {lead.decisionMaker ? (
                            <div className="bg-white/50 p-1.5 rounded-lg border border-slate-100 inline-block md:block w-full">
                                <p className="text-xs font-bold text-slate-700">{lead.decisionMaker.name}</p>
                                <p className="text-[10px] text-slate-400 truncate">{lead.decisionMaker.role}</p>
                            </div>
                        ) : lead.status !== LeadStatus.NEW && onHunt ? (
                             <button onClick={() => onHunt(lead)} disabled={analyzingIds.has(lead.id)} className="text-[10px] font-bold text-purple-600 bg-purple-50 px-3 py-1.5 rounded-md border border-purple-100 w-full md:w-auto hover:bg-purple-100 transition-colors">
                                {analyzingIds.has(lead.id) ? 'Finding...' : 'Find Decision Maker'}
                            </button>
                        ) : <span className="hidden md:inline text-slate-300 text-[10px]">-</span>}
                    </td>

                    {/* Column 4: Source/Strategy */}
                    <td className="md:px-6 md:py-4 align-top hidden md:table-cell">
                        {lead.foundVia && <span className="px-2 py-1 bg-slate-50 text-slate-500 text-[10px] rounded border border-slate-100 truncate inline-block max-w-[140px]">{lead.foundVia}</span>}
                        {lead.triggers && lead.triggers.length > 0 && (
                            <div className="mt-1">
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                                    🔥 {lead.triggers[0].type}
                                </span>
                            </div>
                        )}
                    </td>

                    {/* Column 5: Action */}
                    <td className="md:px-6 md:py-4 align-top md:text-right mt-4 md:mt-0 border-t md:border-none pt-3 md:pt-0 border-slate-50">
                        {lead.status === LeadStatus.NEW ? (
                            <button onClick={() => onAnalyze(lead)} disabled={analyzingIds.has(lead.id)} className="w-full md:w-auto text-xs font-bold bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg shadow-sm hover:bg-slate-50 active:scale-95 transition-all">
                                {analyzingIds.has(lead.id) ? 'Analyzing...' : 'Analyze'}
                            </button>
                        ) : lead.emailSequence && lead.emailSequence.length > 0 ? (
                            <div className="flex flex-col md:items-end gap-1.5">
                                <EmailSequenceViewer sequence={lead.emailSequence} decisionMaker={lead.decisionMaker} onMarkContacted={() => onMarkContacted && onMarkContacted(lead)} lastContactedAt={lead.lastContactedAt} />
                                {lead.activeVariant && (
                                    <span className="text-[9px] font-bold text-purple-400 px-1">
                                        Testing Variant {lead.activeVariant}
                                    </span>
                                )}
                            </div>
                        ) : <span className="hidden md:inline text-slate-300">-</span>}
                    </td>
                </tr>
                ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
          <div className="p-3 border-t border-slate-100 flex justify-center gap-2 items-center bg-slate-50/50 rounded-b-2xl">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-slate-600">Previous</button>
              <span className="text-xs text-slate-500 font-medium">Page {page + 1} of {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed text-slate-600">Next</button>
          </div>
      )}
    </div>
  );
};
