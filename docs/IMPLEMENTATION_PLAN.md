# DocuSeal Pro Features Implementation Plan

## Pricing Comparison: What's Missing in Self-Hosted OSS

| Feature                       | Pro Price | OSS Status                          | Effort  |
| ----------------------------- | --------- | ----------------------------------- | ------- |
| Company Logo / White-label    | $20/mo    | **DONE** — upload + display         | Medium  |
| Connect Own Email Address     | $20/mo    | **Already works** (SMTP settings)   | —       |
| Personalized Email Content    | $20/mo    | **Already works** (email templates) | —       |
| Automated Reminders           | $20/mo    | **DONE** — job + scheduler          | Low     |
| Zapier/Webhooks               | $20/mo    | **Already works** (webhooks exist)  | —       |
| User Roles and Teams          | $20/mo    | **DONE** — editor/viewer enabled    | Medium  |
| Identity Verification via SMS | $20/mo    | Stub only, no provider code         | Medium  |
| Bulk Send from Spreadsheet    | $20/mo    | Frontend exists, no backend         | Low-Med |
| SSO / SAML                    | $20/mo    | Placeholder only                    | High    |
| Accept Payments (Stripe)      | $20/mo    | Frontend exists, no backend         | Medium  |
| Conditional Fields            | $20/mo    | **DONE** — prop enabled             | Trivial |
| Formulas                      | $20/mo    | **DONE** — prop enabled             | Trivial |
| API & Embedding               | $0.20/doc | Dummy JS served                     | High    |
| HTML Template API             | $0.20/doc | No code exists                      | High    |
| PDF/DOCX Field Tags API       | $0.20/doc | **DONE** — PDF + DOCX tag parsing   | Medium  |
| Embedded Signing Form         | $0.20/doc | Dummy JS served                     | High    |
| Embedded Form Builder         | $0.20/doc | Dummy JS served                     | High    |

## Pro Gates Removed

All Pro/Enterprise upsell barriers have been removed:

- Placeholder banners (reminders, logo, SSO, SMS, API/embedding, bulk send)
- UPGRADE button in header navbar
- Plans/Pro link in settings sidebar
- Enterprise API path blocking in errors controller
- Disabled user role options (editor/viewer now selectable)
- E-sign trusted signature button enabled
- Ability permissions granted: `:reply_to`, `:personalization_advanced`, `:bulk_send`, `:disable_decline`, `:delegate_form`, `:saml_sso`, `:countless`, `:cfr`, `:download_users`, `:tenants`

Note: Enterprise API paths (`/api/templates/html`, `/api/templates/pdf`, etc.) no longer show Pro paywall messages but will 404 until Phases 6-7 implement the actual controllers/routes.

---

## Testing Instructions

### Phase 0 — Conditional Fields, Formulas, Phone, Payment

1. Go to any template > Edit
2. Add a field — Conditional Fields, Formula, Phone, and Payment field types should be available in the builder

### Phase 1 — Automated Reminders

1. Go to Settings > Notifications
2. The "Unlock with DocuSeal Pro" banner should be gone
3. Set a First/Second/Third reminder duration and Save
4. Reminders fire automatically via Sidekiq every 15 minutes for pending submitters

### Phase 2 — Company Logo

1. Go to Settings > Personalization
2. Scroll to "Company Logo" — upload dropzone should be visible (no Pro banner)
3. Upload a logo image — preview with filename and Remove button should appear
4. Send a signing request — the signing form should show your logo instead of DocuSeal logo
5. Outgoing emails should include the logo at the top

### Pro Gates Removed

- Settings > Users > Invite new user — Editor and Viewer roles selectable (not grayed out)
- UPGRADE button in header navbar — gone
- Plans/Pro link in settings sidebar — gone
- Settings > E-Signature — "DocuSeal Trusted Signature" Make Default button — enabled
- Settings > SSO — Pro placeholder banner — gone
- Settings > SMS — Pro placeholder banner — gone
- Template > API & Embedding modal — Pro banner — gone

### Phase 3 — User Roles & Permissions

**Setup:** Go to Settings > Users > Invite new user

1. Create an **Editor** user (select "Editor" role) and a **Viewer** user (select "Viewer" role)
2. Sign in as each user and verify:

**Editor should:**

- See templates dashboard, create/upload/edit/delete templates
- Create and send submissions, archive submissions
- See only Profile in Settings (no Account, Email, Storage, Users, API, Webhooks, SSO, MCP links)
- NOT access account-level settings or manage other users

