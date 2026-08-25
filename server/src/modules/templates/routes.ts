import fs from 'node:fs/promises';
import { Router, type Express, type Request } from 'express';
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  templateFolders,
  templateVersions,
  templates,
  users,
} from '../../db/schema.js';
import { asyncHandler, HttpError, validateBody } from '../../http/helpers.js';
import { requireUser } from '../../http/auth.js';
import {
  serializeFolder,
  serializeTemplate,
  serializeVersionDetail,
  serializeVersionSummary,
} from './serializers.js';
import {
  createTemplateFromPdf,
  decodePdfPayload,
  deleteFolderPermanently,
  destroyTemplateCascade,
  duplicateTemplate,
  findOrCreateVersion,
  insertTemplate,
  loadFolderScoped,
  loadTemplateScoped,
} from './service.js';
import type { FormidableFiles } from './multipart.js';
import { parseMultipart } from './multipart.js';
import {
  assertFound,
  bodyOf,
  DEFAULT_FOLDER_NAME,
  findOrCreateFolderByName,
  paginationMeta,
  pagingOf,
  pagingQuerySchema,
} from './util.js';

const idSchema = z.coerce.number().int().positive();

function idParam(req: Request, name = 'id'): number {
  const parsed = idSchema.safeParse(req.params[name]);
  if (!parsed.success) throw new HttpError(404, 'not found');
  return parsed.data;
}

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? String(value[value.length - 1]) : undefined;
  if (value === undefined || value === null) return undefined;
  return String(value);
}

const listTemplatesQuerySchema = pagingQuerySchema.extend({
  folder_id: z.coerce.number().int().positive().optional(),
  archived: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
  search: z.string().optional(),
});

const createTemplateBodySchema = z.object({
  name: z.string().trim().min(1),
  folder_id: z.coerce.number().int().positive().optional(),
  folder_name: z.string().trim().min(1).optional(),
});

const updateTemplateBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    folder_id: z.coerce.number().int().positive().optional(),
  })
  .refine((value) => value.name !== undefined || value.folder_id !== undefined, {
    message: 'name or folder_id is required',
  });

const moveFolderBodySchema = z
  .object({
    folder_id: z.coerce.number().int().positive().optional(),
    folder_name: z.string().trim().min(1).optional(),
    parent_name: z.string().trim().optional(),
  })
  .refine((value) => value.folder_id !== undefined || value.folder_name !== undefined, {
    message: 'folder_id or folder_name is required',
  });

const pdfBase64BodySchema = z.object({
  pdf_base64: z.string().min(1).optional(),
  pdf: z.string().min(1).optional(),
  base64: z.boolean().optional(),
});

const createFolderBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  parent_folder_id: z.coerce.number().int().positive().optional(),
});

const updateFolderBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
});

async function loadAuthorMap(authorIds: number[]): Promise<Map<number, typeof users.$inferSelect>> {
  const rows = authorIds.length ? await db.select().from(users).where(inArray(users.id, authorIds)) : [];
  return new Map(rows.map((row) => [row.id, row]));
}

function extractUploadedPdf(files: FormidableFiles): { filepath: string; originalFilename: string } | null {
  for (const key of ['file', 'files', 'pdf', 'document', 'documents']) {
    const entry = files[key];
    if (!entry) continue;
    const candidate = Array.isArray(entry) ? entry[0] : entry;
    if (candidate) return candidate;
  }
  return null;
}

