import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../app.js';
import { db } from '../../db/index.js';
import { templateFolders, templates } from '../../db/schema.js';
import { cleanupSeed, seedUserWithSession, type Seed } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const app = createApp();

describe('template folders routes', () => {
  let seed: Seed;

  beforeAll(async () => {
    seed = await seedUserWithSession();
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  it('creates folders', async () => {
    const res = await supertest(app)
      .post('/template_folders')
      .set('Cookie', seed.cookie)
      .send({ name: 'Contracts' })
      .expect(201);

    expect(res.body.name).toBe('Contracts');
    expect(res.body.parent_folder_id).toBeNull();
    expect(res.body.full_name).toBe('Contracts');

    await supertest(app).post('/template_folders').set('Cookie', seed.cookie).send({}).expect(422);
  });

  it('lists folders with search and pagination meta', async () => {
    for (const name of ['Alpha Folder', 'Beta Folder', 'Gamma Stuff']) {
      await supertest(app).post('/template_folders').set('Cookie', seed.cookie).send({ name }).expect(201);
    }

    const all = await supertest(app).get('/template_folders').set('Cookie', seed.cookie).expect(200);
    expect(all.body.data.length).toBeGreaterThanOrEqual(3);
    expect(all.body.pagination.count).toBe(all.body.data.length);
    expect(typeof all.body.pagination.total_pages).toBe('number');

    const filtered = await supertest(app)
      .get('/template_folders')
      .query({ q: 'folder' })
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(filtered.body.pagination.count).toBe(2);

    const paged = await supertest(app)
      .get('/template_folders')
      .query({ per_page: 2, page: 1 })
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(paged.body.data.length).toBeLessThanOrEqual(2);
  });

  it('renames folders but protects the Default folder', async () => {
    const folder = await supertest(app)
      .post('/template_folders')
      .set('Cookie', seed.cookie)
      .send({ name: 'Old Name' })
      .expect(201);

    const renamed = await supertest(app)
      .patch(`/template_folders/${folder.body.id}`)
      .set('Cookie', seed.cookie)
      .send({ name: 'New Name' })
      .expect(200);
    expect(renamed.body.name).toBe('New Name');

    await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'Default Trigger' })
      .expect(201);

    const defaultFolders = await db
      .select()
      .from(templateFolders)
      .where(and(eq(templateFolders.accountId, seed.accountId), eq(templateFolders.name, 'Default')));
    expect(defaultFolders.length).toBe(1);

    await supertest(app)
      .patch(`/template_folders/${defaultFolders[0]!.id}`)
      .set('Cookie', seed.cookie)
      .send({ name: 'Renamed Default' })
      .expect(422);
  });

  it('archives a folder with DELETE', async () => {
    const folder = await supertest(app)
      .post('/template_folders')
      .set('Cookie', seed.cookie)
      .send({ name: 'Doomed Folder' })
      .expect(201);

    const del = await supertest(app)
      .delete(`/template_folders/${folder.body.id}`)
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(del.body.archived_at).toBeTruthy();

    const list = await supertest(app)
      .get('/template_folders')
      .query({ q: 'Doomed Folder' })
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(list.body.pagination.count).toBe(0);
  });

  it('permanently deletes a folder and moves its templates to Default', async () => {
    const folder = await supertest(app)
      .post('/template_folders')
      .set('Cookie', seed.cookie)
      .send({ name: 'Vanishing Folder' })
      .expect(201);

    const template = await supertest(app)
      .post('/templates')
      .set('Cookie', seed.cookie)
      .send({ name: 'Orphan To Be', folder_id: folder.body.id })
      .expect(201);

    await supertest(app)
      .delete(`/template_folders/${folder.body.id}?permanently=true`)
      .set('Cookie', seed.cookie)
      .expect(200);

    const folderRows = await db
      .select()
      .from(templateFolders)
      .where(eq(templateFolders.id, folder.body.id));
    expect(folderRows.length).toBe(0);

    const movedTemplate = await db
      .select()
      .from(templates)
      .where(eq(templates.id, template.body.id))
      .then((rows) => rows[0]);
    expect(movedTemplate).toBeTruthy();
    expect(movedTemplate!.folderId).not.toBe(folder.body.id);

    const defaultFolder = await db
      .select()
      .from(templateFolders)
      .where(
        and(
          eq(templateFolders.accountId, seed.accountId),
          eq(templateFolders.name, 'Default'),
        ),
      )
      .then((rows) => rows[0]);
    expect(defaultFolder).toBeTruthy();
    expect(movedTemplate!.folderId).toBe(defaultFolder!.id);
  });
});
