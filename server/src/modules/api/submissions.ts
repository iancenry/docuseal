import { and, asc, desc, eq, exists, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  activeStorageAttachments,
  activeStorageBlobs,
  completedDocuments,
  completedSubmitters,
  submissionEvents,
  submissions,
  submitterVersions,
  submitters,
  templateFolders,
  templateVersions,
  templates,
  users,
} from '../../db/schema.js';
import { HttpError, asyncHandler, validateBody } from '../../http/helpers.js';
import { requireApiToken } from '../../http/auth.js';
import { generateSlug } from '../submissions/slugs.js';
import { parseJsonArray } from '../templates/util.js';
import {
  buildValuesArray,
  serializeSubmissionForApi,
  serializeEventForApi,
  type AuthorJson,
  type DocumentMetaJson,
  type SubmissionRow,
  type SubmitterRow,
  type TemplateRow,
} from './serialize.js';
import { cursorPagingOf, epochPaginationMeta, idPaginationMeta, likeTerm } from './pagination.js';

type FieldItem = Record<string, unknown>;
type SubmitterItem = Record<string, unknown>;

function intParam(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function baseUrlOf(req: Request): string {
  const proto = req.protocol || 'http';
  const host = req.headers.host ?? 'localhost';
  return `${proto}://${host}`;
}

const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

async function loadTemplateScoped(templateId: number, accountId: number): Promise<TemplateRow> {
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.accountId, accountId)))
    .limit(1);
  if (!row) throw new HttpError(404, 'Template not found');
  return row;
}

async function loadSubmissionScoped(id: number, accountId: number): Promise<SubmissionRow> {
  const [row] = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.id, id), eq(submissions.accountId, accountId)))
    .limit(1);
  if (!row) throw new HttpError(404, 'Submission not found');
  return row;
}

async function loadSubmittersFor(submissionId: number): Promise<SubmitterRow[]> {
  return db.select().from(submitters).where(eq(submitters.submissionId, submissionId)).orderBy(asc(submitters.id));
}

async function loadFolderName(folderId: number | null | undefined): Promise<string | null> {
  if (!folderId) return null;
  const [folder] = await db.select().from(templateFolders).where(eq(templateFolders.id, folderId)).limit(1);
  if (!folder) return null;
  if (folder.parentFolderId !== null) {
    const [parent] = await db
      .select()
      .from(templateFolders)
      .where(eq(templateFolders.id, folder.parentFolderId))
      .limit(1);
    return parent ? `${parent.name} / ${folder.name}` : folder.name;
  }
  return folder.name;
}

async function loadCreatedByUser(userId: number | null | undefined): Promise<AuthorJson | null> {
  if (!userId) return null;
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;
  return { id: row.id, email: row.email, first_name: row.firstName, last_name: row.lastName };
}

export async function loadTemplateSubmitters(template: TemplateRow): Promise<SubmitterItem[]> {
  const [version] = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, template.id))
    .orderBy(desc(templateVersions.id))
    .limit(1);

  if (version) {
    try {
      const data = JSON.parse(version.data) as { submitters?: unknown };
      if (Array.isArray(data.submitters) && data.submitters.length > 0) {
        return data.submitters as SubmitterItem[];
      }
    } catch {
      throw new HttpError(422, 'Invalid template version data');
    }
  }

  const list = parseJsonArray(template.submitters);
  if (list.length > 0) return list;

  const latestVersionRows = await db
    .select({ data: templateVersions.data })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, template.id))
    .orderBy(desc(templateVersions.id))
    .limit(10);
  for (const row of latestVersionRows) {
    try {
      const data = JSON.parse(row.data) as { submitters?: unknown };
      if (Array.isArray(data.submitters) && data.submitters.length > 0) {
        return data.submitters as SubmitterItem[];
      }
    } catch {
      continue;
    }
  }
  return [];
}

