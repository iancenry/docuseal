import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { accounts, templateFolders, templates, templateVersions, users } from '../../db/schema.js';
import { config } from '../../config.js';

let counter = 0;

function unique(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${process.pid}_${counter}`;
}

export interface SeededUser {
  accountId: number;
  userId: number;
  email: string;
}

export async function seedAccountAndUser(role = 'user'): Promise<SeededUser> {
  const suffix = unique();
  const [account] = await db
    .insert(accounts)
    .values({
      name: `submissions-test-${suffix}`,
      locale: 'en',
      timezone: 'UTC',
      uuid: crypto.randomUUID(),
    })
    .returning({ id: accounts.id });

  if (!account) throw new Error('failed to seed account');

  const email = `submissions-test-${suffix}@example.com`;
  const [user] = await db
    .insert(users)
    .values({
      accountId: account.id,
      email,
      encryptedPassword: 'not-a-real-hash',
      role,
      uuid: crypto.randomUUID(),
    })
    .returning({ id: users.id });

  if (!user) throw new Error('failed to seed user');

  return { accountId: account.id, userId: user.id, email };
}

export interface SeededTemplate {
  templateId: number;
  folderId: number;
  submitterUuids: string[];
}

export async function seedTemplate(
  accountId: number,
  authorId: number,
  roleNames: string[] = ['First Party'],
): Promise<SeededTemplate> {
  const [folder] = await db
    .insert(templateFolders)
    .values({
      accountId,
      authorId,
      name: `folder-${unique()}`,
    })
    .returning({ id: templateFolders.id });

  if (!folder) throw new Error('failed to seed template folder');

  const submitterUuids = roleNames.map(() => crypto.randomUUID());
  const documentUuid = crypto.randomUUID();

  const schema = [{ name: 'example.pdf', attachment_uuid: documentUuid }];
  const submitters = roleNames.map((name, index) => ({ name, uuid: submitterUuids[index] }));
  const fields = [
    {
      uuid: crypto.randomUUID(),
      type: 'text',
      name: 'field_name',
      submitter_uuid: submitterUuids[0],
      areas: [],
    },
  ];
  const name = `Test Template ${unique()}`;

  const [template] = await db
    .insert(templates)
    .values({
      accountId,
      authorId,
      folderId: folder.id,
      name,
      slug: `${unique()}${unique()}`.slice(0, 40),
      source: 'native',
      preferences: '{}',
      fields: JSON.stringify(fields),
      schema: JSON.stringify(schema),
      submitters: JSON.stringify(submitters),
    })
    .returning({ id: templates.id });

  if (!template) throw new Error('failed to seed template');

  await db.insert(templateVersions).values({
    accountId,
    authorId,
    templateId: template.id,
    data: JSON.stringify({ name, schema, submitters, fields }),
    sha1: crypto.createHash('sha1').update(`${template.id}:${unique()}`).digest('hex'),
  });

  return { templateId: template.id, folderId: folder.id, submitterUuids };
}

let sessionsReady: Promise<void> | null = null;

async function createSessionsTable(): Promise<void> {
  const existing = await db.execute(sql`SELECT to_regclass('public.sessions') AS reg`);
  if ((existing[0] as { reg?: string } | undefined)?.reg) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "sessions" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
      )
    `);
  } catch {
    return;
  }
}

function ensureSessionsTable(): Promise<void> {
  if (!sessionsReady) {
    sessionsReady = createSessionsTable();
  }
  return sessionsReady;
}

export async function seedSessionCookie(userId: number): Promise<string> {
  await ensureSessionsTable();

  const sid = crypto.randomBytes(16).toString('hex');
  const sess = JSON.stringify({ cookie: { originalMaxAge: null }, userId });
  const expire = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.execute(
    sql`INSERT INTO "sessions" ("sid", "sess", "expire") VALUES (${sid}, ${sess}, ${expire}::timestamp)`,
  );

  const signature = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');

  return `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}

export async function cleanupTestData(accountId: number): Promise<void> {
  await db.execute(sql`DELETE FROM submission_events WHERE account_id = ${accountId}`);
  await db.execute(
    sql`DELETE FROM completed_documents WHERE submitter_id IN (SELECT id FROM submitters WHERE account_id = ${accountId})`,
  );
  await db.execute(sql`DELETE FROM completed_submitters WHERE account_id = ${accountId}`);
  await db.execute(sql`DELETE FROM submitters WHERE account_id = ${accountId}`);
  await db.execute(sql`DELETE FROM submissions WHERE account_id = ${accountId}`);
  await db.execute(sql`DELETE FROM template_versions WHERE account_id = ${accountId}`);
  await db.execute(sql`DELETE FROM templates WHERE account_id = ${accountId}`);
  await db.execute(sql`DELETE FROM template_folders WHERE account_id = ${accountId}`);
  await db.execute(sql`DELETE FROM users WHERE account_id = ${accountId}`);
  await db.delete(accounts).where(eq(accounts.id, accountId));
}
