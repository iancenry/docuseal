# Frontend Port Plan — Rails/ERB → Node/Express (branch `node-port`)

Research-only planning document for porting the OpenSeal (DocuSeal fork) frontend from
Rails ERB views to a Node/Express backend with a pure JSON API.

Sources of truth inspected: `app/views/**/*` (391 ERB files), `app/javascript/**`
(application.js pack, form.js pack, 50 custom elements, 2 Vue island apps),
`app/controllers/application_controller.rb` (view helpers), `config/locales/i18n.yml`,
tailwind configs, `package.json`.

---

## 1. Inventory

### 1.1 Totals

| Metric | Value |
|---|---|
| ERB files under `app/views` | **391** |
| Total lines of ERB | **9,814** |
| Registered custom elements (web components) | **50** |
| Custom-element usages inside views | **~204 occurrences** |
| Vue islands (apps mounted into custom elements) | **3 mount hosts** (`template-builder`, `import-list`, `submission-form`) |
| Vue SFC components | ~60 in `submission_form/`, ~55 in `template_builder/` |
| Locales | 1 file (`config/locales/i18n.yml`, ~8.2k lines, en/es/it/fr/pt/de/pl/uk/cs/he/nl/ar/ko/ja…) |
| Turbo Streams templates (`.turbo_stream.erb`) | **0** (only 1 inline `<turbo-stream>` tag in one partial) |

### 1.2 Category counts

| Category | Files | Lines | Description |
|---|---|---|---|
| **Icons** (mechanical) | **140** | ~1,098 | Tiny SVG partials in `app/views/icons/_*.html.erb`, rendered server-side by the `svg_icon(name)` helper. Zero logic. Convert once to an icon component/JS module; not per-page work. |
| **A — Near-static layout/chrome & auth pages** | **26** | ~615 | Layouts (6), Devise sign-in/password/shared (9 incl. mailer reset), MFA setup (4), initial setup wizard (1), invitation accept (1), marketing landing page (1), newsletter opt-in (1), PWA manifest (1), inline-script partials (1), misc. Light ERB: mostly `t()`, links, one `form_for`. |
| **B — Data-rendering pages/forms with light-to-moderate logic** | **205** | ~7,898 | The bulk: dashboards & lists (templates/submissions dashboards, archived, folders, teams, users, webhook events/settings), all settings pages (~15 index pages: account, api, storage, sms, sso, stripe, docusign×2, email smtp, esign, notifications, personalization, mcp, testing), submissions show/detail + filters/export/preview partials, templates show/share/embedding/preferences, submit/start form document pages, QR print page. Logic = conditionals around `can?`, `current_account`, loops over collections, path helpers, forms. |
| **C — Heavy pages embedding JSON payloads into Vue islands** | **7** | ~486 | See table below. |
| **Mailers** (server-side email templates) | **13** | ~108 | `submitter_mailer` (7), devise reset (1), user/template/settings mailers (3), mailer layout + attribution partial. These are *email* templates — they stay server-rendered regardless of strategy (Nunjucks can render them too). |
| **Total** | **391** | 9,814 | |

> Note: `submissions/new.html.erb` + its 4 tab partials (email/phone/detailed/list recipient
> forms, ~250 lines total) are B-category but embed a small Vue island (`import-list`)
> and heavy custom-element usage — a hybrid case worth porting carefully.

### 1.3 Category C detail — Vue-island payload pages

| View | Island / element | Payload |
|---|---|---|
| `templates/edit.html.erb` | `<template-builder>` | `data-template="<%= @template_data.to_json %>"` + custom fields, feature flags (~20 data attrs) |
| `embed/builders/show.html.erb` | `<template-builder>` | same as above, embed-token scoped, separate pack |
| `submit_form/show.html.erb` + `submit_form/_submission_form.html.erb` | `<submission-form>` | `data-submitter`, `data-schema`, `data-values`, `data-fields`, `data-attachments`… (~25 props). Page also SSR-renders completed field values over page images. |
| `embed/forms/show.html.erb` | `<submission-form>` | same payload, `'form'` pack, iframe postMessage bridge |
| `user_signatures/edit.html.erb`, `user_initials/edit.html.erb` | `<signature-form>` | signature pad config JSON |
| `templates_preview/show.html.erb` | preview shell | small `to_json` flags |

