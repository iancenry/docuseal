import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { webhookAttempts, webhookEvents } from '../../db/schema.js';
import {
  WEBHOOK_DELIVER_QUEUE,
  WEBHOOK_USER_AGENT,
  buildWebhookRequestBody,
  deliverWebhookEvent,
  emitAndEnqueue,
  markWebhookEventCompleted,
  markWebhookEventFailed,
  startWebhookWorker,
  stopWebhookWorker,
} from './worker.js';
import { cleanupWebhookData, seedWebhookUrl } from './testHelpers.js';
import { seedAccountAndUser } from '../submissions/testHelpers.js';

interface CapturedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  rawBody: string;
}

async function listenOnEphemeralPort(
  respond: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
): Promise<{ port: number; requests: CapturedRequest[]; close: () => Promise<void> }> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, rawBody });
      respond(req, res, rawBody);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function waitFor(
  description: string,
  condition: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for: ${description}`);
}

describe('webhook delivery worker', () => {
  let seeded: { accountId: number; userId: number; email: string };

  beforeAll(async () => {
    seeded = await seedAccountAndUser();
  });

  afterAll(async () => {
    await cleanupWebhookData(seeded.accountId);
  });

  describe('deliverWebhookEvent (direct, bypassing pg-boss)', () => {
    let stub: Awaited<ReturnType<typeof listenOnEphemeralPort>>;
    let urlId = 0;
    let hmacSecret = '';
    let eventId = 0;

    beforeAll(async () => {
      stub = await listenOnEphemeralPort((_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end('{}');
      });

      const seededUrl = await seedWebhookUrl(seeded.accountId, {
        url: `http://127.0.0.1:${stub.port}/receiver`,
        events: JSON.stringify(['submission.completed']),
      });
      urlId = seededUrl.id;
      hmacSecret = seededUrl.hmacSecret;

      const [event] = await db
        .insert(webhookEvents)
        .values({
          accountId: seeded.accountId,
          webhookUrlId: urlId,
          eventType: 'submission.completed',
          uuid: crypto.randomUUID(),
          recordType: 'Submission',
          recordId: 555,
          status: 'pending',
        })
        .returning({ id: webhookEvents.id });
      eventId = event!.id;
    });

    afterAll(async () => {
      await stub.close();
    });

    it('POSTs the Rails-shaped JSON body with signed headers and completes the event', async () => {
      const result = await deliverWebhookEvent(
        {
          webhookEventId: eventId,
          webhookUrlId: urlId,
          eventUuid: 'uuid-1',
          eventType: 'submission.completed',
          data: { submission: { id: 555 } },
        },
        0,
      );
      expect(result.status).toBe(200);

      await waitFor('captured request', async () => stub.requests.length > 0);

      const captured = stub.requests[0]!;
      expect(captured.method).toBe('POST');
      expect(captured.path).toBe('/receiver');
      expect(captured.headers['content-type']).toBe('application/json');
      expect(captured.headers['user-agent']).toBe(WEBHOOK_USER_AGENT);
      expect(captured.headers['x-docuseal-event']).toBe('submission.completed');

      const parsed = JSON.parse(captured.rawBody) as {
        event_type: string;
        timestamp: string;
        data: unknown;
      };
      expect(parsed.event_type).toBe('submission.completed');
      expect(typeof parsed.timestamp).toBe('string');
      expect(Number.isNaN(Date.parse(parsed.timestamp))).toBe(false);
      expect(parsed.data).toEqual({ submission: { id: 555 } });
      expect(captured.rawBody).toBe(
        JSON.stringify({
          event_type: 'submission.completed',
          timestamp: parsed.timestamp,
          data: { submission: { id: 555 } },
        }),
      );

      const signatureHeader = String(captured.headers['x-docuseal-signature'] ?? '');
      const [ts, signature] = signatureHeader.split('.');
      expect(ts).toMatch(/^\d+$/);
      const expected = crypto
        .createHmac('sha256', hmacSecret)
        .update(`${ts}.${captured.rawBody}`)
        .digest('hex');
      expect(signature).toBe(expected);

      const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
      expect(row?.status).toBe('completed');

      const attempts = await db
        .select()
        .from(webhookAttempts)
        .where(eq(webhookAttempts.webhookEventId, eventId));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.responseStatusCode).toBe(200);
      expect(attempts[0]!.responseBody).toBeNull();
      expect(attempts[0]!.attempt).toBe(0);
    });
  });

  describe('failure handling', () => {
    let failingStub: Awaited<ReturnType<typeof listenOnEphemeralPort>>;
    let urlId = 0;
    let eventId = 0;

    beforeAll(async () => {
      failingStub = await listenOnEphemeralPort((_req, res) => {
        res.statusCode = 500;
        res.end('exploded with a very long error payload that should be truncated to one hundred characters exactly here padding padding');
      });

      const seededUrl = await seedWebhookUrl(seeded.accountId, {
        url: `http://127.0.0.1:${failingStub.port}/fail`,
        events: JSON.stringify(['form.completed']),
      });
      urlId = seededUrl.id;

      const [event] = await db
        .insert(webhookEvents)
        .values({
          accountId: seeded.accountId,
          webhookUrlId: urlId,
          eventType: 'form.completed',
          uuid: crypto.randomUUID(),
          recordType: 'Submission',
          recordId: 1,
          status: 'pending',
        })
        .returning({ id: webhookEvents.id });
      eventId = event!.id;
    });

    afterAll(async () => {
      await failingStub.close();
    });

    it('records the failed attempt and keeps the event pending for retry', async () => {
      await expect(
        deliverWebhookEvent(
          { webhookEventId: eventId, webhookUrlId: urlId, eventUuid: 'uuid-2', eventType: 'form.completed' },
          1,
        ),
      ).rejects.toThrow();

      const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
      expect(row?.status).toBe('pending');

      const attempts = await db
        .select()
        .from(webhookAttempts)
        .where(eq(webhookAttempts.webhookEventId, eventId));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.responseStatusCode).toBe(500);
      expect(attempts[0]!.attempt).toBe(1);
      expect(attempts[0]!.responseBody).not.toBeNull();
      expect(attempts[0]!.responseBody!.length).toBeLessThanOrEqual(100);
    });

    it('marks the event failed on final failure', async () => {
      await markWebhookEventFailed(eventId);
      const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
      expect(row?.status).toBe('failed');
    });

    it('marks completed via helper', async () => {
      await markWebhookEventCompleted(eventId);
      const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
      expect(row?.status).toBe('completed');
    });
  });

  describe('pg-boss roundtrip', () => {
    let stub: Awaited<ReturnType<typeof listenOnEphemeralPort>>;

    beforeAll(async () => {
      stub = await listenOnEphemeralPort((_req, res) => {
        res.statusCode = 200;
        res.end('{}');
      });
      await seedWebhookUrl(seeded.accountId, {
        url: `http://127.0.0.1:${stub.port}/queued`,
        events: JSON.stringify(['template.created']),
      });
    });

    afterAll(async () => {
      await stopWebhookWorker();
      await stub.close();
    });

    it('delivers an emitted event through the real queue', { timeout: 60_000 }, async () => {
      await startWebhookWorker();

      const enqueued = await emitAndEnqueue(seeded.accountId, 'template.created', 777, {
        template: { id: 777 },
      });
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]!.jobId).toBeTruthy();

      await waitFor('webhook_event to complete', async () => {
        const rows = await db
          .select()
          .from(webhookEvents)
          .where(eq(webhookEvents.accountId, seeded.accountId));
        return rows.some((row) => row.status === 'completed' && row.recordId === 777);
      });

      await waitFor('captured queued request', async () =>
        stub.requests.some((captured) => {
          try {
            const parsed = JSON.parse(captured.rawBody) as { event_type?: string; data?: { template?: { id?: number } } };
            return parsed.event_type === 'template.created' && parsed.data?.template?.id === 777;
          } catch {
            return false;
          }
        }),
      );

      const captured = stub.requests.at(-1)!;
      expect(captured.headers['x-docuseal-event']).toBe('template.created');
    });

    it('exposes the queue name and retry policy constants', () => {
      expect(WEBHOOK_DELIVER_QUEUE).toBe('webhook-deliver');
      expect(WEBHOOK_USER_AGENT).toBe('DocuSeal.com Webhook');
    });
  });
});
