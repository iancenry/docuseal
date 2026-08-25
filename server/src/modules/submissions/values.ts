import crypto from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { completedDocuments, completedSubmitters, submissionEvents, submissions, submitters } from '../../db/schema.js';
import { HttpError } from '../../http/helpers.js';
import type { SubmissionRow, SubmitterRow } from './serialize.js';

export const submitDataSchema = z.object({
  values: z.record(z.string(), z.unknown()).default({}),
});

export interface SubmitMeta {
  ip: string | undefined;
  userAgent: string | undefined;
}

export async function findSubmitterBySlug(slug: string): Promise<{ submitter: SubmitterRow; submission: SubmissionRow }> {
  const [submitter] = await db.select().from(submitters).where(eq(submitters.slug, slug)).limit(1);
  if (!submitter) throw new HttpError(404, 'Submitter not found');

  const [submission] = await db.select().from(submissions).where(eq(submissions.id, submitter.submissionId)).limit(1);
  if (!submission) throw new HttpError(404, 'Submission not found');

  return { submitter, submission };
}

export async function submitSubmitterValues(
  slug: string,
  values: Record<string, unknown>,
  meta: SubmitMeta = { ip: undefined, userAgent: undefined },
): Promise<{ submitter: SubmitterRow; submission: SubmissionRow }> {
  return db.transaction(async (tx) => {
    const [submitter] = await tx.select().from(submitters).where(eq(submitters.slug, slug)).limit(1).for('update');
    if (!submitter) throw new HttpError(404, 'Submitter not found');

    const [submission] = await tx.select().from(submissions).where(eq(submissions.id, submitter.submissionId)).limit(1);
    if (!submission) throw new HttpError(404, 'Submission not found');

    if (submitter.completedAt) throw new HttpError(422, 'Form has been completed already');
    if (submission.archivedAt) throw new HttpError(422, 'Form has been archived');
    if (submission.expireAt && !submission.completedAt && submission.expireAt.getTime() <= Date.now()) {
      throw new HttpError(422, 'Form has been expired');
    }

    const existingValues = JSON.parse(submitter.values || '{}') as Record<string, unknown>;
    const mergedValues: Record<string, unknown> = { ...existingValues, ...values };
    const now = new Date();

    const [updatedSubmitter] = await tx
      .update(submitters)
      .set({
        values: JSON.stringify(mergedValues),
        completedAt: now,
        openedAt: submitter.openedAt ?? now,
        ip: meta.ip ?? null,
        ua: meta.userAgent ?? null,
        updatedAt: now,
      })
      .where(eq(submitters.id, submitter.id))
      .returning();

    await tx.insert(submissionEvents).values({
      eventType: 'submit',
      data: '{}',
      eventTimestamp: now,
      submissionId: submission.id,
      submitterId: submitter.id,
      accountId: submission.accountId,
    });

    let updatedSubmission = submission;

    const [incomplete] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(submitters)
      .where(and(eq(submitters.submissionId, submission.id), isNull(submitters.completedAt)));

    if (incomplete && incomplete.count === 0) {
      const allSubmitters = await tx
        .select()
        .from(submitters)
        .where(eq(submitters.submissionId, submission.id))
        .orderBy(asc(submitters.completedAt), asc(submitters.id));

      const maxCompletedAt = allSubmitters.reduce<Date | null>(
        (acc, row) => (row.completedAt && (!acc || row.completedAt > acc) ? row.completedAt : acc),
        null,
      );

      const [completed] = await tx
        .update(submissions)
        .set({ completedAt: maxCompletedAt ?? now, updatedAt: now })
        .where(and(eq(submissions.id, submission.id), isNull(submissions.completedAt)))
        .returning();

      if (completed) updatedSubmission = completed;

      if (allSubmitters.length > 0) {
        await tx.insert(submissionEvents).values(
          allSubmitters.map((row) => ({
            eventType: 'complete',
            data: '{}',
            eventTimestamp: now,
            submissionId: submission.id,
            submitterId: row.id,
            accountId: submission.accountId,
          })),
        );

        let isFirstAssigned = false;

        for (const row of allSubmitters) {
          await tx.insert(completedSubmitters).values({
            accountId: submission.accountId,
            submissionId: submission.id,
            submitterId: row.id,
            templateId: submission.templateId,
            completedAt: row.completedAt ?? now,
            isFirst: !isFirstAssigned,
            smsCount: 0,
            source: submission.source,
          });
          isFirstAssigned = true;

          await tx.insert(completedDocuments).values({
            submitterId: row.id,
            sha256: crypto.createHash('sha256').update(`openseal-v0:${row.slug}`).digest('hex'),
          });
        }
      }
    }

    const finalSubmitter =
      updatedSubmitter ??
      (
        await tx.select().from(submitters).where(eq(submitters.id, submitter.id)).limit(1)
      )[0];

    if (!finalSubmitter) throw new HttpError(500, 'Failed to update submitter');

    return { submitter: finalSubmitter, submission: updatedSubmission };
  });
}