The Vue islands themselves (`submission_form/form.vue` tree, `template_builder/builder.vue`
tree) are **framework-agnostic at their boundary**: they are plain Vue 3 `createApp()` roots
receiving props parsed from `data-*` JSON. They do not depend on Rails except:
CSRF token read from `<meta name="csrf-token">`, `turbo:submit-end` events (builder),
and hardcoded per-pack i18n dictionaries (`submission_form/i18n.js`,
`template_builder/i18n.js`) plus `locale` passed via `data-locale`.

### 1.4 Top 15 heaviest / most important views (port priority order)

| # | View(s) | Lines | Why it matters |
|---|---|---|---|
| 1 | `submit_form/show.html.erb` + `_submission_form.html.erb` | 189+~150 | **Submitter signing flow — the product's core revenue path.** Big `<submission-form>` payload + SSR value overlay. |
| 2 | `templates/edit.html.erb` (+ `templates/_form*` partials) | 129 | **Template builder host** — largest Vue island, ~20 feature-flag data attrs. |
| 3 | `submissions/new.html.erb` + `_email_form`/`_phone_form`/`_detailed_form`/`_list_form` | ~330 | "Add recipients" modal — every send goes through it; uses `import-list` island + 12 custom elements. |
| 4 | `embed/builders/show.html.erb` + `layouts/embed.html.erb` | 95+96 | Embed SDK builder; iframe navigation-guard script must be preserved verbatim. |
| 5 | `embed/forms/show.html.erb` | 71 | Embed SDK signing; postMessage `form:complete` contract. |
| 6 | `templates_dashboard/index.html.erb` (+ `templates/_template`, folder/dropzone/upload partials) | 113 | Main logged-in dashboard: folders grid, dropzone upload, pagination, app tour. |
| 7 | `submissions_dashboard/index.html.erb` (+ `submissions/_list*`, `_filters`) | 86 | Submissions inbox list w/ status badges, search, pagination. |
| 8 | `submissions/show.html.erb` (+ `_value`, `_annotation`) | 327 | Submission audit/view page: heaviest single file; dense Ruby logic (masking, timezones, number formats) that must move into JS utils or API-computed fields. |
| 9 | `accounts/show.html.erb` | 307 | Account settings hub: 14 embedded `form_for` forms, 43 authorization refs. |
| 10 | `shared/_navbar.html.erb` + `shared/_settings_nav.html.erb` | 110+171 | Chrome on every authenticated page; dense `can?` gating. |
| 11 | `devise/sessions/new.html.erb` (+ otp, passwords, mfa_setup) | ~26+~120 | Auth entry: email-link round trips, OTP 2FA, omniauth partials. |
| 12 | `templates_preferences/show.html.erb` + `_recipients` + email-form partials | 189+154+~200 | Per-template preferences & custom email editor (uses `<email-editor>` tiptap island-ish element). |
| 13 | `start_form/show.html.erb` + `completed/email_verification/private` | ~160 | Sign-yourself public flow (SEO-exposed landing for forms). |
| 14 | `users/index.html.erb`, `webhook_settings/show.html.erb`, `api_settings/index.html.erb` | 110/151/124 | Team mgmt + developer settings; representative of the ~15 settings pages sharing one pattern. |
| 15 | `templates_share_link/show.html.erb` + `templates_share_link_qr/show.html.erb` | 100+288 | Share-link modal + printable QR PDF-style page (standalone HTML/CSS print doc). |

---

## 2. Coupling analysis

### 2.1 How the frontend works today

```
Request → Rails controller → ERB render (layout + partials)
                               │
                               ├── SSR chrome/content (Turbo-enhanced <a>/<form>)
                               ├── 50 custom elements enhance DOM progressively
                               └── 3 Vue islands mounted inside custom elements,
                                   fed JSON via data-* attributes
```

