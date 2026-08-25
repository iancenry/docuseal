import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  activeStorageAttachments,
  activeStorageBlobs,
  templateFolders,
} from '../../db/schema.js';
import { cleanupSeed, minimalPdfBytes, seedUserWithSession, type Seed } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const app = createApp();

describe('template pdf upload routes', () => {
  let seed: Seed;

  beforeAll(async () => {
    seed = await seedUserWithSession();
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  it('creates a template from a multipart PDF upload', async () => {
    const res = await supertest(app)
      .post('/templates/pdf')
      .set('Cookie', seed.cookie)
      .field('name', 'Uploaded Contract')
      .attach('file', Buffer.from(minimalPdfBytes()), { filename: 'test-contract.pdf', contentType: 'application/pdf' })
      .expect(201);

    const templateId = res.body.id;
    expect(res.body.name).toBe('Uploaded Contract');
    expect(res.body.source).toBe('api');
    expect(res.body.schema.length).toBe(1);

    const schemaItem = res.body.schema[0];
    expect(schemaItem.attachment_uuid).toBeTruthy();
    expect(schemaItem.pages[0]).toMatchObject({ position: 0, width: 612, height: 792 });

    expect(res.body.documents.length).toBe(1);
    expect(res.body.documents[0].filename).toBe('test-contract.pdf');
    expect(res.body.documents[0].uuid).toBe(schemaItem.attachment_uuid);
    expect(res.body.documents[0].metadata.pdf.number_of_pages).toBe(1);
    expect(res.body.documents[0].metadata.data).toBeUndefined();

    const attachments = await db
      .select()
      .from(activeStorageAttachments)
      .where(
        and(
          eq(activeStorageAttachments.recordType, 'Template'),
          eq(activeStorageAttachments.recordId, templateId),
        ),
      );
    expect(attachments.length).toBe(1);
    expect(attachments[0]!.name).toBe('documents');

    const blobRows = await db
      .select()
      .from(activeStorageBlobs)
      .where(eq(activeStorageBlobs.id, attachments[0]!.blobId));
    const blob = blobRows[0]!;
    expect(blob.contentType).toBe('application/pdf');
    expect(blob.byteSize).toBe(minimalPdfBytes().byteLength);
    expect(blob.serviceName).toBe('local');

    const versions = await supertest(app)
      .get(`/templates/${templateId}/versions`)
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(versions.body.length).toBe(1);

    const versionDetail = await supertest(app)
      .get(`/templates/${templateId}/versions/${versions.body[0]!.id}`)
      .set('Cookie', seed.cookie)
      .expect(200);
    expect(versionDetail.body.data.schema[0].pages[0].width).toBe(612);
  });

  it('creates a template from a base64 JSON payload', async () => {
    const base64 = Buffer.from(minimalPdfBytes()).toString('base64');

    const res = await supertest(app)
      .post('/templates/pdf')
      .set('Cookie', seed.cookie)
      .send({ pdf_base64: base64, name: 'Base64 Doc', folder_name: 'Uploads Folder' })
      .expect(201);

    expect(res.body.name).toBe('Base64 Doc');
    expect(res.body.folder_name).toBe('Uploads Folder');

    const folders = await db
      .select()
      .from(templateFolders)
      .where(and(eq(templateFolders.accountId, seed.accountId), eq(templateFolders.name, 'Uploads Folder')));
    expect(folders.length).toBe(1);
  });

  it('rejects non-PDF payloads', async () => {
    await supertest(app)
      .post('/templates/pdf')
      .set('Cookie', seed.cookie)
      .send({ pdf_base64: Buffer.from('definitely not a pdf').toString('base64') })
      .expect(422);

    await supertest(app).post('/templates/pdf').set('Cookie', seed.cookie).send({}).expect(422);
  });

  it('duplicates an uploaded template with fresh document uuids', async () => {
    const uploaded = await supertest(app)
      .post('/templates/pdf')
      .set('Cookie', seed.cookie)
      .attach('file', Buffer.from(minimalPdfBytes()), { filename: 'test-dup-source.pdf', contentType: 'application/pdf' })
      .expect(201);

    const clone = await supertest(app)
      .post(`/templates/${uploaded.body.id}/duplicate`)
      .set('Cookie', seed.cookie)
      .expect(201);

    expect(clone.body.name).toBe(`${uploaded.body.name} (Clone)`);
    expect(clone.body.schema.length).toBe(1);
    expect(clone.body.schema[0].attachment_uuid).not.toBe(uploaded.body.schema[0].attachment_uuid);
    expect(clone.body.submitters[0].uuid).not.toBe(uploaded.body.submitters[0].uuid);

    const originalDocs = uploaded.body.documents[0];
    const clonedDocs = clone.body.documents[0];
    expect(clonedDocs.uuid).not.toBe(originalDocs.uuid);
    expect(clonedDocs.filename).toBe(originalDocs.filename);

    const cloneAttachments = await db
      .select()
      .from(activeStorageAttachments)
      .where(
        and(
          eq(activeStorageAttachments.recordType, 'Template'),
          eq(activeStorageAttachments.recordId, clone.body.id),
        ),
      );
    expect(cloneAttachments.length).toBe(1);

    const sourceAttachments = await db
      .select()
      .from(activeStorageAttachments)
      .where(
        and(
          eq(activeStorageAttachments.recordType, 'Template'),
          eq(activeStorageAttachments.recordId, uploaded.body.id),
        ),
      );
    expect(sourceAttachments.length).toBe(1);
    const sourceBlob = await db
      .select()
      .from(activeStorageBlobs)
      .where(eq(activeStorageBlobs.id, sourceAttachments[0]!.blobId))
      .then((rows) => rows[0]);
    const cloneBlob = await db
      .select()
      .from(activeStorageBlobs)
      .where(eq(activeStorageBlobs.id, cloneAttachments[0]!.blobId))
      .then((rows) => rows[0]);

    expect(cloneBlob!.key).not.toBe(sourceBlob!.key);
    expect(cloneBlob!.checksum).toBe(sourceBlob!.checksum);
    expect(cloneBlob!.byteSize).toBe(sourceBlob!.byteSize);
  });
});
