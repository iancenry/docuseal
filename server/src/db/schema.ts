// AUTO-GENERATED from db/schema.rb by scripts/generate_drizzle_schema.rb — do not edit by hand.
// Rails mappings: string -> varchar({length}|255), datetime -> timestamp (no tz), array: true -> .array(),
// bigint pk -> serial (identity). FK constraints listed in the FK_TODO comment block at the bottom.

import {
  pgTable,
  text,
  varchar,
  integer,
  bigint,
  boolean,
  timestamp,
  date,
  serial,
  customType,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const accessTokens = pgTable('access_tokens', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  sha256: text("sha256").notNull(),
  token: text("token").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  userId: bigint("user_id", { mode: 'number' }).notNull(),
}, (table) => [
  uniqueIndex('index_access_tokens_on_sha256').on(table.sha256),
  index('index_access_tokens_on_user_id').on(table.userId),
]);

export const accountAccesses = pgTable('account_accesses', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  userId: bigint("user_id", { mode: 'number' }).notNull(),
}, (table) => [
  uniqueIndex('index_account_accesses_on_account_id_and_user_id').on(table.accountId, table.userId),
]);

export const accountConfigs = pgTable('account_configs', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  key: varchar("key").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  value: text("value").notNull(),
}, (table) => [
  uniqueIndex('index_account_configs_on_account_id_and_key').on(table.accountId, table.key),
  index('index_account_configs_on_account_id').on(table.accountId),
]);

export const accountLinkedAccounts = pgTable('account_linked_accounts', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  accountType: text("account_type").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  linkedAccountId: bigint("linked_account_id", { mode: 'number' }).notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex('idx_on_account_id_linked_account_id_48ab9f79d2').on(table.accountId, table.linkedAccountId),
  index('index_account_linked_accounts_on_account_id').on(table.accountId),
  index('index_account_linked_accounts_on_linked_account_id').on(table.linkedAccountId),
]);

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  locale: varchar("locale").notNull(),
  name: varchar("name").notNull(),
  timezone: varchar("timezone").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  uuid: varchar("uuid").notNull(),
}, (table) => [
  uniqueIndex('index_accounts_on_uuid').on(table.uuid),
]);

export const activeStorageAttachments = pgTable('active_storage_attachments', {
  id: serial('id').primaryKey(),
  blobId: bigint("blob_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  name: varchar("name").notNull(),
  recordId: bigint("record_id", { mode: 'number' }).notNull(),
  recordType: varchar("record_type").notNull(),
  uuid: varchar("uuid").notNull(),
}, (table) => [
  index('index_active_storage_attachments_on_blob_id').on(table.blobId),
  index('idx_on_record_type_record_id_name_blob_id_0be5805727').on(table.recordType, table.recordId, table.name, table.blobId),
  index('index_active_storage_attachments_on_uuid').on(table.uuid),
]);

export const activeStorageBlobs = pgTable('active_storage_blobs', {
  id: serial('id').primaryKey(),
  byteSize: bigint("byte_size", { mode: 'number' }).notNull(),
  checksum: varchar("checksum"),
  contentType: varchar("content_type"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  filename: varchar("filename").notNull(),
  key: varchar("key").notNull(),
  metadata: text("metadata"),
  serviceName: varchar("service_name").notNull(),
  uuid: varchar("uuid"),
}, (table) => [
  index('index_active_storage_blobs_on_checksum').on(table.checksum),
  uniqueIndex('index_active_storage_blobs_on_key').on(table.key),
  uniqueIndex('index_active_storage_blobs_on_uuid').on(table.uuid),
]);

export const activeStorageVariantRecords = pgTable('active_storage_variant_records', {
  id: serial('id').primaryKey(),
  blobId: bigint("blob_id", { mode: 'number' }).notNull(),
  variationDigest: varchar("variation_digest").notNull(),
}, (table) => [
  uniqueIndex('index_active_storage_variant_records_uniqueness').on(table.blobId, table.variationDigest),
]);

export const completedDocuments = pgTable('completed_documents', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  sha256: varchar("sha256").notNull(),
  submitterId: bigint("submitter_id", { mode: 'number' }).notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index('index_completed_documents_on_sha256').on(table.sha256),
  index('index_completed_documents_on_submitter_id').on(table.submitterId),
]);

export const completedSubmitters = pgTable('completed_submitters', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  completedAt: timestamp("completed_at").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  isFirst: boolean("is_first"),
  smsCount: integer("sms_count").notNull(),
  source: varchar("source").notNull(),
  submissionId: bigint("submission_id", { mode: 'number' }).notNull(),
  submitterId: bigint("submitter_id", { mode: 'number' }).notNull(),
  templateId: bigint("template_id", { mode: 'number' }),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  verificationMethod: varchar("verification_method"),
}, (table) => [
  index('index_completed_submitters_account_id_completed_at_is_first').on(table.accountId, table.completedAt).where(sql`(is_first = true)`),
  index('index_completed_submitters_on_account_id_and_completed_at').on(table.accountId, table.completedAt),
  uniqueIndex('index_completed_submitters_on_submission_id').on(table.submissionId).where(sql`(is_first = true)`),
  uniqueIndex('index_completed_submitters_on_submitter_id').on(table.submitterId),
]);