export async function loadDocumentsMetadata(submitterIds: number[]): Promise<Map<number, DocumentMetaJson[]>> {
  const bySubmitter = new Map<number, DocumentMetaJson[]>();
  if (submitterIds.length === 0) return bySubmitter;

  const rows = await db
    .select({
      recordId: activeStorageAttachments.recordId,
      filename: activeStorageBlobs.filename,
    })
    .from(activeStorageAttachments)
    .innerJoin(activeStorageBlobs, eq(activeStorageAttachments.blobId, activeStorageBlobs.id))
    .where(
      and(
        eq(activeStorageAttachments.recordType, 'Submitter'),
        eq(activeStorageAttachments.name, 'documents'),
        inArray(activeStorageAttachments.recordId, submitterIds),
      ),
    );

  for (const row of rows) {
    const list = bySubmitter.get(row.recordId) ?? [];
    list.push({ name: row.filename.replace(/\.[^./\\]+$/, ''), url: null });
    bySubmitter.set(row.recordId, list);
  }
  return bySubmitter;
}

async function loadEventsFor(submissionId: number) {
  return db
    .select()
    .from(submissionEvents)
    .where(eq(submissionEvents.submissionId, submissionId))
    .orderBy(asc(submissionEvents.id));
}

function findTemplateSubmitter(
  templateSubmitters: SubmitterItem[],
  input: ApiSubmitterInput,
): SubmitterItem | undefined {
  if (input.uuid) {
    return templateSubmitters.find((item) => item.uuid === input.uuid);
  }
  const role = (input.role ?? '').toLowerCase();
  if (!role) return undefined;
  return templateSubmitters.find((item) => String(item.name ?? '').toLowerCase() === role);
}

const apiSubmitterSchema = z.object({
  role: z.string().min(1).optional(),
  uuid: z.string().min(1).optional(),
  name: z.string().nullish(),
  email: z.union([z.email(), z.literal('')]).nullish(),
  phone: z.string().min(1).nullish(),
  values: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  send_email: z.boolean().optional(),
});

export interface ApiSubmitterInput extends z.infer<typeof apiSubmitterSchema> {}

const apiCreateSubmissionBaseSchema = z.object({
  template_id: z.coerce.number().int().positive(),
  emails: z.union([z.string(), z.array(z.string())]).optional(),
  email: z.union([z.string(), z.array(z.string())]).optional(),
  submitters: z.array(apiSubmitterSchema).min(1).optional(),
  send_email: z.boolean().optional(),
  order: z.enum(['preserved', 'random']).optional(),
  submitters_order: z.enum(['preserved', 'random']).optional(),
});

export const apiCreateSubmissionSchema = apiCreateSubmissionBaseSchema.refine(
  (input) => Boolean(input.submitters?.length) || Boolean(input.emails) || Boolean(input.email),
  { message: 'submitters or emails are required' },
);

export const apiCreateTemplateSubmissionSchema = apiCreateSubmissionBaseSchema
  .omit({ template_id: true })
  .refine((input) => Boolean(input.submitters?.length) || Boolean(input.emails) || Boolean(input.email), {
    message: 'submitters or emails are required',
  });

interface ResolvedSubmitter {
  templateUuid: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  values: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

async function createOneSubmission(
  template: TemplateRow,
  accountId: number,
  userId: number,
  resolvedGroups: ResolvedSubmitter[][],
  options: { sendEmail: boolean; submittersOrder: string },
): Promise<{ submissions: SubmissionRow[]; submittersBySubmission: Map<number, SubmitterRow[]> }> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const created: SubmissionRow[] = [];
    const submittersBySubmission = new Map<number, SubmitterRow[]>();

