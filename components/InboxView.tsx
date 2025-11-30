import React, { useState, useEffect } from 'react';
import { Lead, InboxEmail } from '../types';
import { RefreshCw, Mail, MailOpen, Link, ExternalLink, X, ChevronLeft, ChevronRight, Send } from 'lucide-react';

interface Props {
  leads: Lead[];
}

type FilterType = 'all' | 'unread' | 'linked' | 'unlinked';
type EmailType = 'received' | 'sent';

export const InboxView: React.FC<Props> = ({ leads }) => {
  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<InboxEmail | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [emailType, setEmailType] = useState<EmailType>('received');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [linkingEmailId, setLinkingEmailId] = useState<number | null>(null);
  const [error, setError] = useState<string>('');

  const fetchEmails = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        type: emailType,
      });
      if (filter !== 'all' && emailType === 'received') {
        params.append('filter', filter);
      }
      const res = await fetch(`/api/inbox?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEmails(data.emails || []);
        setTotalPages(data.pagination?.pages || 1);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to fetch emails');
      }
    } catch (e: any) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const res = await fetch('/api/imap/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        await fetchEmails();
      } else {
        setError(data.error || 'Sync failed');
      }
    } catch (e: any) {
      setError('Sync failed: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleLinkEmail = async (emailId: number, leadId: string) => {
    try {
      const res = await fetch(`/api/inbox/${emailId}/link/${leadId}`, { method: 'POST' });
      if (res.ok) {
        await fetchEmails();
        if (selectedEmail?.id === emailId) {
          const lead = leads.find(l => l.id === leadId);
          setSelectedEmail({ ...selectedEmail, leadId: parseInt(leadId), leadName: lead?.companyName });
        }
      }
    } catch (e: any) {
      setError('Failed to link email');
    } finally {
      setLinkingEmailId(null);
    }
  };

  const fetchEmailDetails = async (id: number | string) => {
    try {
      const res = await fetch(`/api/inbox/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedEmail(data);
      }
    } catch (e) {
      console.error('Failed to fetch email details');
    }
  };

  useEffect(() => {
    setPage(1);
    setSelectedEmail(null);
  }, [emailType]);

  useEffect(() => {
    fetchEmails();
  }, [page, filter, emailType]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const extractName = (from?: string) => {
    if (!from) return 'Unknown';
    const match = from.match(/^"?([^"<]+)"?\s*</);
    if (match) return match[1].trim();
    return from.split('@')[0] || 'Unknown';
  };

  return (
    <div className="flex flex-col h-full animate-fadeIn">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Inbox</h1>
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              {(['received', 'sent'] as EmailType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setEmailType(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                    emailType === t
                      ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {t === 'received' ? <Mail size={14} /> : <Send size={14} />}
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {emailType === 'received' && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                syncing
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-slate-900 dark:bg-slate-700 text-white hover:bg-slate-800'
              }`}
            >
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync Inbox'}
            </button>
          )}
        </div>
        {emailType === 'received' && (
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
            {(['all', 'unread', 'linked', 'unlinked'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(1); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  filter === f
                    ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex-1 flex gap-4 min-h-0">
        <div className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden ${selectedEmail ? 'w-1/2' : 'w-full'}`}>
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <RefreshCw size={24} className="animate-spin" />
            </div>
          ) : emails.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
              <Mail size={48} className="mb-4 opacity-50" />
              <p className="text-sm font-medium">No emails found</p>
              <p className="text-xs mt-1">Click "Sync Inbox" to fetch emails from your mailbox</p>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {emails.map((email) => (
                  <div
                    key={email.id}
                    onClick={() => fetchEmailDetails(email.id)}
                    className={`p-4 cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                      selectedEmail?.id === email.id ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500' : ''
                    } ${!email.isRead ? 'bg-slate-50/50 dark:bg-slate-800/30' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-1">
                        {emailType === 'sent' ? (
                          <Send size={16} className="text-slate-400" />
                        ) : email.isRead ? (
                          <MailOpen size={16} className="text-slate-400" />
                        ) : (
                          <Mail size={16} className="text-blue-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className={`text-sm truncate ${!email.isRead ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                            {extractName(email.from)}
                          </span>
                          <span className="text-xs text-slate-400 flex-shrink-0">
                            {formatDate(email.date)}
                          </span>
                        </div>
                        <p className={`text-sm truncate ${!email.isRead ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-600 dark:text-slate-400'}`}>
                          {email.subject || '(No subject)'}
                        </p>
                        {email.leadName && (
                          <div className="mt-2 flex items-center gap-1">
                            <Link size={12} className="text-green-500" />
                            <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                              {email.leadName}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs text-slate-500">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {selectedEmail && (
          <div className="w-1/2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 dark:text-white truncate flex-1">
                {selectedEmail.subject || '(No subject)'}
              </h3>
              <button
                onClick={() => setSelectedEmail(null)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 w-12">From:</span>
                <span className="text-sm text-slate-700 dark:text-slate-300">{selectedEmail.from || 'Unknown'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 w-12">To:</span>
                <span className="text-sm text-slate-700 dark:text-slate-300">{selectedEmail.to || 'Unknown'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 w-12">Date:</span>
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {new Date(selectedEmail.date).toLocaleString()}
                </span>
              </div>
              
              <div className="pt-2 flex items-center gap-2">
                {selectedEmail.leadName ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/30 rounded-lg border border-green-200 dark:border-green-800">
                    <Link size={14} className="text-green-500" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">
                      Linked to: {selectedEmail.leadName}
                    </span>
                  </div>
                ) : linkingEmailId === selectedEmail.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <select
                      className="flex-1 text-sm border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-800"
                      onChange={(e) => {
                        if (e.target.value) {
                          handleLinkEmail(selectedEmail.id, e.target.value);
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>Select a lead...</option>
                      {leads.map((lead) => (
                        <option key={lead.id} value={lead.id}>
                          {lead.companyName}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setLinkingEmailId(null)}
                      className="p-2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setLinkingEmailId(selectedEmail.id)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Link size={14} />
                    Link to Lead
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div
                className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300"
                dangerouslySetInnerHTML={{ __html: selectedEmail.body || '<p class="text-slate-400 italic">No content</p>' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
