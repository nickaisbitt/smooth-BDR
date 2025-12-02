/**
 * Express Middleware for Idempotent Request Handling
 * Automatically deduplicates concurrent identical requests
 * Prevents double-sends, duplicate lead creation, etc.
 */

import deduplicator from '../services/requestDeduplication.js';

/**
 * Idempotency middleware factory
 * @param {object} options - Configuration options
 * @returns {function} Express middleware
 */
export function idempotencyMiddleware(options = {}) {
  const {
    enabledPaths = [
      '/api/send-email',
      '/api/automation/send-queued',
      '/api/automation/approve-email',
      '/api/automation/queue-email',
      '/api/agents/prospect',
      '/api/automation/process-replies'
    ],
    ttlMs = 30000,
    waitForPending = true
  } = options;

  return async (req, res, next) => {
    // Only apply to POST/PUT requests
    if (!['POST', 'PUT'].includes(req.method)) {
      return next();
    }

    // Only apply to enabled paths
    const isEnabledPath = enabledPaths.some(path => req.path.includes(path));
    if (!isEnabledPath) {
      return next();
    }

    try {
      const fingerprint = deduplicator.generateFingerprint(
        req.method,
        req.path,
        req.body
      );

      // Check for cached response
      const cached = deduplicator.getCachedResponse(fingerprint);

      if (cached) {
        if (cached.isPending && waitForPending) {
          // Wait for concurrent request to complete
          const response = await deduplicator.waitForProcessing(fingerprint);
          if (response) {
            return res.json({
              ...response,
              isDuplicate: true,
              cachedAt: new Date().toISOString()
            });
          }
        } else if (!cached.isPending) {
          // Return cached response from recent identical request
          return res.json({
            ...cached,
            isDuplicate: true,
            cachedAt: new Date().toISOString()
          });
        }
      }

      // Mark as processing
      deduplicator.markProcessing(fingerprint);

      // Override res.json to cache response
      const originalJson = res.json.bind(res);
      res.json = function(data) {
        deduplicator.cacheResponse(fingerprint, data, ttlMs);
        return originalJson(data);
      };

      // Store fingerprint for cleanup
      req.deduplicationFingerprint = fingerprint;

      next();
    } catch (error) {
      console.error('Idempotency middleware error:', error);
      next();
    }
  };
}

/**
 * Extract idempotency key from request headers
 * Useful for clients that want explicit control
 */
export function getIdempotencyKey(req) {
  return (
    req.headers['idempotency-key'] ||
    req.headers['x-idempotency-key'] ||
    req.headers['x-request-id']
  );
}

export default idempotencyMiddleware;