**Viewer should:**

- See templates dashboard (no upload button, no create button, no drag-drop upload)
- View template details and submissions (read-only)
- NOT see edit/archive/delete buttons on templates or submissions
- NOT see the "Send" button in the template builder
- See only Profile in Settings
- NOT access any admin settings pages

**Admin should:**

- Full access — unchanged behavior from before

### Phase 7 — PDF/DOCX Field Tags API

**Test PDF endpoint:**

```bash
# Create a PDF with {{tags}} using HexaPDF, then upload:
curl -X POST http://localhost:4000/api/templates/pdf \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -F "file=@my_tagged_document.pdf" \
  -F "name=My PDF Template"
```

**Test DOCX endpoint:**

```bash
# Upload a DOCX with {{tags}} in the text:
curl -X POST http://localhost:4000/api/templates/docx \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -F "file=@my_tagged_document.docx" \
  -F "name=My DOCX Template"
```

**Tag syntax:** `{{Field Name}}`, `{{Field Name|type}}`, `{{Field Name|select|Option1,Option2}}`

**Expected:** Template created with fields auto-detected at correct positions, tags removed from document.

---

## Implementation Phases

### Phase 0: Quick Wins (Trivial — just flip switches) ✅ DONE

These features have **full working code** that's just hidden by Vue props.

#### 0.1 Enable Conditional Fields

- **File**: `app/views/templates/edit.html.erb`
- **Change**: Add `data-with-conditions="true"` to the builder element
- **Status**: JS logic in `app/javascript/template_builder/builder.vue` already handles conditions

#### 0.2 Enable Formulas

- **File**: `app/views/templates/edit.html.erb`
- **Change**: Add `data-with-formula="true"` to the builder element
- **Status**: `app/javascript/template_builder/formula_modal.vue` is already complete

#### 0.3 Enable Phone/Verification Field

- **File**: `app/views/templates/edit.html.erb`
- **Change**: Add `data-with-phone="true"` to the builder element

---

### Phase 1: Automated Reminders (Low effort) ✅ DONE

The config system, UI, and event types already exist. We just need the background job.

#### 1.1 Create `SendSubmitterReminderJob`

- **Location**: `app/jobs/send_submitter_reminder_job.rb`
- **Logic**:
  1. Find all pending submitters where `sent_at` was > configured reminder interval ago
  2. Skip completed or declined submitters
  3. Re-send the invitation email using existing `SubmitterMailer`
  4. Log `send_reminder_email` event to `SubmissionEvent`
- **Schedule**: Add Sidekiq cron/recurring job (check every 15 minutes)
- **Config**: Already stored in `AccountConfig::SUBMITTER_REMINDERS` with duration values

#### 1.2 Wire up Sidekiq schedule

- **File**: `config/sidekiq.yml` or use `sidekiq-cron` gem
- **Add**: Recurring job entry for reminder checking

---

### Phase 2: Company Logo & Branding (Medium effort) ✅ DONE

#### 2.1 Logo Upload Controller

- **File**: `app/controllers/personalization_settings_controller.rb` (extend)
- **Logic**: Accept image upload via Active Storage, store on account
- **Model change**: Add `has_one_attached :logo` to Account model (or use existing `AccountConfig`)
- **Replace**: `_logo_placeholder.html.erb` with actual upload form

#### 2.2 Display Logo

- **Email templates**: Inject logo into mailer layouts
- **Signing form**: Pass logo URL to submission form Vue components
- **PDF**: Optionally embed logo in signed PDF header

---

### Phase 3: User Roles & Teams (Medium effort) ✅ DONE

Editor/Viewer roles are fully implemented with ability-based permission scoping.

#### 3.1 Define Roles ✅

- **File**: `app/models/user.rb`
- **Roles**: `admin`, `editor`, `viewer` (added to `User::ROLES`)
- **Helper methods**: `admin?`, `editor?`, `viewer?`
- **Permissions**:
  - `admin`: Full access (unchanged)
  - `editor`: Create/edit templates, create/send submissions, manage own profile — NO account settings, users, API keys, webhooks, SMTP, SSO, MCP
  - `viewer`: Read-only access to templates and submissions, manage own profile — NO create/edit/delete

#### 3.2 Update Ability System ✅

- **File**: `lib/ability.rb`
- **Implemented**: Role-based `admin_abilities`, `editor_abilities`, `viewer_abilities` methods
- **UI guards**: Settings nav hides admin-only items for editors/viewers
- **View guards**: Dashboard dropzone, upload buttons, archive buttons respect `can?` checks

