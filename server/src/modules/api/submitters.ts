import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Express, Request } from 'express';
import { db } from '../../db/index.js';
import { submissionEvents, submissions, submitters, templates } from '../../db/schema.js';
import { HttpError, asyncHandler } from '../../http/helpers.js';
import { requireApiToken } from '../../http/auth.js';
import { parseJsonArray } from '../templates/util.js';
import {
  serializeSubmitterForApi,
  type DocumentMetaJson,
  type SubmitterRow,
  type TemplateSummaryJson,
} from './serialize.js';
import { cursorPagingOf, idPaginationMeta, likeTerm } from './pagination.js';
import { loadDocumentsMetadata } from './submissions.js';

function intParam(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadSubmitterScoped(id: number, accountId: number): Promise<SubmitterRow> {
  const [row] = await db
    .select()
    .from(submitters)
    .where(and(eq(submitters.id, id), eq(submitters.accountId, accountId)))
    .limit(1);
  if (!row) throw new HttpError(404, 'Submitter not found');
  return row;
}

async function loadTemplateSummary(templateId: number | null | undefined): Promise<TemplateSummaryJson | null> {
  if (!templateId) return null;
  const [row] = await db.select().from(templates).where(eq(templates.id, templateId)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    external_id: row.externalId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

interface FullContext {
  fields: Record<string, unknown>[];
  roleItems: Record<string, unknown>[];
  templateSummary: TemplateSummaryJson | null;
  events: (typeof submissionEvents.$inferSelect)[];
  documents: DocumentMetaJson[];
}

async function buildFullContext(row: SubmitterRow): Promise<FullContext> {
  const [submission] = await db.select().from(submissions).where(eq(submissions.id, row.submissionId)).limit(1);
  if (!submission) throw new HttpError(404, 'Submission not found');

  const fields = parseJsonArray(submission.templateFields);
  const roleItems = parseJsonArray(submission.templateSubmitters);

  const events = await db
    .select()
    .from(submissionEvents)
    .where(eq(submissionEvents.submitterId, row.id))
    .orderBy(asc(submissionEvents.id));

  let documents: DocumentMetaJson[] = [];
  if (row.completedAt) {
    const docsById = await loadDocumentsMetadata([row.id]);
    documents = docsById.get(row.id) ?? [];
  }

  const templateSummary = await loadTemplateSummary(submission.templateId);

  return { fields, roleItems, templateSummary, events, documents };
}

export function registerApiSubmittersRoutes(app: Express): void {
  app.get(
    '/api/submitters',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const paging = cursorPagingOf(req);
      const q = req.query as Record<string, string | undefined>;

      const conditions: (SQL | undefined)[] = [eq(submitters.accountId, user.accountId)];

      if (q.q) {
        const term = likeTerm(q.q);
        conditions.push(or(ilike(submitters.email, term), ilike(submitters.phone, term), ilike(submitters.name, term)));
      }
      if (q.application_key) conditions.push(eq(submitters.externalId, q.application_key));
      if (q.external_id) conditions.push(eq(submitters.externalId, q.external_id));
      if (q.slug) conditions.push(eq(submitters.slug, q.slug));

      const submissionId = intParam(q.submission_id);
      if (submissionId) conditions.push(eq(submitters.submissionId, submissionId));

      if (q.template_id) {
        const templateId = intParam(q.template_id);
        conditions.push(
          templateId
            ? inArray(
                submitters.submissionId,
                db.select({ id: submissions.id }).from(submissions).where(eq(submissions.templateId, templateId)),
              )
            : sql`false`,
        );
      }

      if (q.completed_after) {
        const date = new Date(q.completed_after);
        if (!Number.isNaN(date.getTime())) conditions.push(gte(submitters.completedAt, date));
      }
      if (q.completed_before) {
        const date = new Date(q.completed_before);
        if (!Number.isNaN(date.getTime())) conditions.push(lte(submitters.completedAt, date));
      }

      const cleaned = conditions.filter((condition): condition is SQL => condition !== undefined);

      const rows = await db
        .select()
        .from(submitters)
        .where(and(...cleaned))
        .orderBy(desc(submitters.id))
        .limit(paging.limit);

      const data = [];
      for (const row of rows) {
        const context = await buildFullContext(row);
        data.push(
          serializeSubmitterForApi(row, {
            templateFields: context.fields,
            templateSubmitters: context.roleItems,
            withTemplate: true,
            templateSummary: context.templateSummary,
            withEvents: true,
            events: context.events,
            documents: context.documents,
          }),
        );
      }

      res.json({ data, pagination: idPaginationMeta(rows) });
    }),
  );

  app.get(
    '/api/submitters/:id',
    requireApiToken,
    asyncHandler(async (req, res) => {
      const user = req.currentUser!;
      const id = intParam(req.params.id);
      if (!id) throw new HttpError(404, 'Submitter not found');
      const row = await loadSubmitterScoped(id, user.accountId);

      const context = await buildFullContext(row);
      res.json(
        serializeSubmitterForApi(row, {
          templateFields: context.fields,
          templateSubmitters: context.roleItems,
          withTemplate: true,
          templateSummary: context.templateSummary,
          withEvents: true,
          events: context.events,
          documents: context.documents,
        }),
      );
    }),
  );
}
