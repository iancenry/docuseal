import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { submissionEvents, submissions, submitters, templateVersions, templates } from '../../db/schema.js';
import { HttpError } from '../../http/helpers.js';
import { generateSlug } from './slugs.js';

export interface TemplateSubmitterItem {
  name?: string;
  uuid?: string;
  [key: string]: unknown;
}

export const createSubmissionSchema = z.object({
  template_id: z.coerce.number().int().positive(),
  submitters: z
    .array(
      z.object({
        role: z.string().min(1),
        name: z.string().min(1).nullish(),
        email: z.union([z.email(), z.literal('')]).nullish(),
        phone: z.string().min(1).nullish(),
        uuid: z.string().min(1).nullish(),
      }),
    )
    .min(1),
  send_email: z.boolean().optional(),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
export type CreateSubmitterInput = CreateSubmissionInput['submitters'][number];

function findTemplateSubmitter(
  templateSubmitters: TemplateSubmitterItem[],
  input: CreateSubmitterInput,
): TemplateSubmitterItem | undefined {
  if (input.uuid) {
    return templateSubmitters.find((item) => item.uuid === input.uuid);
  }
  const role = input.role.toLowerCase();
  return templateSubmitters.find((item) => (item.name ?? '').toLowerCase() === role);
}

async function loadLatestVersionSubmitters(templateId: number): Promise<TemplateSubmitterItem[] | null> {
  const [version] = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.id))
    .limit(1);

  if (!version) return null;

  try {
    const data = JSON.parse(version.data) as { submitters?: unknown };
    if (Array.isArray(data.submitters) && data.submitters.length > 0) {
      return data.submitters as TemplateSubmitterItem[];
    }
  } catch {
    throw new HttpError(422, 'Invalid template version data');
  }
  return null;
}

export async function createSubmissionFromSubmitters(
  accountId: number,
  userId: number,
  input: CreateSubmissionInput,
): Promise<{ submissionId: number; submitters: { id: number; slug: string }[] }> {
  const [template] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, input.template_id), eq(templates.accountId, accountId)))
    .limit(1);

  if (!template) throw new HttpError(404, 'Template not found');
  if (template.archivedAt) throw new HttpError(422, 'Template has been archived');

  let templateSubmitters = await loadLatestVersionSubmitters(template.id);
  if (!templateSubmitters) {
    templateSubmitters = (() => {
      try {
        return JSON.parse(template.submitters ?? '[]') as TemplateSubmitterItem[];
      } catch {
        throw new HttpError(422, 'Invalid template submitters data');
      }
    })();
  }

  for (const submitterInput of input.submitters) {
    if (!findTemplateSubmitter(templateSubmitters, submitterInput)) {
      throw new HttpError(422, `${submitterInput.role} role doesn't exist`);
    }
  }

  if (input.submitters.length > templateSubmitters.length) {
    throw new HttpError(422, 'Defined more signing parties than in template');
  }

  const now = new Date();

  return db.transaction(async (tx) => {
    const [submission] = await tx
      .insert(submissions)
      .values({
        slug: generateSlug(),
        accountId,
        templateId: template.id,
        createdByUserId: userId,
        source: 'invite',
        submittersOrder: 'preserved',
        preferences: '{}',
        variables: '{}',
        name: null,
        templateFields: template.fields,
        templateSchema: template.schema,
        templateSubmitters: template.submitters,
      })
      .returning({ id: submissions.id });

    if (!submission) throw new HttpError(500, 'Failed to create submission');

    const matched: {
      uuid: string;
      email: string | null;
      name: string | null;
      phone: string | null;
      sentAt: Date | null;
    }[] = [];

    for (const submitterInput of input.submitters) {
      const templateSubmitter = findTemplateSubmitter(templateSubmitters, submitterInput);
      if (!templateSubmitter?.uuid) throw new HttpError(422, 'Invalid submitter params');

      matched.push({
        uuid: templateSubmitter.uuid,
        email: submitterInput.email ? submitterInput.email : null,
        name: submitterInput.name ?? null,
        phone: submitterInput.phone ?? null,
        sentAt: input.send_email && submitterInput.email ? now : null,
      });
    }

    const insertedSubmitters = await tx
      .insert(submitters)
      .values(
        matched.map((item) => ({
          slug: generateSlug(),
          uuid: item.uuid,
          accountId,
          submissionId: submission.id,
          email: item.email,
          name: item.name,
          phone: item.phone,
          sentAt: item.sentAt,
          values: '{}',
          metadata: '{}',
          preferences: '{}',
        })),
      )
      .returning({ id: submitters.id, slug: submitters.slug });

    await tx.insert(submissionEvents).values({
      eventType: 'create',
      data: '{}',
      eventTimestamp: now,
      submissionId: submission.id,
      submitterId: insertedSubmitters[0]?.id ?? null,
      accountId,
    });

    if (input.send_email) {
      const emailEvents = matched
        .map((item, index) => ({ ...item, submitterId: insertedSubmitters[index]?.id }))
        .filter((item): item is typeof item & { email: string; submitterId: number } =>
          Boolean(item.email && item.submitterId),
        )
        .map((item) => ({
          eventType: 'send_request_email',
          data: JSON.stringify({ to: item.email }),
          eventTimestamp: now,
          submissionId: submission.id,
          submitterId: item.submitterId,
          accountId,
        }));

      if (emailEvents.length > 0) await tx.insert(submissionEvents).values(emailEvents);
    }

    return { submissionId: submission.id, submitters: insertedSubmitters };
  });
}
