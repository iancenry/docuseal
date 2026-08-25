import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/index.js';
import { accounts, users } from '../../db/schema.js';
import { totpCode } from './totp.js';

const RUN = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const PASSWORD = 'Password123!';

const accountIds: number[] = [];
const userIds: number[] = [];

type UserInsert = typeof users.$inferInsert;

async function createAccount(): Promise<number> {
  const [row] = await db
    .insert(accounts)
    .values({ name: `acct-${RUN}`, locale: 'en-US', timezone: 'UTC', uuid: crypto.randomUUID() })
    .returning();
  if (!row) throw new Error('account insert failed');
  accountIds.push(row.id);
  return row.id;
}

async function createUser(accountId: number, email: string, extra: Partial<UserInsert> = {}): Promise<number> {
  const values: UserInsert = {
    accountId,
    email,
    encryptedPassword: await bcrypt.hash(PASSWORD, 12),
    role: 'admin',
    uuid: crypto.randomUUID(),
    failedAttempts: 0,
    ...extra,
  };
  const [row] = await db.insert(users).values(values).returning();
  if (!row) throw new Error('user insert failed');
  userIds.push(row.id);
  return row.id;
}

describe('auth module', () => {
  let accountId: number;

  beforeAll(async () => {
    accountId = await createAccount();
  });

  afterAll(async () => {
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    if (accountIds.length > 0) await db.delete(accounts).where(inArray(accounts.id, accountIds));
  });

  it('signs in with valid credentials and keeps the session', async () => {
    const app = createApp();
    const email = `signin-ok-${RUN}@test.example`;
    await createUser(accountId, email);

    const agent = request.agent(app);
    const res = await agent.post('/sign_in').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);

    const profile = await agent.get('/profile');
    expect(profile.status).toBe(200);
    expect(profile.body.email).toBe(email);
  });

  it('rejects unknown users and wrong passwords without locking early', async () => {
    const app = createApp();

    const unknown = await request(app).post('/sign_in').send({
      email: `ghost-${RUN}@test.example`,
      password: 'whatever1',
    });
    expect(unknown.status).toBe(401);

    const email = `signin-bad-${RUN}@test.example`;
    await createUser(accountId, email);

    const bad = await request(app).post('/sign_in').send({ email, password: 'wrong-password' });
    expect(bad.status).toBe(401);

    const good = await request(app).post('/sign_in').send({ email, password: PASSWORD });
    expect(good.status).toBe(200);
  });

  it('locks the account after 10 failed attempts', async () => {
    const app = createApp();
    const email = `lockout-${RUN}@test.example`;
    await createUser(accountId, email);

    for (let i = 0; i < 9; i += 1) {
      const res = await request(app).post('/sign_in').send({ email, password: 'wrong-password' });
      expect(res.status).toBe(401);
    }

    const tenth = await request(app).post('/sign_in').send({ email, password: 'wrong-password' });
    expect(tenth.status).toBe(423);

    const evenCorrect = await request(app).post('/sign_in').send({ email, password: PASSWORD });
    expect(evenCorrect.status).toBe(423);
  });

  it('requires TOTP verification when otp_required_for_login is set', async () => {
    const app = createApp();
    const email = `totp-${RUN}@test.example`;
    const secret = 'JBSWY3DPEHPK3PXP';
    await createUser(accountId, email, {
      otpRequiredForLogin: true,
      otpSecret: secret,
    });

    const first = request.agent(app);
    const step1 = await first.post('/sign_in').send({ email, password: PASSWORD });
    expect(step1.status).toBe(200);
    expect(step1.body).toEqual({ otp_required: true });

    const notSignedIn = await first.get('/profile');
    expect(notSignedIn.status).toBe(401);

    const badCode = await first
      .post('/sign_in/verify_totp')
      .send({ email, password: PASSWORD, otp_attempt: '000000' });
    expect(badCode.status).toBe(401);

    const second = request.agent(app);
    const step2 = await second
      .post('/sign_in/verify_totp')
      .send({ email, password: PASSWORD, otp_attempt: totpCode(secret) });
    expect(step2.status).toBe(200);
    expect(step2.body.email).toBe(email);

    const profile = await second.get('/profile');
    expect(profile.status).toBe(200);
  });

  it('runs the full reset-password flow and signs the user in', async () => {
    const app = createApp();
    const email = `reset-${RUN}@test.example`;
    await createUser(accountId, email);

    const missing = await request(app).post('/passwords').send({ email: `none-${RUN}@test.example` });
    expect(missing.status).toBe(200);
    expect(missing.body.reset_password_token).toBeUndefined();

    const created = await request(app).post('/passwords').send({ email });
    expect(created.status).toBe(200);
    const token = created.body.reset_password_token as string | undefined;
    expect(token).toBeTruthy();

    const editPage = await request(app).get(`/passwords/edit?reset_password_token=${token}`);
    expect(editPage.status).toBe(200);
    expect(editPage.text).toContain('Change your password');

    const invalid = await request(app)
      .patch('/passwords')
      .send({ reset_password_token: 'not-a-real-token', password: 'BrandNew123' });
    expect(invalid.status).toBe(422);

    const agent = request.agent(app);
    const updated = await agent
      .patch('/passwords')
      .send({ reset_password_token: token, password: 'BrandNew123' });
    expect(updated.status).toBe(200);

    const signedInAfterReset = await agent.get('/profile');
    expect(signedInAfterReset.status).toBe(200);

    const oldPassword = await request(app).post('/sign_in').send({ email, password: PASSWORD });
    expect(oldPassword.status).toBe(401);

    const newPassword = await request(app).post('/sign_in').send({ email, password: 'BrandNew123' });
    expect(newPassword.status).toBe(200);
  });

  it('destroys the session on sign out', async () => {
    const app = createApp();
    const email = `signout-${RUN}@test.example`;
    await createUser(accountId, email);

    const agent = request.agent(app);
    await agent.post('/sign_in').send({ email, password: PASSWORD });
    expect((await agent.get('/profile')).status).toBe(200);

    const signOut = await agent.delete('/sign_out');
    expect(signOut.status).toBe(204);

    const afterSignOut = await agent.get('/profile');
    expect(afterSignOut.status).toBe(401);
  });

  it('returns JSON errors for HttpError failures', async () => {
    const app = createApp();
    const res = await request(app).post('/sign_in').send({});
    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