- **Two JS packs.** `application.js` (default): Turbo + 50 custom elements +
  `template-builder`/`import-list` islands. `form.js` (pack `'form'`, used by
  submit/embed pages): trimmed set (7 elements) + `submission-form` island.
  Selected via `content_for(:embed_pack)` in `layouts/embed.html.erb`.
- **Custom elements** (`app/javascript/elements/*.js`, `@github/catalyst`-style classes
  extending `HTMLElement`) do progressive enhancement: AJAX form submission
  (`submit-form` — 41 usages/18 files), autocompletes, toggles, modals, dropzones,
  editors (tiptap `<email-editor>`, `<markdown-editor>`), charts.
- **Modals/drawers** are Turbo Frames (`<turbo-frame id="modal">`, `turbo-modal`,
  `open-modal`, `modal-button`) loading server HTML fragments — i.e., the server
  returns *HTML partial responses*, not just full pages. Any Express port must keep an
  HTML-fragment endpoint story or replace this mechanism.
- **Form submission UX**: `button_to` generates inline `<form method=post>`;
  `data-turbo-confirm` dialogs; file-download interception on `turbo:submit-end`
  (content-disposition); `encodeMethodIntoRequestBody` for PUT/DELETE as POST w/ hidden
  `_method`; CSRF via meta tag.
- **Auth surfaces**: session cookie (Devise), OTP 2FA (email/SMS codes), magic email
  links for password reset / invitations / submitter signing links (`/s/:slug`),
  embed bearer tokens for `/e/*` SDK routes, HTTP Basic-ish signed URLs for assets
  (`ActiveStorage::Blob.proxy_path` expiring URLs).

### 2.2 What is reusable as-is in a Node port (high confidence)

1. **Both Vue island trees** (`submission_form/`, `template_builder/`) — zero changes if
   the surrounding HTML keeps the same `data-*` contract and CSRF meta tag.
2. **All 50 custom elements** — plain DOM web components; work inside any server template
   (ERB today, Nunjucks tomorrow, even Vue-rendered DOM later).
3. **Webpack build, Tailwind+DaisyUI styling system** — only `content:` globs change
   (`app/views/**/*.erb` → `app/views/**/*.njk`). DaisyUI 3 class vocabulary
   (`btn`, `base-input`, `bg-base-100`, …) stays.
4. **Embed SDK postMessage contracts** and navigation-guard script.
5. **i18n yml** — parseable directly (yaml→JSON at boot) by both Nunjucks global `t()`
   and future client code.

### 2.3 What must be rebuilt/replaced

| Rails mechanism | Replacement required |
|---|---|
| ERB layouts/partials/locals | Nunjucks `{% extends %}` / `{% include %}` / macros (near 1:1) |
| URL helpers (`*_path/_url`, ~464 calls) | Server-side route-name → URL function map (small util) or literal paths during port |
| `t()` I18n (~1,097 calls) | Nunjucks global reading converted locale JSON |
| `svg_icon` (~304) | Icon macro / precompiled sprite |
| `link_to/button_to/button_title` (~169/~82) | Macro library replicating exact markup (incl. disabled-with spinner markup consumed by `toggle-submit`/`download-button` elements) |
| `can?` / `signed_in?` / `true_user` (~153 refs in views) | Authorization results **computed in controllers/services**, passed as view context flags (do not port Ability to templates) |
| `current_account/current_user` (229 refs) | Express middleware injecting `ctx.currentUser/account`; templates receive explicit locals |
| `form_for` model-bound forms (~105) | Plain `<form>` markup macros (the app already mostly posts to fixed URLs; only ~6 real RESTful resource forms) |
| `l()` date localization (34) | `Intl.DateTimeFormat` wrapper keyed off account/user locale |
| Turbo Frame modals/drawers | Keep Turbo (`@hotwired/turbo` is framework-free ESM) — it works fine served by Express; OR phase-2 replace modal transport with fetch+`<dialog>`. Recommendation: keep Turbo initially. |
| `redirect_back`/flash after form POST | Express flash via session cookie + redirect (identical UX) |
| ActiveStorage direct uploads/proxy URLs | Already proxied through app routes (`/rails/active_storage`, `/disk/`, `/file/`) — port those controllers; URLs keep working |
| Email templates (13 mailer views) | Render with Nunjucks too (same `t()` global) — no separate engine needed |