    for (const group of resolvedGroups) {
      const [submission] = await tx
        .insert(submissions)
        .values({
          slug: generateSlug(),
          accountId,
          templateId: template.id,
          createdByUserId: userId,
          source: 'api',
          submittersOrder: options.submittersOrder,
          preferences: '{}',
          variables: '{}',
          name: null,
          templateFields: template.fields,
          templateSchema: template.schema,
          templateSubmitters: template.submitters,
        })
        .returning();
      if (!submission) throw new HttpError(500, 'Failed to create submission');

      const inserted = await tx
        .insert(submitters)
        .values(
          group.map((item) => ({
            slug: generateSlug(),
            uuid: item.templateUuid,
            accountId,
            submissionId: submission.id,
            email: item.email,
            name: item.name,
            phone: item.phone,
            sentAt: options.sendEmail && item.email ? now : null,
            values: JSON.stringify(item.values),
            metadata: JSON.stringify(item.metadata),
            preferences: '{}',
          })),
        )
        .returning();

      await tx.insert(submissionEvents).values({
        eventType: 'create',
        data: '{}',
        eventTimestamp: now,
        submissionId: submission.id,
        submitterId: inserted[0]?.id ?? null,
        accountId,
      });

      if (options.sendEmail) {
        const emailEvents = group
          .map((item, index) => ({ item, submitterId: inserted[index]?.id }))
          .filter((entry): entry is { item: ResolvedSubmitter & { email: string }; submitterId: number } =>
            Boolean(entry.item.email && entry.submitterId),
          )
          .map((entry) => ({
            eventType: 'send_request_email',
            data: JSON.stringify({ to: entry.item.email }),
            eventTimestamp: now,
            submissionId: submission.id,
            submitterId: entry.submitterId,
            accountId,
          }));
        if (emailEvents.length > 0) await tx.insert(submissionEvents).values(emailEvents);
      }

      created.push(submission);
      submittersBySubmission.set(submission.id, inserted);
    }

    return { submissions: created, submittersBySubmission };
  });
}

export async function serializeCreatedSubmitters(
  submission: SubmissionRow,
  submitterRows: SubmitterRow[],
  req: Request,
): Promise<Record<string, unknown>[]> {
  const template = submission.templateId
    ? await loadTemplateScoped(submission.templateId, submission.accountId).catch(() => null)
    : null;
  const fields = parseJsonArray(submission.templateFields);
  const roles = parseJsonArray(submission.templateSubmitters);

  return submitterRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    uuid: row.uuid,
    name: row.name,
    email: row.email,
    phone: row.phone,
    completed_at: null,
    declined_at: null,
    external_id: row.externalId,
    application_key: row.externalId,
    submission_id: row.submissionId,
    metadata: {},
    opened_at: null,
    sent_at: row.sentAt ? row.sentAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    status: row.declinedAt ? 'declined' : row.completedAt ? 'completed' : row.openedAt ? 'opened' : row.sentAt ? 'sent' : 'awaiting',
    values: buildValuesArray(fields, row),
    preferences: {},
    role: (() => {
      const item = roles.find((entry) => entry['uuid'] === row.uuid);
      return typeof item?.['name'] === 'string' ? item['name'] : null;
    })(),
    embed_src: `${baseUrlOf(req)}/s/${row.slug}`,
    template: template
      ? {
          id: template.id,
          name: template.name,
          created_at: template.createdAt.toISOString(),
          updated_at: template.updatedAt.toISOString(),
        }
      : null,
  }));
}

function statusCondition(status: string) {
  const anySubmitter = (extra: Parameters<typeof and>[0]) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(submitters)
        .where(and(eq(submitters.submissionId, submissions.id), extra)),
    );

  switch (status) {
    case 'pending':
      return and(
        isNull(submissions.completedAt),
        or(isNull(submissions.expireAt), gte(submissions.expireAt, new Date())),
      );
    case 'completed':
      return isNotNull(submissions.completedAt);
    case 'declined':
      return anySubmitter(isNotNull(submitters.declinedAt));
    case 'expired':
      return and(lte(submissions.expireAt, new Date()), isNull(submissions.completedAt));
    case 'sent':
      return anySubmitter(
        and(
          isNull(submitters.openedAt),
          isNull(submitters.completedAt),
          isNull(submitters.declinedAt),
          isNotNull(submitters.sentAt),
        ),
      );
    case 'opened':
      return anySubmitter(
        and(isNull(submitters.completedAt), isNull(submitters.declinedAt), isNotNull(submitters.openedAt)),
      );
    case 'partially_completed':
      return and(isNull(submissions.completedAt), anySubmitter(isNotNull(submitters.completedAt)));
    default:
      return undefined;
  }
}

