import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { webhookEvents } from '../../db/schema.js';
import { emitWebhookEvent } from './service.js';
import { cleanupWebhookData, seedWebhookUrl } from './testHelpers.js';
import { seedAccountAndUser } from '../submissions/testHelpers.js';

describe('emitWebhookEvent', () => {
  let seeded: { accountId: number; userId: number; email: string };

  beforeAll(async () => {
    seeded = await seedAccountAndUser();
  });

  afterAll(async () => {
    await cleanupWebhookData(seeded.accountId);
  });

  it('emits nothing when the account has no webhook urls', async () => {
    const emitted = await emitWebhookEvent(seeded.accountId, 'submission.completed', 123);
    expect(emitted).toEqual([]);

    const rows = await db.select().from(webhookEvents).where(eq(webhookEvents.accountId, seeded.accountId));
    expect(rows).toHaveLength(0);
  });

  it('creates a pending webhook_event when a subscription matches', async () => {
    const url = await seedWebhookUrl(seeded.accountId, {
      events: JSON.stringify(['submission.completed']),
    });

    const emitted = await emitWebhookEvent(seeded.accountId, 'submission.completed', 42);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.webhookUrlId).toBe(url.id);

    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, emitted[0]!.id));
    expect(row.status).toBe('pending');
    expect(row.eventType).toBe('submission.completed');
    expect(row.recordType).toBe('Submission');
    expect(row.recordId).toBe(42);
    expect(row.accountId).toBe(seeded.accountId);
    expect(row.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not create an event when no subscription matches the event type', async () => {
    await seedWebhookUrl(seeded.accountId, {
      events: JSON.stringify(['form.viewed', 'form.started']),
    });

    const emitted = await emitWebhookEvent(seeded.accountId, 'template.created', 7);
    expect(emitted).toEqual([]);

    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.accountId, seeded.accountId));
    const templateEvents = rows.filter((row) => row.eventType === 'template.created');
    expect(templateEvents).toHaveLength(0);
  });

  it('creates one row per subscribed url sharing a single event uuid', async () => {
    await seedWebhookUrl(seeded.accountId, { events: JSON.stringify(['submission.expired']) });
    await seedWebhookUrl(seeded.accountId, { events: JSON.stringify(['submission.expired']) });
    await seedWebhookUrl(seeded.accountId, { events: JSON.stringify(['form.completed']) });

    const emitted = await emitWebhookEvent(seeded.accountId, 'submission.expired', 99);
    expect(emitted).toHaveLength(2);

    const uuids = new Set(emitted.map((row) => row.uuid));
    expect(uuids.size).toBe(1);

    const expiredRows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.accountId, seeded.accountId));
    const matching = expiredRows.filter((row) => row.eventType === 'submission.expired');
    expect(matching).toHaveLength(2);
    expect(matching.every((row) => row.status === 'pending')).toBe(true);
  });
});