### 2.4 Risk hotspots

- `submissions/show.html.erb`: business logic in the view (masking, timezone/date
  formatting, condition filtering) — port as shared JS utils (`NumberUtils`,
  `TimeUtils`, `TextUtils.mask_value` already have JS analogues in the Vue packs).
- `button_title`/disabled-spinner markup coupling to `toggle-submit`, `download-button`,
  `check-on-click` elements via `data-target="download-button.defaultButton"` etc. —
  macro output must match byte-for-byte-ish.
- App tour (`app-tour`) reads server-rendered i18n JSON blobs.
- `templates_share_link_qr/show.html.erb` is a standalone print/PDF document with
  container queries — port as standalone Nunjucks page, not part of layout chain.

---

## 3. Helper parity checklist

| Rails helper (views usage est.) | JS/Nunjucks equivalent | Notes |
|---|---|---|
| `t(key, **vars)` — ~1,097 | Nunjucks global `t()` reading `config/locales/i18n.yml` converted to JSON at boot (use `i18n-yaml-loader` or `js-yaml`); pluralization via `i18next`-style count rules | Mirror Rails `i18n.yml` key shape exactly so Vue packs' `data-i18n` blobs stay valid. For future SPA work: vue-i18n can consume the same JSON. |
| `l(time, format:)` — ~34 | `Intl.DateTimeFormat(locale, …)` wrapper exposing `short`/`long` named formats from `i18n.yml` date formats | Timezone arg comes from account/submitter. |
| `svg_icon(name, class:)` — ~304 | `{% icon 'name', 'w-6 h-6' %}` macro importing icons as JS objects (build step converts the 140 partials → `icons.js` map of svg strings) | Single mechanical conversion; kills 140 files. Alternative: `@tabler/icons-vue` already in deps for Vue side. |
| `render partial:, locals:, collection:` — ~317 | `{% include %}` / `{% macro %}` / `{% for %}` + `{% import %}`; collections loop manually | Nunjucks has no implicit collection partial; generate loop wrappers per site. |
| `layout application/embed/form/plain/mailer` — 6 | Nunjucks `{% extends "layouts/application.njk" %}` + `{% block content %}` | 1:1 mapping incl. `content_for(:canonical_url/:html_title)` → block overrides. |
| `link_to body, url, data:{turbo_frame:…}` — ~130 | `{% link_to %}` macro (plain `<a>`; turbo attrs pass-through) | No runtime needed beyond literal attrs. |
| `button_to` (POST-in-form links) — ~39 | `{% button_to %}` macro emitting inline `<form method="post">` + authenticity hidden input | Must emit same structure `remove-on-event`/`app-tour-start` expect. |
| `button_title(title:, disabled_with:, icon:)` — ~82 | Same macro calling icon macro | Markup contract with `toggle-submit`/`download-button` elements. |
| `form_for(model)/form_with` — ~106 | `{% form_for %}` macro (url, method override hidden field, multipart flag) | Only ~6 bind to resources; most use `''` url + explicit inputs. |
| Field tags `f.text_field`, `f.label`, `radio_button_tag`, `select` etc. | Hand-written inputs or tiny input macros; add Tailwind/DaisyUI classes already used (`base-input`, `label`) | Low volume outside settings pages. |
| `csrf_meta_tags` + `authenticity_token` | Template emits `<meta name="csrf-token">`; macro adds hidden input; express-csrf or double-submit cookie | Islands read meta tag — keep name. |
| `can?(action, subject)` — ~137 | Compute booleans in controller layer (`res.locals.can = { createTemplate: … }` via a ported `Ability`-lite module); templates only branch on flags | Never ship policy subjects to templates raw. |
| `signed_in?` — ~16, `true_user` | Auth middleware sets `res.locals.signedIn`, `res.locals.trueUser` | |
| `current_account` — ~163, `current_user` — ~66 | Middleware injects; pass explicit locals (`account`, `user`) | Prefer precomputing derived values (e.g., `showSmtpSettings`) server-side. |
| Path/url helpers (`*_path/_url`) — ~464 | Central `routes.js` exporting named functions (`templatePath(t)`), generated from the Express route table | Also used inside controllers/mailers; build once, share. |
| `content_for(:html_title/:canonical_url/:embed_pack)` + `yield` — ~40 | Nunjucks parent-block overrides (`{% block html_title %}`) | Pack selection becomes query of view-model, not content_for. |
| `params[:q]`, `cookies`, `request.headers['HTTP_X_TURBO']` | Express `req.query/cookies/headers` passed into render locals | Keep `X-Turbo` fragment-render behavior for Turbo Frame/modal endpoints. |
| `simple_format`, `h`, `html_safe`, `j` (few) | `markdown-it` (MarkdownToHtml.call sites), Nunjucks autoescape default-on, `| safe` where deliberate | Audit each `html_safe`. |
| `number_to_human/currency`, `ordinalize` — rare | `Intl.NumberFormat`; `ordinalize` util | |
| `Pagy` pagination (~6 paginated lists) | Port `Pagy` math to a tiny util emitting same `?page=n` links + shared `_pagination` include | |
| `SecureRandom.uuid` ids for modal wiring | `crypto.randomUUID()` in controller/util | Used to pair `modal-button` ↔ `shared/html_modal`. |
| `Docuseal.multitenant?/demo?/enable_pwa?`, env gates | Config service injected as `res.locals.app` | |
| `t('app_tour').to_json`, `@template_data.to_json` payloads — ~28 sites | `JSON.stringify` in template or precomputed local | Keep identical property names — Vue props depend on them. |

