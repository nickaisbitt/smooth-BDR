import React, { useState } from 'react';
import { Lead, LeadStatus, Activity, Note, Contact, Industry, CompanySize, ActivityType } from '../types';
import { v4 as uuidv4 } from 'uuid';
import {
  X,
  ExternalLink,
  DollarSign,
  Calendar,
  Building2,
  Users,
  MapPin,
  Phone,
  Mail,
  Clock,
  FileText,
  Plus,
  Edit2,
  Trash2,
  Check,
  Linkedin,
  MessageSquare,
  Video,
  CheckCircle2,
  Star
} from 'lucide-react';

interface Props {
  lead: Lead;
  onUpdate: (updatedLead: Lead) => void;
  onClose: () => void;
}

export const LeadDetailView: React.FC<Props> = ({ lead, onUpdate, onClose }) => {
  const [formData, setFormData] = useState({
    dealValue: lead.dealValue || 0,
    probability: lead.probability || 0,
    expectedCloseDate: lead.expectedCloseDate || Date.now(),
    industry: lead.industry,
    companySize: lead.companySize,
    location: lead.location || '',
  });

  const [contacts, setContacts] = useState<Contact[]>(lead.contacts || []);
  const [activities, setActivities] = useState<Activity[]>(lead.activities || []);
  const [notes, setNotes] = useState<Note[]>(lead.notes || []);

  const [newNote, setNewNote] = useState('');
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showActivityForm, setShowActivityForm] = useState(false);

  const [contactForm, setContactForm] = useState<Partial<Contact>>({
    name: '',
    role: '',
    email: '',
    phone: '',
    linkedinUrl: '',
    isPrimary: false,
  });

  const [activityForm, setActivityForm] = useState<Partial<Activity>>({
    type: 'call',
    title: '',
    description: '',
    date: Date.now(),
    duration: 30,
    outcome: '',
  });

  const industryOptions: Industry[] = ['Technology', 'Healthcare', 'Finance', 'Retail', 'Manufacturing', 'Education', 'Real Estate', 'Consulting', 'Marketing', 'Legal', 'Other'];
  const companySizeOptions: CompanySize[] = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
  const activityTypes: ActivityType[] = ['call', 'meeting', 'email', 'note', 'task'];

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    const updatedLead = {
      ...lead,
      [field]: value,
      lastUpdated: Date.now(),
    };
    onUpdate(updatedLead);
  };

  const handleSaveAll = () => {
    onUpdate({
      ...lead,
      ...formData,
      contacts,
      activities,
      notes,
      lastUpdated: Date.now(),
    });
    onClose();
  };

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    const note: Note = {
      id: uuidv4(),
      leadId: lead.id,
      content: newNote,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updatedNotes = [note, ...notes];
    setNotes(updatedNotes);
    setNewNote('');
    onUpdate({
      ...lead,
      ...formData,
      contacts,
      activities,
      notes: updatedNotes,
      lastUpdated: Date.now(),
    });
  };

  const handleAddContact = () => {
    if (!contactForm.name?.trim()) return;
    const newContact: Contact = {
      id: uuidv4(),
      name: contactForm.name || '',
      role: contactForm.role || '',
      email: contactForm.email,
      phone: contactForm.phone,
      linkedinUrl: contactForm.linkedinUrl,
      isPrimary: contactForm.isPrimary || false,
    };
    const updatedContacts = [...contacts, newContact];
    setContacts(updatedContacts);
    setContactForm({ name: '', role: '', email: '', phone: '', linkedinUrl: '', isPrimary: false });
    setShowContactForm(false);
    onUpdate({
      ...lead,
      ...formData,
      contacts: updatedContacts,
      activities,
      notes,
      lastUpdated: Date.now(),
    });
  };

  const handleEditContact = () => {
    if (!editingContact || !contactForm.name?.trim()) return;
    const updatedContacts = contacts.map(c => 
      c.id === editingContact.id 
        ? { ...c, ...contactForm, id: c.id } as Contact
        : c
    );
    setContacts(updatedContacts);
    setEditingContact(null);
    setContactForm({ name: '', role: '', email: '', phone: '', linkedinUrl: '', isPrimary: false });
    setShowContactForm(false);
    onUpdate({
      ...lead,
      ...formData,
      contacts: updatedContacts,
      activities,
      notes,
      lastUpdated: Date.now(),
    });
  };

  const handleDeleteContact = (contactId: string) => {
    const updatedContacts = contacts.filter(c => c.id !== contactId);
    setContacts(updatedContacts);
    onUpdate({
      ...lead,
      ...formData,
      contacts: updatedContacts,
      activities,
      notes,
      lastUpdated: Date.now(),
    });
  };

  const startEditContact = (contact: Contact) => {
    setEditingContact(contact);
    setContactForm({
      name: contact.name,
      role: contact.role,
      email: contact.email,
      phone: contact.phone,
      linkedinUrl: contact.linkedinUrl,
      isPrimary: contact.isPrimary,
    });
    setShowContactForm(true);
  };

  const handleAddActivity = () => {
    if (!activityForm.title?.trim()) return;
    const newActivity: Activity = {
      id: uuidv4(),
      leadId: lead.id,
      type: activityForm.type as ActivityType || 'call',
      title: activityForm.title || '',
      description: activityForm.description || '',
      date: activityForm.date || Date.now(),
      duration: activityForm.duration,
      outcome: activityForm.outcome,
      createdAt: Date.now(),
    };
    const updatedActivities = [newActivity, ...activities];
    setActivities(updatedActivities);
    setActivityForm({ type: 'call', title: '', description: '', date: Date.now(), duration: 30, outcome: '' });
    setShowActivityForm(false);
    onUpdate({
      ...lead,
      ...formData,
      contacts,
      activities: updatedActivities,
      notes,
      lastUpdated: Date.now(),
    });
  };

  const formatDateForInput = (timestamp: number) => {
    return new Date(timestamp).toISOString().split('T')[0];
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getActivityIcon = (type: ActivityType) => {
    switch (type) {
      case 'call': return <Phone size={14} className="text-blue-500" />;
      case 'meeting': return <Video size={14} className="text-purple-500" />;
      case 'email': return <Mail size={14} className="text-green-500" />;
      case 'note': return <FileText size={14} className="text-yellow-500" />;
      case 'task': return <CheckCircle2 size={14} className="text-orange-500" />;
      default: return <Clock size={14} className="text-slate-400" />;
    }
  };

  const getStatusColor = (status: LeadStatus) => {
    const colors: Record<LeadStatus, string> = {
      [LeadStatus.NEW]: 'bg-slate-100 text-slate-600 border-slate-200',
      [LeadStatus.ANALYZING]: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      [LeadStatus.QUALIFIED]: 'bg-green-100 text-green-700 border-green-200',
      [LeadStatus.UNQUALIFIED]: 'bg-red-100 text-red-700 border-red-200',
      [LeadStatus.CONTACTED]: 'bg-blue-100 text-blue-700 border-blue-200',
      [LeadStatus.OPENED]: 'bg-purple-100 text-purple-700 border-purple-200',
      [LeadStatus.MEETING_SCHEDULED]: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      [LeadStatus.PROPOSAL_SENT]: 'bg-cyan-100 text-cyan-700 border-cyan-200',
      [LeadStatus.NEGOTIATION]: 'bg-orange-100 text-orange-700 border-orange-200',
      [LeadStatus.WON]: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      [LeadStatus.LOST]: 'bg-rose-100 text-rose-700 border-rose-200',
      [LeadStatus.ARCHIVED]: 'bg-gray-100 text-gray-500 border-gray-200',
    };
    return colors[status] || 'bg-slate-100 text-slate-600 border-slate-200';
  };

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />
      
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 overflow-hidden flex flex-col animate-slideIn">
        <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-xl font-bold text-slate-600 uppercase shadow-sm">
              {lead.companyName.substring(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-800">{lead.companyName}</h2>
                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${getStatusColor(lead.status)}`}>
                  {lead.status.replace(/_/g, ' ')}
                </span>
              </div>
              <a 
                href={lead.website} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-sm text-blue-500 hover:underline flex items-center gap-1"
              >
                {lead.website}
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <DollarSign size={16} className="text-slate-400" />
              Deal Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Deal Value</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <input
                    type="number"
                    value={formData.dealValue}
                    onChange={(e) => handleInputChange('dealValue', parseFloat(e.target.value) || 0)}
                    className="w-full border border-slate-200 rounded-lg p-2.5 pl-7 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    min="0"
                    step="100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Probability: {formData.probability}%
                </label>
                <input
                  type="range"
                  value={formData.probability}
                  onChange={(e) => handleInputChange('probability', parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  min="0"
                  max="100"
                />
                <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${formData.probability > 70 ? 'bg-green-500' : formData.probability > 30 ? 'bg-yellow-400' : 'bg-red-400'}`}
                    style={{ width: `${formData.probability}%` }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
                  <Calendar size={12} />
                  Expected Close Date
                </label>
                <input
                  type="date"
                  value={formatDateForInput(formData.expectedCloseDate)}
                  onChange={(e) => handleInputChange('expectedCloseDate', new Date(e.target.value).getTime())}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
                  <Building2 size={12} />
                  Industry
                </label>
                <select
                  value={formData.industry || ''}
                  onChange={(e) => handleInputChange('industry', e.target.value || undefined)}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                >
                  <option value="">Select Industry</option>
                  {industryOptions.map(industry => (
                    <option key={industry} value={industry}>{industry}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
                  <Users size={12} />
                  Company Size
                </label>
                <select
                  value={formData.companySize || ''}
                  onChange={(e) => handleInputChange('companySize', e.target.value || undefined)}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                >
                  <option value="">Select Size</option>
                  {companySizeOptions.map(size => (
                    <option key={size} value={size}>{size} employees</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
                  <MapPin size={12} />
                  Location
                </label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => handleInputChange('location', e.target.value)}
                  placeholder="City, Country"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <Users size={16} className="text-slate-400" />
                Contacts
              </h3>
              <button 
                onClick={() => {
                  setEditingContact(null);
                  setContactForm({ name: '', role: '', email: '', phone: '', linkedinUrl: '', isPrimary: false });
                  setShowContactForm(true);
                }}
                className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors"
              >
                <Plus size={14} />
                Add Contact
              </button>
            </div>

            {showContactForm && (
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 mb-4">
                <h4 className="text-sm font-semibold text-slate-700 mb-3">
                  {editingContact ? 'Edit Contact' : 'New Contact'}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={contactForm.name || ''}
                    onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                    placeholder="Name *"
                    className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <input
                    type="text"
                    value={contactForm.role || ''}
                    onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                    placeholder="Role / Title"
                    className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <input
                    type="email"
                    value={contactForm.email || ''}
                    onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                    placeholder="Email"
                    className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <input
                    type="tel"
                    value={contactForm.phone || ''}
                    onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                    placeholder="Phone"
                    className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <input
                    type="url"
                    value={contactForm.linkedinUrl || ''}
                    onChange={(e) => setContactForm({ ...contactForm, linkedinUrl: e.target.value })}
                    placeholder="LinkedIn URL"
                    className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none md:col-span-2"
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={contactForm.isPrimary || false}
                      onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <Star size={14} className="text-yellow-500" />
                    Primary Contact
                  </label>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => {
                      setShowContactForm(false);
                      setEditingContact(null);
                      setContactForm({ name: '', role: '', email: '', phone: '', linkedinUrl: '', isPrimary: false });
                    }}
                    className="flex-1 py-2 text-sm font-bold text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={editingContact ? handleEditContact : handleAddContact}
                    className="flex-1 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-1"
                  >
                    <Check size={14} />
                    {editingContact ? 'Save Changes' : 'Add Contact'}
                  </button>
                </div>
              </div>
            )}

            {contacts.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Users size={40} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">No contacts added yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {contacts.map(contact => (
                  <div key={contact.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100 hover:border-slate-200 transition-colors group">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-sm font-bold text-slate-600 uppercase">
                      {contact.name.substring(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800">{contact.name}</p>
                        {contact.isPrimary && (
                          <span className="flex items-center gap-0.5 text-[9px] font-bold bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded uppercase">
                            <Star size={10} />
                            Primary
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">{contact.role}</p>
                      {contact.email && (
                        <a href={`mailto:${contact.email}`} className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                          <Mail size={10} />
                          {contact.email}
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {contact.phone && (
                        <a href={`tel:${contact.phone}`} className="p-1.5 text-slate-400 hover:text-slate-600 bg-white rounded border border-slate-200">
                          <Phone size={14} />
                        </a>
                      )}
                      {contact.linkedinUrl && (
                        <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-blue-500 hover:text-blue-600 bg-white rounded border border-slate-200">
                          <Linkedin size={14} />
                        </a>
                      )}
                      <button
                        onClick={() => startEditContact(contact)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 bg-white rounded border border-slate-200"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteContact(contact.id)}
                        className="p-1.5 text-red-400 hover:text-red-600 bg-white rounded border border-slate-200"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <Clock size={16} className="text-slate-400" />
                Activities Timeline
              </h3>
              <button 
                onClick={() => setShowActivityForm(true)}
                className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors"
              >
                <Plus size={14} />
                Add Activity
              </button>
            </div>

            {showActivityForm && (
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 mb-4">
                <h4 className="text-sm font-semibold text-slate-700 mb-3">New Activity</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
                    <select
                      value={activityForm.type}
                      onChange={(e) => setActivityForm({ ...activityForm, type: e.target.value as ActivityType })}
                      className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      {activityTypes.map(type => (
                        <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={activityForm.title || ''}
                    onChange={(e) => setActivityForm({ ...activityForm, title: e.target.value })}
                    placeholder="Title *"
                    className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <textarea
                    value={activityForm.description || ''}
                    onChange={(e) => setActivityForm({ ...activityForm, description: e.target.value })}
                    placeholder="Description"
                    rows={2}
                    className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none md:col-span-2 resize-none"
                  />
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
                    <input
                      type="date"
                      value={formatDateForInput(activityForm.date || Date.now())}
                      onChange={(e) => setActivityForm({ ...activityForm, date: new Date(e.target.value).getTime() })}
                      className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Duration (minutes)</label>
                    <input
                      type="number"
                      value={activityForm.duration || ''}
                      onChange={(e) => setActivityForm({ ...activityForm, duration: parseInt(e.target.value) || undefined })}
                      placeholder="Duration"
                      min="0"
                      className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <input
                    type="text"
                    value={activityForm.outcome || ''}
                    onChange={(e) => setActivityForm({ ...activityForm, outcome: e.target.value })}
                    placeholder="Outcome / Result"
                    className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none md:col-span-2"
                  />
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => {
                      setShowActivityForm(false);
                      setActivityForm({ type: 'call', title: '', description: '', date: Date.now(), duration: 30, outcome: '' });
                    }}
                    className="flex-1 py-2 text-sm font-bold text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddActivity}
                    className="flex-1 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-1"
                  >
                    <Check size={14} />
                    Add Activity
                  </button>
                </div>
              </div>
            )}

            {activities.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Clock size={40} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">No activities recorded</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-slate-200"></div>
                <div className="space-y-4">
                  {activities.sort((a, b) => b.date - a.date).map(activity => (
                    <div key={activity.id} className="relative pl-10">
                      <div className="absolute left-1.5 w-6 h-6 bg-white border-2 border-slate-300 rounded-full flex items-center justify-center shadow-sm">
                        {getActivityIcon(activity.type)}
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 hover:border-slate-200 transition-colors">
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-slate-800">{activity.title}</p>
                              <span className="text-[10px] font-medium text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded">
                                {activity.type}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{activity.description}</p>
                          </div>
                          <span className="text-[10px] text-slate-400 shrink-0 bg-white px-2 py-0.5 rounded border border-slate-100">
                            {formatDate(activity.date)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          {activity.outcome && (
                            <p className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded inline-flex items-center gap-1 border border-green-100">
                              <CheckCircle2 size={12} />
                              {activity.outcome}
                            </p>
                          )}
                          {activity.duration && (
                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                              <Clock size={10} />
                              {activity.duration} min
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <MessageSquare size={16} className="text-slate-400" />
              Notes
            </h3>
            
            <div className="flex gap-2 mb-4">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a note..."
                rows={2}
                className="flex-1 border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none transition-all"
              />
              <button
                onClick={handleAddNote}
                disabled={!newNote.trim()}
                className="px-4 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed self-end transition-colors flex items-center gap-1"
              >
                <Plus size={14} />
                Add
              </button>
            </div>

            {notes.length === 0 ? (
              <div className="text-center py-6 text-slate-400">
                <MessageSquare size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">No notes yet</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {notes.map(note => (
                  <div key={note.id} className="bg-yellow-50 border border-yellow-100 rounded-lg p-3 hover:shadow-sm transition-shadow">
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.content}</p>
                    <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1">
                      <Clock size={10} />
                      {formatDate(note.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors shadow-sm"
          >
            Close
          </button>
          <button
            onClick={handleSaveAll}
            className="px-6 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2"
          >
            <Check size={16} />
            Save Changes
          </button>
        </div>
      </div>
    </>
  );
};