#### 3.3 Teams (optional for multi-tenant HRMS)

- **Migration**: Create `teams` table, add `team_id` to users
- **Scoping**: Templates and submissions scoped to team within account
- **Use case**: Each org in your HRMS = one team or one account

---

### Phase 4: Bulk Send from Spreadsheet ✅ DONE

#### What was implemented:

1. **`app/controllers/upload_spreadsheet_controller.rb`** — New controller that accepts CSV/XLSX uploads, parses them, and returns JSON `[[sheetName, rows]]` for the Vue component. Uses `CSV` for `.csv` files and `RubyXL` for `.xlsx`. Authorized via `authorize!(:create, Submission)`.

2. **Route**: `POST /upload_spreadsheet` → `upload_spreadsheet#create` (added to `config/routes.rb`)

3. **`app/controllers/submissions_controller.rb`** — Added `submissions_json` branch in `create` action. New `spreadsheet_submissions_params` method parses the JSON from the Vue component's hidden input and builds the hash format expected by `create_submissions`.

4. **`app/views/submissions/_list_form.html.erb`** — Populated with form that renders `<import-list>` Vue custom element, passing template data (name, submitters, fields) as JSON. Includes send_email and extra_fields partials, plus hidden submit buttons div.

5. **`app/javascript/template_builder/import_list.vue`** — Already fully functional (464 lines). Handles file upload via drag-and-drop or file picker, worksheet selection, column-to-field mapping, preview table, and outputs `submissions_json` hidden input.

#### How to test:

1. Navigate to any template → click "Add Recipients"
2. Switch to "Upload List" tab (visible for templates without variables_schema)
3. Upload a CSV with columns like: Email, Name, [field names matching template fields]
4. Map columns to template fields in the UI
5. Click "Add Recipients" to create submissions in bulk

---

### Phase 5: Template Embedding ✅ DONE

All embedding infrastructure is fully functional for self-hosted OpenSeal.

#### What was implemented:

**Pre-existing (already in OSS codebase):**

- `Embed::BaseController` — JWT auth, CORS, CSP headers, `frame-ancestors *`
- `Embed::FormsController` — show, update, completed actions for signing forms
- `EmbedScriptsController` — serves JS SDK at `/js/docuseal.js` with `<docuseal-builder>` and `<docuseal-form>` Web Components
- `Api::EmbedTokensController` — `POST /api/embed_tokens` generates JWT tokens
- Embed layout (`layouts/embed.html.erb`) — minimal chrome, postMessage helper
- `JsonWebToken` — encode/decode using Rails secret_key_base

**Added/Fixed:**

- `Embed::BuildersController` — added `update`, `documents`, `documents_index`, `detect_fields`, `custom_fields` actions for full builder API coverage
- Builder view (`embed/builders/show.html.erb`) — added `baseFetch` patching script that intercepts all template builder API calls and routes them through embed endpoints with JWT auth:
  - `PUT /templates/:id` → `PUT /embed/builder?template_id=:id`
  - `GET /templates/:id/documents` → `GET /embed/builder/documents_index?template_id=:id`
  - `POST /templates/:id/documents` → `POST /embed/builder/documents?template_id=:id`
  - `POST /templates/:id/detect_fields` → `POST /embed/builder/detect_fields?template_id=:id`
  - `POST /account_custom_fields` → `POST /embed/builder/custom_fields`
- Added `data-autosave="true"` to builder view (required for save() to actually fire)
- Added `ActiveStorage::Current.url_options` setup in `Embed::BaseController` (fixes URL generation for Disk service)
- PostMessage events: `builder:save` and `builder:upload` sent to parent window on successful operations

**Architecture:**

- Builder saves go through JWT-authenticated embed endpoints (baseFetch patching)
- Form submissions go through standard `/s/:slug` path (slug IS the auth token — no session needed)
- JS SDK creates iframes and relays `postMessage` events as `docuseal:*` CustomEvents
- All endpoints scoped by `@embed_account` for multi-tenant isolation

**Integration Guide:** See [EMBEDDING.md](EMBEDDING.md) for full integration documentation including backend token generation, frontend usage, multi-tenant patterns, React example, and security notes.

---

### Phase 6: HTML Template API ✅ DONE

#### What was implemented:

