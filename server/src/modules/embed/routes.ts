import type { Express } from 'express';
import { stub } from '../shared.js';

export function registerEmbedRoutes(app: Express): void {
  app.all('/__embed__/stub', stub);
}
