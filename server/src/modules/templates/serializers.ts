import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  activeStorageAttachments,
  activeStorageBlobs,
  templateFolders,
  templates,
  users,
} from '../../db/schema.js';
import type { FolderRow, TemplateRow } from './util.js';
import { parseJsonArray, parseJsonObject } from './util.js';

type UserRow = typeof users.$inferSelect;
type AttachmentRow = typeof activeStorageAttachments.$inferSelect;
type BlobRow = typeof activeStorageBlobs.$inferSelect;

export interface AuthorJson {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface DocumentJson {
  id: number;
  uuid: string;
  filename: string;
  url: string | null;
  preview_image_url: string | null;
  metadata: Record<string, unknown>;
}

export interface TemplateJson {
  id: number;
  name: string;
  slug: string;
  schema: Record<string, unknown>[];
  submitters: Record<string, unknown>[];
  fields: Record<string, unknown>[];
  variables_schema: Record<string, unknown>;
  preferences: Record<string, unknown>;
  source: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  author_id: number;
  author: AuthorJson | null;
  external_id: string | null;
  application_key: string | null;
  folder_id: number;
  folder_name: string | null;
  shared_link: boolean;
  documents: DocumentJson[];
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function serializeAuthor(row: UserRow | undefined): AuthorJson | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    first_name: row.firstName,
    last_name: row.lastName,
  };
}

export function fullName(row: UserRow): string {
  const parts = [row.firstName, row.lastName].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return parts.join(' ');
}

export function folderFullName(folder: FolderRow, parent: FolderRow | null): string {
  if (folder.parentFolderId !== null && parent) {
    return `${parent.name} / ${folder.name}`;
  }
  if (folder.parentFolderId !== null) {
    return folder.name;
  }
  return folder.name;
}

export function serializeFolder(folder: FolderRow, parent: FolderRow | null): Record<string, unknown> {
  return {
    id: folder.id,
    name: folder.name,
    parent_folder_id: folder.parentFolderId,
    full_name: folderFullName(folder, parent),
    archived_at: iso(folder.archivedAt),
    created_at: iso(folder.createdAt),
    updated_at: iso(folder.updatedAt),
  };
}

function publicBlobMetadata(metadata: string | null): Record<string, unknown> {
  const parsed = parseJsonObject(metadata);
  delete parsed['data'];
  return parsed;
}

export async function loadSchemaDocuments(
  templateId: number,
  schemaItems: Record<string, unknown>[],
): Promise<{ attachments: AttachmentRow[]; blobsById: Map<number, BlobRow> }> {
  const uuids = schemaItems
    .map((item) => item['attachment_uuid'])
    .filter((value): value is string => typeof value === 'string');
  if (uuids.length === 0) {
    return { attachments: [], blobsById: new Map() };
  }
  const attachmentRows = await db
    .select()
    .from(activeStorageAttachments)
    .where(
      and(
        eq(activeStorageAttachments.recordType, 'Template'),
        eq(activeStorageAttachments.recordId, templateId),
        inArray(activeStorageAttachments.uuid, uuids),
      ),
    );
  const blobIds = [...new Set(attachmentRows.map((row) => row.blobId))];
  const blobRows = blobIds.length
    ? await db.select().from(activeStorageBlobs).where(inArray(activeStorageBlobs.id, blobIds))
    : [];
  return { attachments: attachmentRows, blobsById: new Map(blobRows.map((b) => [b.id, b])) };
}

export function buildDocumentsJson(
  schemaItems: Record<string, unknown>[],
  attachments: AttachmentRow[],
  blobsById: Map<number, BlobRow>,
): DocumentJson[] {
  const entries: (DocumentJson | null)[] = schemaItems
    .map((item) => item['attachment_uuid'])
    .filter((uuid): uuid is string => typeof uuid === 'string')
    .map((uuid): DocumentJson | null => {
      const attachment = attachments.find((a) => a.uuid === uuid);
      if (!attachment) return null;
      const blob = blobsById.get(attachment.blobId);
      return {
        id: attachment.id,
        uuid: attachment.uuid,
        filename: blob?.filename ?? '',
        url: null,
        preview_image_url: null,
        metadata: blob ? publicBlobMetadata(blob.metadata) : {},
      };
    });
  return entries.filter((entry): entry is DocumentJson => entry !== null);
}

async function folderWithParent(folderId: number): Promise<{ folder: FolderRow; parent: FolderRow | null } | null> {
  const [folder] = await db.select().from(templateFolders).where(eq(templateFolders.id, folderId)).limit(1);
  if (!folder) return null;
  if (folder.parentFolderId === null) return { folder, parent: null };
  const [parent] = await db
    .select()
    .from(templateFolders)
    .where(eq(templateFolders.id, folder.parentFolderId))
    .limit(1);
  return { folder, parent: parent ?? null };
}

export async function serializeTemplate(row: TemplateRow): Promise<TemplateJson> {
  const [authorRow] = await db.select().from(users).where(eq(users.id, row.authorId)).limit(1);

  let folderPair: { folder: FolderRow; parent: FolderRow | null } | null = null;
  try {
    folderPair = await folderWithParent(row.folderId);
  } catch {
    folderPair = null;
  }

  const schemaItems = parseJsonArray(row.schema);
  const { attachments, blobsById } = await loadSchemaDocuments(row.id, schemaItems);

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    schema: schemaItems,
    submitters: parseJsonArray(row.submitters),
    fields: parseJsonArray(row.fields),
    variables_schema: parseJsonObject(row.variablesSchema),
    preferences: parseJsonObject(row.preferences),
    source: row.source,
    created_at: iso(row.createdAt)!,
    updated_at: iso(row.updatedAt)!,
    archived_at: iso(row.archivedAt),
    author_id: row.authorId,
    author: serializeAuthor(authorRow),
    external_id: row.externalId,
    application_key: row.externalId,
    folder_id: row.folderId,
    folder_name: folderPair ? folderFullName(folderPair.folder, folderPair.parent) : null,
    shared_link: row.sharedLink,
    documents: buildDocumentsJson(schemaItems, attachments, blobsById),
  };
}

export interface VersionSummaryJson {
  id: number;
  created_at: string;
  author: { email: string; full_name: string };
}

export interface VersionDetailJson extends VersionSummaryJson {
  data: Record<string, unknown>;
}

interface VersionRowShape {
  id: number;
  createdAt: Date;
  authorId: number;
  data: string;
}

function versionAuthor(row: VersionRowShape, authorRow: UserRow | undefined) {
  return {
    email: authorRow?.email ?? '',
    full_name: authorRow ? fullName(authorRow) : '',
  };
}

export function serializeVersionSummary(
  row: VersionRowShape,
  authorRow: UserRow | undefined,
): VersionSummaryJson {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    author: versionAuthor(row, authorRow),
  };
}

export function serializeVersionDetail(
  row: VersionRowShape,
  authorRow: UserRow | undefined,
): VersionDetailJson {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.data);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = {};
  }
  return { ...serializeVersionSummary(row, authorRow), data };
}
