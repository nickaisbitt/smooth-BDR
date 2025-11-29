import React, { useState, useMemo, DragEvent } from 'react';
import { Lead, LeadStatus } from '../types';
import { DollarSign, TrendingUp, TrendingDown, Calculator, Building2, Calendar, User, GripVertical } from 'lucide-react';

interface Props {
  leads: Lead[];
  onUpdateLead: (lead: Lead) => void;
  onSelectLead: (lead: Lead) => void;
}

const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

const isCurrentMonth = (timestamp?: number): boolean => {
  if (!timestamp) return false;
  const date = new Date(timestamp);
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
};

interface KanbanColumn {
  status: LeadStatus;
  label: string;
  color: string;
  textColor: string;
  borderColor: string;
}

const KANBAN_COLUMNS: KanbanColumn[] = [
  { status: LeadStatus.QUALIFIED, label: 'Qualified', color: 'bg-green-50', textColor: 'text-green-700', borderColor: 'border-green-200' },
  { status: LeadStatus.CONTACTED, label: 'Contacted', color: 'bg-blue-50', textColor: 'text-blue-700', borderColor: 'border-blue-200' },
  { status: LeadStatus.MEETING_SCHEDULED, label: 'Meeting Scheduled', color: 'bg-purple-50', textColor: 'text-purple-700', borderColor: 'border-purple-200' },
  { status: LeadStatus.PROPOSAL_SENT, label: 'Proposal Sent', color: 'bg-indigo-50', textColor: 'text-indigo-700', borderColor: 'border-indigo-200' },
  { status: LeadStatus.NEGOTIATION, label: 'Negotiation', color: 'bg-orange-50', textColor: 'text-orange-700', borderColor: 'border-orange-200' },
  { status: LeadStatus.WON, label: 'Won', color: 'bg-emerald-50', textColor: 'text-emerald-700', borderColor: 'border-emerald-200' },
  { status: LeadStatus.LOST, label: 'Lost', color: 'bg-red-50', textColor: 'text-red-700', borderColor: 'border-red-200' },
];

const PIPELINE_STAGES = [
  LeadStatus.QUALIFIED,
  LeadStatus.CONTACTED,
  LeadStatus.MEETING_SCHEDULED,
  LeadStatus.PROPOSAL_SENT,
  LeadStatus.NEGOTIATION
];

