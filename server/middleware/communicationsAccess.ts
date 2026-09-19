import type { Request, Response, NextFunction } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { canAccessModule } from '@shared/permissions';
import { activePerson } from '../services/communications';

// Shared by the Hub and compatibility routes so older clients cannot bypass it.
export async function requireCommunicationAccess(req: Request, res: Response, next: NextFunction) {
  res.set('Cache-Control', 'no-store');
  if (!req.user || !canAccessModule(req.user.role, 'communication_hub')) {
    return res.status(403).json({ message: 'Communication Hub access required' });
  }
  try {
    const current = await db.execute(sql`SELECT u.id FROM users u WHERE u.id=${req.user.userId} AND ${activePerson('u')}`);
    if (!current.rows.length) return res.status(403).json({ message: 'Current employment access required' });
    return next();
  } catch {
    return res.status(503).json({ message: 'Unable to verify communication access; retry shortly' });
  }
}