1. **`app/controllers/api/templates_html_controller.rb`** — API controller at `POST /api/templates/html`

   - Accepts `html` (required), `name`, `css`, `external_id`, `folder_name` parameters
   - Validates HTML presence and 2MB size limit
   - Creates template, renders HTML to PDF, detects fields, returns serialized template
   - Proper error handling with template cleanup on failure

2. **`lib/templates/parse_html_fields.rb`** — Field tag parser

   - Parses `{{field_name}}`, `{{field_name|type}}`, `{{field_name|select|opt1,opt2,opt3}}` syntax
   - Supports all field types: text, signature, initials, date, image, stamp, checkbox, radio, select, multiple, phone, cells, payment, file, number
   - Replaces tags with `<span data-docuseal-field>` marker elements for position detection
   - Generates clean HTML (tags removed) for the final PDF

3. **`lib/templates/create_from_html.rb`** — HTML-to-PDF conversion service

   - Calls Puppeteer via Node.js subprocess (`Open3.popen3`) with proper stdout/stderr separation
   - Wraps HTML fragments in a full document with default styling
   - Supports custom CSS via `css` parameter
   - Extracts field positions from rendered DOM using `getBoundingClientRect()`
   - Calculates field areas as normalized coordinates (0-1 range) relative to PDF page dimensions
   - Stores PDF via Active Storage and generates preview images

4. **`lib/templates/render_html_template.js`** — Node.js Puppeteer rendering script

   - Launches headless Chromium, renders HTML, extracts field positions from marker spans
   - Clears marker text before PDF generation (fields appear as blank areas)
   - Outputs JSON with base64-encoded PDF and field coordinate data

5. **Route**: `POST /api/templates/html` in `config/routes.rb` (under `api` namespace)

6. **Dependency**: `puppeteer` npm package (includes bundled Chromium)

#### Field tag syntax:

| Syntax                      | Example                          | Result                         |
| --------------------------- | -------------------------------- | ------------------------------ |
| `{{Name}}`                  | `{{Full Name}}`                  | Text field named "Full Name"   |
| `{{Name\|type}}`            | `{{Date\|date}}`                 | Date field                     |
| `{{Name\|signature}}`       | `{{Sign Here\|signature}}`       | Signature field (200x50px min) |
| `{{Name\|select\|options}}` | `{{Dept\|select\|Eng,Sales,HR}}` | Select with options            |
| `{{Name\|checkbox}}`        | `{{Agree\|checkbox}}`            | Checkbox field                 |

#### How to test:

```bash
curl -X POST http://localhost:4000/api/templates/html \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Agreement</h1><p>I, {{Full Name}}, agree.</p><p>Date: {{Date|date}}</p><p>{{Signature|signature}}</p>",
    "name": "My HTML Template",
    "css": "h1 { color: #2563eb; }"
  }'
```

---

### Phase 7: PDF/DOCX Field Tags API — **DONE** ✅

#### 7.1 PDF with Tags — **DONE**

- **Controller**: `app/controllers/api/templates_pdf_tags_controller.rb`
- **Service**: `lib/templates/create_from_pdf_tags.rb`
- **Route**: `POST /api/templates/pdf` (multipart file upload)
- **Logic**:
  1. Accepts PDF upload (max 50MB, validates content type)
  2. Extracts `{{field_name|type|options}}` tags from PDF text layer via Pdfium
  3. Calculates normalized bounding boxes for each tag from character-level text nodes
  4. Removes tag text from PDF content streams via HexaPDF
  5. Stores cleaned PDF, generates preview images, creates template with mapped fields
  6. Supports all field types: text, signature, date, select (with options), checkbox, etc.

#### 7.2 DOCX with Tags — **DONE**

- **Controller**: `app/controllers/api/templates_docx_controller.rb`
- **Service**: `lib/templates/create_from_docx.rb`
- **Route**: `POST /api/templates/docx` (multipart file upload)
- **Logic**:
  1. Accepts DOCX upload (max 50MB, validates content type + extension)
  2. Parses DOCX XML for `{{tags}}` using Zip::File + Nokogiri (zero new gem deps)
  3. Converts DOCX to PDF via LibreOffice headless (120s timeout)
  4. Detects tag positions in converted PDF using Pdfium text nodes
  5. Removes tags from PDF, stores cleaned PDF, creates template
- **Middleware**: Updated `ApiPathConsiderJsonMiddleware` to exclude `/templates/pdf` and `/templates/docx` from JSON content-type override (required for multipart uploads)

---

### Phase 8: SMS Verification (Medium effort)

#### 8.1 SMS Provider Integration

