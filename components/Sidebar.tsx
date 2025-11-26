import React from 'react';
import { ViewType } from '../types';

interface Props {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
}

export const Sidebar: React.FC<Props> = ({ currentView, onViewChange }) => {
  return (
    <div className="w-20 lg:w-64 bg-white border-r border-slate-200 flex flex-col items-center lg:items-stretch py-8 h-screen sticky top-0 z-20">
      <div className="mb-10 flex items-center justify-center lg:justify-start lg:px-8 gap-3 cursor-pointer" onClick={() => onViewChange('dashboard')}>
        <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white font-bold text-xl shadow-lg">
          S
        </div>
        <div className="hidden lg:block">
          <h1 className="text-lg font-bold text-slate-800 leading-none">Smooth<span className="text-blue-500">AI</span></h1>
          <p className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase">Consulting OS</p>
        </div>
      </div>

      <nav className="flex-1 w-full space-y-2 px-2 lg:px-4">
        <SidebarItem 
            icon={<HomeIcon />} 
            label="Dashboard" 
            active={currentView === 'dashboard'} 
            onClick={() => onViewChange('dashboard')} 
        />
        <SidebarItem 
            icon={<UsersIcon />} 
            label="Prospects" 
            active={currentView === 'prospects'} 
            onClick={() => onViewChange('prospects')} 
        />
        <SidebarItem 
            icon={<ChartBarIcon />} 
            label="Analytics" 
            active={currentView === 'analytics'} 
            onClick={() => onViewChange('analytics')} 
        />
      </nav>

      <div className="p-4 border-t border-slate-100">
        <SidebarItem 
            icon={<CogIcon />} 
            label="Settings" 
            active={currentView === 'settings'} 
            onClick={() => onViewChange('settings')} 
        />
      </div>
    </div>
  );
};

const SidebarItem = ({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center justify-center lg:justify-start gap-3 p-3 rounded-2xl transition-all duration-200 group ${active ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
  >
    <div className={`${active ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`}>
      {icon}
    </div>
    <span className="hidden lg:block font-medium text-sm">{label}</span>
  </button>
);

// Simple Icons
const HomeIcon = () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
const UsersIcon = () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
const ChartBarIcon = () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
const CogIcon = () => <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;