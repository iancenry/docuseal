import crypto from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  activeStorageAttachments,
  activeStorageBlobs,
  activeStorageVariantRecords,
  completedDocuments,
  completedSubmitters,
  documentGenerationEvents,
  dynamicDocumentVersions,
  dynamicDocuments,
  searchEntries,
  submissionEvents,
  submissions,
  submitterVersions,
  submitters,
  templateAccesses,
  templateFolders,
  templateSharings,
  templateVersions,
  templates,
} from '../../db/schema.js';
import { Document } from '../../lib/pdfium.js';
import { HttpError } from '../../http/helpers.js';
import type { FolderRow, TemplateRow } from './util.js';
import {
  assertFound,
  ensureDefaultFolderInTx,
  findOrCreateFolderByName,
  generateTemplateSlug,
  parseJsonArray,
  parseJsonObject,
} from './util.js';

export const PDF_CONTENT_TYPE = 'application/pdf';
export const MAX_PDF_SIZE = 50 * 1024 * 1024;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface PdfPageInfo {
  position: number;
  width: number;
  height: number;
}

export interface StoredAttachment {
  attachmentId: number;
  uuid: string;
  blobKey: string;
}

function md5Base64(bytes: Uint8Array): string {
  return crypto.createHash('md5').update(bytes).digest('base64');
}

function sha256Urlsafe(): string {
  return crypto.createHash('sha256').digest('base64url');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) return false;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.byteLength, 1024)));
  return head.startsWith('%PDF-');
}

export function extractPdfPages(bytes: Uint8Array): { pageCount: number; pages: PdfPageInfo[] } {
  let doc: ReturnType<typeof Document.openBytes> | null = null;
  try {
    doc = Document.openBytes(bytes);
    const pageCount = doc.pageCount;
    const pages: PdfPageInfo[] = [];
    for (let index = 0; index < pageCount; index++) {
      const page = doc.getPage(index);
      try {
        pages.push({ position: index, width: round2(page.width), height: round2(page.height) });
      } finally {
        page.close();
      }
    }
    return { pageCount, pages };
  } finally {
    doc?.close();
  }
}

async function storeBlobAndAttachment(
  tx: Tx,
  recordId: number,
  filename: string,
  bytes: Uint8Array,
  metadata: Record<string, unknown>,
): Promise<StoredAttachment> {
  const key = crypto.randomUUID();
  const blobRows = await tx
    .insert(activeStorageBlobs)
    .values({
      key,
      uuid: key,
      filename: filename.slice(0, 255),
      contentType: PDF_CONTENT_TYPE,
      byteSize: bytes.byteLength,
      checksum: md5Base64(bytes),
      serviceName: 'local',
      metadata: JSON.stringify({ ...metadata, data: Buffer.from(bytes).toString('base64') }),
    })
    .returning();
  const blob = blobRows[0];
  if (!blob) throw new HttpError(500, 'failed to store blob');
  const uuid = crypto.randomUUID();
  const attachmentRows = await tx
    .insert(activeStorageAttachments)
    .values({
      blobId: blob.id,
      recordType: 'Template',
      recordId,
      name: 'documents',
      uuid,
    })
    .returning();
  const attachment = attachmentRows[0];
  if (!attachment) throw new HttpError(500, 'failed to create attachment');
  return { attachmentId: attachment.id, uuid, blobKey: key };
}

export async function readStoredBytes(blobRow: BlobRowLike): Promise<Uint8Array> {
  const metadata = parseJsonObject(blobRow.metadata);
  const data = metadata['data'];
  if (typeof data !== 'string') {
    throw new HttpError(404, 'stored blob content is unavailable');
  }
  return new Uint8Array(Buffer.from(data, 'base64'));
}

interface BlobRowLike {
  id: number;
  metadata: string | null;
}

export function defaultSubmittersJson(): string {
  return JSON.stringify([{ name: 'First Party', uuid: crypto.randomUUID() }]);
}

export interface CreateTemplateInput {
  accountId: number;
  authorId: number;
  name?: string;
  folderId?: number | undefined;
  folderName?: string | undefined;
  source?: string;
  externalId?: string | undefined;
  schemaItems?: Record<string, unknown>[];
  fields?: Record<string, unknown>[];
}

export async function resolveFolderForCreate(
  tx: Tx,
  input: Pick<CreateTemplateInput, 'accountId' | 'authorId' | 'folderId' | 'folderName'>,
): Promise<FolderRow> {
  if (typeof input.folderId === 'number') {
    const [folder] = await tx
      .select()
      .from(templateFolders)
      .where(
        and(
          eq(templateFolders.id, input.folderId),
          eq(templateFolders.accountId, input.accountId),
          isNull(templateFolders.archivedAt),
        ),
      )
      .limit(1);
    if (!folder) throw new HttpError(422, 'folder_id: folder not found');
    return folder;
  }
  if (typeof input.folderName === 'string' && input.folderName.trim().length > 0) {
    return findOrCreateFolderByName(tx, input.accountId, input.authorId, input.folderName);
  }
  return ensureDefaultFolderInTx(tx, input.accountId, input.authorId);
}

