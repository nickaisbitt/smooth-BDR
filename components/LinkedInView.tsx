
import React from 'react';

export const LinkedInView: React.FC = () => {
    return (
        <div className="flex flex-col h-full items-center justify-center bg-slate-50 p-6 text-center">
             <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 shadow-lg rotate-12">
                <svg className="w-10 h-10 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
             </div>
             <h1 className="text-3xl font-bold text-slate-900 mb-2">LinkedIn Automation</h1>
             <p className="text-slate-500 max-w-md mb-8">
                The Connection Bot module is currently under development. 
                Soon you will be able to auto-connect and DM prospects directly from here.
             </p>
             <button className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 transition-colors opacity-50 cursor-not-allowed">
                 Coming in v3.1
             </button>
        </div>
    );
};
