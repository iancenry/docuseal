# Express ↔ Web integration notes

Everything below is NEW-file-only work; `server/src/app.ts`, `config.ts`,
`modules/*`, `http/*`, `db/*` are untouched.

## (a) The two lines for `server/src/app.ts`

```ts
import { registerViews } from './views.js';   // with the other imports
registerViews(app);                           // BEFORE registerAuthRoutes(app)
```

Order matters: `registerViews` must be called **before** `registerPagesRoutes(app)`
so that `GET /sign_in` resolves to `server/views/sign_in.njk` instead of the
legacy inline-HTML stub in `modules/pages/routes.ts`. Placing it before
`registerAuthRoutes` is the simplest safe spot. `registerViews` also mounts
`express.static(web/dist)` at `/assets`, so no extra static line is needed.

What `registerViews` gives you:

| Capability | Detail |
|---|---|
| Nunjucks env | views at `server/views/`, autoescape on, `noCache`/`watch` unless `NODE_ENV=production` |
| Globals | `t(key, vars)` (reuses `src/i18n.ts`) |
| Locals per request | `userEmail`, `currentUser`, `webCssHref`, `flashError`/`flashNotice` (from `?error=` / `?notice=`) |
| Static assets | `/assets/*` ← `web/dist/` (`web.css` deterministic name via Vite `assetFileNames`) |
| Routes | `GET /sign_in` → `sign_in.njk`, `GET /templates_dashboard` → `dashboard.njk` (redirects to `/sign_in` when signed out) |

## (b) Env vars

| Var | Used by | Default | Notes |
|---|---|---|---|
| `PORT` | server (`config.ts`) | 4300 | Never 3000/8080. Vite proxy target is `http://localhost:${PORT}`. |
| `WEB_DEV_PORT` | web/vite dev server | 5174 | Vite only; not read by Express. |
| `NODE_ENV` | `views.ts` | development | `production` ⇒ template cache + immutable static assets. |
| `DATABASE_URL`, `SESSION_SECRET` | existing config | unchanged | |

## Icons

`server/views/partials/icons.njk` is GENERATED from the Rails partials:

```sh
cd server && node scripts/generate-icons.mjs
```

145 of 146 partials under `app/views/icons/` are extracted verbatim
(opening-tag attrs minus `class`, inner SVG markup). `_user_number.html.erb`
is skipped because its `<text>` node interpolates an ERB `number` variable —
port by hand if ever needed.

Usage in any template:

```njk
{% import "partials/icons.njk" as icons %}
{{ icons.icon('settings', 'w-5 h-5') }}
```

## Vue packs: placeholder decision

The real `template_builder/builder.vue` (~55 SFCs) and `submission_form/form.vue`
(~60 SFCs) trees depend on TipTap editors, `@tabler/icons-vue`, Catalyst custom
elements and pack-local i18n dictionaries; porting them standalone was out of
budget for this milestone. **Placeholders were built instead**: two thin Vue 3
apps (`web/src/template_builder/App.vue`, `web/src/submission_form/App.vue`)
mounted exactly where the real islands will mount, fetching templates JSON
through the same API path the real packs will use.

One deliberate deviation: islands call `GET /templates` (session-cookie auth)
rather than `GET /api/templates` — the latter requires a Bearer embed token a
browser page does not have. The architecture proof (Vite build/proxy → Express
JSON) is identical.

## Dev workflow (when you wire it up)

```sh
cd server && PORT=4300 npm run dev     # terminal 1
cd web && npm run dev                  # terminal 2 — proxies /api,/sign_in,/templates,… to :4300
```

Production: `cd web && npm run build` emits `web/dist/web.css`; pages link it
automatically, and render an HTML comment instead if the build is missing.
