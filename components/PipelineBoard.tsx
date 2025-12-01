
import React, { useState } from 'react';
import { Lead, LeadStatus, Contact } from '../types';
import { generateMailtoLink } from '../services/emailService';
import { LeadDetailView } from './LeadDetailView';
import { ResearchDetailView } from './ResearchDetailView';
import { ContactDetailView } from './ContactDetailView';

interface Props {
  leads: Lead[];
  onAnalyze: (lead: Lead) => void;
  onMarkContacted?: (lead: Lead) => void;
  onDeleteLead?: (leadId: string) => void;
  analyzingIds: Set<string>;
  onUpdateLead?: (lead: Lead) => void;
}

const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

export const PipelineBoard: React.FC<Props> = ({ leads, onAnalyze, onMarkContacted, onDeleteLead, analyzingIds, onUpdateLead }) => {
  const [selectedDetailLeadId, setSelectedDetailLeadId] = useState<string | null>(null);
  const [selectedResearchLeadId, setSelectedResearchLeadId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<{contact: Contact, lead: Lead} | null>(null);

  const columns = [
    { id: LeadStatus.NEW, label: 'Identified', color: 'bg-slate-100', text: 'text-slate-600' },
    { id: LeadStatus.ANALYZING, label: 'Processing', color: 'bg-yellow-50', text: 'text-yellow-700' },
    { id: LeadStatus.QUALIFIED, label: 'Qualified', color: 'bg-green-50', text: 'text-green-700' },
    { id: LeadStatus.CONTACTED, label: 'Contacted', color: 'bg-blue-50', text: 'text-blue-700' },
    { id: LeadStatus.MEETING_SCHEDULED, label: 'Meeting Set', color: 'bg-purple-50', text: 'text-purple-700' },
    { id: LeadStatus.PROPOSAL_SENT, label: 'Proposal', color: 'bg-indigo-50', text: 'text-indigo-700' },
    { id: LeadStatus.NEGOTIATION, label: 'Negotiating', color: 'bg-orange-50', text: 'text-orange-700' },
    { id: LeadStatus.WON, label: 'Won', color: 'bg-emerald-100', text: 'text-emerald-700' },
    { id: LeadStatus.LOST, label: 'Lost', color: 'bg-red-50', text: 'text-red-700' },
    { id: LeadStatus.UNQUALIFIED, label: 'Disqualified', color: 'bg-gray-100', text: 'text-gray-600' },
  ];

  const isHighValueDeal = (lead: Lead): boolean => {
    return lead.dealValue !== undefined && lead.dealValue > 10000;
  };

  return (
    <div className="h-full overflow-x-auto pb-4 scrollbar-hide">
        <div className="flex gap-3 min-w-[2600px] h-full">
            {columns.map(col => {
                const colLeads = leads.filter(l => l.status === col.id);
                return (
                    <div key={col.id} className="w-64 flex flex-col h-full bg-slate-50/50 rounded-xl border border-slate-200/60 shrink-0">
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
                                <div 
                                    key={lead.id} 
                                    className={`bg-white p-3 rounded-lg border shadow-sm hover:shadow-md transition-shadow group flex flex-col gap-2 relative ${
                                        isHighValueDeal(lead) 
                                            ? 'border-amber-300 ring-2 ring-amber-100' 
                                            : 'border-slate-200'
                                    }`}
                                >
                                    {/* High Value Indicator */}
                                    {isHighValueDeal(lead) && (
                                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-400 rounded-full flex items-center justify-center shadow-sm">
                                            <span className="text-[10px]">💎</span>
                                        </div>
                                    )}
                                    
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
                                        <button onClick={() => setSelectedDetailLeadId(lead.id)} className="font-bold text-slate-800 text-sm leading-tight truncate pr-4 hover:text-blue-600 hover:underline text-left" title={lead.companyName}>{lead.companyName}</button>
                                        <p className="text-[10px] text-slate-400 line-clamp-2 mt-0.5">{lead.description}</p>
                                    </div>

                                    {/* Deal Value */}
                                    {lead.dealValue !== undefined && (
                                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${
                                            isHighValueDeal(lead) 
                                                ? 'bg-amber-50 border border-amber-200' 
                                                : 'bg-slate-50 border border-slate-100'
                                        }`}>
                                            <span className="text-[10px]">💰</span>
                                            <span className={`text-[11px] font-bold ${
                                                isHighValueDeal(lead) ? 'text-amber-700' : 'text-slate-600'
                                            }`}>
                                                {formatCurrency(lead.dealValue)}
                                            </span>
                                        </div>
                                    )}
                                    
                                    {/* Trigger Badge */}
                                    {lead.triggers && lead.triggers.length > 0 && (
                                        <div>
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-50 text-red-600 rounded border border-red-100 text-[9px] font-bold uppercase tracking-wide">
                                                🔥 {lead.triggers[0].type}
                                            </span>
                                        </div>
                                    )}

                                    {/* Research Quality Badge */}
                                    {lead.researchQuality !== undefined && (
                                        <button onClick={() => setSelectedResearchLeadId(lead.id)} className={`text-[10px] font-bold p-1.5 rounded border cursor-pointer hover:shadow-md transition-shadow ${
                                            (lead.researchQuality || 0) >= 8 
                                                ? 'text-green-600 bg-green-50 border-green-100 hover:border-green-300' 
                                                : (lead.researchQuality || 0) >= 5
                                                ? 'text-orange-600 bg-orange-50 border-orange-100 hover:border-orange-300'
                                                : 'text-red-600 bg-red-50 border-red-100 hover:border-red-300'
                                        }`}>
                                            Research: {lead.researchQuality}/10 {(lead.researchQuality || 0) >= 8 ? '✓' : (lead.researchQuality || 0) >= 5 ? '⚠️' : '✗'}
                                        </button>
                                    )}

                                    {/* Decision Maker */}
                                    {lead.decisionMaker && (
                                        <button onClick={() => setSelectedContact({contact: {id: `dm-${lead.id}`, ...lead.decisionMaker, phone: undefined, isPrimary: true}, lead})} className="flex items-center gap-2 bg-purple-50 p-1.5 rounded border border-purple-100 hover:bg-purple-100 hover:border-purple-300 transition-colors w-full text-left">
                                            <div className="w-4 h-4 rounded-full bg-purple-200 flex items-center justify-center text-[8px] text-purple-700 font-bold">
                                                {lead.decisionMaker.name[0]}
                                            </div>
                                            <div className="overflow-hidden">
                                                <p className="text-[10px] font-bold text-purple-900 truncate hover:text-purple-700">{lead.decisionMaker.name}</p>
                                                <p className="text-[8px] text-purple-600 truncate">{lead.decisionMaker.role}</p>
                                            </div>
                                        </button>
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

        {/* Detail View Modal */}
        {selectedDetailLeadId && (
          <div className="absolute inset-0 bg-black/20 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
              <LeadDetailView 
                lead={leads.find(l => l.id === selectedDetailLeadId)!}
                onUpdate={(updatedLead) => {
                  if (onUpdateLead) onUpdateLead(updatedLead);
                  setSelectedDetailLeadId(null);
                }}
                onClose={() => setSelectedDetailLeadId(null)}
              />
            </div>
          </div>
        )}

        {/* Research Detail Modal */}
        {selectedResearchLeadId && (
          (() => {
            const lead = leads.find(l => l.id === selectedResearchLeadId);
            return lead ? (
              <ResearchDetailView 
                research={lead.research || null}
                companyName={lead.companyName}
                website={lead.website}
                lead={lead}
                onClose={() => setSelectedResearchLeadId(null)}
                onLeadUpdate={(updatedLead) => {
                  if (onUpdateLead) onUpdateLead(updatedLead);
                }}
              />
            ) : null;
          })()
        )}

        {/* Contact Detail Modal */}
        {selectedContact && (
          <ContactDetailView 
            contact={selectedContact.contact}
            lead={selectedContact.lead}
            onClose={() => setSelectedContact(null)}
            onViewCompany={(lead) => {
              setSelectedContact(null);
              setSelectedDetailLeadId(lead.id);
            }}
            onUpdate={(updatedContact) => {
              if (onUpdateLead && selectedContact) {
                const updatedLead = {
                  ...selectedContact.lead,
                  decisionMaker: updatedContact.isPrimary ? updatedContact : selectedContact.lead.decisionMaker,
                  contacts: selectedContact.lead.contacts?.map(c => c.id === updatedContact.id ? updatedContact : c) || [updatedContact]
                };
                onUpdateLead(updatedLead);
                setSelectedContact({...selectedContact, contact: updatedContact});
              }
            }}
          />
        )}
    </div>
  );
};
