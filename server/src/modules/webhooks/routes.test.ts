import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../app.js';
import { db } from '../../db/index.js';
import { webhookUrls } from '../../db/schema.js';
import { cleanupWebhookData } from './testHelpers.js';
import { seedAccountAndUser, seedSessionCookie } from '../submissions/testHelpers.js';

const app = createApp();

describe('webhook_urls CRUD routes', () => {
  let cookie = '';
  let otherCookie = '';
  let seeded: { accountId: number; userId: number; email: string };
  let otherSeeded: { accountId: number; userId: number; email: string };
  let createdId = 0;

  beforeAll(async () => {
    seeded = await seedAccountAndUser();
    cookie = await seedSessionCookie(seeded.userId);
    otherSeeded = await seedAccountAndUser();
    otherCookie = await seedSessionCookie(otherSeeded.userId);
  });

  afterAll(async () => {
    await cleanupWebhookData(seeded.accountId);
    await cleanupWebhookData(otherSeeded.accountId);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/webhook_urls');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('creates a webhook url with default events', async () => {
    const res = await request(app)
      .post('/webhook_urls')
      .set('Cookie', cookie)
      .send({ name: 'Primary', webhook_url: 'http://example.test/hooks/incoming' });

    expect(res.status).toBe(201);
    expect(res.body.webhook_url).toBe('http://example.test/hooks/incoming');
    expect(res.body.events).toEqual(['form.viewed', 'form.started', 'form.completed', 'form.declined']);
    expect(res.body.ssl).toBe(false);

    createdId = res.body.id;
    expect(createdId).toBeGreaterThan(0);

    const [row] = await db.select().from(webhookUrls).where(eq(webhookUrls.id, createdId));
    expect(row.accountId).toBe(seeded.accountId);
    expect(row.sha1).toBe(crypto.createHash('sha1').update('http://example.test/hooks/incoming').digest('hex'));
    expect(row.hmacSecret).toMatch(/^whsec_/);
    expect(row.secret).toBe('{}');
    expect(JSON.parse(row.events)).toEqual(['form.viewed', 'form.started', 'form.completed', 'form.declined']);
  });

  it('creates with explicit events and https ssl flag', async () => {
    const res = await request(app)
      .post('/webhook_urls')
      .set('Cookie', cookie)
      .send({
        webhook_url: 'https://example.test/secure',
        events: ['submission.completed', 'template.created'],
        ssl: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.events).toEqual(['submission.completed', 'template.created']);
    expect(res.body.ssl).toBe(true);
  });

  it('rejects non-http(s) schemes', async () => {
    const res = await request(app)
      .post('/webhook_urls')
      .set('Cookie', cookie)
      .send({ webhook_url: 'ftp://example.test/file' });
    expect(res.status).toBe(422);
  });

  it('rejects invalid urls', async () => {
    const res = await request(app)
      .post('/webhook_urls')
      .set('Cookie', cookie)
      .send({ webhook_url: 'not-a-url' });
    expect(res.status).toBe(422);
  });

  it('rejects http when ssl is required', async () => {
    const res = await request(app)
      .post('/webhook_urls')
      .set('Cookie', cookie)
      .send({ webhook_url: 'http://example.test/insecure', ssl: true });
    expect(res.status).toBe(422);
  });

  it('rejects unknown event names', async () => {
    const res = await request(app)
      .post('/webhook_urls')
      .set('Cookie', cookie)
      .send({ webhook_url: 'https://example.test/x', events: ['not.an.event'] });
    expect(res.status).toBe(422);
  });

  it('lists webhook urls with their events', async () => {
    const res = await request(app).get('/webhook_urls').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((row: { id: number }) => row.id);
    expect(ids).toContain(createdId);
    const created = res.body.data.find((row: { id: number }) => row.id === createdId);
    expect(Array.isArray(created.events)).toBe(true);
    expect(created.events.length).toBeGreaterThan(0);
  });

  it('scopes the list to the current account', async () => {
    const foreign = await request(app)
      .post('/webhook_urls')
      .set('Cookie', otherCookie)
      .send({ webhook_url: 'http://other.test/hook' });
    expect(foreign.status).toBe(201);

    const list = await request(app).get('/webhook_urls').set('Cookie', cookie);
    const ids = list.body.data.map((row: { id: number }) => row.id);
    expect(ids).not.toContain(foreign.body.id);
  });

  it('updates via PATCH', async () => {
    const res = await request(app)
      .patch(`/webhook_urls/${createdId}`)
      .set('Cookie', cookie)
      .send({ webhook_url: 'https://example.test/rotated', events: ['submission.completed'] });

    expect(res.status).toBe(200);
    expect(res.body.webhook_url).toBe('https://example.test/rotated');
    expect(res.body.events).toEqual(['submission.completed']);

    const [row] = await db.select().from(webhookUrls).where(eq(webhookUrls.id, createdId));
    expect(row.sha1).toBe(crypto.createHash('sha1').update('https://example.test/rotated').digest('hex'));
  });

  it('updates via PUT', async () => {
    const res = await request(app)
      .put(`/webhook_urls/${createdId}`)
      .set('Cookie', cookie)
      .send({ events: ['form.completed'] });
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual(['form.completed']);
  });

  it('returns 404 for another account webhook on update', async () => {
    const mine = await request(app)
      .post('/webhook_urls')
      .set('Cookie', cookie)
      .send({ webhook_url: 'http://example.test/mine' });

    const res = await request(app)
      .patch(`/webhook_urls/${mine.body.id}`)
      .set('Cookie', otherCookie)
      .send({ webhook_url: 'http://evil.test/hook' });
    expect(res.status).toBe(404);
  });

  it('deletes a webhook url', async () => {
    const created = await request(app)
      .post('/webhook_urls')
      .set('Cookie', cookie)
      .send({ webhook_url: 'http://doomed.test/hook' });

    const res = await request(app).delete(`/webhook_urls/${created.body.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);

    const gone = await request(app).delete(`/webhook_urls/${created.body.id}`).set('Cookie', cookie);
    expect(gone.status).toBe(404);
  });
});
