import type { RequestHandler } from 'express';

export function createReadinessHandler(checkDatabase: () => Promise<unknown>): RequestHandler {
  return async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await checkDatabase();
      res.json({ status: 'ready' });
    } catch {
      // Connection strings and database diagnostics must stay out of public probes.
      res.status(503).json({ status: 'unavailable' });
    }
  };
}
