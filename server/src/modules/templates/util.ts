import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { templateFolders, templates } from '../../db/schema.js';
import { HttpError } from '../../http/helpers.js';

export const DEFAULT_FOLDER_NAME = 'Default';
export const DEFAULT_SUBMITTER_NAME = 'First Party';

export type FolderRow = typeof templateFolders.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | Tx;

export function bodyOf<T>(req: Request): T {
  return (req.parsedBody ?? {}) as T;
}

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomToken(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SLUG_ALPHABET[crypto.randomInt(SLUG_ALPHABET.length)];
  }
  return out;
}

export async function generateTemplateSlug(tx: DbOrTx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = randomToken(12);
    const [existing] = await tx
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  throw new HttpError(500, 'unable to generate a unique template slug');
}

export function assertFound<T>(row: T | undefined | null, message = 'not found'): T {
  if (row === undefined || row === null) {
    throw new HttpError(404, message);
  }
  return row;
}

export function parseJsonArray(value: string | null): Record<string, unknown>[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export interface Paging {
  page: number;
  perPage: number;
  offset: number;
}

export const pagingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(15),
});

export function pagingOf(query: { page?: number; per_page?: number }): Paging {
  const page = query.page ?? 1;
  const perPage = query.per_page ?? 15;
  return { page, perPage, offset: (page - 1) * perPage };
}

export function paginationMeta(count: number, paging: Paging): Record<string, number> {
  return {
    page: paging.page,
    per_page: paging.perPage,
    count,
    total_pages: Math.max(Math.ceil(count / paging.perPage), 1),
  };
}

export function splitFullName(rawName: string): { parentName: string | null; name: string } {
  const parts = rawName.split(' / ', 2).map((part) => part.trim());
  if (parts.length === 2 && parts[1] !== undefined && parts[1].length > 0 && parts[0] !== undefined) {
    return { parentName: parts[0], name: parts[1] };
  }
  return { parentName: null, name: parts[0] ?? rawName.trim() };
}

async function findFolderInTx(
  tx: DbOrTx,
  accountId: number,
  name: string,
  parentFolderId: number | null,
): Promise<FolderRow | undefined> {
  const conditions =
    parentFolderId === null
      ? and(
          eq(templateFolders.accountId, accountId),
          eq(templateFolders.name, name),
          isNull(templateFolders.parentFolderId),
        )
      : and(
          eq(templateFolders.accountId, accountId),
          eq(templateFolders.name, name),
          eq(templateFolders.parentFolderId, parentFolderId),
        );
  const [row] = await tx.select().from(templateFolders).where(conditions).limit(1);
  return row ?? undefined;
}

export async function ensureFolderInTx(
  tx: DbOrTx,
  accountId: number,
  authorId: number,
  name: string,
  parentFolderId: number | null,
): Promise<FolderRow> {
  const existing = await findFolderInTx(tx, accountId, name, parentFolderId);
  if (existing) return existing;
  const [created] = await tx
    .insert(templateFolders)
    .values({ accountId, authorId, name, parentFolderId })
    .returning();
  return assertFound(created, 'folder could not be created');
}

export async function ensureDefaultFolderInTx(
  tx: DbOrTx,
  accountId: number,
  authorId: number,
): Promise<FolderRow> {
  return ensureFolderInTx(tx, accountId, authorId, DEFAULT_FOLDER_NAME, null);
}

export async function findOrCreateFolderByName(
  tx: DbOrTx,
  accountId: number,
  authorId: number,
  rawName: string,
): Promise<FolderRow> {
  const trimmed = rawName.trim();
  if (trimmed.length === 0 || trimmed === DEFAULT_FOLDER_NAME) {
    return ensureDefaultFolderInTx(tx, accountId, authorId);
  }
  const { parentName, name } = splitFullName(trimmed);
  let parentId: number | null = null;
  if (parentName !== null) {
    const parent = await ensureFolderInTx(tx, accountId, authorId, parentName, null);
    parentId = parent.id;
  }
  return ensureFolderInTx(tx, accountId, authorId, name, parentId);
}
