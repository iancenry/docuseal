import type { Express, Request, Response } from 'express';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  completedDocuments,
  completedSubmitters,
  submissionEvents,
  submissions,
  submitters,
  templates,
} from '../../db/schema.js';
import { requireUser } from '../../http/auth.js';
import { HttpError, asyncHandler, validateBody } from '../../http/helpers.js';
import { parseJsonColumn, serializeEvent, serializeSubmission, serializeSubmitter } from './serialize.js';
import { createSubmissionFromSubmitters, createSubmissionSchema } from './create.js';
import { findSubmitterBySlug, submitDataSchema, submitSubmitterValues } from './values.js';

function body<T>(req: Request): T {
  return ((req as Request & { parsedBody?: T }).parsedBody ?? {}) as T;
}

function intParam(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadScopedSubmission(req: Request): Promise<{
  id: number;
  accountId: number;
}> {
  const id = intParam(req.params.id);
  if (!id || !req.currentUser) throw new HttpError(404, 'Submission not found');

  const [row] = await db
    .select({ id: submissions.id, accountId: submissions.accountId })
    .from(submissions)
    .where(and(eq(submissions.id, id), eq(submissions.accountId, req.currentUser.accountId)))
    .limit(1);

  if (!row) throw new HttpError(404, 'Submission not found');
  return row;
}

async function loadSubmitters(submissionId: number) {
  return db.select().from(submitters).where(eq(submitters.submissionId, submissionId)).orderBy(asc(submitters.id));
}

export function registerSubmissionsRoutes(app: Express): void {
  app.post(
    '/submissions',
    requireUser,
    validateBody(createSubmissionSchema),
    asyncHandler(async (req, res) => {
      const input = body<z.infer<typeof createSubmissionSchema>>(req);
      if (!req.currentUser) throw new HttpError(401, 'authentication required');

      const created = await createSubmissionFromSubmitters(req.currentUser.accountId, req.currentUser.id, input);

      const [submission] = await db.select().from(submissions).where(eq(submissions.id, created.submissionId)).limit(1);
      const submitterRows = await loadSubmitters(created.submissionId);

      res.status(201).json(serializeSubmission(submission!, submitterRows));
    }),
  );

  app.get(
    '/submissions',
    requireUser,
    asyncHandler(async (req, res) => {
      const accountId = req.currentUser!.accountId;
      const page = intParam(req.query.page as string | undefined) ?? 1;
      const perPage = Math.min(Math.max(intParam(req.query.per_page as string | undefined) ?? 25, 1), 100);
      const archived = req.query.archived === 'true';

      const conditions = [eq(submissions.accountId, accountId)];

      const templateId = intParam(req.query.template_id as string | undefined);
      if (templateId) conditions.push(eq(submissions.templateId, templateId));

      conditions.push(archived ? isNotNull(submissions.archivedAt) : isNull(submissions.archivedAt));

      const where = and(...conditions);

      const countRows = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(submissions)
        .where(where);
      const total = countRows[0]?.total ?? 0;

      const rows = await db
        .select()
        .from(submissions)
        .where(where)
        .orderBy(desc(submissions.id))
        .limit(perPage)
        .offset((page - 1) * perPage);

      const ids = rows.map((row) => row.id);
      const submitterRows =
        ids.length > 0
          ? await db
              .select()
              .from(submitters)
              .where(inArray(submitters.submissionId, ids))
              .orderBy(asc(submitters.id))
          : [];

      const grouped = new Map<number, typeof submitterRows>();
      for (const row of submitterRows) {
        const list = grouped.get(row.submissionId) ?? [];
        list.push(row);
        grouped.set(row.submissionId, list);
      }

      res.json({
        data: rows.map((row) => serializeSubmission(row, grouped.get(row.id) ?? [])),
        pagination: { page, per_page: perPage, total },
      });
    }),
  );

  app.get(
    '/submissions/:id/events',
    requireUser,
    asyncHandler(async (req, res) => {
      const scoped = await loadScopedSubmission(req);

      const events = await db
        .select()
        .from(submissionEvents)
        .where(eq(submissionEvents.submissionId, scoped.id))
        .orderBy(asc(submissionEvents.id));

      res.json({ data: events.map(serializeEvent) });
    }),
  );

  app.get(
    '/submissions/:id',
    requireUser,
    asyncHandler(async (req, res) => {
      const scoped = await loadScopedSubmission(req);

      const [submission] = await db.select().from(submissions).where(eq(submissions.id, scoped.id)).limit(1);
      const submitterRows = await loadSubmitters(scoped.id);
      const events = await db
        .select()
        .from(submissionEvents)
        .where(eq(submissionEvents.submissionId, scoped.id))
        .orderBy(asc(submissionEvents.id));

      res.json({
        ...serializeSubmission(submission!, submitterRows),
        events: events.map(serializeEvent),
      });
    }),
  );

  app.delete(
    '/submissions/:id',
    requireUser,
    asyncHandler(async (req, res) => {
      const scoped = await loadScopedSubmission(req);
      const permanently = String(req.query.permanently ?? '') === 'true';

      if (permanently) {
        await db.transaction(async (tx) => {
          const submitterRows = await tx
            .select({ id: submitters.id })
            .from(submitters)
            .where(eq(submitters.submissionId, scoped.id));

          const submitterIds = submitterRows.map((row) => row.id);

          if (submitterIds.length > 0) {
            await tx.delete(completedDocuments).where(inArray(completedDocuments.submitterId, submitterIds));
          }
          await tx.delete(completedSubmitters).where(eq(completedSubmitters.submissionId, scoped.id));
          await tx.delete(submissionEvents).where(eq(submissionEvents.submissionId, scoped.id));
          await tx.delete(submitters).where(eq(submitters.submissionId, scoped.id));
          await tx.delete(submissions).where(eq(submissions.id, scoped.id));
        });

        res.json({ id: scoped.id, archived_at: null });
        return;
      }

      const now = new Date();
      const [updated] = await db
        .update(submissions)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(submissions.id, scoped.id))
        .returning({ archivedAt: submissions.archivedAt });

      res.json({ id: scoped.id, archived_at: updated?.archivedAt?.toISOString() ?? null });
    }),
  );

  app.get(
    '/s/:slug',
    asyncHandler(async (req: Request, res: Response) => {
      const slug = String(req.params.slug ?? '');
      const { submitter, submission } = await findSubmitterBySlug(slug);

      let templateSchema: unknown[] = [];
      let templateFields: unknown[] = [];
      let templateName: string | null = null;
      let templateSubmittersList: unknown[] = [];

      if (submission.templateId) {
        const [template] = await db.select().from(templates).where(eq(templates.id, submission.templateId)).limit(1);
        if (template) {
          templateName = template.name;
          templateSchema = parseJsonColumn<unknown[]>(submission.templateSchema ?? template.schema, []);
          templateFields = parseJsonColumn<unknown[]>(submission.templateFields ?? template.fields, []);
          templateSubmittersList = parseJsonColumn<unknown[]>(template.submitters, []);
        }
      }

      res.json({
        submitter: serializeSubmitter(submitter),
        submission: {
          id: submission.id,
          slug: submission.slug,
          status: submission.completedAt ? 'completed' : 'started',
          created_at: submission.createdAt.toISOString(),
          completed_at: submission.completedAt?.toISOString() ?? null,
          expire_at: submission.expireAt?.toISOString() ?? null,
          archived_at: submission.archivedAt?.toISOString() ?? null,
        },
        template: {
          id: submission.templateId,
          name: templateName,
          schema: templateSchema,
          fields: templateFields,
          submitters: templateSubmittersList,
        },
      });
    }),
  );

  app.post(
    '/s/:slug/data',
    validateBody(submitDataSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const slug = String(req.params.slug ?? '');
      const input = body<{ values: Record<string, unknown> }>(req);

      const { submitter, submission } = await submitSubmitterValues(slug, input.values, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        submitter: serializeSubmitter(submitter),
        submission: {
          id: submission.id,
          slug: submission.slug,
          status: submission.completedAt ? 'completed' : 'started',
          completed_at: submission.completedAt?.toISOString() ?? null,
        },
      });
    }),
  );
}
