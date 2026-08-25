import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/index.js';
import { accounts, users } from '../../db/schema.js';

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

function agentFor(app: ReturnType<typeof createApp>, email: string) {
  const agent = request.agent(app);
  return agent.post('/sign_in').send({ email, password: PASSWORD }).then(() => agent);
}

describe('users module', () => {
  let app: ReturnType<typeof createApp>;
  let accountId: number;
  let adminEmail: string;
  let memberEmail: string;

  beforeAll(async () => {
    app = createApp();
    accountId = await createAccount();
    adminEmail = `admin-${RUN}@test.example`;
    memberEmail = `member-${RUN}@test.example`;
    await createUser(accountId, adminEmail, { role: 'admin' });
    await createUser(accountId, memberEmail, { role: 'editor' });
  });

  afterAll(async () => {
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    if (accountIds.length > 0) await db.delete(accounts).where(inArray(accounts.id, accountIds));
  });

  it('guards /profile behind authentication', async () => {
    const anon = await request(app).get('/profile');
    expect(anon.status).toBe(401);

    const admin = await agentFor(app, adminEmail);
    const res = await admin.get('/profile');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(adminEmail);
    expect(res.body.role).toBe('admin');
  });

  it('updates contact fields via PATCH /profile', async () => {
    const admin = await agentFor(app, adminEmail);
    const res = await admin
      .patch('/profile')
      .send({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(res.status).toBe(200);
    expect(res.body.first_name).toBe('Ada');
    expect(res.body.last_name).toBe('Lovelace');

    const [row] = await db.select().from(users).where(eq(users.email, adminEmail));
    expect(row?.firstName).toBe('Ada');
  });

  it('rejects locale/timezone on /profile (no such user columns)', async () => {
    const admin = await agentFor(app, adminEmail);
    const res = await admin.patch('/profile').send({ locale: 'en-GB' });
    expect(res.status).toBe(422);
  });

  it('changes the password only with the correct current password', async () => {
    const email = `pwchange-${RUN}@test.example`;
    await createUser(accountId, email);
    const agent = await agentFor(app, email);

    const wrongCurrent = await agent
      .put('/profile/password')
      .send({ currentPassword: 'not-it', newPassword: 'FreshPass123' });
    expect(wrongCurrent.status).toBe(422);

    const ok = await agent
      .put('/profile/password')
      .send({ currentPassword: PASSWORD, newPassword: 'FreshPass123' });
    expect(ok.status).toBe(200);

    const oldPw = await request(app).post('/sign_in').send({ email, password: PASSWORD });
    expect(oldPw.status).toBe(401);

    const newPw = await request(app).post('/sign_in').send({ email, password: 'FreshPass123' });
    expect(newPw.status).toBe(200);
  });

  it('restricts invitations to admins and returns an invite URL', async () => {
    const member = await agentFor(app, memberEmail);
    const forbidden = await member.post('/invitations').send({ email: `x-${RUN}@test.example` });
    expect(forbidden.status).toBe(403);

    const admin = await agentFor(app, adminEmail);
    const inviteEmail = `invited-${RUN}@test.example`;
    const created = await admin
      .post('/invitations')
      .send({ email: inviteEmail, firstName: 'Grace', lastName: 'Hopper' });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('user');

    const inviteUrl = created.body.invite_url as string;
    expect(inviteUrl).toContain(`/invitations/${created.body.id}/edit?invitation_token=`);

    const duplicate = await admin.post('/invitations').send({ email: inviteEmail });
    expect(duplicate.status).toBe(422);

    const [row] = await db.select().from(users).where(eq(users.email, inviteEmail));
    expect(row?.firstName).toBe('Grace');
    expect(row?.resetPasswordSentAt).toBeTruthy();
  });

  it('lets the invitee accept via edit page + PATCH and sets confirmed_at', async () => {
    const admin = await agentFor(app, adminEmail);
    const inviteEmail = `acceptee-${RUN}@test.example`;
    const created = await admin.post('/invitations').send({ email: inviteEmail });
    expect(created.status).toBe(201);
    const userId = created.body.id as number;
    const token = new URL(created.body.invite_url as string, 'http://test').searchParams.get(
      'invitation_token',
    ) as string;

    const badPage = await request(app).get(`/invitations/${userId}/edit?invitation_token=nope`);
    expect(badPage.status).toBe(404);

    const page = await request(app).get(`/invitations/${userId}/edit?invitation_token=${token}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Accept invitation');

    const badAccept = await request(app)
      .patch(`/invitations/${userId}/accept`)
      .send({ invitation_token: 'nope', password: 'SetMe12345' });
    expect(badAccept.status).toBe(404);

    const accepted = await request(app)
      .patch(`/invitations/${userId}/accept`)
      .send({ invitation_token: token, password: 'SetMe12345' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.email).toBe(inviteEmail);

    const signedIn = await request(app).post('/sign_in').send({
      email: inviteEmail,
      password: 'SetMe12345',
    });
    expect(signedIn.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.confirmedAt).toBeTruthy();
    expect(row?.resetPasswordToken).toBeNull();

    const expiredToken = await request(app)
      .patch(`/invitations/${userId}/accept`)
      .send({ invitation_token: token, password: 'Again12345' });
    expect(expiredToken.status).toBe(404);
  });

  it('exposes GET /account to any user but restricts PATCH /account to admins', async () => {
    const anon = await request(app).get('/account');
    expect(anon.status).toBe(401);

    const member = await agentFor(app, memberEmail);
    const shown = await member.get('/account');
    expect(shown.status).toBe(200);
    expect(shown.body.id).toBe(accountId);
    expect(shown.body.name).toBe(`acct-${RUN}`);

    const memberPatch = await member.patch('/account').send({ name: 'Nope Inc' });
    expect(memberPatch.status).toBe(403);

    const admin = await agentFor(app, adminEmail);
    const updated = await admin
      .patch('/account')
      .send({ name: `acct-updated-${RUN}`, locale: 'en-GB', timezone: 'Europe/London' });
    expect(updated.status).toBe(200);
    expect(updated.body.locale).toBe('en-GB');
    expect(updated.body.timezone).toBe('Europe/London');

    const invalid = await admin.patch('/account').send({ name: '' });
    expect(invalid.status).toBe(422);
  });
});
