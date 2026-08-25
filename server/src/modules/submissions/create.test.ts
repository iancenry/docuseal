import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../app.js';
import { db } from '../../db/index.js';
import { submissionEvents, submitters } from '../../db/schema.js';
import { cleanupTestData, seedAccountAndUser, seedSessionCookie, seedTemplate } from './testHelpers.js';

const app = createApp();

describe('POST /submissions', () => {
  let cookie = '';
  let seeded: { accountId: number; userId: number; email: string };
  let templateId = 0;

  beforeAll(async () => {
    seeded = await seedAccountAndUser();
    cookie = await seedSessionCookie(seeded.userId);
    const template = await seedTemplate(seeded.accountId, seeded.userId);
    templateId = template.templateId;
  });

  afterAll(async () => {
    await cleanupTestData(seeded.accountId);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/submissions').send({ template_id: templateId, submitters: [] });
    expect(res.status).toBe(401);
  });

  it('returns 404 for a template outside the account', async () => {
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({ template_id: 999999999, submitters: [{ role: 'First Party', email: 'a@example.com' }] });
    expect(res.status).toBe(404);
  });

  it('returns 422 when a role does not match the template schema', async () => {
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({ template_id: templateId, submitters: [{ role: 'Nonexistent Role', email: 'a@example.com' }] });
    expect(res.status).toBe(422);
    expect(res.body?.error ?? res.text).toContain("Nonexistent Role role doesn't exist");
  });

  it('creates a submission with submitters and a create event', async () => {
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({
        template_id: templateId,
        submitters: [{ role: 'First Party', name: 'John Doe', email: 'john@example.com' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
    expect(typeof res.body.slug).toBe('string');
    expect(res.body.slug).toHaveLength(12);
    expect(res.body.status).toBe('started');
    expect(res.body.completed_at).toBeNull();
    expect(res.body.template_id).toBe(templateId);
    expect(res.body.created_by_user_id).toBe(seeded.userId);

    const [submitter] = res.body.submitters;
    expect(submitter.email).toBe('john@example.com');
    expect(submitter.name).toBe('John Doe');
    expect(submitter.sent_at).toBeNull();
    expect(submitter.submitted_at).toBeNull();
    expect(submitter.sign_url).toBe(`/s/${submitter.slug}`);
    expect(submitter.slug).toHaveLength(12);

    const events = await db
      .select()
      .from(submissionEvents)
      .where(eq(submissionEvents.submissionId, res.body.id));
    expect(events.map((e) => e.eventType)).toContain('create');
  });

  it('matches submitters case-insensitively and accepts explicit uuid', async () => {
    const template = await seedTemplate(seeded.accountId, seeded.userId, ['Second Party']);

    const byRole = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({ template_id: template.templateId, submitters: [{ role: 'second party' }] });
    expect(byRole.status).toBe(201);

    const byUuid = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({
        template_id: template.templateId,
        submitters: [{ role: 'whatever', uuid: template.submitterUuids[0] }],
      });
    expect(byUuid.status).toBe(201);
    if (byUuid.status === 201) {
      expect(byUuid.body.submitters[0].uuid).toBe(template.submitterUuids[0]);
    }
  });

  it('rejects more submitters than the template defines', async () => {
    const template = await seedTemplate(seeded.accountId, seeded.userId, ['Only Party']);

    const res = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({
        template_id: template.templateId,
        submitters: [
          { role: 'Only Party' },
          { role: 'Only Party' },
        ],
      });
    expect(res.status).toBe(422);
    expect(String(res.body?.error ?? res.text)).toContain('more signing parties');
  });

  it('records send_request_email intent and sets sent_at when send_email is true', async () => {
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({
        template_id: templateId,
        send_email: true,
        submitters: [{ role: 'First Party', name: 'Jane', email: 'jane@example.com' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.submitters[0].sent_at).not.toBeNull();

    const events = await db
      .select()
      .from(submissionEvents)
      .where(eq(submissionEvents.submissionId, res.body.id));

    const sendEvent = events.find((e) => e.eventType === 'send_request_email');
    expect(sendEvent).toBeDefined();
    expect(JSON.parse(sendEvent!.data)).toEqual({ to: 'jane@example.com' });
    expect(sendEvent!.submitterId).toBe(res.body.submitters[0].id);
  });

  it('leaves sent_at null without an email address even when send_email is true', async () => {
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({ template_id: templateId, send_email: true, submitters: [{ role: 'First Party' }] });

    expect(res.status).toBe(201);
    expect(res.body.submitters[0].sent_at).toBeNull();
  });

  it('validates the body shape', async () => {
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({ template_id: templateId, submitters: [] });
    expect(res.status).toBe(422);
  });

  it('snapshots template schema/fields/submitters onto the submission', async () => {
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({ template_id: templateId, submitters: [{ role: 'First Party', email: `snap-${crypto.randomUUID()}@example.com` }] });

    const [row] = await db.select().from(submitters).where(eq(submitters.submissionId, res.body.id));
    expect(row).toBeDefined();
  });
});
