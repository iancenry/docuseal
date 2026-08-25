import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { Express, Request } from 'express';
import { db } from '../../db/index.js';
import { accessTokens, users } from '../../db/schema.js';
import { asyncHandler, HttpError } from '../../http/helpers.js';
import { requireUser } from '../../http/auth.js';

export function registerApiRevealAccessTokenRoutes(app: Express): void {
  app.post(
    '/reveal_access_token',
    requireUser,
    asyncHandler(async (req: Request, res) => {
      const user = req.currentUser!;
      const password = String((req.body ?? {}).password ?? '');

      const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      if (!row) throw new HttpError(401, 'authentication required');

      if (!(await bcrypt.compare(password, row.encryptedPassword))) {
        throw new HttpError(422, 'wrong_password');
      }

      const [existing] = await db
        .select({ token: accessTokens.token })
        .from(accessTokens)
        .where(eq(accessTokens.userId, user.id))
        .limit(1);

      if (existing) {
        res.json({ token: existing.token });
        return;
      }

      const token = crypto.randomBytes(20).toString('hex');
      await db.insert(accessTokens).values({
        token,
        sha256: crypto.createHash('sha256').update(token).digest('hex'),
        userId: user.id,
      });

      res.json({ token });
    }),
  );
}
