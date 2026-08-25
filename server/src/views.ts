// ============================================================================
// Nunjucks view layer registration — NEW integration point for app.ts.
//
// INTEGRATION (app.ts) — exactly two lines, placed BEFORE `registerAuthRoutes(app)`
// (must run before registerPagesRoutes so the styled /sign_in page wins over the
// legacy inline-HTML stub):
//
//   1.  import { registerViews } from './views.js';
//   2.  registerViews(app);
//
// That single call also serves the built web bundle: web/dist is mounted at
// /assets (layouts/base.njk links /assets/web.css). Nothing else to wire.
//
// Env vars consumed here (all optional): NODE_ENV ('production' enables template
// caching + static maxAge), PORT (only logged in warnings), WEB_DEV_PORT is
// Vite-only and irrelevant to this file. See server/src/integrations.md.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Express, RequestHandler } from 'express';
import type { ServeStaticOptions } from 'serve-static';
import nunjucks from 'nunjucks';
import { config } from './config.js';
import { t as translate } from './i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.resolve(__dirname, '../views');
const WEB_DIST_DIR = path.resolve(__dirname, '../../web/dist');
const WEB_CSS_PATH = path.join(WEB_DIST_DIR, 'web.css');

function webCssHref(): string | null {
  return fs.existsSync(WEB_CSS_PATH) ? '/assets/web.css' : null;
}

const attachViewLocals: RequestHandler = (req, res, next) => {
  const query = req.query as Record<string, unknown>;
  res.locals.currentUser = req.currentUser ?? null;
  res.locals.userEmail = req.currentUser?.email ?? null;
  res.locals.webCssHref = webCssHref();
  res.locals.flashError = typeof query.error === 'string' ? query.error : null;
  res.locals.flashNotice = typeof query.notice === 'string' ? query.notice : null;
  next();
};

export function registerViews(app: Express): void {
  const isDev = config.nodeEnv !== 'production';

  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(VIEWS_DIR, {
      noCache: isDev,
      watch: isDev,
    }),
    { autoescape: true },
  );
  env.express(app);
  env.addGlobal('t', (key: string, vars?: Record<string, string | number>) =>
    translate(key, 'en', vars),
  );

  const staticOptions: ServeStaticOptions = isDev
    ? { index: false, etag: true }
    : { index: false, maxAge: '365d', immutable: true };
  app.use('/assets', express.static(WEB_DIST_DIR, staticOptions));

  app.use(attachViewLocals);

  app.get('/sign_in', (_req, res) => {
    res.render('sign_in.njk');
  });

  app.get('/templates_dashboard', (req, res) => {
    if (!req.currentUser) {
      res.redirect('/sign_in');
      return;
    }
    res.render('dashboard.njk');
  });
}
