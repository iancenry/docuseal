import type { submissionEvents, submissions, submitters, templates } from '../../db/schema.js';
import { parseJsonArray, parseJsonObject } from '../templates/util.js';

export type SubmissionRow = typeof submissions.$inferSelect;
export type SubmitterRow = typeof submitters.$inferSelect;
export type SubmissionEventRow = typeof submissionEvents.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;

type FieldItem = Record<string, unknown>;
type SubmitterItem = Record<string, unknown>;

const EVENT_DATA_KEYS = ['reason', 'firstname', 'lastname', 'method', 'country', 'idcode'];

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function titleize(raw: string): string {
  return raw
    .split(/[_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function submitterStatus(row: SubmitterRow): string {
  if (row.declinedAt) return 'declined';
  if (row.completedAt) return 'completed';
  if (row.openedAt) return 'opened';
  if (row.sentAt) return 'sent';
  return 'awaiting';
}

export function serializeEventForApi(row: SubmissionEventRow): Record<string, unknown> {
  const data = parseJsonObject(row.data);
  const sliced: Record<string, unknown> = {};
  for (const key of EVENT_DATA_KEYS) {
    if (key in data) sliced[key] = data[key];
  }
  return {
    id: row.id,
    submitter_id: row.submitterId ?? null,
    event_type: row.eventType,
    event_timestamp: iso(row.eventTimestamp),
    data: sliced,
  };
}

export interface DocumentMetaJson {
  name: string;
  url: string | null;
}

export function fieldNameFor(
  field: FieldItem,
  typeCounters: Map<string, number>,
): string {
  const type = String(field['type'] ?? '');
  const explicit = field['name'];
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const count = typeCounters.get(type) ?? 1;
  return `${titleize(type)} Field ${count}`;
}

export function buildValuesArray(
  fields: FieldItem[],
  row: SubmitterRow,
): { field: string; value: unknown }[] {
  const counters = new Map<string, number>();
  const values = parseJsonObject(row.values);
  const out: { field: string; value: unknown }[] = [];

  for (const field of fields) {
    const type = String(field['type'] ?? '');
    counters.set(type, (counters.get(type) ?? 0) + 1);
    if (field['submitter_uuid'] !== row.uuid || type === 'heading') continue;

    const hasValue = Object.prototype.hasOwnProperty.call(values, String(field['uuid']));
    if (!hasValue && !row.completedAt) continue;

    out.push({ field: fieldNameFor(field, counters), value: hasValue ? values[String(field['uuid'])] : null });
  }
  return out;
}

export function roleOf(templateSubmitters: SubmitterItem[], row: SubmitterRow): string | null {
  const item = templateSubmitters.find((entry) => entry['uuid'] === row.uuid);
  const name = item?.['name'];
  return typeof name === 'string' ? name : null;
}

export interface SubmitterSerializeOptions {
  templateFields: FieldItem[];
  templateSubmitters: SubmitterItem[];
  baseUrl?: string | undefined;
  withValues?: boolean | undefined;
  withDocuments?: boolean | undefined;
  withUrls?: boolean | undefined;
  withTemplate?: boolean | undefined;
  templateSummary?: TemplateSummaryJson | null | undefined;
  withEvents?: boolean | undefined;
  events?: SubmissionEventRow[] | undefined;
  documents?: DocumentMetaJson[] | undefined;
}

export function serializeSubmitterForApi(
  row: SubmitterRow,
  options: SubmitterSerializeOptions,
): Record<string, unknown> {
  const json: Record<string, unknown> = {
    id: row.id,
    slug: row.slug,
    uuid: row.uuid,
    name: row.name,
    email: row.email,
    phone: row.phone,
    completed_at: iso(row.completedAt),
    declined_at: iso(row.declinedAt),
    external_id: row.externalId,
    application_key: row.externalId,
    submission_id: row.submissionId,
    metadata: parseJsonObject(row.metadata),
    opened_at: iso(row.openedAt),
    sent_at: iso(row.sentAt),
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    status: submitterStatus(row),
  };

  if (options.withTemplate) {
    json['template'] = options.templateSummary ?? null;
  }
  if (options.withValues !== false) {
    json['values'] = buildValuesArray(options.templateFields, row);
  }
  if (options.withDocuments !== false) {
    json['documents'] = options.documents ?? [];
  }
  const preferences = parseJsonObject(row.preferences);
  delete preferences['default_values'];
  json['preferences'] = preferences;
  if (options.withEvents) {
    json['submission_events'] = (options.events ?? []).map(serializeEventForApi);
  }
  json['role'] = roleOf(options.templateSubmitters, row);
  if (options.withUrls) {
    json['embed_src'] = `${options.baseUrl ?? ''}/s/${row.slug}`;
  }
  return json;
}

export function buildSubmissionStatus(
  submission: SubmissionRow,
  rows: SubmitterRow[],
): 'completed' | 'declined' | 'expired' | 'pending' {
  if (submission.completedAt) return 'completed';
  if (rows.some((row) => row.declinedAt)) return 'declined';
  if (submission.expireAt && submission.expireAt.getTime() <= Date.now()) return 'expired';
  return 'pending';
}

export interface TemplateSummaryJson {
  id: number;
  name: string;
  external_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  folder_name?: string | null;
}

export function templateSummaryJson(row: TemplateRow | null, folderName?: string | null): TemplateSummaryJson | null {
  if (!row) return null;
  const summary: TemplateSummaryJson = {
    id: row.id,
    name: row.name,
    external_id: row.externalId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
  if (folderName !== undefined) summary['folder_name'] = folderName ?? null;
  return summary;
}

export interface AuthorJson {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface SubmissionSerializeOptions {
  template?: TemplateRow | null | undefined;
  folderName?: string | null | undefined;
  createdByUser?: AuthorJson | null | undefined;
  baseUrl?: string | undefined;
  withEvents?: boolean | undefined;
  withDocuments?: boolean | undefined;
  withValues?: boolean | undefined;
  includeFields?: boolean | undefined;
  documents?: DocumentMetaJson[] | undefined;
  events?: SubmissionEventRow[] | undefined;
}

export function serializeSubmissionForApi(
  submission: SubmissionRow,
  submitterRows: SubmitterRow[],
  options: SubmissionSerializeOptions,
): Record<string, unknown> {
  const fields = parseJsonArray(submission.templateFields);
  const submittersList = parseJsonArray(submission.templateSubmitters);

  const serializedSubmitters = submitterRows.map((row) =>
    serializeSubmitterForApi(row, {
      templateFields: fields,
      templateSubmitters: submittersList,
      baseUrl: options.baseUrl,
      withValues: options.withValues,
      withDocuments: options.withDocuments,
    }),
  );

  let variables: unknown = {};
  try {
    variables = submission.variables ? JSON.parse(submission.variables) : {};
  } catch {
    variables = {};
  }

  const json: Record<string, unknown> = {
    id: submission.id,
    name: submission.name,
    slug: submission.slug,
    source: submission.source,
    submitters_order: submission.submittersOrder,
    expire_at: iso(submission.expireAt),
    created_at: iso(submission.createdAt),
    updated_at: iso(submission.updatedAt),
    archived_at: iso(submission.archivedAt),
    template: templateSummaryJson(options.template ?? null, options.folderName),
    created_by_user: options.createdByUser ?? null,
    variables,
    status: buildSubmissionStatus(submission, submitterRows),
    completed_at: iso(submission.completedAt),
  };

  if (options.withEvents !== false) {
    json['submission_events'] = (options.events ?? []).map(serializeEventForApi);
  }
  if (options.includeFields) {
    json['fields'] = fields;
  }
  json['audit_log_url'] = null;
  json['combined_document_url'] = null;
  json['documents'] =
    options.documents ?? (options.withDocuments !== false ? lastCompletedSubmitterDocuments(submitterRows, serializedSubmitters) : []);
  json['submitters'] = serializedSubmitters;

  return json;
}

function lastCompletedSubmitterDocuments(
  rows: SubmitterRow[],
  serialized: Record<string, unknown>[],
): DocumentMetaJson[] {
  let last: SubmitterRow | null = null;
  for (const row of rows) {
    if (row.completedAt && (!last || last === null || row.completedAt.getTime() >= (last.completedAt?.getTime() ?? 0))) {
      last = row;
    }
  }
  if (!last) return [];
  const index = rows.indexOf(last);
  const entry = serialized[index];
  const docs = entry?.['documents'];
  return Array.isArray(docs) ? (docs as DocumentMetaJson[]) : [];
}
