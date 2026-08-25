import type { Express } from 'express';
import { registerApiSubmissionsRoutes } from './submissions.js';
import { registerApiTemplatesRoutes } from './templates.js';
import { registerApiSubmittersRoutes } from './submitters.js';
import { registerApiEmbedTokensRoutes } from './embedTokens.js';
import { registerApiRevealAccessTokenRoutes } from './revealAccessToken.js';

export function registerApiRoutes(app: Express): void {
  registerApiSubmissionsRoutes(app);
  registerApiTemplatesRoutes(app);
  registerApiSubmittersRoutes(app);
  registerApiEmbedTokensRoutes(app);
  registerApiRevealAccessTokenRoutes(app);
}
