/**
 * Cache Invalidation Hooks
 * Automatically invalidates cache entries when data mutations occur
 * Ensures cache stays fresh as the system processes emails, prospects, etc.
 */

import queryCache from './queryCache.js';

export const invalidationHooks = {
  // Invalidate metrics when emails are sent/modified
  onEmailSent: () => {
    queryCache.invalidatePattern(/^metrics:/);
    queryCache.invalidatePattern(/^engagement:/);
  },

  // Invalidate metrics when prospect status changes
  onProspectStatusChange: () => {
    queryCache.invalidatePattern(/^metrics:/);
    queryCache.invalidatePattern(/^agents:/);
  },

  // Invalidate when research is completed
  onResearchCompleted: () => {
    queryCache.invalidatePattern(/^metrics:/);
    queryCache.invalidatePattern(/^agents:/);
  },

  // Invalidate when draft is generated
  onDraftGenerated: () => {
    queryCache.invalidatePattern(/^metrics:/);
  },

  // Invalidate when email is reviewed/approved
  onEmailReviewed: () => {
    queryCache.invalidatePattern(/^metrics:/);
    queryCache.invalidatePattern(/^engagement:/);
  },

  // Invalidate when reply is received
  onReplyReceived: () => {
    queryCache.invalidatePattern(/^metrics:/);
    queryCache.invalidatePattern(/^engagement:/);
  },

  // Global invalidation for major state changes
  invalidateAll: () => {
    queryCache.clear();
  }
};

export default invalidationHooks;
