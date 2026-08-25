import crypto from 'node:crypto';
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import type { Express, Request } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { templateFolders, templates } from '../../db/schema.js';
import { HttpError, asyncHandler, validateBody } from '../../http/helpers.js';
import { requireApiToken } from '../../http/auth.js';
import { serializeTemplate } from '../templates/serializers.js';
import {
  destroyTemplateCascade,
  duplicateTemplate,
  findOrCreateVersion,
  insertTemplate,
} from '../templates/service.js';
import { findOrCreateFolderByName, parseJsonArray } from '../templates/util.js';
import { cursorPagingOf, idPaginationMeta, likeTerm } from './pagination.js';

function intParam(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadTemplateScoped(id: number, accountId: number) {
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, id), eq(templates.accountId, accountId)))
    .limit(1);
  if (!row) throw new HttpError(404, 'Template not found');
  return row;
}

const createTemplateSchema = z.object({
  name: z.string().min(1),
  folder_name: z.string().optional(),
  external_id: z.string().nullish(),
  application_key: z.string().nullish(),
});

function bodyOf<T>(req: Request): T {
  return ((req.parsedBody ?? req.body) ?? {}) as T;
}

export function registerApiTemplatesRoutes(app: Express): void {
  app.post(
    '/api/templates',
    requireApiToken,
    validateBody(createTemplateSchema),
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const input = bodyOf<z.infer<typeof createTemplateSchema>>(req);

      const row = await db.transaction(async (tx) => {
        const template = await insertTemplate(tx, {
          accountId: user.accountId,
          authorId: user.id,
          name: input.name.trim() || 'Untitled',
          folderName: input.folder_name,
          source: 'api',
          externalId: input.external_id ?? input.application_key ?? undefined,
        });
        await findOrCreateVersion(tx, template, user.id);
        return template;
      });

      res.json(await serializeTemplate(row));
    }),
  );

  app.get(
    '/api/templates',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const paging = cursorPagingOf(req);
      const q = req.query as Record<string, string | undefined>;

      const conditions = [eq(templates.accountId, user.accountId)];
      conditions.push(q.archived === 'true' ? isNotNull(templates.archivedAt) : isNull(templates.archivedAt));

      if (q.q) conditions.push(ilike(templates.name, likeTerm(q.q)));
      if (q.application_key) conditions.push(eq(templates.externalId, q.application_key));
      if (q.external_id) conditions.push(eq(templates.externalId, q.external_id));
      if (q.slug) conditions.push(eq(templates.slug, q.slug));
      if (paging.after !== null) conditions.push(lt(templates.id, paging.after));
      if (paging.before !== null) conditions.push(gte(templates.id, paging.before + 1));

      if (q.folder) {
        const parts = q.folder.split(' / ').map((part) => part.trim());
        const name = parts[parts.length - 1] || q.folder;
        const folders = await db
          .select({ id: templateFolders.id })
          .from(templateFolders)
          .where(and(eq(templateFolders.accountId, user.accountId), eq(templateFolders.name, name)));
        if (folders.length === 0) {
          res.json({ data: [], pagination: idPaginationMeta([]) });
          return;
        }
        conditions.push(inArray(templates.folderId, folders.map((folder) => folder.id)));
      }

      const rows = await db
        .select()
        .from(templates)
        .where(and(...conditions))
        .orderBy(desc(templates.id))
        .limit(paging.limit);

      const data = [];
      for (const row of rows) {
        data.push(await serializeTemplate(row));
      }

      res.json({ data, pagination: idPaginationMeta(rows) });
    }),
  );

  app.get(
    '/api/templates/:id',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const id = intParam(req.params.id);
      if (!id) throw new HttpError(404, 'Template not found');
      const row = await loadTemplateScoped(id, user.accountId);
      res.json(await serializeTemplate(row));
    }),
  );

  const patchHandler = asyncHandler(async (req: Request, res) => {
    const user = req.currentUser!;
    const id = intParam(req.params.id);
    if (!id) throw new HttpError(404, 'Template not found');
    const row = await loadTemplateScoped(id, user.accountId);

    const raw = (req.body ?? {}) as Record<string, unknown>;
    const attrs = ((raw['template'] ?? raw) ?? {}) as Record<string, unknown>;

    const updates: Partial<typeof templates.$inferInsert> = {};

    const folderName =
      typeof attrs['folder_name'] === 'string' && attrs['folder_name'].length > 0 ? attrs['folder_name'] : undefined;

    const roles = Array.isArray(attrs['roles']) ? (attrs['roles'] as unknown[]) : [];

    let archivedFlag: boolean | null = null;
    if (typeof attrs['archived'] === 'boolean') archivedFlag = attrs['archived'];

    const explicitFields = Array.isArray(attrs['fields'])
      ? (attrs['fields'] as Record<string, unknown>[])
      : Array.isArray(attrs['schema'])
        ? (attrs['schema'] as Record<string, unknown>[])
        : null;

    if (typeof attrs['name'] === 'string' && attrs['name'].length > 0) updates.name = attrs['name'];

    if ('external_id' in attrs || 'application_key' in attrs) {
      const externalId = 'external_id' in attrs ? attrs['external_id'] : attrs['application_key'];
      updates.externalId = externalId == null ? null : String(externalId);
    }
    if (typeof attrs['shared_link'] === 'boolean') updates.sharedLink = attrs['shared_link'];

    const updated = await db.transaction(async (tx) => {
      let current = row;

      if (folderName !== undefined) {
        const folder = await findOrCreateFolderByName(tx, current.accountId, user.id, folderName);
        updates.folderId = folder.id;
      }

      if (roles.length > 0) {
        const submitterItems = parseJsonArray(current.submitters);
        roles.forEach((role, index) => {
          if (typeof role !== 'string') return;
          if (submitterItems[index]) {
            submitterItems[index]!['name'] = role;
          } else {
            submitterItems[index] = { name: role, uuid: crypto.randomUUID() };
          }
        });
        updates.submitters = JSON.stringify(submitterItems);
      }

      if (explicitFields) {
        updates.fields = JSON.stringify(explicitFields);
      }

      if (archivedFlag !== null) {
        updates.archivedAt = archivedFlag ? new Date() : null;
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        const [next] = await tx.update(templates).set(updates).where(eq(templates.id, current.id)).returning();
        current = next!;
      }

      await findOrCreateVersion(tx, current, user.id);
      return current;
    });

    res.json({ id: updated.id, updated_at: updated.updatedAt.toISOString() });
  });

  app.patch('/api/templates/:id', requireApiToken, patchHandler);
  app.put('/api/templates/:id', requireApiToken, patchHandler);

  const deleteHandler = asyncHandler(async (req: Request, res) => {
    const user = req.currentUser!;
    const id = intParam(req.params.id);
    if (!id) throw new HttpError(404, 'Template not found');
    const row = await loadTemplateScoped(id, user.accountId);
    const permanently = String((req.query as Record<string, unknown>).permanently ?? '') === 'true';

    if (permanently) {
      await destroyTemplateCascade(row.id);
      res.json({ id: row.id, archived_at: null });
      return;
    }

    const [updated] = await db
      .update(templates)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(templates.id, row.id))
      .returning({ archivedAt: templates.archivedAt });

    res.json({ id: row.id, archived_at: updated?.archivedAt?.toISOString() ?? null });
  });

  app.delete('/api/templates/:id', requireApiToken, deleteHandler);

  const cloneHandler = asyncHandler(async (req: Request, res) => {
    const user = req.currentUser!;
    const id = intParam(req.params.template_id);
    if (!id) throw new HttpError(404, 'Template not found');
    const original = await loadTemplateScoped(id, user.accountId);

    const result = await duplicateTemplate(original, user.id);

    const [withSource] = await db
      .update(templates)
      .set({ source: 'api', updatedAt: new Date() })
      .where(and(eq(templates.id, result.template.id), eq(templates.accountId, user.accountId)))
      .returning();

    res.json(await serializeTemplate(withSource!));
  });

  app.post('/api/templates/:template_id/clone', requireApiToken, cloneHandler);
  app.post('/api/templates/:template_id/duplicate', requireApiToken, cloneHandler);
}