async function readPdfBytes(req: Request): Promise<{ bytes: Uint8Array; filename: string; fields: Record<string, string | undefined> }> {
  const contentType = req.headers['content-type'] ?? '';
  if (contentType.startsWith('multipart/form-data') || contentType.startsWith('multipart/mixed')) {
    const { fields, files } = await parseMultipart(req, 50 * 1024 * 1024);
    const uploaded = extractUploadedPdf(files);
    if (uploaded) {
      const flatFields: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(fields)) {
        flatFields[key] = Array.isArray(value) ? value[value.length - 1] : value;
      }
      return {
        bytes: new Uint8Array(await fs.readFile(uploaded.filepath)),
        filename: uploaded.originalFilename || 'upload.pdf',
        fields: flatFields,
      };
    }
    throw new HttpError(422, 'PDF file is required');
  }
  const raw = req.body as Record<string, unknown> | undefined;
  const payload =
    typeof raw?.['pdf'] === 'string'
      ? (raw['pdf'] as string)
      : typeof raw?.['pdf_base64'] === 'string'
        ? (raw['pdf_base64'] as string)
        : null;
  const checked = pdfBase64BodySchema.parse(raw ?? {});
  const source = payload ?? checked.pdf_base64 ?? checked.pdf;
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new HttpError(422, 'PDF file is required');
  }
  const bytes = decodePdfPayload(source);
  const nameField = raw?.['name'];
  const folderNameField = raw?.['folder_name'];
  const externalIdField = raw?.['external_id'];
  return {
    bytes,
    filename: typeof raw?.['filename'] === 'string' ? (raw['filename'] as string) : 'upload.pdf',
    fields: {
      name: typeof nameField === 'string' ? nameField : undefined,
      folder_name: typeof folderNameField === 'string' ? folderNameField : undefined,
      external_id: typeof externalIdField === 'string' ? externalIdField : undefined,
    },
  };
}

