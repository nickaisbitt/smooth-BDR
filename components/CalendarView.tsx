
import React from 'react';
import { Lead } from '../types';

interface Props {
    leads: Lead[];
}

export const CalendarView: React.FC<Props> = ({ leads }) => {
    // 1. Get Scheduled Follow-ups
    const scheduledEvents = leads
        .filter(l => l.lastContactedAt && l.emailSequence && l.emailSequence.length > 1)
        .map(l => {
            const nextEmailIndex = 1; // Assuming next step is always #2 for visualization simplicty
            const nextDraft = l.emailSequence![nextEmailIndex];
            const dueTime = (l.lastContactedAt || 0) + (nextDraft.delayDays * 24 * 60 * 60 * 1000);
            return {
                id: l.id,
                date: new Date(dueTime),
                company: l.companyName,
                task: `Send Email #${nextEmailIndex + 1}`,
                status: 'pending'
            };
        })
        .sort((a, b) => a.date.getTime() - b.date.getTime());

    // 2. Get Past Interactions
    const pastEvents = leads
        .filter(l => l.lastContactedAt)
        .map(l => ({
            id: l.id,
            date: new Date(l.lastContactedAt!),
            company: l.companyName,
            task: "Initial Outreach Sent",
            status: 'done'
        }))
        .sort((a, b) => b.date.getTime() - a.date.getTime());

    return (
        <div className="flex flex-col h-full bg-slate-50 p-6 animate-fadeIn">
            <h1 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                Outreach Calendar
            </h1>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* UPCOMING */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h3 className="font-bold text-slate-400 uppercase tracking-wider text-xs mb-4">Upcoming Follow-Ups</h3>
                    <div className="space-y-3">
                        {scheduledEvents.length === 0 && <p className="text-slate-400 text-sm italic">No follow-ups scheduled.</p>}
                        {scheduledEvents.map(evt => (
                            <div key={evt.id} className="flex gap-4 items-center p-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all">
                                <div className="flex flex-col items-center justify-center bg-blue-50 w-12 h-12 rounded-lg text-blue-700 border border-blue-100">
                                    <span className="text-[10px] font-bold uppercase">{evt.date.toLocaleString('default', { month: 'short' })}</span>
                                    <span className="text-lg font-bold leading-none">{evt.date.getDate()}</span>
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-800 text-sm">{evt.company}</h4>
                                    <p className="text-xs text-slate-500">{evt.task}</p>
                                </div>
                                <div className="ml-auto">
                                    <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded-full">Due</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* PAST */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 opacity-75">
                    <h3 className="font-bold text-slate-400 uppercase tracking-wider text-xs mb-4">Recent Activity</h3>
                    <div className="space-y-3">
                         {pastEvents.map(evt => (
                            <div key={evt.id} className="flex gap-4 items-center p-3 rounded-lg border border-slate-50">
                                <div className="flex flex-col items-center justify-center bg-slate-100 w-12 h-12 rounded-lg text-slate-500">
                                    <span className="text-[10px] font-bold uppercase">{evt.date.toLocaleString('default', { month: 'short' })}</span>
                                    <span className="text-lg font-bold leading-none">{evt.date.getDate()}</span>
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-700 text-sm">{evt.company}</h4>
                                    <p className="text-xs text-slate-400">{evt.task}</p>
                                </div>
                                <div className="ml-auto">
                                    <span className="text-[10px] font-bold text-green-600">✓ Done</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
