export const WEBHOOK_URL_EVENTS = [
  'form.viewed',
  'form.started',
  'form.completed',
  'form.declined',
  'submission.created',
  'submission.completed',
  'submission.expired',
  'submission.archived',
  'template.created',
  'template.updated',
  'template.archived',
] as const;

export type WebhookUrlEvent = (typeof WEBHOOK_URL_EVENTS)[number];

export const DEFAULT_WEBHOOK_EVENTS: WebhookUrlEvent[] = [
  'form.viewed',
  'form.started',
  'form.completed',
  'form.declined',
];

export function isWebhookUrlEvent(value: string): value is WebhookUrlEvent {
  return (WEBHOOK_URL_EVENTS as readonly string[]).includes(value);
}