export async function insertTemplate(tx: Tx, input: CreateTemplateInput): Promise<TemplateRow> {
  const folder = await resolveFolderForCreate(tx, input);
  const slug = await generateTemplateSlug(tx);
  const [row] = await tx
    .insert(templates)
    .values({
      accountId: input.accountId,
      authorId: input.authorId,
      folderId: folder.id,
      name: input.name ?? 'Untitled',
      slug,
      source: input.source ?? 'native',
      externalId: input.externalId ?? null,
      fields: JSON.stringify(input.fields ?? []),
      preferences: '{}',
      schema: JSON.stringify(input.schemaItems ?? []),
      submitters: defaultSubmittersJson(),
    })
    .returning();
  return assertFound(row, 'template could not be created');
}

export function buildVersionData(row: TemplateRow): Record<string, unknown> {
  return {
    name: row.name,
    schema: parseJsonArray(row.schema),
    submitters: parseJsonArray(row.submitters),
    variables_schema: parseJsonObject(row.variablesSchema),
    fields: parseJsonArray(row.fields),
    dynamic_documents: [],
  };
}

export async function findOrCreateVersion(
  tx: Tx,
  row: TemplateRow,
  authorId: number,
): Promise<number> {
  const data = buildVersionData(row);
  const sha1 = crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
  const [existing] = await tx
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, row.id), eq(templateVersions.sha1, sha1)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(templateVersions)
    .values({
      accountId: row.accountId,
      templateId: row.id,
      authorId,
      sha1,
      data: JSON.stringify(data),
    })
    .onConflictDoNothing()
    .returning({ id: templateVersions.id });
  if (created) return created.id;
  const [fallback] = await tx
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, row.id), eq(templateVersions.sha1, sha1)))
    .limit(1);
  return assertFound(fallback, 'version missing').id;
}

export function decodePdfPayload(raw: string): Uint8Array {
  const withoutDataUri = raw.includes(',') && raw.trimStart().startsWith('data:')
    ? raw.slice(raw.indexOf(',') + 1)
    : raw;
  return new Uint8Array(Buffer.from(withoutDataUri.replace(/\s+/g, ''), 'base64'));
}

export interface CreateTemplateFromPdfInput {
  user: { id: number; accountId: number };
  bytes: Uint8Array;
  filename: string;
  name?: string | undefined;
  folderName?: string | undefined;
  externalId?: string | undefined;
}

export async function createTemplateFromPdf(
  input: CreateTemplateFromPdfInput,
): Promise<TemplateRow & { storedAttachment: StoredAttachment }> {
  if (input.bytes.byteLength === 0) {
    throw new HttpError(422, 'PDF file is required');
  }
  if (input.bytes.byteLength > MAX_PDF_SIZE) {
    throw new HttpError(422, 'File exceeds 50MB limit');
  }
  if (!looksLikePdf(input.bytes)) {
    throw new HttpError(422, 'File must be a PDF');
  }

  const { pageCount, pages } = extractPdfPages(input.bytes);

  const baseName = input.filename.replace(/\.[^./\\]+$/, '');
  const name =
    typeof input.name === 'string' && input.name.trim().length > 0 ? input.name.trim() : baseName || 'Untitled';

  return db.transaction(async (tx) => {
    const template = await insertTemplate(tx, {
      accountId: input.user.accountId,
      authorId: input.user.id,
      name,
      folderName: input.folderName,
      source: 'api',
      externalId: input.externalId,
    });

    const storedAttachment = await storeBlobAndAttachment(
      tx,
      template.id,
      input.filename || `${name}.pdf`,
      input.bytes,
      {
        identified: true,
        analyzed: true,
        pdf: { number_of_pages: pageCount, pages },
        sha256_urlsafe: sha256Urlsafe(),
      },
    );

    const schemaItems = [
      {
        attachment_uuid: storedAttachment.uuid,
        uuid: storedAttachment.uuid,
        name,
        filename: input.filename,
        blob_key: storedAttachment.blobKey,
        pages,
      },
    ];

    const [updated] = await tx
      .update(templates)
      .set({ schema: JSON.stringify(schemaItems), updatedAt: new Date() })
      .where(eq(templates.id, template.id))
      .returning();

    const row = assertFound(updated, 'template update failed');
    await findOrCreateVersion(tx, row, input.user.id);

    return { ...row, storedAttachment };
  });
}

