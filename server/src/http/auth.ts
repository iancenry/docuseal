import crypto from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accessTokens, accounts, users } from '../db/schema.js';

export interface CurrentUser {
  id: number;
  accountId: number;
  email: string;
  role: string;
  teamId: number | null;
  admin: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    currentUser?: CurrentUser;
    currentAccount?: typeof accounts.$inferSelect;
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    returnTo?: string;
  }
}

export function currentUserFromRow(row: typeof users.$inferSelect): CurrentUser {
  return {
    id: row.id,
    accountId: row.accountId,
    email: row.email,
    role: row.role,
    teamId: row.teamId ?? null,
    admin: row.role === 'admin',
  };
}

export async function loadCurrentUser(req: Request): Promise<CurrentUser | undefined> {
  const userId = req.session.userId;
  if (!userId) return undefined;
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row || row.archivedAt) return undefined;
  return currentUserFromRow(row);
}

export const attachCurrentUser: RequestHandler = (req, _res, next) => {
  void loadCurrentUser(req)
    .then(async (user) => {
      if (user) {
        req.currentUser = user;
        const [account] = await db.select().from(accounts).where(eq(accounts.id, user.accountId)).limit(1);
        if (account) req.currentAccount = account;
      }
      next();
    })
    .catch(next);
};

export const requireUser: RequestHandler = (req, res, next) => {
  if (!req.currentUser) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.currentUser?.admin) {
    res.status(403).json({ error: 'admin access required' });
    return;
  }
  next();
};

async function resolveApiToken(token: string): Promise<CurrentUser | undefined> {
  const sha256 = crypto.createHash('sha256').update(token).digest('hex');
  const [row] = await db.select().from(accessTokens).where(eq(accessTokens.sha256, sha256)).limit(1);
  if (!row) return undefined;
  const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  return user && !user.archivedAt ? currentUserFromRow(user) : undefined;
}

export const requireApiToken: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.api_token as string | undefined);
  if (!token) {
    res.status(401).json({ error: 'API token required' });
    return;
  }
  void resolveApiToken(token)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: 'invalid API token' });
        return;
      }
      req.currentUser = user;
      next();
    })
    .catch(next);
};
