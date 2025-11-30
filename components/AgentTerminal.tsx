import React, { useEffect, useRef } from 'react';
import { AgentLog } from '../types';

interface Props {
    logs: AgentLog[];
    active: boolean;
}

export const AgentTerminal: React.FC<Props> = ({ logs, active }) => {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    return (
        <div className={`flex-1 bg-slate-950 rounded-xl overflow-hidden flex flex-col border border-slate-800 shadow-inner relative ${active ? 'ring-1 ring-green-900/50' : ''} min-h-[250px]`}>
            {/* Header */}
            <div className="bg-slate-900 px-4 py-2 flex items-center justify-between border-b border-slate-800">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${active ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}></div>
                    <span className="text-xs font-mono text-slate-400 font-bold tracking-wider uppercase">
                        {active ? 'NEURAL_ENGINE :: ONLINE' : 'NEURAL_ENGINE :: STANDBY'}
                    </span>
                </div>
                <div className="text-[10px] font-mono text-slate-600">v2.5.0</div>
            </div>

            {/* Terminal Body */}
            <div className="flex-1 p-4 font-mono text-xs overflow-y-auto max-h-[300px] relative">
                
                {logs.length === 0 && (
                    <div className="text-slate-700 italic mt-4 text-center">
                        System ready. Initialize Growth Engine to begin scanning.
                    </div>
                )}

                <div className="space-y-1.5">
                    {logs.map((log) => {
                        const time = new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
                        return (
                            <div key={log.id} className={`flex items-start gap-0 animate-fadeIn font-mono`}>
                                <span className="text-slate-500 shrink-0 w-16">{time}</span>
                                <span className={`
                                    ${log.type === 'info' ? 'text-slate-300' : ''}
                                    ${log.type === 'success' ? 'text-green-400' : ''}
                                    ${log.type === 'warning' ? 'text-yellow-400' : ''}
                                    ${log.type === 'error' ? 'text-red-400' : ''}
                                    ${log.type === 'action' ? 'text-cyan-400' : ''}
                                `}>
                                    {log.message}
                                </span>
                            </div>
                        );
                    })}
                    <div ref={bottomRef} />
                </div>

                {/* Scanline Effect */}
                <div className="absolute inset-0 pointer-events-none bg-scanline opacity-5"></div>
            </div>
        </div>
    );
};