function remapUuidsInPlace(value: unknown, mapping: Map<string, string>): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) remapUuidsInPlace(item, mapping);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string' && mapping.has(item)) {
      record[key] = mapping.get(item)!;
    } else {
      remapUuidsInPlace(item, mapping);
    }
  }
}

function cloneWithFreshUuids(
  submittersSource: Record<string, unknown>[],
  fieldsSource: Record<string, unknown>[],
  preferencesSource: Record<string, unknown>,
): { submitters: Record<string, unknown>[]; fields: Record<string, unknown>[]; preferences: Record<string, unknown>; mapping: Map<string, string>; fieldMapping: Map<string, string> } {
  const submitters = structuredClone(submittersSource);
  const fields = structuredClone(fieldsSource);
  const preferences = structuredClone(preferencesSource);
  const mapping = new Map<string, string>();
  const fieldMapping = new Map<string, string>();

  for (const submitter of submitters) {
    const oldUuid = submitter['uuid'];
    const newUuid = crypto.randomUUID();
    if (typeof oldUuid === 'string') mapping.set(oldUuid, newUuid);
    submitter['uuid'] = newUuid;
  }
  for (const field of fields) {
    const oldUuid = field['uuid'];
    const newUuid = crypto.randomUUID();
    if (typeof oldUuid === 'string') fieldMapping.set(oldUuid, newUuid);
    field['uuid'] = newUuid;
  }

  remapUuidsInPlace(submitters, mapping);
  remapUuidsInPlace(fields, fieldMapping);
  remapUuidsInPlace(preferences, mapping);

  return { submitters, fields, preferences, mapping, fieldMapping };
}

export interface DuplicateTemplateResult {
  template: TemplateRow;
}

export async function duplicateTemplate(original: TemplateRow, userId: number): Promise<DuplicateTemplateResult> {
  return db.transaction(async (tx) => {
    const { submitters, fields, preferences, fieldMapping } = cloneWithFreshUuids(
      parseJsonArray(original.submitters),
      parseJsonArray(original.fields),
      parseJsonObject(original.preferences),
    );

    const slug = await generateTemplateSlug(tx);
    const [row] = await tx
      .insert(templates)
      .values({
        accountId: original.accountId,
        authorId: userId,
        folderId: original.folderId,
        name: `${original.name} (Clone)`,
        slug,
        source: original.source,
        externalId: null,
        sharedLink: false,
        variablesSchema: original.variablesSchema,
        fields: JSON.stringify(fields),
        preferences: JSON.stringify(preferences),
        schema: '[]',
        submitters: JSON.stringify(submitters),
      })
      .returning();
    const template = assertFound(row, 'template could not be cloned');

    const attachments = await tx
      .select()
      .from(activeStorageAttachments)
      .where(
        and(
          eq(activeStorageAttachments.recordType, 'Template'),
          eq(activeStorageAttachments.recordId, original.id),
          eq(activeStorageAttachments.name, 'documents'),
        ),
      );

    const blobIds = [...new Set(attachments.map((a) => a.blobId))];
    const blobs = blobIds.length
      ? await tx.select().from(activeStorageBlobs).where(inArray(activeStorageBlobs.id, blobIds))
      : [];
    const blobsById = new Map(blobs.map((b) => [b.id, b]));

    const uuidMap = new Map<string, string>();
    for (const attachment of attachments) {
      const blob = blobsById.get(attachment.blobId);
      if (!blob) continue;
      const stored = await storeBlobAndAttachment(tx, template.id, blob.filename, await readStoredBytes(blob), {
        identified: true,
        analyzed: true,
      });
      uuidMap.set(attachment.uuid, stored.uuid);
    }

    const schemaItems: Record<string, unknown>[] = parseJsonArray(original.schema)
      .map((item): Record<string, unknown> | null => {
        const oldUuid = item['attachment_uuid'];
        if (typeof oldUuid !== 'string' || !uuidMap.has(oldUuid)) return null;
        return { ...item, attachment_uuid: uuidMap.get(oldUuid)!, uuid: uuidMap.get(oldUuid)! };
      })
      .filter((item): item is Record<string, unknown> => item !== null);

    remapUuidsInPlace(schemaItems, fieldMapping);

    const [withSchema] = await tx
      .update(templates)
      .set({ schema: JSON.stringify(schemaItems), updatedAt: new Date() })
      .where(eq(templates.id, template.id))
      .returning();

    const finalRow = assertFound(withSchema, 'template clone failed');

    const accesses = await tx
      .select({ userId: templateAccesses.userId })
      .from(templateAccesses)
      .where(eq(templateAccesses.templateId, original.id));
    if (accesses.length > 0) {
      await tx
        .insert(templateAccesses)
        .values(accesses.map((a) => ({ templateId: template.id, userId: a.userId })))
        .onConflictDoNothing();
    }

    const versions = await tx
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, original.id));
    if (versions.length > 0) {
      await tx
        .insert(templateVersions)
        .values(
          versions.map((v) => ({
            accountId: v.accountId,
            templateId: template.id,
            authorId: userId,
            sha1: v.sha1,
            data: v.data,
          })),
        )
        .onConflictDoNothing();
    }

    return { template: finalRow };
  });
}