- **Create**: `lib/sms_sender.rb`
- **Providers**: Twilio, Vonage, or generic HTTP-based (configurable)
- **Config**: Store API keys in `EncryptedConfig` (schema already exists)

#### 8.2 2FA Flow

- **Create**: `app/controllers/sms_verifications_controller.rb`
- **Logic**:
  1. Before showing signing form, send OTP to signer's phone
  2. Verify OTP before allowing form access
  3. Log `send_2fa_sms` event (event type already defined)

#### 8.3 Settings UI

- **Replace**: `app/views/sms_settings/_placeholder.html.erb` with actual config form
- **Fields**: Provider selection, API key, sender number

---

### Phase 9: Stripe Payments (Medium effort)

#### 9.1 Backend Controller

- **Create**: `app/controllers/api/stripe_payments_controller.rb`
- **Routes**: `POST /api/stripe_payments` (create checkout session), webhook endpoint
- **Logic**:
  1. Create Stripe Checkout Session with amount from template field config
  2. Return session URL
  3. Handle `checkout.session.completed` webhook
  4. Mark payment field as completed in submission

#### 9.2 Connect Frontend

- **File**: `app/javascript/submission_form/payment_step.vue` (already exists)
- **Enable**: Add `data-with-payment="true"` to builder element

#### 9.3 Stripe Connect (for multi-tenant)

- Each org connects their own Stripe account
- Store Stripe keys per account in `EncryptedConfig`

---

### Phase 10: SSO / SAML (High effort)

#### 10.1 Add Gems

- **Gemfile**: Add `omniauth-saml`, `ruby-saml`

#### 10.2 SAML Controller

- **Create**: `app/controllers/saml_sessions_controller.rb`
- **Routes**: `/auth/saml/metadata`, `/auth/saml/callback`, `/auth/saml/logout`
- **Logic**: Standard SAML 2.0 SP implementation

#### 10.3 Configuration

- **Replace**: `app/views/sso_settings/_placeholder.html.erb` with form
- **Fields**: IdP metadata URL, entity ID, certificate, attribute mapping
- **Store**: In `EncryptedConfig` (key already defined: `saml_configs`)

#### 10.4 Force SSO

- `AccountConfig::FORCE_SSO_AUTH_KEY` already exists — wire it up to skip password login

---

## Priority Order for Your HRMS Use Case

| Priority | Feature                             | Why                                           |
| -------- | ----------------------------------- | --------------------------------------------- |
| 🔴 P0    | Conditional Fields + Formulas       | Trivial flip, instant value                   |
| 🔴 P0    | Template Embedding (builder + form) | Core requirement for multi-tenant HRMS        |
| 🟠 P1    | User Roles                          | Org admins vs employees need different access |
| 🟠 P1    | Automated Reminders                 | HR workflows need follow-ups                  |
| 🟡 P2    | Bulk Send from Spreadsheet          | Onboarding batches of employees               |
| 🟡 P2    | Company Logo/Branding               | Each org wants their logo                     |
| 🟡 P2    | HTML Template API                   | Programmatic doc generation                   |
| 🟢 P3    | PDF/DOCX Field Tags API             | Developer convenience                         |
| 🟢 P3    | SMS Verification                    | Extra security for sensitive docs             |
| 🟢 P3    | Stripe Payments                     | Paid document workflows                       |
| 🟢 P3    | SSO/SAML                            | Enterprise orgs on your HRMS                  |

---

## Technical Notes

### Key Files Reference

- Feature flags: `lib/docuseal.rb`
- Pro route blocker: `app/controllers/errors_controller.rb` (ENTERPRISE_PATHS)
- Template builder props: `app/views/templates/edit.html.erb`
- Embed script (dummy): `app/controllers/embed_scripts_controller.rb`
- Abilities: `lib/ability.rb`
- Account config: `app/models/account_config.rb`
- API base: `app/controllers/api/`
- Jobs: `app/jobs/`
- Mailers: `app/mailers/`

### Multi-Tenant Architecture (already supported)

- Every template belongs to an `account_id`
- Every user belongs to an `account_id`
- Queries are automatically scoped via `current_account`
- For your HRMS: 1 DocuSeal Account = 1 Organization

---

## Getting Started

```bash
# Phase 0: Enable hidden features immediately
# Edit app/views/templates/edit.html.erb and add the data attributes
# Then restart the Rails server to see conditional fields + formulas
```

Next step: Start with Phase 0 (trivial) then move to Phase 5 (embedding) since that's your core need.