function registerSubmissionsHandlers(app: Express): void {
  const createHandler = async (req: Request, res: Response): Promise<void> => {
    const user = req.currentUser!;
    const input = req.parsedBody as z.infer<typeof apiCreateSubmissionSchema>;

    const [templateRow] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, input.template_id), eq(templates.accountId, user.accountId)))
      .limit(1);
    if (!templateRow) throw new HttpError(422, 'Template not found');
    const template = templateRow;
      if (template.archivedAt) throw new HttpError(422, 'Template has been archived');
      if (parseJsonArray(template.fields).length === 0) {
        throw new HttpError(422, 'Template does not contain fields');
      }

      const templateSubmitters = await loadTemplateSubmitters(template);

      let groups: ApiSubmitterInput[][];
      const rawEmails = input.emails ?? input.email;
      if (rawEmails && !input.submitters) {
        const emails = (
          Array.isArray(rawEmails) ? rawEmails : rawEmails.match(/[^\s,;<>"]+@[^\s,;<>"]+/g) ?? []
        )
          .map(normalizeEmail)
          .filter((email) => email.length > 0);
        const uniqueEmails = [...new Set(emails)];
        if (uniqueEmails.length === 0) throw new HttpError(422, 'emails are invalid');
        // emails mode: one submission per email signed by the first template role
        const firstRole = templateSubmitters[0];
        if (!firstRole?.uuid) throw new HttpError(422, 'Template has no submitters');
        groups = uniqueEmails.map((email) => [{ email, role: String(firstRole.name ?? '') }]);
      } else {
        groups = [input.submitters!];
      }

      for (const group of groups) {
        for (const submitterInput of group) {
          if (!findTemplateSubmitter(templateSubmitters, submitterInput)) {
            throw new HttpError(422, `${submitterInput.role ?? ''} role doesn't exist`);
          }
        }
        if (group.length > templateSubmitters.length) {
          throw new HttpError(422, 'Defined more signing parties than in template');
        }
      }

      const sendEmail = input.send_email !== false;
      const submittersOrder =
        input.submitters_order ?? input.order ?? 'preserved';

      const resolvedGroups: ResolvedSubmitter[][] = groups.map((group) =>
        group.map((submitterInput) => {
          const match = findTemplateSubmitter(templateSubmitters, submitterInput)!;
          return {
            templateUuid: String(match['uuid']),
            email: submitterInput.email ? normalizeEmail(submitterInput.email) : null,
            name: submitterInput.name ?? null,
            phone: submitterInput.phone ?? null,
            values: submitterInput.values ?? {},
            metadata: submitterInput.metadata ?? {},
          };
        }),
      );

      const { submissions: created, submittersBySubmission } = await createOneSubmission(
        template,
        user.accountId,
        user.id,
        resolvedGroups,
        { sendEmail, submittersOrder },
      );

      const out: Record<string, unknown>[] = [];
      for (const submission of created) {
        const rows = submittersBySubmission.get(submission.id) ?? [];
        out.push(...(await serializeCreatedSubmitters(submission, rows, req)));
      }

      res.json(out);
  };

  app.post('/api/submissions', requireApiToken, validateBody(apiCreateSubmissionSchema), asyncHandler(createHandler));

  app.get(
    '/api/submissions',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const paging = cursorPagingOf(req);
      const q = req.query as Record<string, string | undefined>;

      const conditions = [eq(submissions.accountId, user.accountId)];

      const templateId = intParam(q.template_id);
      if (templateId) conditions.push(eq(submissions.templateId, templateId));
      if (q.slug) conditions.push(eq(submissions.slug, q.slug));

      if ('archived' in req.query) {
        conditions.push(q.archived === 'true' ? isNotNull(submissions.archivedAt) : isNull(submissions.archivedAt));
      }

      if (paging.after !== null) conditions.push(lt(submissions.id, paging.after));
      if (paging.before !== null) conditions.push(gte(submissions.id, paging.before + 1));

      if (q.q) {
        const term = likeTerm(q.q);
        conditions.push(
          exists(
            db
              .select({ one: sql`1` })
              .from(submitters)
              .where(
                and(
                  eq(submitters.submissionId, submissions.id),
                  or(
                    ilike(submitters.email, term),
                    ilike(submitters.phone, term),
                    ilike(submitters.name, term),
                  ),
                ),
              ),
          ),
        );
      }

      if (q.status) {
        const cond = statusCondition(q.status);
        if (cond) conditions.push(cond);
      }

      const where = and(...conditions);
      const rows = await db
        .select()
        .from(submissions)
        .where(where)
        .orderBy(desc(submissions.id))
        .limit(paging.limit);

      const ids = rows.map((row) => row.id);
      const submitterRows = ids.length
        ? await db
            .select()
            .from(submitters)
            .where(inArray(submitters.submissionId, ids))
            .orderBy(asc(submitters.id))
        : [];

      const grouped = new Map<number, SubmitterRow[]>();
      for (const row of submitterRows) {
        const list = grouped.get(row.submissionId) ?? [];
        list.push(row);
        grouped.set(row.submissionId, list);
      }

      const includeFields = (q.include ?? '').includes('fields');
      const base = baseUrlOf(req);

      const data = await Promise.all(
        rows.map(async (row) => {
          const template = row.templateId
            ? (await db.select().from(templates).where(eq(templates.id, row.templateId)).limit(1))[0] ?? null
            : null;
          const folderName = await loadFolderName(template?.folderId);
          const createdByUser = await loadCreatedByUser(row.createdByUserId);
          return serializeSubmissionForApi(row, grouped.get(row.id) ?? [], {
            template,
            folderName,
            createdByUser,
            baseUrl: base,
            withEvents: false,
            withDocuments: false,
            withValues: false,
            includeFields,
          });
        }),
      );

      res.json({ data, pagination: idPaginationMeta(rows) });
    }),
  );

  app.get(
    '/api/submissions/:id/events',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const id = intParam(req.params.id);
      if (!id) throw new HttpError(404, 'Submission not found');
      const submission = await loadSubmissionScoped(id, user.accountId);
      const events = await loadEventsFor(submission.id);
      res.json({ data: events.map(serializeEventForApi) });
    }),
  );

  app.get(
    '/api/submissions/:id',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const id = intParam(req.params.id);
      if (!id) throw new HttpError(404, 'Submission not found');
      const submission = await loadSubmissionScoped(id, user.accountId);

      const submitterRows = await loadSubmittersFor(submission.id);
      const events = await loadEventsFor(submission.id);
      const template = submission.templateId
        ? (await db.select().from(templates).where(eq(templates.id, submission.templateId)).limit(1))[0] ?? null
        : null;
      const folderName = await loadFolderName(template?.folderId);
      const createdByUser = await loadCreatedByUser(submission.createdByUserId);

      res.json(
        serializeSubmissionForApi(submission, submitterRows, {
          template,
          folderName,
          createdByUser,
          baseUrl: baseUrlOf(req),
          withEvents: true,
          events,
        }),
      );
    }),
  );

  app.get(
    '/api/submissions/:id/documents',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const id = intParam(req.params.id);
      if (!id) throw new HttpError(404, 'Submission not found');
      const submission = await loadSubmissionScoped(id, user.accountId);
      const rows = await loadSubmittersFor(submission.id);

      let documents: DocumentMetaJson[] = [];
      if (submission.completedAt) {
        const completed = rows.filter((row) => row.completedAt);
        const last = completed[completed.length - 1];
        if (last) {
          const docsById = await loadDocumentsMetadata([last.id]);
          documents = docsById.get(last.id) ?? [];
        }
      }

      res.json({ id: submission.id, documents });
    }),
  );

  app.patch(
    '/api/submissions/:id',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const id = intParam(req.params.id);
      if (!id) throw new HttpError(404, 'Submission not found');
      const submission = await loadSubmissionScoped(id, user.accountId);
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const attrs = ((raw.submission ?? raw) ?? {}) as Record<string, unknown>;

      const updates: Partial<typeof submissions.$inferInsert> = {};
      const archivedRaw = 'archived' in attrs ? attrs['archived'] : attrs['archived_at'];
      if (typeof archivedRaw === 'boolean') {
        updates.archivedAt = archivedRaw ? new Date() : null;
      } else if (typeof archivedRaw === 'string' && ['true', 'false'].includes(archivedRaw)) {
        updates.archivedAt = archivedRaw === 'true' ? new Date() : null;
      }
      if ('name' in attrs) updates.name = attrs['name'] === null ? null : String(attrs['name']);
      if ('expire_at' in attrs) {
        const expire = attrs['expire_at'];
        updates.expireAt = expire ? new Date(String(expire)) : null;
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await db.update(submissions).set(updates).where(eq(submissions.id, submission.id));
      }

      const fresh = await loadSubmissionScoped(submission.id, user.accountId);
      const submitterRows = await loadSubmittersFor(fresh.id);
      const template = fresh.templateId
        ? (await db.select().from(templates).where(eq(templates.id, fresh.templateId)).limit(1))[0] ?? null
        : null;
      const folderName = await loadFolderName(template?.folderId);
      const createdByUser = await loadCreatedByUser(fresh.createdByUserId);

      res.json(
        serializeSubmissionForApi(fresh, submitterRows, {
          template,
          folderName,
          createdByUser,
          baseUrl: baseUrlOf(req),
          withEvents: false,
        }),
      );
    }),
  );

  app.delete(
    '/api/submissions/:id',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const id = intParam(req.params.id);
      if (!id) throw new HttpError(404, 'Submission not found');
      const submission = await loadSubmissionScoped(id, user.accountId);
      const permanently = String((req.query as Record<string, unknown>).permanently ?? '') === 'true';

      if (permanently) {
        await db.transaction(async (tx) => {
          const submitterRows = await tx
            .select({ id: submitters.id })
            .from(submitters)
            .where(eq(submitters.submissionId, submission.id));
          const submitterIds = submitterRows.map((row) => row.id);

          if (submitterIds.length > 0) {
            await tx.delete(completedDocuments).where(inArray(completedDocuments.submitterId, submitterIds));
            await tx.delete(submitterVersions).where(inArray(submitterVersions.submitterId, submitterIds));
          }
          await tx
            .delete(completedSubmitters)
            .where(eq(completedSubmitters.submissionId, submission.id));
          await tx.delete(submissionEvents).where(eq(submissionEvents.submissionId, submission.id));
          await tx.delete(submitters).where(eq(submitters.submissionId, submission.id));
          await tx.delete(submissions).where(eq(submissions.id, submission.id));
        });

        res.json({ id: submission.id, archived_at: null });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(submissions)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(submissions.id, submission.id))
        .returning({ archivedAt: submissions.archivedAt });

      res.json({ id: submission.id, archived_at: updated?.archivedAt?.toISOString() ?? null });
    }),
  );

  app.get(
    '/api/events/submission/:type',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const paging = cursorPagingOf(req);

      const after = (req.query as Record<string, unknown>).after;
      const before = (req.query as Record<string, unknown>).before;
      const toEpochDate = (value: unknown) => {
        const seconds = Number.parseInt(String(value ?? ''), 10);
        return Number.isInteger(seconds) ? new Date(seconds * 1000) : null;
      };

      const conditions = [
        eq(submissions.accountId, user.accountId),
        isNull(submissions.archivedAt),
        isNotNull(submissions.completedAt),
      ];
      const afterDate = toEpochDate(after);
      if (afterDate) conditions.push(lt(submissions.completedAt, afterDate));
      const beforeDate = toEpochDate(before);
      if (beforeDate) conditions.push(gte(submissions.completedAt, beforeDate));

      const rows = await db
        .select()
        .from(submissions)
        .where(and(...conditions))
        .orderBy(desc(submissions.completedAt))
        .limit(paging.limit);

      const ids = rows.map((row) => row.id);
      const submitterRows = ids.length
        ? await db.select().from(submitters).where(inArray(submitters.submissionId, ids)).orderBy(asc(submitters.id))
        : [];
      const grouped = new Map<number, SubmitterRow[]>();
      for (const row of submitterRows) {
        const list = grouped.get(row.submissionId) ?? [];
        list.push(row);
        grouped.set(row.submissionId, list);
      }

      const eventRows = ids.length
        ? await db
            .select()
            .from(submissionEvents)
            .where(inArray(submissionEvents.submissionId, ids))
            .orderBy(asc(submissionEvents.id))
        : [];
      const eventsGrouped = new Map<number, typeof eventRows>();
      for (const row of eventRows) {
        const list = eventsGrouped.get(row.submissionId) ?? [];
        list.push(row);
        eventsGrouped.set(row.submissionId, list);
      }

      const data = await Promise.all(
        rows.map(async (row) => ({
          event_type: 'submission.completed',
          timestamp: row.completedAt ? row.completedAt.toISOString() : null,
          data: serializeSubmissionForApi(row, grouped.get(row.id) ?? [], {
            baseUrl: baseUrlOf(req),
            withEvents: true,
            events: eventsGrouped.get(row.id) ?? [],
          }),
        })),
      );

      res.json({ data, pagination: epochPaginationMeta(rows) });
    }),
  );

  app.get(
    '/api/templates/:template_id/submissions',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const paging = cursorPagingOf(req);
      const templateId = intParam(req.params.template_id);
      if (!templateId) throw new HttpError(404, 'Template not found');
      await loadTemplateScoped(templateId, user.accountId);

      const q = req.query as Record<string, string | undefined>;
      const conditions = [eq(submissions.accountId, user.accountId), eq(submissions.templateId, templateId)];
      if (paging.after !== null) conditions.push(lt(submissions.id, paging.after));
      if (paging.before !== null) conditions.push(gte(submissions.id, paging.before + 1));
      if ('archived' in req.query) {
        conditions.push(q.archived === 'true' ? isNotNull(submissions.archivedAt) : isNull(submissions.archivedAt));
      }

      const rows = await db
        .select()
        .from(submissions)
        .where(and(...conditions))
        .orderBy(desc(submissions.id))
        .limit(paging.limit);

      const template = await loadTemplateScoped(templateId, user.accountId);
      const folderName = await loadFolderName(template.folderId);

      const ids = rows.map((row) => row.id);
      const submitterRows = ids.length
        ? await db.select().from(submitters).where(inArray(submitters.submissionId, ids)).orderBy(asc(submitters.id))
        : [];
      const grouped = new Map<number, SubmitterRow[]>();
      for (const row of submitterRows) {
        const list = grouped.get(row.submissionId) ?? [];
        list.push(row);
        grouped.set(row.submissionId, list);
      }

      const base = baseUrlOf(req);
      const data = rows.map((row) =>
        serializeSubmissionForApi(row, grouped.get(row.id) ?? [], {
          template,
          folderName,
          baseUrl: base,
          withEvents: false,
          withDocuments: false,
          withValues: false,
        }),
      );

      res.json({ data, pagination: idPaginationMeta(rows) });
    }),
  );

  app.post(
    '/api/templates/:template_id/submissions',
    requireApiToken,
    validateBody(apiCreateTemplateSubmissionSchema),
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const templateId = intParam(req.params.template_id);
      if (!templateId) throw new HttpError(404, 'Template not found');
      await loadTemplateScoped(templateId, user.accountId);

      req.parsedBody = { ...(req.parsedBody as Record<string, unknown>), template_id: templateId };
      await createHandler(req, res);
    }),
  );
}

export function registerApiSubmissionsRoutes(app: Express): void {
  registerSubmissionsHandlers(app);
}
