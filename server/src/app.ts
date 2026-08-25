import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { config } from './config.js';
import { db } from './db/index.js';
import { attachCurrentUser } from './http/auth.js';
import { registerViews } from './views.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerUsersRoutes } from './modules/users/routes.js';
import { registerTemplatesRoutes } from './modules/templates/routes.js';
import { registerSubmissionsRoutes } from './modules/submissions/routes.js';
import { registerWebhooksRoutes } from './modules/webhooks/routes.js';
import { registerApiRoutes } from './modules/api/routes.js';
import { registerEmbedRoutes } from './modules/embed/routes.js';
import { registerPagesRoutes } from './modules/pages/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PgStore = connectPgSimple(session);

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use(
    session({
      store: new PgStore({
        conString: config.databaseUrl,
        tableName: 'sessions',
        createTableIfMissing: true,
      }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.nodeEnv === 'production',
        maxAge: 730 * 24 * 60 * 60 * 1000, // Devise default remember-for: 2 years
      },
    }),
  );

  app.use(attachCurrentUser);

  registerViews(app);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'openseal-server', ts: new Date().toISOString() });
  });

  registerAuthRoutes(app);
  registerUsersRoutes(app);
  registerTemplatesRoutes(app);
  registerSubmissionsRoutes(app);
  registerWebhooksRoutes(app);
  registerApiRoutes(app);
  registerEmbedRoutes(app);
  registerPagesRoutes(app);

  if (config.nodeEnv === 'production') {
    const webDist = path.resolve(__dirname, '../../web/dist');
    app.use(express.static(webDist));
  }

  return app;
}
