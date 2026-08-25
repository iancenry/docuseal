import crypto from 'node:crypto';
import type { Express } from 'express';
import type { Request } from 'express';
import bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { accounts, users } from '../../db/schema.js';
import { HttpError, asyncHandler, validateBody } from '../../http/helpers.js';
import { requireAdmin, requireUser } from '../../http/auth.js';

const BCRYPT_COST = 12;
const INVITATION_VALID_FOR_MS = 6 * 60 * 60 * 1000;

type UserRow = typeof users.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;

function body<T>(req: Request): T {
  return ((req as Request & { parsedBody?: T }).parsedBody ?? {}) as T;
}

function newToken(): string {
  return crypto.randomBytes(20).toString('hex');
}

function intParam(req: Request, name: string): number | undefined {
  const raw = req.params[name];
  const value = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

async function findUserById(id: number): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

async function findAccountById(id: number): Promise<AccountRow | undefined> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return row;
}

function assertValidInvitation(user: UserRow | undefined, token: string): UserRow {
  if (!user || !user.resetPasswordToken || user.resetPasswordToken !== token || !user.resetPasswordSentAt) {
    throw new HttpError(404, 'Invitation not found');
  }
  if (Date.now() - user.resetPasswordSentAt.getTime() > INVITATION_VALID_FOR_MS) {
    throw new HttpError(422, 'Invitation token has expired');
  }
  return user;
}

function publicUser(user: UserRow): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    first_name: user.firstName,
    last_name: user.lastName,
    role: user.role,
    account_id: user.accountId,
  };
}

function publicAccount(account: AccountRow): Record<string, unknown> {
  return { id: account.id, name: account.name, locale: account.locale, timezone: account.timezone };
}