export const console1984Commands = pgTable('console1984_commands', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  sensitiveAccessId: bigint("sensitive_access_id", { mode: 'number' }),
  sessionId: bigint("session_id", { mode: 'number' }).notNull(),
  statements: text("statements"),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index('index_console1984_commands_on_sensitive_access_id').on(table.sensitiveAccessId),
  index('on_session_and_sensitive_chronologically').on(table.sessionId, table.createdAt, table.sensitiveAccessId),
]);

export const console1984SensitiveAccesses = pgTable('console1984_sensitive_accesses', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  justification: text("justification"),
  sessionId: bigint("session_id", { mode: 'number' }).notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index('index_console1984_sensitive_accesses_on_session_id').on(table.sessionId),
]);

export const console1984Sessions = pgTable('console1984_sessions', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  reason: text("reason"),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  userId: bigint("user_id", { mode: 'number' }).notNull(),
}, (table) => [
  index('index_console1984_sessions_on_created_at').on(table.createdAt),
  index('index_console1984_sessions_on_user_id_and_created_at').on(table.userId, table.createdAt),
]);

export const console1984Users = pgTable('console1984_users', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  username: varchar("username").notNull(),
}, (table) => [
  index('index_console1984_users_on_username').on(table.username),
]);

export const documentGenerationEvents = pgTable('document_generation_events', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  eventName: varchar("event_name").notNull(),
  submitterId: bigint("submitter_id", { mode: 'number' }).notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex('index_document_generation_events_on_submitter_id_and_event_name').on(table.submitterId, table.eventName).where(sql`((event_name)::text = ANY (ARRAY[('start'::character varying)::text, ('complete'::character varying)::text]))`),
  index('index_document_generation_events_on_submitter_id').on(table.submitterId),
]);

export const documentMetadata = pgTable('document_metadata', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  blobChecksum: varchar("blob_checksum").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  textRuns: text("text_runs").notNull(),
}, (table) => [
  uniqueIndex('index_document_metadata_on_account_id_and_blob_checksum').on(table.accountId, table.blobChecksum),
]);

export const dynamicDocumentVersions = pgTable('dynamic_document_versions', {
  id: serial('id').primaryKey(),
  areas: text("areas").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  dynamicDocumentId: bigint("dynamic_document_id", { mode: 'number' }).notNull(),
  sha1: varchar("sha1").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex('idx_on_dynamic_document_id_sha1_3503adf557').on(table.dynamicDocumentId, table.sha1),
]);

