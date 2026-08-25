import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { webhookUrls } from '../../db/schema.js';

let counter = 0;

function unique(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${process.pid}_${counter}`;
}

export function webhookUrlUnique(): string {
  return unique();
}

export interface SeededWebhookUrl {
  id: number;
  url: string;
}

export async function seedWebhookUrl(
  accountId: number,
  overrides: Partial<typeof webhookUrls.$inferInsert> = {},
): Promise<SeededWebhookUrl & { hmacSecret: string }> {
  const suffix = unique();
  const url = overrides.url ?? `http://example.test/${suffix}/hook`;
  const [row] = await db
    .insert(webhookUrls)
    .values({
      accountId,
      url,
      sha1: crypto.createHash('sha1').update(url).digest('hex'),
      hmacSecret: `whsec_${suffix}`,
      secret: '{}',
      events: JSON.stringify(['form.viewed', 'form.started', 'form.completed', 'form.declined']),
      ...overrides,
    })
    .returning({ id: webhookUrls.id, url: webhookUrls.url, hmacSecret: webhookUrls.hmacSecret });

  if (!row) throw new Error('failed to seed webhook_url');
  return row;
}

export async function cleanupWebhookData(accountId: number): Promise<void> {
  await db.execute(
    sql`DELETE FROM webhook_attempts WHERE webhook_event_id IN (SELECT id FROM webhook_events WHERE account_id = ${accountId})`,
  );
  await db.execute(sql`DELETE FROM webhook_events WHERE account_id = ${accountId}`);
  await db.execute(sql`DELETE FROM webhook_urls WHERE account_id = ${accountId}`);
  await db.execute(sql`DELETE FROM users WHERE account_id = ${accountId}`);
  await db.execute(sql`DELETE FROM accounts WHERE id = ${accountId}`);
}