---

## 4. Strategy decision

### Options considered

**(A) Nunjucks server templates preserving the Vue-islands architecture.**
Express renders `.njk` pages that keep the exact DOM contract (layouts, partials, data-*
payloads, custom elements, Turbo for modals/fragments). JSON API routes added alongside
for new work; legacy form posts keep working behind the same routes.

**(B) Full Vue SPA + Express JSON API (no SSR shell).**
Rewrite all 231 non-icon, non-mailer pages as SPA routes; rebuild modal/drawer/pagination/
flash/download UX; convert 50 custom elements' integration points; re-home auth redirects,
email-link landings, and embed iframe pages against token-based bootstrapping.

### Decision: **Option A — Nunjucks server templates + preserved Vue islands**

Rationale (condensed):

1. **Reuse dominates.** 100% of the interactive value lives in 50 custom elements + 2 Vue
   island trees whose contract is plain DOM + `data-*` JSON. Both options preserve the
   Vue apps themselves, but only A preserves them *without touching their hosting pages'
   behavior*: modals-as-Turbo-Frames, `button_to` POST forms, download interception,
   `X-Turbo` fragment requests, and the embed navigation guard are all server-HTML
   behaviors that would need parallel reimplementation in an SPA.
2. **Auth flows with email links stay trivial.** Password resets, invitations, OTP 2FA,
   and `/s/:slug` signing links are full-page GET landings with form POSTs — exactly what
   server templates already do; an SPA would need guarded bootstrap routes for each.
3. **Embed SDK pages are iframe-island pages**, not routable app states — they actively
   fight SPAs (navigation guard blocks routing!). A keeps them byte-similar.
4. **SEO needs are minimal** (landing page + start-form pages only), so the classic SPA
   SEO argument doesn't apply, while SPA costs (auth, frames, regression risk on the
   signing flow, 2 packs → 1 bundle refactor) do.
5. **Dev velocity:** the port becomes a mechanical, per-page translation with a diffable
   DOM (same classes/ids/data-attrs), testable side-by-side; ~205 B-pages share ~6
   repeating patterns (settings form page, list page, dashboard, modal form), so effective
   unique work ≈ 30–40 templates. Option B is a rewrite of ~230 screens with high
   signing-flow regression risk.
