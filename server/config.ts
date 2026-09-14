export function getAppUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // Render supplies its assigned HTTPS origin; an explicit custom domain takes precedence.
  const configured = env.APP_URL?.trim() || (env.RENDER === 'true' ? env.RENDER_EXTERNAL_URL?.trim() : undefined);
  if (!configured) return undefined;
  let url: URL;
  try { url = new URL(configured); }
  catch { throw new Error('APP_URL must be an absolute HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('APP_URL must be an HTTP(S) origin without credentials, a path, query, or fragment');
  }
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('APP_URL must use HTTPS in production');
  return url.origin;
}

export function validateAppConfiguration() {
  if (!getAppUrl() && process.env.NODE_ENV === 'production') {
    throw new Error('Set APP_URL to the public HTTPS origin (or deploy with Render external URL configuration)');
  }
}