export const dynamicDocuments = pgTable('dynamic_documents', {
  id: serial('id').primaryKey(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  head: text("head"),
  sha1: varchar("sha1").notNull(),
  templateId: bigint("template_id", { mode: 'number' }).notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  uuid: varchar("uuid").notNull(),
}, (table) => [
  index('index_dynamic_documents_on_template_id').on(table.templateId),
]);

export const emailEvents = pgTable('email_events', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  data: text("data").notNull(),
  email: varchar("email").notNull(),
  emailableId: bigint("emailable_id", { mode: 'number' }).notNull(),
  emailableType: varchar("emailable_type").notNull(),
  eventDatetime: timestamp("event_datetime").notNull(),
  eventType: varchar("event_type").notNull(),
  messageId: varchar("message_id").notNull(),
  tag: varchar("tag").notNull(),
}, (table) => [
  index('index_email_events_on_account_id_and_event_datetime').on(table.accountId, table.eventDatetime),
  index('index_email_events_on_email').on(table.email),
  index('index_email_events_on_email_event_types').on(table.email).where(sql`((event_type)::text = ANY (ARRAY[('bounce'::character varying)::text, ('soft_bounce'::character varying)::text, ('permanent_bounce'::character varying)::text, ('complaint'::character varying)::text, ('soft_complaint'::character varying)::text]))`),
  index('index_email_events_on_emailable').on(table.emailableType, table.emailableId),
  index('index_email_events_on_message_id').on(table.messageId),
]);

export const emailMessageAssets = pgTable('email_message_assets', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  data: text("data").notNull(),
  sha1: varchar("sha1").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex('index_email_message_assets_on_account_id_and_sha1').on(table.accountId, table.sha1),
]);

export const emailMessages = pgTable('email_messages', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  authorId: bigint("author_id", { mode: 'number' }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  sha1: varchar("sha1").notNull(),
  subject: text("subject").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  uuid: varchar("uuid").notNull(),
}, (table) => [
  index('index_email_messages_on_account_id').on(table.accountId),
  index('index_email_messages_on_sha1').on(table.sha1),
  index('index_email_messages_on_uuid').on(table.uuid),
]);

export const encryptedConfigs = pgTable('encrypted_configs', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  key: varchar("key").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  value: text("value").notNull(),
}, (table) => [
  uniqueIndex('index_encrypted_configs_on_account_id_and_key').on(table.accountId, table.key),
  index('index_encrypted_configs_on_account_id').on(table.accountId),
]);

export const encryptedUserConfigs = pgTable('encrypted_user_configs', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  key: varchar("key").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  userId: bigint("user_id", { mode: 'number' }).notNull(),
  value: text("value").notNull(),
}, (table) => [
  uniqueIndex('index_encrypted_user_configs_on_user_id_and_key').on(table.userId, table.key),
  index('index_encrypted_user_configs_on_user_id').on(table.userId),
]);

export const lockEvents = pgTable('lock_events', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  eventName: varchar("event_name").notNull(),
  key: varchar("key").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex('index_lock_events_on_event_name_and_key').on(table.eventName, table.key).where(sql`((event_name)::text = ANY (ARRAY[('start'::character varying)::text, ('complete'::character varying)::text]))`),
  index('index_lock_events_on_key').on(table.key),
]);

export const mcpTokens = pgTable('mcp_tokens', {
  id: serial('id').primaryKey(),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  name: varchar("name").notNull(),
  sha256: varchar("sha256").notNull(),
  tokenPrefix: varchar("token_prefix").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  userId: bigint("user_id", { mode: 'number' }).notNull(),
}, (table) => [
  uniqueIndex('index_mcp_tokens_on_sha256').on(table.sha256),
  index('index_mcp_tokens_on_user_id').on(table.userId),
]);

