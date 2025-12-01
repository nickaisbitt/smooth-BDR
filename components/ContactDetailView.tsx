import React, { useState } from 'react';
import { Contact, Lead } from '../types';
import { X, Mail, Phone, Linkedin, ArrowLeft, Edit2, Check } from 'lucide-react';

interface Props {
  contact: Contact;
  lead: Lead;
  onClose: () => void;
  onUpdate?: (contact: Contact) => void;
  onViewCompany?: (lead: Lead) => void;
}

export const ContactDetailView: React.FC<Props> = ({ contact, lead, onClose, onUpdate, onViewCompany }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(contact);

  const handleSave = () => {
    if (onUpdate) {
      onUpdate(editForm);
    }
    setIsEditing(false);
  };

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-900 to-purple-800 text-white p-6 border-b border-purple-700 rounded-t-2xl flex justify-between items-start flex-shrink-0">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <button 
                onClick={onClose}
                className="text-purple-200 hover:text-white transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
              <h2 className="text-2xl font-bold">{contact.name}</h2>
            </div>
            <p className="text-purple-100">{contact.role}</p>
            {contact.isPrimary && (
              <span className="inline-block mt-2 px-2 py-1 bg-purple-600 text-white text-xs font-bold rounded">
                Primary Contact
              </span>
            )}
          </div>
          {!isEditing && (
            <button 
              onClick={() => setIsEditing(true)}
              className="text-purple-200 hover:text-white transition-colors p-2 rounded hover:bg-purple-700"
              title="Edit"
            >
              <Edit2 className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          {/* Company Link */}
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Company</p>
            <button
              onClick={() => onViewCompany?.(lead)}
              className="text-base font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              {lead.companyName}
            </button>
          </div>

          {/* Contact Information */}
          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">Name</label>
                <input 
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">Role</label>
                <input 
                  type="text"
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">Email</label>
                <input 
                  type="email"
                  value={editForm.email || ''}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                  placeholder="email@example.com"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">Phone</label>
                <input 
                  type="tel"
                  value={editForm.phone || ''}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                  placeholder="+1 (555) 000-0000"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">LinkedIn URL</label>
                <input 
                  type="url"
                  value={editForm.linkedinUrl || ''}
                  onChange={(e) => setEditForm({ ...editForm, linkedinUrl: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                  placeholder="https://linkedin.com/in/..."
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox"
                  checked={editForm.isPrimary}
                  onChange={(e) => setEditForm({ ...editForm, isPrimary: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-200"
                />
                <span className="text-sm font-semibold text-slate-700">Mark as Primary Contact</span>
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              {contact.email && (
                <a 
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors group"
                >
                  <Mail className="w-5 h-5 text-blue-600 group-hover:text-blue-700" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-blue-600 uppercase tracking-wide">Email</p>
                    <p className="text-sm font-semibold text-blue-900">{contact.email}</p>
                  </div>
                </a>
              )}

              {contact.phone && (
                <a 
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200 hover:bg-green-100 transition-colors group"
                >
                  <Phone className="w-5 h-5 text-green-600 group-hover:text-green-700" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-green-600 uppercase tracking-wide">Phone</p>
                    <p className="text-sm font-semibold text-green-900">{contact.phone}</p>
                  </div>
                </a>
              )}

              {contact.linkedinUrl && (
                <a 
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 bg-indigo-50 rounded-lg border border-indigo-200 hover:bg-indigo-100 transition-colors group"
                >
                  <Linkedin className="w-5 h-5 text-indigo-600 group-hover:text-indigo-700" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide">LinkedIn</p>
                    <p className="text-sm font-semibold text-indigo-900">View Profile</p>
                  </div>
                </a>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 p-4 rounded-b-2xl flex justify-end gap-2 flex-shrink-0">
          {isEditing ? (
            <>
              <button 
                onClick={() => {
                  setEditForm(contact);
                  setIsEditing(false);
                }}
                className="px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSave}
                className="px-4 py-2 text-sm font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                Save Changes
              </button>
            </>
          ) : (
            <button 
              onClick={onClose}
              className="px-6 py-2 text-sm font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
