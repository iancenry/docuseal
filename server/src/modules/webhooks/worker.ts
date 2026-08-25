import crypto from 'node:crypto';
import { PgBoss } from 'pg-boss';
import type { ConstructorOptions, JobResult, JobWithMetadata } from 'pg-boss';
import { eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { webhookAttempts, webhookEvents, webhookUrls } from '../../db/schema.js';
import { emitWebhookEvent, type EmittedWebhookEvent } from './service.js';

export const WEBHOOK_DELIVER_QUEUE = 'webhook-deliver';
export const WEBHOOK_USER_AGENT = 'DocuSeal.com Webhook';
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 15_000;
export const WEBHOOK_RETRY_LIMIT = 2;
export const WEBHOOK_RETRY_DELAY_SECONDS = 5;

export interface WebhookDeliveryPayload {
  webhookEventId: number;
  webhookUrlId: number;
  eventUuid: string;
  eventType: string;
  data?: unknown;
}

export class WebhookDeliveryError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

async function recordWebhookAttemptIfPossible(
  webhookEventId: number,
  responseStatusCode: number,
  responseBody: string | null,
  attempt: number,
): Promise<void> {
  try {
    await db.insert(webhookAttempts).values({ webhookEventId, responseStatusCode, responseBody, attempt });
  } catch {
    return;
  }
}

export async function markWebhookEventCompleted(webhookEventId: number): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(eq(webhookEvents.id, webhookEventId));
}

export async function markWebhookEventFailed(webhookEventId: number): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(webhookEvents.id, webhookEventId));
}

function buildSignature(hmacSecret: string, body: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = crypto.createHmac('sha256', hmacSecret).update(`${timestamp}.${body}`).digest('hex');
  return `${timestamp}.${digest}`;
}

export function buildWebhookRequestBody(eventType: string, data?: unknown): string {
  return JSON.stringify({ event_type: eventType, timestamp: new Date().toISOString(), data: data ?? {} });
}

export async function deliverWebhookEvent(
  payload: WebhookDeliveryPayload,
  attempt = 0,
): Promise<{ status: number }> {
  const [urlRow] = await db
    .select({ url: webhookUrls.url, hmacSecret: webhookUrls.hmacSecret })
    .from(webhookUrls)
    .where(eq(webhookUrls.id, payload.webhookUrlId))
    .limit(1);

  if (!urlRow || !urlRow.url) {
    await recordWebhookAttemptIfPossible(payload.webhookEventId, 0, 'webhook_url missing', attempt);
    throw new WebhookDeliveryError('webhook_url missing', 0);
  }

  const body = buildWebhookRequestBody(payload.eventType, payload.data);

  let response: Response;
  try {
    response = await fetch(urlRow.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': WEBHOOK_USER_AGENT,
        'X-Docuseal-Event': payload.eventType,
        'X-Docuseal-Signature': buildSignature(urlRow.hmacSecret, body),
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_DELIVERY_TIMEOUT_MS),
    });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 100);
    await recordWebhookAttemptIfPossible(payload.webhookEventId, 0, message, attempt);
    throw new WebhookDeliveryError(message, 0);
  }

  if (response.status >= 400) {
    const text = (await response.text().catch(() => '')).slice(0, 100);
    await recordWebhookAttemptIfPossible(payload.webhookEventId, response.status, text || null, attempt);
    throw new WebhookDeliveryError(`webhook responded with status ${response.status}`, response.status);
  }

  await recordWebhookAttemptIfPossible(payload.webhookEventId, response.status, null, attempt);
  await markWebhookEventCompleted(payload.webhookEventId);
  return { status: response.status };
}

async function handleDeliveryJobs(
  jobs: readonly JobWithMetadata<WebhookDeliveryPayload>[],
): Promise<JobResult[]> {
  return Promise.all(
    jobs.map(async (job): Promise<JobResult> => {
      try {
        await deliverWebhookEvent(job.data, job.retryCount);
        return { id: job.id, status: 'completed' };
      } catch {
        if (job.retryCount >= job.retryLimit) {
          await markWebhookEventFailed(job.data.webhookEventId).catch(() => undefined);
        }
        return { id: job.id, status: 'failed' };
      }
    }),
  );
}

let bossInstance: PgBoss | null = null;
let bossStarting: Promise<PgBoss> | null = null;

async function ensureWorkerRunning(options?: Partial<ConstructorOptions>): Promise<PgBoss> {
  if (bossInstance) return bossInstance;
  if (!bossStarting) {
    bossStarting = (async () => {
      const boss = new PgBoss({
        connectionString: config.databaseUrl,
        ...options,
      });
      await boss.start();
      await boss.createQueue(WEBHOOK_DELIVER_QUEUE).catch(() => undefined);
      await boss.work(
        WEBHOOK_DELIVER_QUEUE,
        { includeMetadata: true, perJobResults: true, pollingIntervalSeconds: 1 },
        handleDeliveryJobs,
      );
      bossInstance = boss;
      return boss;
    })();
    bossStarting.catch(() => {
      if (bossStarting) bossStarting = null;
    });
  }
  return bossStarting;
}

export async function startWebhookWorker(options?: Partial<ConstructorOptions>): Promise<void> {
  await ensureWorkerRunning(options);
}

export async function stopWebhookWorker(): Promise<void> {
  const boss = bossInstance;
  bossInstance = null;
  bossStarting = null;
  if (boss) await boss.stop();
}

export interface EnqueuedWebhookDelivery extends EmittedWebhookEvent {
  jobId: string | null;
}

export async function emitAndEnqueue(
  accountId: number,
  event: string,
  submissionId?: number,
  data?: unknown,
): Promise<EnqueuedWebhookDelivery[]> {
  const emitted = await emitWebhookEvent(accountId, event, submissionId);
  if (emitted.length === 0) return [];

  const boss = await ensureWorkerRunning();

  return Promise.all(
    emitted.map(async (row) => ({
      ...row,
      jobId: await boss.send(
        WEBHOOK_DELIVER_QUEUE,
        {
          webhookEventId: row.id,
          webhookUrlId: row.webhookUrlId,
          eventUuid: row.uuid,
          eventType: event,
          data,
        },
        {
          retryLimit: WEBHOOK_RETRY_LIMIT,
          retryDelay: WEBHOOK_RETRY_DELAY_SECONDS,
          retryBackoff: true,
        },
      ),
    })),
  );
}
