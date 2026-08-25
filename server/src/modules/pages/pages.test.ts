import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/index.js';
import { accounts, users } from '../../db/schema.js';

const RUN = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const PASSWORD = 'Password123!';

const accountIds: number[] = [];
const userIds: number[] = [];

async function createUser(): Promise<string> {
  const [account] = await db
    .insert(accounts)
    .values({ name: `acct-${RUN}`, locale: 'en-US', timezone: 'UTC', uuid: crypto.randomUUID() })
    .returning();
  if (!account) throw new Error('account insert failed');
  accountIds.push(account.id);

  const email = `pages-${RUN}@test.example`;
  const [row] = await db
    .insert(users)
    .values({
      accountId: account.id,
      email,
      encryptedPassword: await bcrypt.hash(PASSWORD, 12),
      role: 'admin',
      uuid: crypto.randomUUID(),
      failedAttempts: 0,
    })
    .returning();
  if (!row) throw new Error('user insert failed');
  userIds.push(row.id);
  return email;
}

describe('pages module', () => {
  let app: ReturnType<typeof createApp>;
  let email: string;

  beforeAll(async () => {
    app = createApp();
    email = await createUser();
  });

  afterAll(async () => {
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    if (accountIds.length > 0) await db.delete(accounts).where(inArray(accounts.id, accountIds));
  });

  it('redirects / to /sign_in when signed out and to the dashboard when signed in', async () => {
    const anon = await request(app).get('/');
    expect(anon.status).toBe(302);
    expect(anon.headers.location).toBe('/sign_in');

    const agent = request.agent(app);
    await agent.post('/sign_in').send({ email, password: PASSWORD });
    const signedIn = await agent.get('/');
    expect(signedIn.status).toBe(302);
    expect(signedIn.headers.location).toBe('/templates_dashboard');
  });

  it('redirects /dashboard with the same rule', async () => {
    const anon = await request(app).get('/dashboard');
    expect(anon.status).toBe(302);
    expect(anon.headers.location).toBe('/sign_in');
  });

  it('renders a minimal sign-in form', async () => {
    const res = await request(app).get('/sign_in');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('action="/sign_in"');
    expect(res.text).toContain('name="password"');
  });
});
