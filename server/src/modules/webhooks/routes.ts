import crypto from 'node:crypto';
import type { Express, Request } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { webhookUrls } from '../../db/schema.js';
import { requireUser } from '../../http/auth.js';
import { HttpError, asyncHandler, validateBody } from '../../http/helpers.js';
import { DEFAULT_WEBHOOK_EVENTS, WEBHOOK_URL_EVENTS } from './events.js';
import { serializeWebhookUrl } from './service.js';

const HMAC_SECRET_PREFIX = 'whsec_';
const HMAC_SECRET_BYTES = 24;

function generateHmacSecret(): string {
  return `${HMAC_SECRET_PREFIX}${crypto.randomBytes(HMAC_SECRET_BYTES).toString('base64')}`;
}

const createSchema = z.object({
  name: z.string().optional(),
  webhook_url: z.string().min(1),
  events: z.array(z.enum(WEBHOOK_URL_EVENTS)).optional(),
  ssl: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

function body<T>(req: Request): T {
  return ((req as Request & { parsedBody?: T }).parsedBody ?? {}) as T;
}

function intParam(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validatedWebhookUrl(raw: string, ssl: boolean | undefined): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpError(422, 'webhook_url: must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(422, 'webhook_url: only http and https schemes are allowed');
  }
  if (ssl && parsed.protocol !== 'https:') {
    throw new HttpError(422, 'webhook_url: ssl requires an https:// URL');
  }
  return parsed.toString();
}

async function loadScopedWebhookUrl(req: { currentUser?: { accountId: number }; params: { id?: string } }) {
  const id = intParam(req.params.id);
  if (!id || !req.currentUser) throw new HttpError(404, 'Webhook not found');

  const [row] = await db
    .select()
    .from(webhookUrls)
    .where(and(eq(webhookUrls.id, id), eq(webhookUrls.accountId, req.currentUser.accountId)))
    .limit(1);

  if (!row) throw new HttpError(404, 'Webhook not found');
  return row;
}

interface WebhookUrlInput {
  name?: string;
  webhook_url: string;
  events?: (typeof WEBHOOK_URL_EVENTS)[number][];
  ssl?: boolean;
}

export function registerWebhooksRoutes(app: Express): void {
  app.get(
    '/webhook_urls',
    requireUser,
    asyncHandler(async (req, res) => {
      if (!req.currentUser) throw new HttpError(401, 'authentication required');

      const rows = await db
        .select()
        .from(webhookUrls)
        .where(eq(webhookUrls.accountId, req.currentUser.accountId))
        .orderBy(desc(webhookUrls.id));

      res.json({ data: rows.map(serializeWebhookUrl) });
    }),
  );

  app.post(
    '/webhook_urls',
    requireUser,
    validateBody(createSchema),
    asyncHandler(async (req, res) => {
      if (!req.currentUser) throw new HttpError(401, 'authentication required');

      const input = body<z.infer<typeof createSchema>>(req);
      const url = validatedWebhookUrl(input.webhook_url, input.ssl);

      const [created] = await db
        .insert(webhookUrls)
        .values({
          accountId: req.currentUser.accountId,
          url,
          sha1: crypto.createHash('sha1').update(url).digest('hex'),
          hmacSecret: generateHmacSecret(),
          secret: '{}',
          events: JSON.stringify(input.events ?? DEFAULT_WEBHOOK_EVENTS),
        })
        .returning();

      res.status(201).json(serializeWebhookUrl(created!));
    }),
  );

  const updateHandler = asyncHandler(async (req, res) => {
    const existing = await loadScopedWebhookUrl(req);
    const input = body<z.infer<typeof updateSchema>>(req);

    const values: Partial<typeof webhookUrls.$inferInsert> = { updatedAt: new Date() };

    if (input.webhook_url !== undefined) {
      const url = validatedWebhookUrl(input.webhook_url, input.ssl);
      values.url = url;
      values.sha1 = crypto.createHash('sha1').update(url).digest('hex');
    }
    if (input.events !== undefined) {
      values.events = JSON.stringify(input.events);
    }

    const [updated] = await db
      .update(webhookUrls)
      .set(values)
      .where(eq(webhookUrls.id, existing.id))
      .returning();

    res.json(serializeWebhookUrl(updated!));
  });

  app.patch('/webhook_urls/:id', requireUser, validateBody(updateSchema), updateHandler);
  app.put('/webhook_urls/:id', requireUser, validateBody(updateSchema), updateHandler);

  app.delete(
    '/webhook_urls/:id',
    requireUser,
    asyncHandler(async (req, res) => {
      const existing = await loadScopedWebhookUrl(req);
      await db.delete(webhookUrls).where(eq(webhookUrls.id, existing.id));
      res.json({ id: existing.id });
    }),
  );
}