6. **Escape hatch retained:** because islands are already Vue 3, any future migration of a
   section to more SPA-like behavior can happen incrementally per-page (Vue can hydrate
   server-markup or own a route later) without a big-bang switch.

Consequences / accepted trade-offs: we keep Turbo as the modal/fragment transport short-term
(it is framework-free and works from Express); we maintain two render paths for HTML vs
JSON during transition; Nunjucks async-filter limitations require precomputed view models
(which we want anyway for authorization flags).

---

## 5. Phased checklist

Ordered milestones. "Files" = rough ERB-equivalent count ported per phase.

- [ ] **M0 — Foundations (infra, ~0 views)**
  Express app skeleton serving HTML; Nunjucks env (autoescape on, globals: `t`, `icon`,
  path-helpers, `app` config); yaml→JSON locale loader + `t()` with interpolation &
  count-pluralization; route-name helper module; auth/session middleware + CSRF;
  flash; error pages; webpack/Tailwind glob switch to `.njk`; render both packs.
- [ ] **M1 — Icon & macro library (~140 icons + shared partials)**
  Convert `icons/*.erb` → `icons.js` + `{% icon %}` macro; port `shared/` chrome
  partials used everywhere: navbar, flash, pagination, html_modal/turbo_modal, button_title,
  clipboard_copy, search_input, settings_nav skeleton (~20 includes).
- [ ] **M2 — Layouts & auth (≈20 views)**
  `layouts/application|embed|form|plain|mailer(.njk)`; Devise pages: sessions/new + otp +
  omniauth/hidden-field partials, passwords new/edit, MFA setup (4), invitations edit,
  setup wizard; prove full email-link round trip (reset + invite + signing link) against
  Node.
- [ ] **M3 — Dashboards & lists (≈25 views)**
  templates_dashboard + templates/_template + folder/dropzone/upload/toggle_view partials;
  submissions_dashboard + list/filters/applied_filters; archived ×2; template_folders;
  teams; users/index; webhook_events; Pagy-compatible pagination util; search.
- [ ] **M4 — Settings pages (≈40 views, pattern-driven)**
  accounts/show (14 forms), profile, api_settings, storage, sms, sso, stripe, docusign ×2,
  email_smtp, notifications, personalization (+markdown editor partial), esign, mcp,
  testing_api, webhook_settings, reveal_access_token, user_signatures/user_initials edits
  (signature islands). Build one reusable "settings page" pattern first; authorization
  flags computed server-side.
- [ ] **M5 — Core flow: send & sign (≈35 views)**
  submissions/new + email/phone/detailed/list form partials (import-list island);
  submit_form/show + _submission_form (submission-form island) + email_2fa + banner/delegate/
  decline forms; start_form/* (public sign-yourself); send_submission_email;
  submission_events; verify_pdf_signature.
- [ ] **M6 — Core flow: template management (≈25 views)**
  templates/edit (template-builder island) + _title/_embedding/_submission/code_modal
  partials; templates/show; preferences show + recipients + email-form partials
  (email-editor element); clone/uploads/preview/form_preview/share_link(+qr print page);
  templates_prefillable_fields.
- [ ] **M7 — Embed SDK & special pages (≈10 views)**
  embed/forms/show ('form' pack, postMessage contract tests), embed/builders/show,
  layouts/embed guard script parity; errors pages; pwa manifest; newsletters;
  pages/landing; docusign_import; submissions_export/preview; scripts partials.
- [ ] **M8 — Mailers (13 views)**
  Port submitter_mailer ×7, user/template/settings mailers, devise reset mailer, mailer
  layout + attributions to Nunjucks rendered from the mailer job layer; snapshot-test HTML
  output against Rails fixtures.
- [ ] **M9 — Cleanup & cutover**
  Delete ERB; e2e suite parity (signing, sending, embedding happy paths); perf pass
  (preload islands, defer Turbo); docs; remove Rails view dependencies; final
  JSON-API consolidation for any remaining XHR-from-elements endpoints.

Total ≈ 308 view-file equivalents ported (391 − 140 icons collapsed into 1 module −
dedup); critical-path (M2–M6) ≈ 145 files.
