import crypto from 'node:crypto';
import type { Express, Request } from 'express';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { HttpError, asyncHandler, validateBody } from '../../http/helpers.js';
import { verifyTotp } from './totp.js';

const BCRYPT_COST = 12;
const MAX_FAILED_ATTEMPTS = 10;
const RESET_PASSWORD_WITHIN_MS = 6 * 60 * 60 * 1000;

type UserRow = typeof users.$inferSelect;

function body<T>(req: Request): T {
  return ((req as Request & { parsedBody?: T }).parsedBody ?? {}) as T;
}

function newResetToken(): string {
  return crypto.randomBytes(20).toString('hex');
}

async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  return row;
}

async function findUserByResetToken(token: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.resetPasswordToken, token)).limit(1);
  return row;
}

function assertNotLocked(user: UserRow): void {
  if (user.lockedAt) throw new HttpError(423, 'Your account is locked.');
}

async function registerFailedAttempt(user: UserRow): Promise<void> {
  const failedAttempts = user.failedAttempts + 1;
  const set: Partial<typeof users.$inferInsert> & { updatedAt: Date } = {
    failedAttempts,
    updatedAt: new Date(),
  };
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) set.lockedAt = new Date();
  await db.update(users).set(set).where(eq(users.id, user.id));
  if (set.lockedAt) throw new HttpError(423, 'Your account is locked.');
  throw new HttpError(401, 'Invalid Email or password.');
}

async function completeSignIn(user: UserRow, req: Request): Promise<void> {
  await db
    .update(users)
    .set({
      failedAttempts: 0,
      lockedAt: null,
      signInCount: user.signInCount + 1,
      lastSignInAt: user.currentSignInAt,
      currentSignInAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));
  req.session.userId = user.id;
}

function publicUser(user: UserRow): Record<string, unknown> {
  return { id: user.id, email: user.email, role: user.role, account_id: user.accountId };
}

export function registerAuthRoutes(app: Express): void {
  const signInSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
  });

  app.post(
    '/sign_in',
    validateBody(signInSchema),
    asyncHandler(async (req, res) => {
      const { email, password } = body<z.infer<typeof signInSchema>>(req);
      const user = await findUserByEmail(email);
      if (!user || user.archivedAt) throw new HttpError(401, 'Invalid Email or password.');
      assertNotLocked(user);

      const passwordOk = await bcrypt.compare(password, user.encryptedPassword);
      if (!passwordOk) {
        await registerFailedAttempt(user);
        return;
      }
      if (user.otpRequiredForLogin) {
        res.json({ otp_required: true });
        return;
      }
      await completeSignIn(user, req);
      res.json(publicUser(user));
    }),
  );

  app.post(
    '/sign_in/verify_totp',
    validateBody(signInSchema.extend({ otp_attempt: z.string().min(6) })),
    asyncHandler(async (req, res) => {
      const { email, password, otp_attempt } = body<z.infer<typeof signInSchema> & { otp_attempt: string }>(req);
      const user = await findUserByEmail(email);
      if (!user || user.archivedAt) throw new HttpError(401, 'Invalid Email or password.');
      assertNotLocked(user);

      const passwordOk = await bcrypt.compare(password, user.encryptedPassword);
      if (!passwordOk) {
        await registerFailedAttempt(user);
        return;
      }
      if (!verifyTotp(user.otpSecret ?? '', otp_attempt)) {
        await registerFailedAttempt(user);
        return;
      }
      await completeSignIn(user, req);
      res.json(publicUser(user));
    }),
  );

  app.delete(
    '/sign_out',
    asyncHandler(async (req, res) => {
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.status(204).send();
      });
    }),
  );

  app.post(
    '/passwords',
    validateBody(z.object({ email: z.email() })),
    asyncHandler(async (req, res) => {
      const { email } = body<{ email: string }>(req);
      const user = await findUserByEmail(email);
      let token: string | undefined;
      if (user && !user.archivedAt) {
        token = newResetToken();
        await db
          .update(users)
          .set({ resetPasswordToken: token, resetPasswordSentAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, user.id));
      }
      res.json({ ok: true, ...(token ? { reset_password_token: token } : {}) });
    }),
  );

  app.get('/passwords/edit', (req, res) => {
    const token = typeof req.query.reset_password_token === 'string' ? req.query.reset_password_token : '';
    res.send(`<!doctype html><html><body><h1>Change your password</h1>
<form id="f"><input type="hidden" name="reset_password_token" value="${token}">
<input name="password" type="password" placeholder="New password" minlength="6">
<button type="submit">Change my password</button></form>
<script>
document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/passwords', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reset_password_token: e.target.reset_password_token.value, password: e.target.password.value })
  }).then(function () { window.location.href = '/sign_in'; });
});
</script></body></html>`);
  });

  app.patch(
    '/passwords',
    validateBody(z.object({ reset_password_token: z.string().min(1), password: z.string().min(6) })),
    asyncHandler(async (req, res) => {
      const { reset_password_token, password } = body<{
        reset_password_token: string;
        password: string;
      }>(req);
      const user = await findUserByResetToken(reset_password_token);
      if (
        !user ||
        !user.resetPasswordSentAt ||
        Date.now() - user.resetPasswordSentAt.getTime() > RESET_PASSWORD_WITHIN_MS
      ) {
        throw new HttpError(422, 'Reset password token is invalid or expired.');
      }

      const encryptedPassword = await bcrypt.hash(password, BCRYPT_COST);
      await db
        .update(users)
        .set({
          encryptedPassword,
          resetPasswordToken: null,
          resetPasswordSentAt: null,
          failedAttempts: 0,
          lockedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      if (!user.otpRequiredForLogin) req.session.userId = user.id;
      res.json(publicUser(user));
    }),
  );
}