export const oauthAccessGrants = pgTable('oauth_access_grants', {
  id: serial('id').primaryKey(),
  applicationId: bigint("application_id", { mode: 'number' }).notNull(),
  codeChallenge: varchar("code_challenge"),
  codeChallengeMethod: varchar("code_challenge_method"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  expiresIn: integer("expires_in").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  resourceOwnerId: bigint("resource_owner_id", { mode: 'number' }).notNull(),
  revokedAt: timestamp("revoked_at"),
  scopes: varchar("scopes").notNull().default(sql`''`),
  token: varchar("token").notNull(),
}, (table) => [
  index('index_oauth_access_grants_on_application_id').on(table.applicationId),
  index('index_oauth_access_grants_on_resource_owner_id').on(table.resourceOwnerId),
  uniqueIndex('index_oauth_access_grants_on_token').on(table.token),
]);

export const oauthAccessTokens = pgTable('oauth_access_tokens', {
  id: serial('id').primaryKey(),
  applicationId: bigint("application_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  expiresIn: integer("expires_in"),
  previousRefreshToken: varchar("previous_refresh_token").notNull().default(sql`''`),
  refreshToken: varchar("refresh_token"),
  resourceOwnerId: bigint("resource_owner_id", { mode: 'number' }),
  revokedAt: timestamp("revoked_at"),
  scopes: varchar("scopes"),
  token: varchar("token").notNull(),
}, (table) => [
  index('index_oauth_access_tokens_on_application_id').on(table.applicationId),
  uniqueIndex('index_oauth_access_tokens_on_refresh_token').on(table.refreshToken),
  index('index_oauth_access_tokens_on_resource_owner_id').on(table.resourceOwnerId),
  uniqueIndex('index_oauth_access_tokens_on_token').on(table.token),
]);

export const oauthApplications = pgTable('oauth_applications', {
  id: serial('id').primaryKey(),
  confidential: boolean("confidential").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  name: varchar("name").notNull(),
  redirectUri: text("redirect_uri"),
  scopes: varchar("scopes").notNull().default(sql`''`),
  secret: varchar("secret").notNull(),
  uid: varchar("uid").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex('index_oauth_applications_on_uid').on(table.uid),
]);

export const searchEntries = pgTable('search_entries', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  ngram: tsvector("ngram"),
  recordId: bigint("record_id", { mode: 'number' }).notNull(),
  recordType: varchar("record_type").notNull(),
  tsvector: tsvector("tsvector").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index('index_search_entries_on_account_id_ngram_submission').on(table.accountId, table.ngram).where(sql`((record_type)::text = 'Submission'::text)`),
  index('index_search_entries_on_account_id_ngram_submitter').on(table.accountId, table.ngram).where(sql`((record_type)::text = 'Submitter'::text)`),
  index('index_search_entries_on_account_id_ngram_template').on(table.accountId, table.ngram).where(sql`((record_type)::text = 'Template'::text)`),
  index('index_search_entries_on_account_id_tsvector_submission').on(table.accountId, table.tsvector).where(sql`((record_type)::text = 'Submission'::text)`),
  index('index_search_entries_on_account_id_tsvector_submitter').on(table.accountId, table.tsvector).where(sql`((record_type)::text = 'Submitter'::text)`),
  index('index_search_entries_on_account_id_tsvector_template').on(table.accountId, table.tsvector).where(sql`((record_type)::text = 'Template'::text)`),
  uniqueIndex('index_search_entries_on_record_id_and_record_type').on(table.recordId, table.recordType),
]);

export const submissionEvents = pgTable('submission_events', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  data: text("data").notNull(),
  eventTimestamp: timestamp("event_timestamp").notNull(),
  eventType: varchar("event_type").notNull(),
  submissionId: bigint("submission_id", { mode: 'number' }).notNull(),
  submitterId: bigint("submitter_id", { mode: 'number' }),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index('index_submissions_events_on_sms_event_types').on(table.accountId, table.createdAt).where(sql`((event_type)::text = ANY (ARRAY[('send_sms'::character varying)::text, ('send_2fa_sms'::character varying)::text]))`),
  index('index_submission_events_on_account_id').on(table.accountId),
  index('index_submission_events_on_created_at').on(table.createdAt),
  index('index_submission_events_on_submission_id').on(table.submissionId),
  index('index_submission_events_on_submitter_id').on(table.submitterId),
]);

