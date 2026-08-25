import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { accounts, users } from '../../db/schema.js';

export interface Seed {
  accountId: number;
  userId: number;
  email: string;
  sid: string;
  cookie: string;
}

export async function seedUserWithSession(): Promise<Seed> {
  const runId = `${Date.now().toString(36)}-${crypto.randomInt(1_000_000).toString(36)}`;
  const accountRows = await db
    .insert(accounts)
    .values({
      name: `tpl-test-${runId}`,
      locale: 'en',
      timezone: 'UTC',
      uuid: crypto.randomUUID(),
    })
    .returning();
  const account = accountRows[0]!;
  const userRows = await db
    .insert(users)
    .values({
      accountId: account.id,
      email: `tpl-tests-${runId}@example.test`,
      encryptedPassword: 'x',
      role: 'user',
      uuid: crypto.randomUUID(),
    })
    .returning();
  const user = userRows[0]!;
  const sid = crypto.randomBytes(16).toString('hex');
  const sess = JSON.stringify({ cookie: { originalMaxAge: null }, userId: user.id });
  const expire = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  await db.execute(
    sql`INSERT INTO sessions (sid, sess, expire) VALUES (${sid}, ${sess}, ${expire}::timestamp)`,
  );
  const signature = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return {
    accountId: account.id,
    userId: user.id,
    email: user.email,
    sid,
    cookie: `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`,
  };
}

export async function cleanupSeed(seed: Seed): Promise<void> {
  const acc = seed.accountId;
  const statements = [
    sql`DELETE FROM completed_documents WHERE submitter_id IN (SELECT s.id FROM submitters s JOIN submissions su ON su.id = s.submission_id JOIN templates t ON t.id = su.template_id WHERE t.account_id = ${acc})`,
    sql`DELETE FROM completed_submitters WHERE account_id = ${acc}`,
    sql`DELETE FROM submitter_versions WHERE submitter_id IN (SELECT s.id FROM submitters s JOIN submissions su ON su.id = s.submission_id JOIN templates t ON t.id = su.template_id WHERE t.account_id = ${acc})`,
    sql`DELETE FROM document_generation_events WHERE submitter_id IN (SELECT s.id FROM submitters s JOIN submissions su ON su.id = s.submission_id JOIN templates t ON t.id = su.template_id WHERE t.account_id = ${acc})`,
    sql`DELETE FROM submission_events WHERE submission_id IN (SELECT su.id FROM submissions su JOIN templates t ON t.id = su.template_id WHERE t.account_id = ${acc})`,
    sql`DELETE FROM submitters WHERE submission_id IN (SELECT su.id FROM submissions su JOIN templates t ON t.id = su.template_id WHERE t.account_id = ${acc})`,
    sql`DELETE FROM submissions WHERE template_id IN (SELECT id FROM templates WHERE account_id = ${acc})`,
    sql`DELETE FROM search_entries WHERE account_id = ${acc}`,
    sql`DELETE FROM template_versions WHERE template_id IN (SELECT id FROM templates WHERE account_id = ${acc})`,
    sql`DELETE FROM template_accesses WHERE template_id IN (SELECT id FROM templates WHERE account_id = ${acc})`,
    sql`DELETE FROM template_sharings WHERE template_id IN (SELECT id FROM templates WHERE account_id = ${acc})`,
    sql`DELETE FROM dynamic_document_versions WHERE dynamic_document_id IN (SELECT d.id FROM dynamic_documents d JOIN templates t ON t.id = d.template_id WHERE t.account_id = ${acc})`,
    sql`DELETE FROM dynamic_documents WHERE template_id IN (SELECT id FROM templates WHERE account_id = ${acc})`,
    sql`DELETE FROM active_storage_variant_records WHERE blob_id IN (SELECT a.blob_id FROM active_storage_attachments a WHERE a.record_type = 'Template' AND a.record_id IN (SELECT id FROM templates WHERE account_id = ${acc}))`,
    sql`DELETE FROM active_storage_attachments WHERE record_type = 'Template' AND record_id IN (SELECT id FROM templates WHERE account_id = ${acc})`,
    sql`DELETE FROM active_storage_blobs WHERE filename LIKE 'test-%' AND service_name = 'local'`,
    sql`DELETE FROM templates WHERE account_id = ${acc}`,
    sql`DELETE FROM template_folders WHERE account_id = ${acc}`,
    sql`DELETE FROM access_tokens WHERE user_id = ${seed.userId}`,
    sql`DELETE FROM users WHERE id = ${seed.userId}`,
    sql`DELETE FROM accounts WHERE id = ${acc}`,
    sql`DELETE FROM sessions WHERE sid = ${seed.sid}`,
  ];
  for (const statement of statements) {
    await db.execute(statement);
  }
  try {
    await db.execute(sql`DELETE FROM sessions WHERE sess->>'userId' = ${String(seed.userId)}`);
  } catch {
    void 0;
  }
}

export function minimalPdfBytes(text = 'Hello World'): Uint8Array {
  const contentStream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((objectBody, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  });

  const xrefOffset = body.length;

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(body + xref + trailer);
}
