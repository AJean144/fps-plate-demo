const rateLimit = require('express-rate-limit');

// General API rate limiter: 100 requests per minute per API key
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: {
    error: 'Rate limit exceeded',
    message: 'Too many requests. Please try again later.',
    retryAfter: '60 seconds',
  },
  keyGenerator: (req) => {
    // Rate limit by API key (primary), falls back to a safe default
    return req.headers['x-api-key'] || 'anonymous';
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Stricter limiter for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    error: 'Rate limit exceeded',
    message: 'Too many lookup requests. Limit: 30/minute.',
  },
  keyGenerator: (req) => req.headers['x-api-key'] || 'anonymous',
  validate: { xForwardedForHeader: false },
});

module.exports = { apiLimiter, strictLimiter };