export const submissions = pgTable('submissions', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  archivedAt: timestamp("archived_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  createdByUserId: bigint("created_by_user_id", { mode: 'number' }),
  expireAt: timestamp("expire_at"),
  name: text("name"),
  preferences: text("preferences").notNull(),
  slug: varchar("slug").notNull(),
  source: varchar("source").notNull(),
  submittersOrder: varchar("submitters_order").notNull(),
  templateFields: text("template_fields"),
  templateId: bigint("template_id", { mode: 'number' }),
  templateSchema: text("template_schema"),
  templateSubmitters: text("template_submitters"),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  variables: text("variables"),
  variablesSchema: text("variables_schema"),
}, (table) => [
  index('index_submissions_on_account_id_and_completed_at').on(table.accountId, table.completedAt).where(sql`((completed_at IS NOT NULL) AND (archived_at IS NULL))`),
  index('index_submissions_on_account_id_and_id').on(table.accountId, table.id),
  index('index_submissions_on_account_id_and_id_pending').on(table.accountId, table.id).where(sql`((completed_at IS NULL) AND (archived_at IS NULL))`),
  index('index_submissions_on_account_id_and_template_id_and_id').on(table.accountId, table.templateId, table.id).where(sql`(archived_at IS NULL)`),
  index('index_submissions_on_account_id_and_template_id_and_id_archived').on(table.accountId, table.templateId, table.id).where(sql`(archived_at IS NOT NULL)`),
  index('index_submissions_on_created_at').on(table.createdAt),
  index('index_submissions_on_created_by_user_id').on(table.createdByUserId),
  uniqueIndex('index_submissions_on_slug').on(table.slug),
  index('index_submissions_on_template_id').on(table.templateId),
]);

export const submitterVersions = pgTable('submitter_versions', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  email: varchar("email"),
  name: varchar("name"),
  phone: varchar("phone"),
  slug: varchar("slug").notNull(),
  submitterId: bigint("submitter_id", { mode: 'number' }).notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index('index_submitter_versions_on_slug').on(table.slug),
  index('index_submitter_versions_on_submitter_id').on(table.submitterId),
]);

export const submitters = pgTable('submitters', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  declinedAt: timestamp("declined_at"),
  email: varchar("email"),
  externalId: varchar("external_id"),
  ip: varchar("ip"),
  metadata: text("metadata").notNull(),
  name: varchar("name"),
  openedAt: timestamp("opened_at"),
  phone: varchar("phone"),
  preferences: text("preferences").notNull(),
  sentAt: timestamp("sent_at"),
  slug: varchar("slug").notNull(),
  submissionId: bigint("submission_id", { mode: 'number' }).notNull(),
  timezone: varchar("timezone"),
  ua: varchar("ua"),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  uuid: varchar("uuid").notNull(),
  values: text("values").notNull(),
}, (table) => [
  index('index_submitters_on_account_id_and_completed_at').on(table.accountId, table.completedAt).where(sql`(completed_at IS NOT NULL)`),
  index('index_submitters_on_account_id_and_id').on(table.accountId, table.id),
  index('index_submitters_on_email').on(table.email),
  index('index_submitters_on_external_id').on(table.externalId),
  uniqueIndex('index_submitters_on_slug').on(table.slug),
  index('index_submitters_on_submission_id').on(table.submissionId),
]);

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  description: text("description"),
  name: varchar("name").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex('index_teams_on_account_id_and_name').on(table.accountId, table.name).where(sql`(archived_at IS NULL)`),
  index('index_teams_on_account_id').on(table.accountId),
]);

export const templateAccesses = pgTable('template_accesses', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  templateId: bigint("template_id", { mode: 'number' }).notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  userId: bigint("user_id", { mode: 'number' }).notNull(),
}, (table) => [
  uniqueIndex('index_template_accesses_on_template_id_and_user_id').on(table.templateId, table.userId),
]);

export const templateFolders = pgTable('template_folders', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  archivedAt: timestamp("archived_at"),
  authorId: bigint("author_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  name: varchar("name").notNull(),
  parentFolderId: bigint("parent_folder_id", { mode: 'number' }),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index('index_template_folders_on_account_id').on(table.accountId),
  index('index_template_folders_on_author_id').on(table.authorId),
  index('index_template_folders_on_parent_folder_id').on(table.parentFolderId),
]);