export function registerUsersRoutes(app: Express): void {
  app.get(
    '/profile',
    requireUser,
    asyncHandler(async (req, res) => {
      const row = await findUserById(req.currentUser!.id);
      if (!row) throw new HttpError(404, 'User not found');
      res.json(publicUser(row));
    }),
  );

  app.patch(
    '/profile',
    requireUser,
    validateBody(
      z
        .object({
          firstName: z.string().min(1).optional(),
          lastName: z.string().optional(),
          locale: z.string().min(1).optional(),
          timezone: z.string().min(1).optional(),
        }),
    ),
    asyncHandler(async (req, res) => {
      const patch = body<{
        firstName?: string;
        lastName?: string;
        locale?: string;
        timezone?: string;
      }>(req);
      if (patch.locale !== undefined || patch.timezone !== undefined) {
        throw new HttpError(422, 'users table has no locale/timezone columns; account-level settings live on /account');
      }
      const set: Partial<typeof users.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
      if (patch.firstName !== undefined) set.firstName = patch.firstName;
      if (patch.lastName !== undefined) set.lastName = patch.lastName;

      const [updated] = await db.update(users).set(set).where(eq(users.id, req.currentUser!.id)).returning();
      if (!updated) throw new HttpError(404, 'User not found');
      res.json(publicUser(updated));
    }),
  );

  app.put(
    '/profile/password',
    requireUser,
    validateBody(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6) })),
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = body<{ currentPassword: string; newPassword: string }>(req);
      const row = await findUserById(req.currentUser!.id);
      if (!row) throw new HttpError(404, 'User not found');

      const ok = await bcrypt.compare(currentPassword, row.encryptedPassword);
      if (!ok) throw new HttpError(422, 'Current password is invalid');

      const encryptedPassword = await bcrypt.hash(newPassword, BCRYPT_COST);
      await db.update(users).set({ encryptedPassword, updatedAt: new Date() }).where(eq(users.id, row.id));
      req.session.userId = row.id;
      res.json({ ok: true });
    }),
  );

  app.post(
    '/invitations',
    requireUser,
    requireAdmin,
    validateBody(
      z.object({
        email: z.email(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().optional(),
      }),
    ),
    asyncHandler(async (req, res) => {
      const invite = body<{ email: string; firstName?: string; lastName?: string }>(req);
      const email = invite.email.trim().toLowerCase();
      const admin = req.currentUser!;

      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length > 0) throw new HttpError(422, 'Email has already been taken');

      const randomPassword = crypto.randomBytes(24).toString('base64url');
      const invitationToken = newToken();
      const set: typeof users.$inferInsert = {
        accountId: admin.accountId,
        email,
        encryptedPassword: await bcrypt.hash(randomPassword, BCRYPT_COST),
        role: 'user',
        uuid: crypto.randomUUID(),
        resetPasswordToken: invitationToken,
        resetPasswordSentAt: new Date(),
        failedAttempts: 0,
      };
      if (invite.firstName !== undefined) set.firstName = invite.firstName;
      if (invite.lastName !== undefined) set.lastName = invite.lastName;

      const [created] = await db.insert(users).values(set).returning();
      if (!created) throw new HttpError(500, 'Failed to create invitation');

      res.status(201).json({
        ...publicUser(created),
        invite_url: `/invitations/${created.id}/edit?invitation_token=${invitationToken}`,
      });
    }),
  );

  app.get(
    '/invitations/:id/edit',
    asyncHandler(async (req, res) => {
      const id = intParam(req, 'id');
      if (id === undefined) throw new HttpError(404, 'Invitation not found');

      const token = typeof req.query.invitation_token === 'string' ? req.query.invitation_token : '';
      assertValidInvitation(await findUserById(id), token);

      res.send(`<!doctype html><html><body><h1>Accept invitation</h1>
<form id="f"><input type="hidden" name="invitation_token" value="${token}">
<input name="password" type="password" placeholder="New password" minlength="6">
<button type="submit">Set my password</button></form>
<script>
document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  fetch('/invitations/${id}/accept', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invitation_token: e.target.invitation_token.value, password: e.target.password.value })
  }).then(function () { window.location.href = '/sign_in'; });
});
</script></body></html>`);
    }),
  );

  app.patch(
    '/invitations/:id/accept',
    validateBody(z.object({ invitation_token: z.string().min(1), password: z.string().min(6) })),
    asyncHandler(async (req, res) => {
      const id = intParam(req, 'id');
      if (id === undefined) throw new HttpError(404, 'Invitation not found');

      const accept = body<{ invitation_token: string; password: string }>(req);
      const user = assertValidInvitation(await findUserById(id), accept.invitation_token);

      const encryptedPassword = await bcrypt.hash(accept.password, BCRYPT_COST);
      await db
        .update(users)
        .set({
          encryptedPassword,
          confirmedAt: user.confirmedAt ?? new Date(),
          resetPasswordToken: null,
          resetPasswordSentAt: null,
          failedAttempts: 0,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, id), eq(users.resetPasswordToken, accept.invitation_token)));

      const updated = await findUserById(id);
      res.json(updated ? publicUser(updated) : {});
    }),
  );

  app.get(
    '/account',
    requireUser,
    asyncHandler(async (req, res) => {
      const account = await findAccountById(req.currentUser!.accountId);
      if (!account) throw new HttpError(404, 'Account not found');
      res.json(publicAccount(account));
    }),
  );

  app.patch(
    '/account',
    requireUser,
    requireAdmin,
    validateBody(
      z.object({
        name: z.string().min(1).optional(),
        locale: z.string().min(1).optional(),
        timezone: z.string().min(1).optional(),
      }),
    ),
    asyncHandler(async (req, res) => {
      const patch = body<{ name?: string; locale?: string; timezone?: string }>(req);
      const set: Partial<typeof accounts.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.locale !== undefined) set.locale = patch.locale;
      if (patch.timezone !== undefined) set.timezone = patch.timezone;

      const [updated] = await db
        .update(accounts)
        .set(set)
        .where(eq(accounts.id, req.currentUser!.accountId))
        .returning();
      if (!updated) throw new HttpError(404, 'Account not found');
      res.json(publicAccount(updated));
    }),
  );
}
