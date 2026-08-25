import crypto from 'node:crypto';
import type { Express, Request } from 'express';
import { asyncHandler } from '../../http/helpers.js';
import { requireApiToken } from '../../http/auth.js';
import { config } from '../../config.js';

const MAX_EXPIRE_IN = 24 * 60 * 60;
const DEFAULT_EXPIRE_IN = 60 * 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function encodeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function expireInSeconds(rawExpireIn: unknown): number {
  const parsed = Number.parseInt(String(rawExpireIn ?? ''), 10);
  const requested = Number.isInteger(parsed) ? parsed : DEFAULT_EXPIRE_IN;
  const capped = Math.min(requested, MAX_EXPIRE_IN);
  return capped <= 0 ? DEFAULT_EXPIRE_IN : capped;
}

export function registerApiEmbedTokensRoutes(app: Express): void {
  app.post(
    '/api/embed_tokens',
    requireApiToken,
    asyncHandler(async (req: Request, res) => {
      const rawToken =
        (req.headers.authorization ?? '').startsWith('Bearer ')
          ? (req.headers.authorization ?? '').slice(7)
          : ((req.query.api_token as string | undefined) ?? '');

      const payload: Record<string, unknown> = {
        token_hash: crypto.createHash('sha256').update(rawToken).digest('hex'),
        exp: Math.floor(Date.now() / 1000) + expireInSeconds((req.body ?? {}).expire_in ?? req.query.expire_in),
      };

      const templateId = Number.parseInt(String((req.body ?? {}).template_id ?? ''), 10);
      if (Number.isInteger(templateId)) payload['template_id'] = templateId;
      const submissionId = Number.parseInt(String((req.body ?? {}).submission_id ?? ''), 10);
      if (Number.isInteger(submissionId)) payload['submission_id'] = submissionId;

      res.json({
        token: encodeJwt(payload),
        expires_at: new Date((payload['exp'] as number) * 1000).toISOString(),
      });
    }),
  );
}
