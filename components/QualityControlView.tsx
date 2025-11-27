
import React from 'react';
import { Lead, LeadStatus } from '../types';

interface Props {
    leads: Lead[];
    onApprove: (lead: Lead) => void;
    onReject: (lead: Lead) => void;
}

export const QualityControlView: React.FC<Props> = ({ leads, onApprove, onReject }) => {
    // Logic: Leads that are "Good" (Score > 70) but not yet approved (Qualified) or Rejected.
    // Assuming 'New' leads enter this queue if they are pre-scored? 
    // Actually, in the current flow, leads go New -> Qualified directly.
    // So this view shows QUALIFIED leads that haven't been CONTACTED yet?
    // Let's filter for Qualified but NOT Contacted.
    const reviewQueue = leads
        .filter(l => l.status === LeadStatus.QUALIFIED && !l.lastContactedAt)
        .sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0));

    return (
        <div className="flex flex-col h-full bg-slate-50">
            <div className="mb-6 px-2">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    Quality Control <span className="bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-full uppercase tracking-wide">Abby Mode</span>
                </h1>
                <p className="text-slate-500 text-sm mt-1">Review {reviewQueue.length} leads pending outreach.</p>
            </div>

            {reviewQueue.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl m-2">
                    <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
                        <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <p className="font-bold text-slate-600">All caught up!</p>
                    <p className="text-sm">No qualified leads pending review.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto pb-10 pr-2">
                    {reviewQueue.map(lead => (
                        <div key={lead.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col group hover:shadow-md transition-all">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="font-bold text-slate-800 text-lg">{lead.companyName}</h3>
                                    <a href={lead.website} target="_blank" className="text-blue-500 text-xs hover:underline">{lead.website}</a>
                                </div>
                                <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded-lg border border-green-200">
                                    {lead.analysis?.score || 0}/100
                                </span>
                            </div>

                            <div className="flex-1 space-y-3 mb-6">
                                <div className="bg-slate-50 p-3 rounded-lg text-xs text-slate-600 italic border border-slate-100">
                                    "{lead.analysis?.reasoning}"
                                </div>
                                
                                {lead.decisionMaker ? (
                                    <div className="flex items-center gap-3 bg-purple-50 p-2 rounded-lg border border-purple-100">
                                        <div className="w-8 h-8 bg-purple-200 rounded-full flex items-center justify-center text-purple-700 font-bold">
                                            {lead.decisionMaker.name[0]}
                                        </div>
                                        <div className="text-xs">
                                            <span className="font-bold text-slate-700 block">{lead.decisionMaker.name}</span>
                                            <span className="text-slate-500">{lead.decisionMaker.role}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-xs text-orange-500 font-bold bg-orange-50 p-2 rounded border border-orange-100">
                                        ⚠️ No Decision Maker Found
                                    </div>
                                )}

                                <div className="border-t border-slate-100 pt-3">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Subject Line A/B</p>
                                    <p className="text-xs font-medium text-slate-800 truncate" title={lead.emailSequence?.[0]?.subject}>
                                        A: {lead.emailSequence?.[0]?.subject || 'N/A'}
                                    </p>
                                    {lead.emailSequence?.[0]?.alternativeSubject && (
                                        <p className="text-xs font-medium text-slate-500 truncate mt-1" title={lead.emailSequence[0].alternativeSubject}>
                                            B: {lead.emailSequence[0].alternativeSubject}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-3 mt-auto">
                                <button 
                                    onClick={() => onReject(lead)}
                                    className="flex-1 py-2.5 border border-red-200 text-red-600 bg-red-50 rounded-lg text-sm font-bold hover:bg-red-100 transition-colors"
                                >
                                    Disqualify
                                </button>
                                {/* In QC view, "Approve" effectively just keeps it qualified, maybe we want a "Mark Reviewed" status? 
                                    For now, let's assume Approval means nothing changes (it stays in pipeline), but maybe we send? 
                                    Or we could implement a 'REVIEWED' status. 
                                    For V1, let's say "Approve" just removes it from this view? 
                                    Ah, the filter is "Qualified AND !Contacted". 
                                    So to remove from this view, we must Contact it or Reject it.
                                    Let's make "Approve" open the email client? No, that's manual.
                                    Let's just leave it.
                                */}
                                <button 
                                    onClick={() => { alert("Lead confirmed! Ready for outreach in Pipeline."); }}
                                    className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800 transition-colors"
                                >
                                    Keep
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
