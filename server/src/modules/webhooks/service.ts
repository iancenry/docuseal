import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { webhookEvents, webhookUrls } from '../../db/schema.js';

export function parseWebhookEvents(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

export function serializeWebhookUrl(row: typeof webhookUrls.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    name: null,
    webhook_url: row.url,
    events: parseWebhookEvents(row.events),
    ssl: row.url.startsWith('https://'),
    created_at: row.createdAt ? row.createdAt.toISOString() : null,
    updated_at: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export interface EmittedWebhookEvent {
  id: number;
  uuid: string;
  webhookUrlId: number;
}

export async function emitWebhookEvent(
  accountId: number,
  event: string,
  submissionId?: number,
): Promise<EmittedWebhookEvent[]> {
  const urls = await db
    .select({ id: webhookUrls.id, events: webhookUrls.events })
    .from(webhookUrls)
    .where(eq(webhookUrls.accountId, accountId));

  const subscribed = urls.filter((url) => parseWebhookEvents(url.events).includes(event));
  if (subscribed.length === 0) return [];

  const uuid = crypto.randomUUID();

  return db
    .insert(webhookEvents)
    .values(
      subscribed.map((url) => ({
        accountId,
        webhookUrlId: url.id,
        eventType: event,
        uuid,
        recordType: 'Submission',
        recordId: submissionId ?? 0,
        status: 'pending',
      })),
    )
    .returning({ id: webhookEvents.id, uuid: webhookEvents.uuid, webhookUrlId: webhookEvents.webhookUrlId });
}