export const DealsView: React.FC<Props> = ({ leads, onUpdateLead, onSelectLead }) => {
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<LeadStatus | null>(null);

  const totalPipelineValue = useMemo(() => {
    return leads
      .filter(l => PIPELINE_STAGES.includes(l.status))
      .reduce((sum, l) => sum + ((l.dealValue || 0) * (l.probability || 0) / 100), 0);
  }, [leads]);

  const wonThisMonth = useMemo(() => {
    return leads
      .filter(l => l.status === LeadStatus.WON && isCurrentMonth(l.wonLostDate))
      .reduce((sum, l) => sum + (l.actualRevenue || 0), 0);
  }, [leads]);

  const lostThisMonth = useMemo(() => {
    return leads
      .filter(l => l.status === LeadStatus.LOST && isCurrentMonth(l.wonLostDate))
      .length;
  }, [leads]);

  const averageDealSize = useMemo(() => {
    const leadsWithDealValue = leads.filter(l => l.dealValue !== undefined && l.dealValue > 0);
    if (leadsWithDealValue.length === 0) return 0;
    const total = leadsWithDealValue.reduce((sum, l) => sum + (l.dealValue || 0), 0);
    return total / leadsWithDealValue.length;
  }, [leads]);

  const getLeadsForColumn = (status: LeadStatus): Lead[] => {
    return leads.filter(l => l.status === status);
  };

  const getPrimaryContact = (lead: Lead): string | null => {
    if (!lead.contacts || lead.contacts.length === 0) return null;
    const primary = lead.contacts.find(c => c.isPrimary);
    return primary?.name || lead.contacts[0]?.name || null;
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, lead: Lead) => {
    setDraggedLeadId(lead.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', lead.id);
  };

  const handleDragEnd = () => {
    setDraggedLeadId(null);
    setDragOverColumn(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, status: LeadStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, newStatus: LeadStatus) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    const lead = leads.find(l => l.id === leadId);
    
    if (lead && lead.status !== newStatus) {
      const updatedLead: Lead = {
        ...lead,
        status: newStatus,
        lastUpdated: Date.now(),
        ...(newStatus === LeadStatus.WON || newStatus === LeadStatus.LOST 
          ? { wonLostDate: Date.now() } 
          : {})
      };
      onUpdateLead(updatedLead);
    }
    
    setDraggedLeadId(null);
    setDragOverColumn(null);
  };

  return (
    <div className="space-y-6 pb-10 h-full flex flex-col">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/20 rounded-full blur-2xl" />
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xs font-semibold text-slate-500 mb-1">Total Pipeline Value</h3>
              <div className="text-2xl font-bold text-blue-900 tracking-tight">{formatCurrency(totalPipelineValue)}</div>
              <div className="text-[10px] text-blue-600 mt-1">Weighted by probability</div>
            </div>
            <div className="p-2 bg-white/60 rounded-xl">
              <TrendingUp className="w-5 h-5 text-blue-600" />
            </div>
          </div>
        </div>
        
        <div className="bg-green-50 rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/20 rounded-full blur-2xl" />
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xs font-semibold text-slate-500 mb-1">Won This Month</h3>
              <div className="text-2xl font-bold text-green-900 tracking-tight">{formatCurrency(wonThisMonth)}</div>
              <div className="text-[10px] text-green-600 mt-1">Revenue closed</div>
            </div>
            <div className="p-2 bg-white/60 rounded-xl">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
          </div>
        </div>
        
        <div className="bg-red-50 rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/20 rounded-full blur-2xl" />
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xs font-semibold text-slate-500 mb-1">Lost This Month</h3>
              <div className="text-2xl font-bold text-red-900 tracking-tight">{lostThisMonth}</div>
              <div className="text-[10px] text-red-600 mt-1">Deals lost</div>
            </div>
            <div className="p-2 bg-white/60 rounded-xl">
              <TrendingDown className="w-5 h-5 text-red-600" />
            </div>
          </div>
        </div>
        
        <div className="bg-purple-50 rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/20 rounded-full blur-2xl" />
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xs font-semibold text-slate-500 mb-1">Average Deal Size</h3>
              <div className="text-2xl font-bold text-purple-900 tracking-tight">{formatCurrency(averageDealSize)}</div>
              <div className="text-[10px] text-purple-600 mt-1">Across all deals</div>
            </div>
            <div className="p-2 bg-white/60 rounded-xl">
              <Calculator className="w-5 h-5 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-max h-full">
          {KANBAN_COLUMNS.map(column => {
            const columnLeads = getLeadsForColumn(column.status);
            const columnValue = columnLeads.reduce((sum, l) => sum + (l.dealValue || 0), 0);
            const isDragOver = dragOverColumn === column.status;
            
            return (
              <div 
                key={column.status}
                className={`w-72 flex flex-col bg-slate-50/50 rounded-xl border transition-all ${
                  isDragOver 
                    ? `${column.borderColor} border-2 ring-2 ring-offset-2 ${column.borderColor.replace('border', 'ring')}` 
                    : 'border-slate-200/60'
                }`}
                onDragOver={(e) => handleDragOver(e, column.status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, column.status)}
              >
                <div className={`p-3 border-b border-slate-100 rounded-t-xl ${column.color}`}>
                  <div className="flex justify-between items-center mb-1">
                    <h3 className={`text-xs font-bold uppercase tracking-wider ${column.textColor}`}>
                      {column.label}
                    </h3>
                    <span className="text-[10px] font-bold bg-white/60 px-2 py-0.5 rounded-full">
                      {columnLeads.length}
                    </span>
                  </div>
                  <div className={`text-sm font-semibold ${column.textColor}`}>
                    {formatCurrency(columnValue)}
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[calc(100vh-320px)]">
                  {columnLeads.length === 0 && (
                    <div className={`text-center py-10 opacity-50 border-2 border-dashed rounded-lg ${
                      isDragOver ? column.borderColor : 'border-slate-200'
                    }`}>
                      <p className="text-[10px] uppercase font-bold text-slate-400">
                        {isDragOver ? 'Drop here' : 'No deals'}
                      </p>
                    </div>
                  )}
                  
                  {columnLeads.map(lead => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, lead)}
                      onDragEnd={handleDragEnd}
                      onClick={() => onSelectLead(lead)}
                      className={`bg-white p-3 rounded-lg border shadow-sm hover:shadow-md transition-all cursor-pointer group ${
                        draggedLeadId === lead.id 
                          ? 'opacity-50 border-blue-300 ring-2 ring-blue-200' 
                          : 'border-slate-200 hover:border-blue-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-xs shrink-0 uppercase">
                            {lead.companyName.substring(0, 1)}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-semibold text-sm text-slate-800 truncate" title={lead.companyName}>
                              {lead.companyName}
                            </h4>
                          </div>
                        </div>
                        <GripVertical className="w-4 h-4 text-slate-300 group-hover:text-slate-400 shrink-0 cursor-grab" />
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <DollarSign className="w-3.5 h-3.5 text-green-500" />
                          <span className="font-semibold text-slate-700">
                            {formatCurrency(lead.dealValue || 0)}
                          </span>
                          {lead.probability !== undefined && (
                            <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                              {lead.probability}%
                            </span>
                          )}
                        </div>
                        
                        {lead.expectedCloseDate && (
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span>{formatDate(lead.expectedCloseDate)}</span>
                          </div>
                        )}
                        
                        {getPrimaryContact(lead) && (
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            <span className="truncate">{getPrimaryContact(lead)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