export async function destroyTemplateCascade(templateId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const submissionIds = (
      await tx.select({ id: submissions.id }).from(submissions).where(eq(submissions.templateId, templateId))
    ).map((r) => r.id);
    const submitterIds = submissionIds.length
      ? (
          await tx
            .select({ id: submitters.id })
            .from(submitters)
            .where(inArray(submitters.submissionId, submissionIds))
        ).map((r) => r.id)
      : [];

    if (submitterIds.length > 0) {
      await tx.delete(completedDocuments).where(inArray(completedDocuments.submitterId, submitterIds));
      await tx.delete(completedSubmitters).where(inArray(completedSubmitters.submitterId, submitterIds));
      await tx.delete(submitterVersions).where(inArray(submitterVersions.submitterId, submitterIds));
      await tx.delete(documentGenerationEvents).where(inArray(documentGenerationEvents.submitterId, submitterIds));
    }
    if (submissionIds.length > 0) {
      await tx.delete(submissionEvents).where(inArray(submissionEvents.submissionId, submissionIds));
      await tx.delete(submitters).where(inArray(submitters.submissionId, submissionIds));
      await tx.delete(submissions).where(inArray(submissions.id, submissionIds));
    }

    const dynamicDocIds = (
      await tx.select({ id: dynamicDocuments.id }).from(dynamicDocuments).where(eq(dynamicDocuments.templateId, templateId))
    ).map((r) => r.id);
    if (dynamicDocIds.length > 0) {
      await tx.delete(dynamicDocumentVersions).where(inArray(dynamicDocumentVersions.dynamicDocumentId, dynamicDocIds));
      await tx.delete(dynamicDocuments).where(inArray(dynamicDocuments.id, dynamicDocIds));
    }

    const attachments = await tx
      .select({ blobId: activeStorageAttachments.blobId })
      .from(activeStorageAttachments)
      .where(
        and(
          eq(activeStorageAttachments.recordType, 'Template'),
          eq(activeStorageAttachments.recordId, templateId),
        ),
      );
    const blobIds = [...new Set(attachments.map((a) => a.blobId))];
    if (blobIds.length > 0) {
      await tx.delete(activeStorageVariantRecords).where(inArray(activeStorageVariantRecords.blobId, blobIds));
      await tx.delete(activeStorageAttachments).where(
        and(
          eq(activeStorageAttachments.recordType, 'Template'),
          eq(activeStorageAttachments.recordId, templateId),
        ),
      );
      await tx.delete(activeStorageBlobs).where(inArray(activeStorageBlobs.id, blobIds));
    }

    await tx.delete(searchEntries).where(
      and(eq(searchEntries.recordType, 'Template'), eq(searchEntries.recordId, templateId)),
    );
    await tx.delete(templateVersions).where(eq(templateVersions.templateId, templateId));
    await tx.delete(templateAccesses).where(eq(templateAccesses.templateId, templateId));
    await tx.delete(templateSharings).where(eq(templateSharings.templateId, templateId));

    await tx.delete(templates).where(eq(templates.id, templateId));
  });
}

export async function loadTemplateScoped(id: number, accountId: number): Promise<TemplateRow> {
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, id), eq(templates.accountId, accountId)))
    .limit(1);
  return assertFound(row, 'template not found');
}

export async function loadFolderScoped(id: number, accountId: number): Promise<FolderRow> {
  const [row] = await db
    .select()
    .from(templateFolders)
    .where(and(eq(templateFolders.id, id), eq(templateFolders.accountId, accountId)))
    .limit(1);
  return assertFound(row, 'folder not found');
}

export async function collectDescendantFolderIds(rootId: number): Promise<number[]> {
  const ordered: number[] = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await db
      .select({ id: templateFolders.id })
      .from(templateFolders)
      .where(inArray(templateFolders.parentFolderId, frontier));
    frontier = children.map((c) => c.id).filter((id) => !ordered.includes(id));
    ordered.push(...frontier);
  }
  return ordered;
}

export async function deleteFolderPermanently(folder: FolderRow): Promise<void> {
  await db.transaction(async (tx) => {
    const ids = await collectDescendantFolderIds(folder.id);
    const defaultFolder = await ensureDefaultFolderInTx(tx, folder.accountId, folder.authorId);

    for (const id of [...ids].reverse()) {
      await tx.update(templates).set({ folderId: defaultFolder.id }).where(eq(templates.folderId, id));
      await tx.delete(templateFolders).where(eq(templateFolders.id, id));
    }
  });
}
