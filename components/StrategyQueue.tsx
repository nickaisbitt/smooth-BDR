import React, { useState } from 'react';
import { StrategyNode, Lead } from '../types';
import { X, Building2 } from 'lucide-react';

interface Props {
    queue: StrategyNode[];
    active: boolean;
    onAddStrategy: (sector: string, query: string) => void;
    leads?: Lead[];
}

export const StrategyQueue: React.FC<Props> = ({ queue, active, onAddStrategy, leads }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [newSector, setNewSector] = useState('');
    const [newQuery, setNewQuery] = useState('');
    const [selectedStrategy, setSelectedStrategy] = useState<StrategyNode | null>(null);

    const activeStrategy = queue.find(n => n.status === 'active');
    const pendingStrategies = queue.filter(n => n.status === 'pending');
    const completedStrategies = queue.filter(n => n.status === 'completed');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newSector && newQuery) {
            onAddStrategy(newSector, newQuery);
            setNewSector('');
            setNewQuery('');
            setIsAdding(false);
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex flex-col h-full">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                    <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 7m0 13V7" /></svg>
                    Campaign Funnel
                </h3>
                <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    {active ? 'EXECUTING' : 'READY'}
                </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
                {/* Active Strategy */}
                {activeStrategy && (
                    <div onClick={() => setSelectedStrategy(activeStrategy)} className="bg-purple-50 border border-purple-200 rounded-lg p-3 relative overflow-hidden group transition-all cursor-pointer hover:shadow-md hover:border-purple-300">
                        <div className="absolute top-0 right-0 p-1">
                            <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-ping"></div>
                        </div>
                        <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wide mb-1">Targeting Now</p>
                        <p className="font-bold text-purple-900 text-sm">{activeStrategy.sector}</p>
                        <p className="text-[10px] text-purple-700 mt-1 italic line-clamp-2">"{activeStrategy.rationale}"</p>
                    </div>
                )}

                {/* Pending List */}
                {pendingStrategies.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-2">Up Next</p>
                        {pendingStrategies.map(node => (
                            <div key={node.id} onClick={() => setSelectedStrategy(node)} className="bg-slate-50 border border-slate-100 rounded-lg p-3 opacity-90 cursor-pointer hover:opacity-100 hover:border-slate-300 hover:shadow-sm transition-all">
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                         <p className="font-semibold text-slate-700 text-xs">{node.sector}</p>
                                         <p className="text-[10px] text-slate-400 truncate">{node.query}</p>
                                    </div>
                                    <div className="w-2 h-2 rounded-full border border-slate-300 ml-2"></div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Empty State */}
                {pendingStrategies.length === 0 && !activeStrategy && !isAdding && (
                     <div className="text-center py-4 border border-dashed border-slate-200 rounded-lg">
                        <p className="text-xs text-slate-400">Queue empty.</p>
                        <p className="text-[10px] text-slate-400">Agent will auto-generate plan.</p>
                     </div>
                )}
                
                {/* Add Manual Strategy */}
                {isAdding ? (
                    <form onSubmit={handleSubmit} className="bg-white border border-blue-200 rounded-lg p-3 shadow-md animate-fadeIn">
                        <p className="text-[10px] font-bold text-blue-500 uppercase mb-2">Inject Strategy</p>
                        <input 
                            className="w-full text-xs border border-slate-200 rounded p-1.5 mb-2 focus:ring-1 focus:ring-blue-500 outline-none"
                            placeholder="Sector Name (e.g. Arizona HVAC)"
                            value={newSector}
                            onChange={(e) => setNewSector(e.target.value)}
                            autoFocus
                        />
                        <input 
                            className="w-full text-xs border border-slate-200 rounded p-1.5 mb-2 focus:ring-1 focus:ring-blue-500 outline-none"
                            placeholder="Search Query"
                            value={newQuery}
                            onChange={(e) => setNewQuery(e.target.value)}
                        />
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setIsAdding(false)} className="flex-1 text-xs py-1 text-slate-500 hover:bg-slate-50 rounded">Cancel</button>
                            <button type="submit" className="flex-1 text-xs py-1 bg-blue-500 text-white rounded font-bold hover:bg-blue-600">Add</button>
                        </div>
                    </form>
                ) : (
                    <button 
                        onClick={() => setIsAdding(true)}
                        className="w-full py-2 border border-dashed border-slate-300 rounded-lg text-slate-400 text-xs font-bold hover:border-blue-400 hover:text-blue-500 transition-colors flex items-center justify-center gap-1"
                    >
                        <span>+</span> Inject Manual Strategy
                    </button>
                )}

                {/* Completed (Collapsed view) */}
                {completedStrategies.length > 0 && (
                     <div className="pt-2 border-t border-slate-100 mt-2">
                        <p className="text-[10px] text-slate-400 text-center">{completedStrategies.length} sectors conquered</p>
                     </div>
                )}
            </div>

            {/* Strategy Detail Modal */}
            {selectedStrategy && (
                <>
                    <div 
                        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
                        onClick={() => setSelectedStrategy(null)}
                    />
                    <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-hidden flex flex-col animate-slideIn">
                        <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-start shrink-0">
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">
                                    {selectedStrategy.status === 'active' ? '🎯 Active Campaign' : selectedStrategy.status === 'completed' ? '✅ Completed' : '⏳ Queued'}
                                </p>
                                <h2 className="text-xl font-bold text-slate-800">{selectedStrategy.sector}</h2>
                            </div>
                            <button 
                                onClick={() => setSelectedStrategy(null)}
                                className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                            >
                                <X size={20} className="text-slate-500" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Search Query</p>
                                <p className="text-sm text-slate-700">{selectedStrategy.query}</p>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Rationale</p>
                                <p className="text-sm text-slate-700">{selectedStrategy.rationale}</p>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                                <p className="text-xs font-bold text-blue-600 uppercase mb-2">Status</p>
                                <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                                    selectedStrategy.status === 'active' ? 'bg-purple-100 text-purple-700' :
                                    selectedStrategy.status === 'completed' ? 'bg-green-100 text-green-700' :
                                    'bg-slate-100 text-slate-700'
                                }`}>
                                    {selectedStrategy.status.toUpperCase()}
                                </span>
                            </div>

                            {/* Companies Identified */}
                            {leads && (
                                <div className="border-t border-slate-200 pt-4">
                                    <p className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-1">
                                        <Building2 size={12} />
                                        Companies Identified
                                    </p>
                                    {(() => {
                                        const matchingLeads = leads.filter(l => 
                                            l.strategyId === selectedStrategy.id ||
                                            l.foundVia?.includes(selectedStrategy.sector)
                                        );
                                        return matchingLeads.length > 0 ? (
                                            <div className="space-y-2">
                                                {matchingLeads.slice(0, 10).map(lead => (
                                                    <div key={lead.id} className="bg-white border border-slate-100 rounded-lg p-3 hover:border-slate-300 hover:shadow-sm transition-all">
                                                        <p className="text-xs font-bold text-slate-700">{lead.companyName}</p>
                                                        <p className="text-[10px] text-slate-500 truncate">{lead.website}</p>
                                                        <span className={`inline-block mt-1.5 px-1.5 py-0.5 text-[8px] font-bold rounded uppercase ${
                                                            lead.status === 'QUALIFIED' ? 'bg-green-100 text-green-700' :
                                                            lead.status === 'CONTACTED' ? 'bg-blue-100 text-blue-700' :
                                                            lead.status === 'NEW' ? 'bg-slate-100 text-slate-600' :
                                                            'bg-slate-50 text-slate-500'
                                                        }`}>
                                                            {lead.status}
                                                        </span>
                                                    </div>
                                                ))}
                                                {matchingLeads.length > 10 && (
                                                    <p className="text-xs text-slate-400 text-center pt-2">+{matchingLeads.length - 10} more</p>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="text-xs text-slate-400 italic">No companies identified yet</p>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};