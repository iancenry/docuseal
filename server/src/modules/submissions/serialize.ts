import type { submissionEvents, submissions, submitters } from '../../db/schema.js';

export type SubmissionRow = typeof submissions.$inferSelect;
export type SubmitterRow = typeof submitters.$inferSelect;
export type SubmissionEventRow = typeof submissionEvents.$inferSelect;

export function parseJsonColumn<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function submissionStatus(submission: SubmissionRow): 'completed' | 'started' {
  return submission.completedAt ? 'completed' : 'started';
}

export function submitterStatus(submitter: SubmitterRow): string {
  if (submitter.declinedAt) return 'declined';
  if (submitter.completedAt) return 'completed';
  if (submitter.openedAt) return 'opened';
  if (submitter.sentAt) return 'sent';
  return 'awaiting';
}

export function serializeSubmitter(row: SubmitterRow): Record<string, unknown> {
  return {
    id: row.id,
    uuid: row.uuid,
    slug: row.slug,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: submitterStatus(row),
    sent_at: iso(row.sentAt),
    submitted_at: iso(row.completedAt),
    opened_at: iso(row.openedAt),
    declined_at: iso(row.declinedAt),
    values: parseJsonColumn<Record<string, unknown>>(row.values, {}),
    sign_url: `/s/${row.slug}`,
  };
}

export interface SerializedEvent {
  id: number;
  event_type: string;
  data: Record<string, unknown>;
  submission_id: number;
  submitter_id: number | null;
  created_at: string | null;
}

export function serializeEvent(row: SubmissionEventRow): SerializedEvent {
  return {
    id: row.id,
    event_type: row.eventType,
    data: parseJsonColumn<Record<string, unknown>>(row.data, {}),
    submission_id: row.submissionId,
    submitter_id: row.submitterId ?? null,
    created_at: iso(row.createdAt),
  };
}

export function serializeSubmission(
  submission: SubmissionRow,
  submitterRows: SubmitterRow[],
): Record<string, unknown> {
  return {
    id: submission.id,
    slug: submission.slug,
    name: submission.name,
    status: submissionStatus(submission),
    source: submission.source,
    submitters_order: submission.submittersOrder,
    template_id: submission.templateId,
    created_by_user_id: submission.createdByUserId,
    created_at: iso(submission.createdAt),
    updated_at: iso(submission.updatedAt),
    completed_at: iso(submission.completedAt),
    archived_at: iso(submission.archivedAt),
    expire_at: iso(submission.expireAt),
    submitters: submitterRows.map(serializeSubmitter),
  };
}