export const templateSharings = pgTable('template_sharings', {
  id: serial('id').primaryKey(),
  ability: varchar("ability").notNull(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  templateId: bigint("template_id", { mode: 'number' }).notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex('index_template_sharings_on_account_id_and_template_id').on(table.accountId, table.templateId),
  index('index_template_sharings_on_template_id').on(table.templateId),
]);

export const templateVersions = pgTable('template_versions', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  authorId: bigint("author_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  data: text("data").notNull(),
  sha1: varchar("sha1").notNull(),
  templateId: bigint("template_id", { mode: 'number' }).notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index('index_template_versions_on_account_id').on(table.accountId),
  index('index_template_versions_on_author_id').on(table.authorId),
  uniqueIndex('index_template_versions_on_template_id_and_sha1').on(table.templateId, table.sha1),
]);

export const templates = pgTable('templates', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  archivedAt: timestamp("archived_at"),
  authorId: bigint("author_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  externalId: varchar("external_id"),
  fields: text("fields").notNull(),
  folderId: bigint("folder_id", { mode: 'number' }).notNull(),
  name: varchar("name").notNull(),
  preferences: text("preferences").notNull(),
  schema: text("schema").notNull(),
  sharedLink: boolean("shared_link").notNull().default(false),
  slug: varchar("slug").notNull(),
  source: text("source").notNull(),
  submitters: text("submitters").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  variablesSchema: text("variables_schema"),
}, (table) => [
  index('index_templates_on_account_id_and_folder_id_and_id').on(table.accountId, table.folderId, table.id).where(sql`(archived_at IS NULL)`),
  index('index_templates_on_account_id_and_id_archived').on(table.accountId, table.id).where(sql`(archived_at IS NOT NULL)`),
  index('index_templates_on_account_id').on(table.accountId),
  index('index_templates_on_author_id').on(table.authorId),
  index('index_templates_on_external_id').on(table.externalId),
  index('index_templates_on_folder_id').on(table.folderId),
  uniqueIndex('index_templates_on_slug').on(table.slug),
]);

export const userConfigs = pgTable('user_configs', {
  id: serial('id').primaryKey(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  key: varchar("key").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  userId: bigint("user_id", { mode: 'number' }).notNull(),
  value: text("value").notNull(),
}, (table) => [
  uniqueIndex('index_user_configs_on_user_id_and_key').on(table.userId, table.key),
  index('index_user_configs_on_user_id').on(table.userId),
]);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  archivedAt: timestamp("archived_at"),
  confirmationSentAt: timestamp("confirmation_sent_at"),
  confirmationToken: varchar("confirmation_token"),
  confirmedAt: timestamp("confirmed_at"),
  consumedTimestep: integer("consumed_timestep"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  currentSignInAt: timestamp("current_sign_in_at"),
  currentSignInIp: varchar("current_sign_in_ip"),
  email: varchar("email").notNull(),
  encryptedPassword: varchar("encrypted_password").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  lastSignInAt: timestamp("last_sign_in_at"),
  lastSignInIp: varchar("last_sign_in_ip"),
  lockedAt: timestamp("locked_at"),
  otpRequiredForLogin: boolean("otp_required_for_login").notNull().default(false),
  otpSecret: varchar("otp_secret"),
  rememberCreatedAt: timestamp("remember_created_at"),
  resetPasswordSentAt: timestamp("reset_password_sent_at"),
  resetPasswordToken: varchar("reset_password_token"),
  role: varchar("role").notNull(),
  signInCount: integer("sign_in_count").notNull().default(0),
  teamId: bigint("team_id", { mode: 'number' }),
  unconfirmedEmail: varchar("unconfirmed_email"),
  unlockToken: varchar("unlock_token"),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  uuid: varchar("uuid").notNull(),
}, (table) => [
  index('index_users_on_account_id').on(table.accountId),
  uniqueIndex('index_users_on_email').on(table.email),
  uniqueIndex('index_users_on_reset_password_token').on(table.resetPasswordToken),
  index('index_users_on_team_id').on(table.teamId),
  uniqueIndex('index_users_on_unlock_token').on(table.unlockToken),
  uniqueIndex('index_users_on_uuid').on(table.uuid),
]);

export const webhookAttempts = pgTable('webhook_attempts', {
  id: serial('id').primaryKey(),
  attempt: integer("attempt").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  responseBody: text("response_body"),
  responseStatusCode: integer("response_status_code").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  webhookEventId: bigint("webhook_event_id", { mode: 'number' }).notNull(),
}, (table) => [
  index('index_webhook_attempts_on_webhook_event_id').on(table.webhookEventId),
]);

export const webhookEvents = pgTable('webhook_events', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  eventType: varchar("event_type").notNull(),
  recordId: bigint("record_id", { mode: 'number' }).notNull(),
  recordType: varchar("record_type").notNull(),
  status: varchar("status").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  uuid: varchar("uuid").notNull(),
  webhookUrlId: bigint("webhook_url_id", { mode: 'number' }).notNull(),
}, (table) => [
  uniqueIndex('index_webhook_events_on_uuid_and_webhook_url_id').on(table.uuid, table.webhookUrlId),
  index('index_webhook_events_error').on(table.webhookUrlId, table.id).where(sql`((status)::text = 'error'::text)`),
  index('index_webhook_events_on_webhook_url_id_and_id').on(table.webhookUrlId, table.id),
]);

