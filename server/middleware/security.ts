import type {Request, Response, NextFunction, ErrorRequestHandler} from 'express';
import {randomUUID} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {getAppUrl} from '../config';

function storageOrigin(env: NodeJS.ProcessEnv): string[] {
  if (env.STORAGE_PROVIDER === 'supabase' && env.SUPABASE_S3_ENDPOINT) {
    try {
      const url = new URL(env.SUPABASE_S3_ENDPOINT);
      if (url.protocol === 'https:' && /^[a-z0-9-]+\.(storage\.)?supabase\.co$/.test(url.hostname) && !url.port) return [url.origin];
    } catch { /* An invalid storage configuration grants no browser access. */ }
  }
  return /^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID || '') ? [`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`] : [];
}

export function securityHeaders(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const storage = storageOrigin(env).join(' ');
  const csp = [
    "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
    `script-src 'self'${production ? '' : " 'unsafe-inline' 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${storage}${production ? '' : ' ws: wss:'}`,
    `media-src 'self' blob: ${storage}`, `frame-src 'self' blob: ${storage}`, "worker-src 'self' blob:",
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return (_req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.set({
      'X-Request-ID': requestId,
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
      'X-Permitted-Cross-Domain-Policies': 'none',
    });
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}

// Session cookies must never authorize a write initiated by another origin,
// including a sibling subdomain. Native clients without cookies may use bearer tokens.
export function sameOriginWrites(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const expected = getAppUrl() || (process.env.NODE_ENV !== 'production' ? `${req.protocol}://${req.get('host')}` : undefined);
  const origin = req.get('origin'), site = req.get('sec-fetch-site');
  const denied = () => res.status(403).json({message: 'Cross-origin request denied'});
  if (!expected || (origin !== undefined && origin !== expected)) return denied();
  if (site && !['same-origin', 'none'].includes(site)) return denied();
  const hasSessionCookie = /(?:^|;\s*)(?:accessToken|refreshToken)=/.test(req.get('cookie') || '');
  if (!origin && hasSessionCookie && site !== 'same-origin') {
    try { if (new URL(req.get('referer') || '').origin !== expected) return denied(); }
    catch { return denied(); }
  }
  return next();
}

export function privateApiResponses(_req: Request, res: Response, next: NextFunction) {
  res.set({'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Expires': '0'});
  // Older handlers sometimes include database errors in JSON. Never expose a
  // server failure's query, driver detail or stack in an API response.
  const json = res.json.bind(res);
  res.json = body => json(res.statusCode >= 500 ? {message: 'The request could not be completed. Please try again.', requestId: res.locals.requestId} : body);
  next();
}

export const apiRateLimit = rateLimit({windowMs: 60_000, limit: 900, standardHeaders: 'draft-8', legacyHeaders: false,
  message: {message: 'Too many requests. Please wait a moment and try again.'}});
export const loginRateLimit = rateLimit({windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  message: {message: 'Too many sign-in attempts. Please try again later.'}});
export const credentialRateLimit = rateLimit({windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: {message: 'Too many password requests. Please try again later.'}});

// Applied only after authentication and before any in-memory multipart parser.
export function uploadCapacity(maximum = 2) {
  let active = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.is('multipart/form-data')) return next();
    if (active >= maximum) { res.set('Retry-After', '10'); return res.status(503).json({message: 'Uploads are busy. Please try again shortly.'}); }
    active++;
    let released = false;
    const release = () => { if (!released) { active--; released = true; } };
    res.once('finish', release); res.once('close', release);
    next();
  };
}

export const requestError: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error?.type === 'entity.too.large' || error?.code === 'LIMIT_FILE_SIZE') return void res.status(413).json({message: 'The uploaded content is too large.'});
  if (error?.type === 'entity.parse.failed' || error instanceof URIError) return void res.status(400).json({message: 'Malformed request.'});
  if (error?.name === 'MulterError') return void res.status(400).json({message: 'Invalid upload fields.'});
  const status = Number(error?.status || error?.statusCode);
  if (status === 415) return void res.status(415).json({message: 'Unsupported request encoding.'});
  console.error('Request failed', {requestId: res.locals.requestId});
  res.status(500).json({message: 'The request could not be completed.', requestId: res.locals.requestId});
};
