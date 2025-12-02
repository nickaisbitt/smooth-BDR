
import React from 'react';
import { ViewType } from '../types';
import { LayoutDashboard, Users, BarChart3, Settings, ShieldCheck, Activity, Calendar, Linkedin, Mail, Zap, DollarSign, Bot } from 'lucide-react';

interface Props {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  isOpen?: boolean;
  onToggle?: () => void;
}

export const Sidebar: React.FC<Props> = ({ currentView, onViewChange, isOpen = true, onToggle }) => {
  return (
    <div className={`${isOpen ? 'w-20 lg:w-64' : 'w-20'} bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col items-center lg:items-stretch py-8 h-screen sticky top-0 z-20`}>
      <div className="mb-10 flex items-center justify-center lg:justify-start lg:px-8 gap-3 cursor-pointer" onClick={() => onToggle?.()}>
        <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-white flex items-center justify-center text-white dark:text-slate-900 font-bold text-xl shadow-lg hover:shadow-xl transition-shadow">
          S
        </div>
        <div className="hidden lg:block">
          <h1 className="text-lg font-bold text-slate-800 dark:text-white leading-none">Smooth<span className="text-blue-500">AI</span></h1>
          <p className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase">Consulting OS</p>
        </div>
      </div>

      <nav className="flex-1 w-full space-y-2 px-2 lg:px-4">
        <SidebarItem 
            icon={<LayoutDashboard size={20} />} 
            label="Dashboard" 
            active={currentView === 'dashboard'} 
            onClick={() => onViewChange('dashboard')} 
        />
        <SidebarItem 
            icon={<Users size={20} />} 
            label="Prospects" 
            active={currentView === 'prospects'} 
            onClick={() => onViewChange('prospects')} 
        />
        <SidebarItem 
            icon={<DollarSign size={20} />} 
            label="Deals" 
            active={currentView === 'deals'} 
            onClick={() => onViewChange('deals')} 
        />
        <SidebarItem 
            icon={<Calendar size={20} />} 
            label="Calendar" 
            active={currentView === 'calendar'} 
            onClick={() => onViewChange('calendar')} 
        />
        <SidebarItem 
            icon={<Linkedin size={20} />} 
            label="LinkedIn" 
            active={currentView === 'linkedin'} 
            onClick={() => onViewChange('linkedin')} 
        />
        <SidebarItem 
            icon={<Mail size={20} />} 
            label="Inbox" 
            active={currentView === 'inbox'} 
            onClick={() => onViewChange('inbox')} 
        />
        <SidebarItem 
            icon={<ShieldCheck size={20} />} 
            label="Quality Control" 
            active={currentView === 'quality_control'} 
            onClick={() => onViewChange('quality_control')} 
        />
        <SidebarItem 
            icon={<BarChart3 size={20} />} 
            label="Analytics" 
            active={currentView === 'analytics'} 
            onClick={() => onViewChange('analytics')} 
        />
        <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800">
             <SidebarItem 
                icon={<Bot size={20} />} 
                label="Agents" 
                active={currentView === 'agents'} 
                onClick={() => onViewChange('agents')} 
            />
             <SidebarItem 
                icon={<Zap size={20} />} 
                label="Automation" 
                active={currentView === 'system_status'} 
                onClick={() => onViewChange('system_status')} 
            />
             <SidebarItem 
                icon={<Activity size={20} />} 
                label="Debug Logs" 
                active={currentView === 'debug'} 
                onClick={() => onViewChange('debug')} 
            />
        </div>
      </nav>

      <div className="p-4">
        <SidebarItem 
            icon={<Settings size={20} />} 
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
    className={`w-full flex items-center justify-center lg:justify-start gap-3 p-3 rounded-2xl transition-all duration-200 group ${active ? 'bg-slate-900 text-white shadow-md dark:bg-slate-800' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'}`}
  >
    <div className={`${active ? 'text-white' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200'}`}>
      {icon}
    </div>
    <span className="hidden lg:block font-medium text-sm">{label}</span>
  </button>
);
