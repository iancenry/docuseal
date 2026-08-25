import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  accessTokens,
  submissions,
  submitters,
  submissionEvents,
  templateVersions,
  templates,
  users,
} from '../../db/schema.js';
import { cleanupSeed, seedUserWithSession, type Seed } from '../templates/helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const app: Express = createApp();

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('api v1 routes', () => {
  let seed: Seed;
  let apiToken: string;
  let templateId: number;
  let submitterUuid: string;
  let fieldUuid: string;

  const auth = (request: supertest.Request): supertest.Request =>
    request.set('Authorization', `Bearer ${apiToken}`);

  async function createSubmission(payload: Record<string, unknown>): Promise<supertest.Response> {
    return auth(supertest(app).post('/api/submissions').send(payload)).expect(200);
  }

  beforeAll(async () => {
    seed = await seedUserWithSession();
    apiToken = crypto.randomBytes(20).toString('hex');
    await db.insert(accessTokens).values({
      token: apiToken,
      sha256: sha256(apiToken),
      userId: seed.userId,
    });
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  describe('authentication', () => {
    it('rejects missing and invalid tokens with 401', async () => {
      await supertest(app).get('/api/templates').expect(401);
      await supertest(app)
        .get('/api/templates')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
      await supertest(app).get(`/api/templates?api_token=${apiToken}`).expect(200);
    });
  });

  describe('templates', () => {
    it('creates an empty template with Rails-shaped json', async () => {
      const res = await auth(supertest(app).post('/api/templates').send({ name: 'API Template' })).expect(200);

      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.name).toBe('API Template');
      expect(typeof res.body.slug).toBe('string');
      expect(res.body.schema).toEqual([]);
      expect(res.body.fields).toEqual([]);
      expect(res.body.submitters[0].name).toBe('First Party');
      expect(typeof res.body.submitters[0].uuid).toBe('string');
      expect(res.body.variables_schema).toEqual({});
      expect(res.body.preferences).toEqual({});
      expect(res.body.source).toBe('api');
      expect(res.body.archived_at).toBeNull();
      expect(res.body.author.email).toBe(seed.email);
      expect(res.body.author_id).toBe(seed.userId);
      expect(res.body.external_id).toBeNull();
      expect(res.body.application_key).toBeNull();
      expect(typeof res.body.folder_id).toBe('number');
      expect(res.body.folder_name).toBe('Default');
      expect(res.body.shared_link).toBe(false);
      expect(Array.isArray(res.body.documents)).toBe(true);
      expect(res.body.created_at).toBeTruthy();

      templateId = res.body.id;
      submitterUuid = res.body.submitters[0].uuid;
    });

    it('lists templates with cursor pagination meta', async () => {
      const list = await auth(supertest(app).get('/api/templates')).expect(200);

      expect(Array.isArray(list.body.data)).toBe(true);
      expect(list.body.data.length).toBeGreaterThanOrEqual(1);
      expect(list.body.pagination).toEqual({
        count: list.body.data.length,
        next: list.body.data[list.body.data.length - 1]?.id ?? null,
        prev: list.body.data[0]?.id ?? null,
      });

      const filtered = await auth(
        supertest(app).get('/api/templates').query({ q: 'api template' }),
      ).expect(200);
      expect(filtered.body.data.length).toBe(1);
      expect(filtered.body.data[0].name).toBe('API Template');
    });

    it('shows a single template and 404s on unknown ids', async () => {
      const show = await auth(supertest(app).get(`/api/templates/${templateId}`)).expect(200);
      expect(show.body.id).toBe(templateId);
      expect(show.body).toHaveProperty('schema');
      expect(show.body).toHaveProperty('submitters');
      expect(show.body).toHaveProperty('fields');

      await auth(supertest(app).get('/api/templates/999999999')).expect(404);
    });

    it('patches name + fields (via schema alias) and persists a new version', async () => {
      fieldUuid = crypto.randomUUID();
      const fields = [
        {
          uuid: fieldUuid,
          submitter_uuid: submitterUuid,
          name: 'API Field',
          type: 'text',
          required: false,
          areas: [],
        },
      ];

      const patched = await auth(
        supertest(app).patch(`/api/templates/${templateId}`).send({
          name: 'Renamed API Template',
          schema: fields,
        }),
      ).expect(200);

      expect(Object.keys(patched.body).sort()).toEqual(['id', 'updated_at']);
      expect(patched.body.id).toBe(templateId);

      const shown = await auth(supertest(app).get(`/api/templates/${templateId}`)).expect(200);
      expect(shown.body.name).toBe('Renamed API Template');
      expect(shown.body.fields).toHaveLength(1);
      expect(shown.body.fields[0].name).toBe('API Field');

      const versions = await db
        .select()
        .from(templateVersions)
        .where(eq(templateVersions.templateId, templateId))
        .orderBy(desc(templateVersions.id));
      expect(versions.length).toBeGreaterThanOrEqual(1);
      const latestData = JSON.parse(versions[0]!.data) as { fields?: { name?: string }[] };
      expect(latestData.fields?.[0]?.name).toBe('API Field');
    });

    it('archives via PATCH archived flag and filters the index accordingly', async () => {
      const created = await auth(
        supertest(app).post('/api/templates').send({ name: 'Doomed Template' }),
      ).expect(200);

      await auth(
        supertest(app).patch(`/api/templates/${created.body.id}`).send({ archived: true }),
      ).expect(200);

      const activeList = await auth(supertest(app).get('/api/templates')).expect(200);
      expect(activeList.body.data.some((t: { id: number }) => t.id === created.body.id)).toBe(false);

      const archivedList = await auth(
        supertest(app).get('/api/templates').query({ archived: 'true' }),
      ).expect(200);
      expect(archivedList.body.data.some((t: { id: number }) => t.id === created.body.id)).toBe(true);

      const del = await auth(supertest(app).delete(`/api/templates/${created.body.id}`)).expect(200);
      expect(del.body.id).toBe(created.body.id);
      expect(del.body.archived_at).toBeTruthy();
    });

    it('clones a template', async () => {
      const cloned = await auth(supertest(app).post(`/api/templates/${templateId}/clone`)).expect(200);
      expect(cloned.body.id).not.toBe(templateId);
      expect(cloned.body.name).toContain('(Clone)');
      expect(cloned.body.source).toBe('api');
      expect(cloned.body.fields).toHaveLength(1);
      expect(cloned.body.fields[0].uuid).not.toBe(fieldUuid);
    });
  });

  describe('submissions', () => {
    let submissionId: number;
    let submitterSlug: string;

    it('creates a submission from submitters and returns Rails-shaped array', async () => {
      const res = await createSubmission({
        template_id: templateId,
        send_email: false,
        submitters: [
          { role: 'First Party', email: 'Signer@Example.COM', name: 'Jane Doe', values: { [fieldUuid]: 'Hello' } },
        ],
      });

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);

      const item = res.body[0];
      for (const key of ['id', 'slug', 'uuid', 'email', 'status', 'role', 'embed_src', 'application_key', 'preferences', 'values']) {
        expect(item).toHaveProperty(key);
      }
      expect(item.role).toBe('First Party');
      expect(item.email).toBe('signer@example.com');
      expect(item.status).toBe('awaiting');
      expect(item.embed_src).toMatch(new RegExp(`/s/${item.slug}$`));
      expect(item.application_key).toBeNull();
      expect(Array.isArray(item.values)).toBe(true);

      submitterSlug = item.slug;

      const rows = await db.select().from(submitters).where(eq(submitters.slug, item.slug));
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.values)).toEqual({ [fieldUuid]: 'Hello' });

      const subs = await db.select().from(submissions).where(eq(submissions.id, rows[0]!.submissionId));
      expect(subs[0]!.templateId).toBe(templateId);
      expect(subs[0]!.source).toBe('api');
      submissionId = subs[0]!.id;
    });

    it('creates one submission per email in emails mode', async () => {
      const res = await createSubmission({
        template_id: templateId,
        emails: 'first@example.com second@example.com',
        send_email: false,
      });

      expect(res.body).toHaveLength(2);
      expect(res.body[0].email).toBe('first@example.com');
      expect(res.body[1].email).toBe('second@example.com');
      expect(res.body[0].submission_id).not.toBe(res.body[1].submission_id);
    });

    it('returns 422 with error payload on invalid input', async () => {
      await auth(supertest(app).post('/api/submissions').send({})).expect(422);
      await auth(
        supertest(app).post('/api/submissions').send({ template_id: templateId, emails: '' }),
      ).expect(422);
      await auth(
        supertest(app)
          .post('/api/submissions')
          .send({ template_id: templateId, send_email: false, submitters: [{ role: 'Nope' }] }),
      )
        .expect(422)
        .then((res) => expect(res.body.error).toMatch(/role doesn't exist/));
      await auth(
        supertest(app)
          .post('/api/submissions')
          .send({ template_id: 999999999, send_email: false, submitters: [{ role: 'First Party' }] }),
      )
        .expect(422)
        .then((res) => expect(res.body.error).toBe('Template not found'));
    });

    it('indexes submissions with filters and pagination meta', async () => {
      const list = await auth(
        supertest(app)
          .get('/api/submissions')
          .query({ template_id: String(templateId), status: 'pending', q: 'signer@example.com' }),
      ).expect(200);

      expect(list.body.pagination.count).toBeGreaterThanOrEqual(1);
      expect(list.body.pagination.next).toBeTypeOf('number');

      const first = list.body.data.find((s: { id: number }) => s.id === submissionId);
      expect(first).toBeDefined();
      for (const key of [
        'id',
        'name',
        'slug',
        'source',
        'submitters_order',
        'expire_at',
        'created_at',
        'updated_at',
        'archived_at',
        'variables',
        'status',
        'completed_at',
        'audit_log_url',
        'combined_document_url',
        'documents',
        'submitters',
        'template',
        'created_by_user',
      ]) {
        expect(first).toHaveProperty(key);
      }
      expect(first.status).toBe('pending');
      expect(first.audit_log_url).toBeNull();
      expect(first.combined_document_url).toBeNull();
      expect(first.created_by_user.id).toBe(seed.userId);
      expect(first.template.id).toBe(templateId);
      expect(first.template.folder_name).toBe('Default');
      const ser = first.submitters.find((s: { slug: string }) => s.slug === submitterSlug);
      expect(ser.role).toBe('First Party');
      expect(ser.preferences).toEqual({});
    });

    it('shows a submission with events', async () => {
      const res = await auth(supertest(app).get(`/api/submissions/${submissionId}`)).expect(200);
      expect(res.body.id).toBe(submissionId);
      expect(Array.isArray(res.body.submission_events)).toBe(true);
      expect(res.body.submission_events.length).toBeGreaterThanOrEqual(1);
      expect(res.body.submission_events[0].event_type).toBe('create');
    });

    it('lists events and documents metadata for a submission', async () => {
      const events = await auth(supertest(app).get(`/api/submissions/${submissionId}/events`)).expect(200);
      expect(events.body.data.length).toBeGreaterThanOrEqual(1);
      expect(events.body.data[0]).toHaveProperty('event_type');
      expect(events.body.data[0]).toHaveProperty('event_timestamp');

      const docs = await auth(supertest(app).get(`/api/submissions/${submissionId}/documents`)).expect(200);
      expect(docs.body).toEqual({ id: submissionId, documents: [] });

      await auth(supertest(app).get('/api/submissions/999999999/documents')).expect(404);
    });

    it('archives via PATCH and deletes via DELETE', async () => {
      const patchRes = await auth(
        supertest(app).patch(`/api/submissions/${submissionId}`).send({ name: 'Renamed Submission' }),
      ).expect(200);
      expect(patchRes.body.name).toBe('Renamed Submission');

      const archiveRes = await auth(
        supertest(app).delete(`/api/submissions/${submissionId}`),
      ).expect(200);
      expect(archiveRes.body.id).toBe(submissionId);
      expect(archiveRes.body.archived_at).toBeTruthy();

      const row = await db.select().from(submissions).where(eq(submissions.id, submissionId));
      expect(row[0]!.archivedAt).not.toBeNull();

      const archivedList = await auth(
        supertest(app)
          .get('/api/submissions')
          .query({ archived: 'true', template_id: String(templateId) }),
      ).expect(200);
      expect(archivedList.body.data.some((s: { id: number }) => s.id === submissionId)).toBe(true);
    });

    it('exposes completed-submission events feed', async () => {
      const res = await auth(supertest(app).get('/api/events/submission/completed')).expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toHaveProperty('count');
      expect(res.body.pagination).toHaveProperty('next');
      expect(res.body.pagination).toHaveProperty('prev');
    });
  });

  describe('submitters', () => {
    let submitterId: number;

    beforeAll(async () => {
      const res = await createSubmission({
        template_id: templateId,
        send_email: false,
        submitters: [{ role: 'First Party', email: 'lookup@example.com', name: 'Lookup Person' }],
      });
      submitterId = res.body[0].id;
    });

    it('lists submitters with q and submission_id filters', async () => {
      const list = await auth(
        supertest(app).get('/api/submitters').query({ q: 'lookup' }),
      ).expect(200);

      expect(list.body.pagination.count).toBeGreaterThanOrEqual(1);
      const item = list.body.data.find((s: { id: number }) => s.id === submitterId);
      expect(item).toBeDefined();

      for (const key of [
        'id',
        'slug',
        'uuid',
        'name',
        'email',
        'phone',
        'completed_at',
        'declined_at',
        'external_id',
        'application_key',
        'submission_id',
        'metadata',
        'opened_at',
        'sent_at',
        'created_at',
        'updated_at',
        'status',
        'values',
        'documents',
        'preferences',
        'submission_events',
        'role',
        'template',
      ]) {
        expect(item).toHaveProperty(key);
      }
      expect(item.role).toBe('First Party');
      expect(item.status).toBe('awaiting');
      expect(item.template.id).toBe(templateId);
    });

    it('shows a single submitter and 404s on unknown ids', async () => {
      const res = await auth(supertest(app).get(`/api/submitters/${submitterId}`)).expect(200);
      expect(res.body.id).toBe(submitterId);
      expect(res.body.submission_id).toBeGreaterThan(0);

      await auth(supertest(app).get('/api/submitters/999999999')).expect(404);
    });
  });

  describe('embed tokens', () => {
    it('issues an HS256 jwt scoped to the api token hash', async () => {
      const res = await auth(supertest(app).post('/api/embed_tokens').send({ expire_in: 120 })).expect(200);

      expect(res.body.expires_at).toBeTruthy();
      const parts = res.body.token.split('.');
      expect(parts).toHaveLength(3);

      const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
      expect(header.alg).toBe('HS256');
      expect(payload.token_hash).toBe(sha256(apiToken));

      const expectedSig = crypto
        .createHmac('sha256', 'dev-only-secret-change-me')
        .update(`${parts[0]}.${parts[1]}`)
        .digest('base64url');
      expect(parts[2]).toBe(expectedSig);

      const now = Math.floor(Date.now() / 1000);
      expect(payload.exp).toBeGreaterThanOrEqual(now + 100);
      expect(payload.exp).toBeLessThanOrEqual(now + 140);
      expect(new Date(res.body.expires_at).getTime() / 1000).toBeCloseTo(payload.exp, -1);
    });
  });

  describe('reveal_access_token (session auth)', () => {
    const password = 'Sup3rSecret!';

    beforeAll(async () => {
      await db
        .update(users)
        .set({ encryptedPassword: bcrypt.hashSync(password, 10) })
        .where(eq(users.id, seed.userId));
      // Remove the seeded API token so POST /reveal_access_token exercises the create path.
      await db.delete(accessTokens).where(eq(accessTokens.userId, seed.userId));
    });

    it('requires a session', async () => {
      await supertest(app).post('/reveal_access_token').send({ password }).expect(401);
    });

    it('rejects a wrong password with 422', async () => {
      await supertest(app)
        .post('/reveal_access_token')
        .set('Cookie', seed.cookie)
        .send({ password: 'wrong' })
        .expect(422);
    });

    it('creates a token once and reveals the same token afterwards', async () => {
      const first = await supertest(app)
        .post('/reveal_access_token')
        .set('Cookie', seed.cookie)
        .send({ password })
        .expect(200);

      expect(first.body.token).toMatch(/^[0-9a-f]{40}$/);

      const rows = await db
        .select()
        .from(accessTokens)
        .where(and(eq(accessTokens.userId, seed.userId), eq(accessTokens.token, first.body.token)));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sha256).toBe(sha256(first.body.token));

      const second = await supertest(app)
        .post('/reveal_access_token')
        .set('Cookie', seed.cookie)
        .send({ password })
        .expect(200);
      expect(second.body.token).toBe(first.body.token);
    });
  });
});