export function registerTemplatesRoutes(app: Express): void {
  const router = Router();

  // Auth applies only to this module's prefixes so public routes are unaffected.
  // Must be registered before any route layers.
  router.use((req, res, next) => {
    if (/^\/(templates|templates_archived|template_folders)(\/|$)/.test(req.originalUrl.split('?')[0] ?? '')) {
      requireUser(req, res, next);
      return;
    }
    next();
  });

  router.get(
    '/templates_archived',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const query = listTemplatesQuerySchema.parse(req.query);
      const paging = pagingOf(query);
      const where = and(eq(templates.accountId, user.accountId), isNotNull(templates.archivedAt));
      const countRows = await db.select({ value: count() }).from(templates).where(where);
      const total = countRows[0]?.value ?? 0;
      const rows = await db
        .select()
        .from(templates)
        .where(where)
        .orderBy(desc(templates.id))
        .limit(paging.perPage)
        .offset(paging.offset);
      res.json({ data: await Promise.all(rows.map((row) => serializeTemplate(row))), pagination: paginationMeta(total, paging) });
    }),
  );

  router.get(
    '/templates',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const query = listTemplatesQuerySchema.parse(req.query);
      const paging = pagingOf(query);
      const archived = query.archived === 'true';
      const keyword = (query.q ?? query.search ?? '').trim();

      const conditions = [
        eq(templates.accountId, user.accountId),
        archived ? isNotNull(templates.archivedAt) : isNull(templates.archivedAt),
      ];
      if (query.folder_id !== undefined) conditions.push(eq(templates.folderId, query.folder_id));
      if (keyword.length > 0) conditions.push(ilike(templates.name, `%${keyword}%`));

      const where = and(...conditions);
      const countRows = await db.select({ value: count() }).from(templates).where(where);
      const total = countRows[0]?.value ?? 0;
      const rows = await db
        .select()
        .from(templates)
        .where(where)
        .orderBy(desc(templates.id))
        .limit(paging.perPage)
        .offset(paging.offset);

      res.json({
        data: await Promise.all(rows.map((row) => serializeTemplate(row))),
        pagination: paginationMeta(total, paging),
      });
    }),
  );

  router.post(
    '/templates/pdf',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const { bytes, filename, fields } = await readPdfBytes(req);
      const template = await createTemplateFromPdf({
        user,
        bytes,
        filename,
        name: fields.name,
        folderName: fields.folder_name,
        externalId: fields.external_id,
      });
      res.status(201).json(await serializeTemplate(template));
    }),
  );

  router.post(
    '/templates',
    validateBody(createTemplateBodySchema),
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const body = bodyOf<z.infer<typeof createTemplateBodySchema>>(req);
      const created = await db.transaction(async (tx) =>
        insertTemplate(tx, {
          accountId: user.accountId,
          authorId: user.id,
          name: body.name,
          folderId: body.folder_id,
          folderName: body.folder_name,
          source: 'native',
        }),
      );
      res.status(201).json(await serializeTemplate(created));
    }),
  );

  router.get(
    '/templates/:id/versions',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const template = await loadTemplateScoped(idParam(req), user.accountId);
      const rows = await db
        .select()
        .from(templateVersions)
        .where(eq(templateVersions.templateId, template.id))
        .orderBy(desc(templateVersions.id));
      const authors = await loadAuthorMap([...new Set(rows.map((r) => r.authorId))]);
      res.json(rows.map((row) => serializeVersionSummary(row, authors.get(row.authorId))));
    }),
  );

  router.post(
    '/templates/:id/versions',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const template = await loadTemplateScoped(idParam(req), user.accountId);
      await db.transaction(async (tx) => {
        await findOrCreateVersion(tx, template, user.id);
      });
      res.status(200).json({ ok: true });
    }),
  );

  router.get(
    '/templates/:id/versions/:vid',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const template = await loadTemplateScoped(idParam(req), user.accountId);
      const versionId = idParam(req, 'vid');
      const [row] = await db
        .select()
        .from(templateVersions)
        .where(and(eq(templateVersions.templateId, template.id), eq(templateVersions.id, versionId)))
        .limit(1);
      const found = assertFound(row, 'version not found');
      const authors = await loadAuthorMap([found.authorId]);
      res.json(serializeVersionDetail(found, authors.get(found.authorId)));
    }),
  );

  router.post(
    '/templates/:id/duplicate',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const template = await loadTemplateScoped(idParam(req), user.accountId);
      const { template: cloned } = await duplicateTemplate(template, user.id);
      res.status(201).json(await serializeTemplate(cloned));
    }),
  );

  router.post(
    '/templates/:id/move_folder',
    validateBody(moveFolderBodySchema),
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const template = await loadTemplateScoped(idParam(req), user.accountId);
      const body = bodyOf<z.infer<typeof moveFolderBodySchema>>(req);

      const updated = await db.transaction(async (tx) => {
        if (body.folder_id !== undefined) {
          const [folder] = await tx
            .select()
            .from(templateFolders)
            .where(
              and(
                eq(templateFolders.id, body.folder_id),
                eq(templateFolders.accountId, user.accountId),
                isNull(templateFolders.archivedAt),
              ),
            )
            .limit(1);
          if (!folder) throw new HttpError(422, 'folder_id: folder not found');
        }
        const folder =
          body.folder_id !== undefined
            ? null
            : await findOrCreateFolderByName(
                tx,
                user.accountId,
                user.id,
                body.parent_name ? `${body.parent_name} / ${body.folder_name!}` : body.folder_name!,
              );
        const [row] = await tx
          .update(templates)
          .set({ folderId: body.folder_id ?? folder!.id, updatedAt: new Date() })
          .where(eq(templates.id, template.id))
          .returning();
        return row;
      });

      res.json(await serializeTemplate(assertFound(updated, 'template not found')));
    }),
  );

  router.get(
    '/templates/:id',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const template = await loadTemplateScoped(idParam(req), user.accountId);
      res.json(await serializeTemplate(template));
    }),
  );

  router.patch(
    '/templates/:id',
    validateBody(updateTemplateBodySchema),
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const template = await loadTemplateScoped(idParam(req), user.accountId);
      const body = bodyOf<z.infer<typeof updateTemplateBodySchema>>(req);

      const updated = await db.transaction(async (tx) => {
        let folderId = template.folderId;
        if (body.folder_id !== undefined) {
          const [folder] = await tx
            .select()
            .from(templateFolders)
            .where(
              and(
                eq(templateFolders.id, body.folder_id),
                eq(templateFolders.accountId, user.accountId),
              ),
            )
            .limit(1);
          if (!folder) throw new HttpError(422, 'folder_id: folder not found');
          folderId = folder.id;
        }
        const [row] = await tx
          .update(templates)
          .set({ name: body.name ?? template.name, folderId, updatedAt: new Date() })
          .where(eq(templates.id, template.id))
          .returning();
        return row;
      });

      res.json(await serializeTemplate(assertFound(updated, 'template not found')));
    }),
  );

  router.delete(
    '/templates/:id',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const template = await loadTemplateScoped(idParam(req), user.accountId);
      const permanently = ['true', true].includes(req.query.permanently as string | boolean);
      if (permanently) {
        await destroyTemplateCascade(template.id);
        res.json({ id: template.id, archived_at: null, deleted: true });
        return;
      }
      const now = new Date();
      await db.update(templates).set({ archivedAt: now, updatedAt: now }).where(eq(templates.id, template.id));
      res.json({ id: template.id, archived_at: now.toISOString() });
    }),
  );

  router.get(
    '/template_folders',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const query = pagingQuerySchema.extend({ q: z.string().optional() }).parse(req.query);
      const paging = pagingOf(query);
      const keyword = (query.q ?? '').trim();

      const conditions = [eq(templateFolders.accountId, user.accountId), isNull(templateFolders.archivedAt)];
      if (keyword.length > 0) conditions.push(ilike(templateFolders.name, `%${keyword}%`));
      const where = and(...conditions);

      const folderCountRows = await db.select({ value: count() }).from(templateFolders).where(where);

      const total = folderCountRows[0]?.value ?? 0;
      const rows = await db
        .select()
        .from(templateFolders)
        .where(where)
        .orderBy(desc(templateFolders.id))
        .limit(paging.perPage)
        .offset(paging.offset);

      const parentIds = [...new Set(rows.map((row) => row.parentFolderId).filter((v): v is number => v !== null))];
      const parents = parentIds.length
        ? await db.select().from(templateFolders).where(inArray(templateFolders.id, parentIds))
        : [];
      const parentsById = new Map(parents.map((p) => [p.id, p]));

      res.json({
        data: rows.map((row) => serializeFolder(row, row.parentFolderId === null ? null : parentsById.get(row.parentFolderId) ?? null)),
        pagination: paginationMeta(total, paging),
      });
    }),
  );

  router.post(
    '/template_folders',
    validateBody(createFolderBodySchema),
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const body = bodyOf<z.infer<typeof createFolderBodySchema>>(req);

      let parent: typeof templateFolders.$inferSelect | undefined;
      if (body.parent_folder_id !== undefined) {
        const [row] = await db
          .select()
          .from(templateFolders)
          .where(
            and(
              eq(templateFolders.id, body.parent_folder_id),
              eq(templateFolders.accountId, user.accountId),
              isNull(templateFolders.archivedAt),
            ),
          )
          .limit(1);
        parent = row;
        if (!parent) throw new HttpError(422, 'parent_folder_id: folder not found');
      }

      const [created] = await db
        .insert(templateFolders)
        .values({
          accountId: user.accountId,
          authorId: user.id,
          name: body.name,
          parentFolderId: parent?.id ?? null,
        })
        .returning();

      const folder = assertFound(created, 'folder could not be created');
      res.status(201).json(serializeFolder(folder, parent ?? null));
    }),
  );

  router.patch(
    '/template_folders/:id',
    validateBody(updateFolderBodySchema),
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const folder = await loadFolderScoped(idParam(req), user.accountId);
      const body = bodyOf<z.infer<typeof updateFolderBodySchema>>(req);
      if (folder.name === DEFAULT_FOLDER_NAME) {
        throw new HttpError(422, 'unable_to_rename_folder');
      }
      const [updated] = await db
        .update(templateFolders)
        .set({ name: body.name, updatedAt: new Date() })
        .where(eq(templateFolders.id, folder.id))
        .returning();
      res.json(serializeFolder(assertFound(updated, 'folder not found'), null));
    }),
  );

  router.delete(
    '/template_folders/:id',
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const folder = await loadFolderScoped(idParam(req), user.accountId);
      const permanently = ['true', true].includes(req.query.permanently as string | boolean);
      if (permanently) {
        await deleteFolderPermanently(folder);
        res.json({ id: folder.id, deleted: true });
        return;
      }
      const now = new Date();
      await db
        .update(templateFolders)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(templateFolders.id, folder.id));
      res.json({ id: folder.id, archived_at: now.toISOString() });
    }),
  );

  app.use('/', router);
}