export const webhookUrls = pgTable('webhook_urls', {
  id: serial('id').primaryKey(),
  accountId: bigint("account_id", { mode: 'number' }).notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  events: text("events").notNull(),
  hmacSecret: text("hmac_secret").notNull(),
  secret: text("secret").notNull(),
  sha1: varchar("sha1").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  url: text("url").notNull(),
}, (table) => [
  index('index_webhook_urls_on_account_id').on(table.accountId),
  index('index_webhook_urls_on_sha1').on(table.sha1),
]);

/*
 * FK_TODO: re-add foreign keys via drizzle's references()/foreignKey() once table ordering is settled:
 * add_foreign_key "access_tokens", "users"
 * add_foreign_key "account_accesses", "accounts"
 * add_foreign_key "account_configs", "accounts"
 * add_foreign_key "account_linked_accounts", "accounts"
 * add_foreign_key "account_linked_accounts", "accounts", column: "linked_account_id"
 * add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
 * add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
 * add_foreign_key "document_generation_events", "submitters"
 * add_foreign_key "document_metadata", "accounts"
 * add_foreign_key "dynamic_document_versions", "dynamic_documents"
 * add_foreign_key "dynamic_documents", "templates"
 * add_foreign_key "email_events", "accounts"
 * add_foreign_key "email_message_assets", "accounts"
 * add_foreign_key "email_messages", "accounts"
 * add_foreign_key "email_messages", "users", column: "author_id"
 * add_foreign_key "encrypted_configs", "accounts"
 * add_foreign_key "encrypted_user_configs", "users"
 * add_foreign_key "mcp_tokens", "users"
 * add_foreign_key "oauth_access_grants", "oauth_applications", column: "application_id"
 * add_foreign_key "oauth_access_grants", "users", column: "resource_owner_id"
 * add_foreign_key "oauth_access_tokens", "oauth_applications", column: "application_id"
 * add_foreign_key "oauth_access_tokens", "users", column: "resource_owner_id"
 * add_foreign_key "submission_events", "accounts"
 * add_foreign_key "submission_events", "submissions"
 * add_foreign_key "submission_events", "submitters"
 * add_foreign_key "submissions", "templates"
 * add_foreign_key "submissions", "users", column: "created_by_user_id"
 * add_foreign_key "submitter_versions", "submitters"
 * add_foreign_key "submitters", "submissions"
 * add_foreign_key "teams", "accounts"
 * add_foreign_key "template_accesses", "templates"
 * add_foreign_key "template_folders", "accounts"
 * add_foreign_key "template_folders", "template_folders", column: "parent_folder_id"
 * add_foreign_key "template_folders", "users", column: "author_id"
 * add_foreign_key "template_sharings", "templates"
 * add_foreign_key "template_versions", "accounts"
 * add_foreign_key "template_versions", "templates"
 * add_foreign_key "template_versions", "users", column: "author_id"
 * add_foreign_key "templates", "accounts"
 * add_foreign_key "templates", "template_folders", column: "folder_id"
 * add_foreign_key "templates", "users", column: "author_id"
 * add_foreign_key "user_configs", "users"
 * add_foreign_key "users", "accounts"
 * add_foreign_key "users", "teams"
 * add_foreign_key "webhook_urls", "accounts"
 */
