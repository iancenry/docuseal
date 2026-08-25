import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../app.js';
import { db } from '../../db/index.js';
import { templateFolders, templateVersions, templates } from '../../db/schema.js';
import { cleanupSeed, seedUserWithSession, type Seed } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const app = createApp();

describe('templates routes', () => {
  let seed: Seed;

  beforeAll(async () => {
    seed = await seedUserWithSession();
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  it('requires authentication', async () => {
    await supertest(app).get('/templates').expect(401);
    await supertest(app).post('/templates').send({ name: 'x' }).expect(401);
  });

  it('creates an empty template with defaults', async () => {
    const res = await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'My Empty Template' })
      .expect(201);

    expect(res.body.name).toBe('My Empty Template');
    expect(typeof res.body.id).toBe('number');
    expect(res.body.slug).toMatch(/^[a-z0-9]{12}$/);
    expect(res.body.source).toBe('native');
    expect(res.body.fields).toEqual([]);
    expect(res.body.schema).toEqual([]);
    expect(res.body.submitters[0].name).toBe('First Party');
    expect(res.body.author.email).toBe(seed.email);
    expect(typeof res.body.folder_id).toBe('number');
    expect(res.body.folder_name).toBe('Default');
    expect(res.body.created_at).toBeTruthy();

    const folders = await db
      .select()
      .from(templateFolders)
      .where(and(eq(templateFolders.accountId, seed.accountId), eq(templateFolders.name, 'Default')));
    expect(folders.length).toBe(1);
  });

  it('creates a template inside a given folder', async () => {
    const folderRes = await supertest(app)
      .post('/template_folders')
      .set('Cookie', seed.cookie)
      .send({ name: 'HR Forms' })
      .expect(201);

    const res = await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'Offer Letter', folder_id: folderRes.body.id })
      .expect(201);

    expect(res.body.folder_id).toBe(folderRes.body.id);
    expect(res.body.folder_name).toBe('HR Forms');
  });

  it('rejects invalid create payloads', async () => {
    await supertest(app).post('/templates').set('Cookie', seed.cookie).send({}).expect(422);
    await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'x', folder_id: 999_999_999 })
      .expect(422);
  });

  it('lists templates with search, filters and count-aware pagination', async () => {
    await supertest(app).post('/templates').set('Cookie', seed.cookie).send({ name: 'Zeta Unique Report' }).expect(201);

    const list = await supertest(app)
      .get('/templates')
      .query({ q: 'zeta unique' })
      .set('Cookie', seed.cookie)
      .expect(200);

    expect(list.body.pagination.count).toBe(1);
    expect(list.body.data.length).toBe(1);
    expect(list.body.data[0].name).toBe('Zeta Unique Report');

    for (let i = 0; i < 3; i++) {
      await supertest(app).post('/templates').set('Cookie', seed.cookie).send({ name: `Paginated ${i}` }).expect(201);
    }

    const page = await supertest(app)
      .get('/templates')
      .query({ q: 'Paginated', per_page: 2, page: 2 })
      .set('Cookie', seed.cookie)
      .expect(200);

    expect(page.body.pagination.count).toBe(3);
    expect(page.body.pagination.per_page).toBe(2);
    expect(page.body.pagination.page).toBe(2);
    expect(page.body.pagination.total_pages).toBe(2);
    expect(page.body.data.length).toBe(1);

    const emptyPage = await supertest(app)
      .get('/templates')
      .query({ q: 'Paginated', per_page: 2, page: 9 })
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(emptyPage.body.data).toEqual([]);
  });

  it('shows a single template and 404s on missing ids', async () => {
    const created = await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'Show Me' })
      .expect(201);

    const shown = await supertest(app)
      .get(`/templates/${created.body.id}`)
      .set('Cookie', seed.cookie)
      .expect(200);

    expect(shown.body.id).toBe(created.body.id);
    expect(shown.body.documents).toEqual([]);

    await supertest(app).get('/templates/999999999').set('Cookie', seed.cookie).expect(404);
    await supertest(app).get('/templates/not-a-number').set('Cookie', seed.cookie).expect(404);
  });

  it('updates name and moves template between folders via PATCH', async () => {
    const created = await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'Before Rename' })
      .expect(201);

    const patched = await supertest(app)
      .patch(`/templates/${created.body.id}`)
      .set('Cookie', seed.cookie)
      .send({ name: 'After Rename' })
      .expect(200);
    expect(patched.body.name).toBe('After Rename');

    const folder = await supertest(app)
      .post('/template_folders')
      .set('Cookie', seed.cookie)
      .send({ name: 'Patched Folder' })
      .expect(201);

    const moved = await supertest(app)
      .patch(`/templates/${created.body.id}`)
      .set('Cookie', seed.cookie)
      .send({ folder_id: folder.body.id })
      .expect(200);
    expect(moved.body.folder_id).toBe(folder.body.id);

    await supertest(app)
      .patch(`/templates/${created.body.id}`)
      .set('Cookie', seed.cookie)
      .send({})
      .expect(422);
  });

  it('archives with DELETE and restores listing semantics', async () => {
    const created = await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'Archive Candidate' })
      .expect(201);

    const del = await supertest(app)
      .delete(`/templates/${created.body.id}`)
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(del.body.archived_at).toBeTruthy();

    const activeList = await supertest(app)
      .get('/templates')
      .query({ q: 'Archive Candidate' })
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(activeList.body.pagination.count).toBe(0);

    const archivedList = await supertest(app)
      .get('/templates')
      .query({ q: 'Archive Candidate', archived: 'true' })
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(archivedList.body.pagination.count).toBe(1);

    await supertest(app).get(`/templates/${created.body.id}`).set('Cookie', seed.cookie).expect(200);
  });

  it('permanently deletes a template with its versions', async () => {
    const created = await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'Doomed Template' })
      .expect(201);

    await supertest(app).post(`/templates/${created.body.id}/versions`).set('Cookie', seed.cookie).expect(200);

    const versionsBefore = await supertest(app)
      .get(`/templates/${created.body.id}/versions`)
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(versionsBefore.body.length).toBe(1);

    await supertest(app)
      .delete(`/templates/${created.body.id}?permanently=true`)
      .set('Cookie', seed.cookie)
      .expect(200);

    await supertest(app).get(`/templates/${created.body.id}`).set('Cookie', seed.cookie).expect(404);

    const orphanVersions = await db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, created.body.id));
    expect(orphanVersions.length).toBe(0);
  });

  it('duplicates a template with a fresh slug', async () => {
    const created = await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'Original Template' })
      .expect(201);

    const clone = await supertest(app)
      .post(`/templates/${created.body.id}/duplicate`)
      .set('Cookie', seed.cookie)
      .expect(201);

    expect(clone.body.id).not.toBe(created.body.id);
    expect(clone.body.name).toBe('Original Template (Clone)');
    expect(clone.body.slug).toMatch(/^[a-z0-9]{12}$/);
    expect(clone.body.slug).not.toBe(created.body.slug);
    expect(clone.body.submitters[0].uuid).not.toBe(created.body.submitters[0].uuid);
  });

  it('moves a template into a nested folder by name', async () => {
    const created = await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'Moveable Template' })
      .expect(201);

    const moved = await supertest(app)
      .post(`/templates/${created.body.id}/move_folder`)
      .set('Cookie', seed.cookie)
      .send({ folder_name: 'Deep Nest', parent_name: 'Outer Space' })
      .expect(200);

    expect(moved.body.folder_name).toBe('Outer Space / Deep Nest');

    const folders = await db
      .select()
      .from(templateFolders)
      .where(and(eq(templateFolders.accountId, seed.accountId), eq(templateFolders.name, 'Deep Nest')));
    expect(folders.length).toBe(1);
    expect(folders[0]!.parentFolderId).not.toBeNull();
  });

  it('lists and shows versions snapshots', async () => {
    const created = await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'Versioned Template' })
      .expect(201);

    await supertest(app).post(`/templates/${created.body.id}/versions`).set('Cookie', seed.cookie).expect(200);
    await supertest(app).post(`/templates/${created.body.id}/versions`).set('Cookie', seed.cookie).expect(200);

    const versions = await supertest(app)
      .get(`/templates/${created.body.id}/versions`)
      .set('Cookie', seed.cookie)
      .expect(200);

    expect(versions.body.length).toBe(1);
    const first = versions.body[0];
    expect(first.id).toBeTruthy();
    expect(first.author.email).toBe(seed.email);
    expect(first.created_at).toBeTruthy();

    const detail = await supertest(app)
      .get(`/templates/${created.body.id}/versions/${first.id}`)
      .set('Cookie', seed.cookie)
      .expect(200);

    expect(detail.body.data.name).toBe('Versioned Template');
    expect(detail.body.data.schema).toEqual([]);
    expect(detail.body.data.dynamic_documents).toEqual([]);
    expect(Array.isArray(detail.body.data.fields)).toBe(true);
    expect(detail.body.data.variables_schema).toEqual({});

    await supertest(app)
      .get(`/templates/${created.body.id}/versions/999999999`)
      .set('Cookie', seed.cookie)
      .expect(404);
  });

  it('scopes templates to the current account', async () => {
    const otherSeed = await seedUserWithSession();
    try {
      const foreignTemplate = await supertest(app)
        .post('/templates')
        .set('Cookie', otherSeed.cookie)
        .send({ name: 'Foreign Template' })
        .expect(201);

      await supertest(app)
        .get(`/templates/${foreignTemplate.body.id}`)
        .set('Cookie', seed.cookie)
        .expect(404);

      await supertest(app)
        .patch(`/templates/${foreignTemplate.body.id}`)
        .set('Cookie', seed.cookie)
        .send({ name: 'Hijack' })
        .expect(404);

      await supertest(app)
        .delete(`/templates/${foreignTemplate.body.id}`)
        .set('Cookie', seed.cookie)
        .expect(404);
    } finally {
      await cleanupSeed(otherSeed);
    }
  });
});
