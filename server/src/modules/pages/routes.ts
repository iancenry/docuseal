import type { ErrorRequestHandler, Express } from 'express';
import { HttpError } from '../../http/helpers.js';

function signedInRedirect(req: { currentUser?: unknown }): string {
  return req.currentUser ? '/templates_dashboard' : '/sign_in';
}

export function registerPagesRoutes(app: Express): void {
  app.get('/', (req, res) => {
    res.redirect(signedInRedirect(req));
  });

  app.get('/dashboard', (req, res) => {
    res.redirect(signedInRedirect(req));
  });

  app.get('/sign_in', (_req, res) => {
    res.send(`<!doctype html><html><body><h1>Sign in</h1>
<form method="post" action="/sign_in">
<input name="email" type="email" placeholder="Email">
<input name="password" type="password" placeholder="Password">
<button type="submit">Sign in</button>
</form>
</body></html>`);
  });

  const jsonErrorFormatter: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  };
  app.use(jsonErrorFormatter);
}
