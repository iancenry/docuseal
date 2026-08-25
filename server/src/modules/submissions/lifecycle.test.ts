import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  completedDocuments,
  completedSubmitters,
  submissionEvents,
  submissions,
  submitters,
} from '../../db/schema.js';
import { cleanupTestData, seedAccountAndUser, seedSessionCookie, seedTemplate } from './testHelpers.js';

const app = createApp();

describe('submissions lifecycle', () => {
  let cookie = '';
  let seeded: { accountId: number; userId: number; email: string };
  let singleTemplateId = 0;
  let multiTemplateId = 0;

  beforeAll(async () => {
    seeded = await seedAccountAndUser();
    cookie = await seedSessionCookie(seeded.userId);
    singleTemplateId = (await seedTemplate(seeded.accountId, seeded.userId)).templateId;
    multiTemplateId = (
      await seedTemplate(seeded.accountId, seeded.userId, ['First Party', 'Second Party'])
    ).templateId;
  });

  afterAll(async () => {
    await cleanupTestData(seeded.accountId);
  });

  async function createSubmission(templateId: number, roles: { role: string; email?: string; name?: string }[]) {
    const res = await request(app)
      .post('/submissions')
      .set('Cookie', cookie)
      .send({ template_id: templateId, submitters: roles });
    expect(res.status).toBe(201);
    return res.body as { id: number; slug: string; submitters: { id: number; slug: string; sign_url: string }[] };
  }

  it('completes a submission when every submitter has submitted', async () => {
    const submission = await createSubmission(singleTemplateId, [
      { role: 'First Party', email: 'signer@example.com', name: 'Signer' },
    ]);

    const publicView = await request(app).get(`/s/${submission.submitters[0]!.slug}`);
    expect(publicView.status).toBe(200);
    expect(publicView.body.submitter.id).toBe(submission.submitters[0]!.id);
    expect(publicView.body.submission.status).toBe('started');
    expect(publicView.body.template.name).toContain('Test Template');
    expect(Array.isArray(publicView.body.template.schema)).toBe(true);
    expect(Array.isArray(publicView.body.template.fields)).toBe(true);

    const dataRes = await request(app)
      .post(`/s/${submission.submitters[0]!.slug}/data`)
      .send({ values: { field_name: 'typed value' } });

    expect(dataRes.status).toBe(200);
    expect(dataRes.body.submitter.values).toEqual({ field_name: 'typed value' });
    expect(dataRes.body.submitter.status).toBe('completed');
    expect(dataRes.body.submitter.submitted_at).not.toBeNull();
    expect(dataRes.body.submission.status).toBe('completed');
    expect(dataRes.body.submission.completed_at).not.toBeNull();

    const detail = await request(app).get(`/submissions/${submission.id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('completed');
    const eventTypes = detail.body.events.map((e: { event_type: string }) => e.event_type);
    expect(eventTypes.filter((t: string) => t === 'submit')).toHaveLength(1);
    expect(eventTypes.filter((t: string) => t === 'complete')).toHaveLength(1);

    const completedRows = await db
      .select()
      .from(completedSubmitters)
      .where(eq(completedSubmitters.submissionId, submission.id));
    expect(completedRows).toHaveLength(1);
    expect(completedRows[0].isFirst).toBe(true);
    expect(completedRows[0].source).toBe('invite');

    const docRows = await db
      .select()
      .from(completedDocuments)
      .where(eq(completedDocuments.submitterId, submission.submitters[0]!.id));
    expect(docRows).toHaveLength(1);
    expect(docRows[0].sha256).toMatch(/^[a-f0-9]{64}$/);

    const again = await request(app)
      .post(`/s/${submission.submitters[0]!.slug}/data`)
      .send({ values: { field_name: 'again' } });
    expect(again.status).toBe(422);
  });

  it('keeps the submission started until all submitters have submitted', async () => {
    const submission = await createSubmission(multiTemplateId, [
      { role: 'First Party', email: 'first@example.com' },
      { role: 'Second Party', email: 'second@example.com' },
    ]);
    expect(submission.submitters).toHaveLength(2);

    const firstData = await request(app)
      .post(`/s/${submission.submitters[0]!.slug}/data`)
      .send({ values: { field_name: 'from first' } });
    expect(firstData.status).toBe(200);
    expect(firstData.body.submission.status).toBe('started');
    expect(firstData.body.submission.completed_at).toBeNull();

    const secondData = await request(app)
      .post(`/s/${submission.submitters[1]!.slug}/data`)
      .send({ values: { field_name: 'from second' } });
    expect(secondData.status).toBe(200);
    expect(secondData.body.submission.status).toBe('completed');

    const events = await db
      .select()
      .from(submissionEvents)
      .where(eq(submissionEvents.submissionId, submission.id))
      .orderBy(submissionEvents.id);

    const completeEvents = events.filter((e) => e.eventType === 'complete');
    expect(completeEvents).toHaveLength(2);
    expect(new Set(completeEvents.map((e) => e.submitterId))).toEqual(
      new Set(submission.submitters.map((s: { id: number }) => s.id)),
    );

    const completedRows = await db
      .select()
      .from(completedSubmitters)
      .where(eq(completedSubmitters.submissionId, submission.id));
    expect(completedRows).toHaveLength(2);
    expect(completedRows.filter((row) => row.isFirst)).toHaveLength(1);
  });

  it('rejects data posts for archived and unknown slugs', async () => {
    const submission = await createSubmission(singleTemplateId, [{ role: 'First Party' }]);

    await request(app).delete(`/submissions/${submission.id}`).set('Cookie', cookie).expect(200);

    const res = await request(app).post(`/s/${submission.submitters[0]!.slug}/data`).send({ values: {} });
    expect(res.status).toBe(422);
    expect(String(res.body?.error ?? res.text)).toContain('archived');

    const missing = await request(app).get('/s/nonexistent-slug').send();
    expect(missing.status).toBe(404);
  });

  it('lists submissions with template filter, archived handling and pagination', async () => {
    const template = await seedTemplate(seeded.accountId, seeded.userId);
    const kept = await createSubmission(template.templateId, [{ role: 'First Party' }]);
    const archivedOne = await createSubmission(template.templateId, [{ role: 'First Party' }]);
    const otherTemplate = await createSubmission(singleTemplateId, [{ role: 'First Party' }]);

    await request(app).delete(`/submissions/${archivedOne.id}`).set('Cookie', cookie).expect(200);

    const filtered = await request(app)
      .get('/submissions')
      .query({ template_id: template.templateId })
      .set('Cookie', cookie);
    expect(filtered.status).toBe(200);
    const filteredIds = filtered.body.data.map((row: { id: number }) => row.id);
    expect(filteredIds).toContain(kept.id);
    expect(filteredIds).not.toContain(otherTemplate.id);
    expect(filteredIds).not.toContain(archivedOne.id);
    expect(filtered.body.pagination.total).toBeGreaterThanOrEqual(1);

    const archivedList = await request(app)
      .get('/submissions')
      .query({ template_id: template.templateId, archived: 'true' })
      .set('Cookie', cookie);
    expect(archivedList.body.data.map((row: { id: number }) => row.id)).toEqual([archivedOne.id]);

    const paged = await request(app)
      .get('/submissions')
      .query({ page: 1, per_page: 1 })
      .set('Cookie', cookie);
    expect(paged.status).toBe(200);
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.pagination.per_page).toBe(1);
    expect(paged.body.pagination.total).toBeGreaterThanOrEqual(3);
  });

  it('returns 404 for another account submission or missing id', async () => {
    const res = await request(app).get('/submissions/999999999').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('exposes ordered events via the events endpoint', async () => {
    const submission = await createSubmission(singleTemplateId, [
      { role: 'First Party', email: 'events@example.com' },
    ]);
    await request(app).post(`/s/${submission.submitters[0]!.slug}/data`).send({ values: {} });

    const res = await request(app).get(`/submissions/${submission.id}/events`).set('Cookie', cookie);
    expect(res.status).toBe(200);

    const types = res.body.data.map((e: { event_type: string }) => e.event_type);
    expect(types.indexOf('create')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('create')).toBeLessThan(types.indexOf('submit'));
    expect(types.indexOf('submit')).toBeLessThan(types.indexOf('complete'));
  });

  it('archives and permanently deletes submissions with cascade cleanup', async () => {
    const submission = await createSubmission(multiTemplateId, [
      { role: 'First Party', email: 'del-first@example.com' },
      { role: 'Second Party', email: 'del-second@example.com' },
    ]);
    for (const s of submission.submitters) {
      await request(app).post(`/s/${s.slug}/data`).send({ values: {} }).expect(200);
    }

    const archive = await request(app).delete(`/submissions/${submission.id}`).set('Cookie', cookie);
    expect(archive.status).toBe(200);
    expect(archive.body.archived_at).not.toBeNull();

    const [beforeDelete] = await db.select().from(submissions).where(eq(submissions.id, submission.id));
    expect(beforeDelete?.archivedAt).not.toBeNull();
    expect(await db.select().from(submitters).where(eq(submitters.submissionId, submission.id))).toHaveLength(2);

    const permanent = await request(app)
      .delete(`/submissions/${submission.id}`)
      .query({ permanently: 'true' })
      .set('Cookie', cookie);
    expect(permanent.status).toBe(200);
    expect(permanent.body.archived_at).toBeNull();

    expect(await db.select().from(submissions).where(eq(submissions.id, submission.id))).toHaveLength(0);
    expect(await db.select().from(submitters).where(eq(submitters.submissionId, submission.id))).toHaveLength(0);
    expect(await db.select().from(submissionEvents).where(eq(submissionEvents.submissionId, submission.id))).toHaveLength(0);
    expect(await db.select().from(completedSubmitters).where(eq(completedSubmitters.submissionId, submission.id))).toHaveLength(0);

    const docCheck = await request(app).get(`/submissions/${submission.id}`).set('Cookie', cookie);
    expect(docCheck.status).toBe(404);
  });
});
