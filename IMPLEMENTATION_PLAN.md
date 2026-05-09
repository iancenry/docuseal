# DocuSeal Pro Features Implementation Plan

## Pricing Comparison: What's Missing in Self-Hosted OSS

| Feature                       | Pro Price | OSS Status                          | Effort  |
| ----------------------------- | --------- | ----------------------------------- | ------- |
| Company Logo / White-label    | $20/mo    | Placeholder only                    | Medium  |
| Connect Own Email Address     | $20/mo    | **Already works** (SMTP settings)   | —       |
| Personalized Email Content    | $20/mo    | **Already works** (email templates) | —       |
| Automated Reminders           | $20/mo    | Config exists, no send job          | Low     |
| Zapier/Webhooks               | $20/mo    | **Already works** (webhooks exist)  | —       |
| User Roles and Teams          | $20/mo    | Schema exists, only `admin` role    | Medium  |
| Identity Verification via SMS | $20/mo    | Stub only, no provider code         | Medium  |
| Bulk Send from Spreadsheet    | $20/mo    | Frontend exists, no backend         | Low-Med |
| SSO / SAML                    | $20/mo    | Placeholder only                    | High    |
| Accept Payments (Stripe)      | $20/mo    | Frontend exists, no backend         | Medium  |
| Conditional Fields            | $20/mo    | **Full code hidden** by prop        | Trivial |
| Formulas                      | $20/mo    | **Full code hidden** by prop        | Trivial |
| API & Embedding               | $0.20/doc | Dummy JS served                     | High    |
| HTML Template API             | $0.20/doc | No code exists                      | High    |
| PDF/DOCX Field Tags API       | $0.20/doc | No code exists                      | Medium  |
| Embedded Signing Form         | $0.20/doc | Dummy JS served                     | High    |
| Embedded Form Builder         | $0.20/doc | Dummy JS served                     | High    |

---

## Implementation Phases

### Phase 0: Quick Wins (Trivial — just flip switches)

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

### Phase 1: Automated Reminders (Low effort)

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

### Phase 2: Company Logo & Branding (Medium effort)

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

### Phase 3: User Roles & Teams (Medium effort)

#### 3.1 Define Roles

- **File**: `app/models/user.rb`
- **Add roles**: `admin`, `manager`, `member`, `viewer`
- **Permissions**:
  - `admin`: Full access (current behavior)
  - `manager`: Create/send templates, manage team members
  - `member`: Create/send templates, view own submissions only
  - `viewer`: Read-only access to assigned submissions

#### 3.2 Update Ability System

- **File**: `lib/ability.rb`
- **Implement**: CanCanCan role-based rules per role

#### 3.3 Teams (optional for multi-tenant HRMS)

- **Migration**: Create `teams` table, add `team_id` to users
- **Scoping**: Templates and submissions scoped to team within account
- **Use case**: Each org in your HRMS = one team or one account

---

### Phase 4: Bulk Send from Spreadsheet (Low-Medium effort)

#### 4.1 Backend Controller

- **Create**: `app/controllers/submissions_spreadsheet_controller.rb`
- **Route**: `POST /submissions/upload_spreadsheet`
- **Logic**:
  1. Accept XLSX/CSV upload
  2. Parse using existing `rubyXL` or `csv` gems (already in Gemfile)
  3. Map columns to template fields
  4. Create submissions for each row
  5. Send invitation emails

#### 4.2 Connect Frontend

- **File**: `app/javascript/template_builder/import_list.vue` (already exists)
- **Fix**: Update fetch URL to match new route
- **Replace**: `_bulk_send_placeholder.html.erb` with actual form partial

---

### Phase 5: Template Embedding (High effort — YOUR PRIORITY)

This is the most critical feature for your multi-tenant HRMS use case.

#### 5.1 Architecture for Multi-Tenant Embedding

```
Your HRMS App
  └── Org A dashboard → embedded DocuSeal builder (Org A's templates)
  └── Org B dashboard → embedded DocuSeal builder (Org B's templates)
  └── Employee signing → embedded DocuSeal form
```

#### 5.2 Embed Authentication (JWT tokens)

- **Create**: `app/controllers/api/embed_tokens_controller.rb`
- **Route**: `POST /api/embed_token`
- **Logic**: Generate short-lived JWT with `account_id`, `user_email`, `template_id`
- **Library**: `jwt` gem already in Gemfile

#### 5.3 Embedded Form Builder Component

- **Create**: `app/controllers/embed/builders_controller.rb`
- **Route**: `GET /embed/builder?token=<jwt>`
- **View**: Render the template builder Vue app in an iframe-friendly layout (no nav/header)
- **Layout**: Create `app/views/layouts/embed.html.erb` (minimal, no navigation)
- **CORS**: Allow embedding origin domains (configurable per account)

#### 5.4 Embedded Signing Form Component

- **Create**: `app/controllers/embed/forms_controller.rb`
- **Route**: `GET /embed/form?token=<jwt>&submission_id=<id>`
- **View**: Render submission form in embed layout
- **Already exists**: `app/views/submit_form/show.html.erb` — adapt for embed

#### 5.5 JavaScript SDK (Web Components)

- **Create**: `app/javascript/embed/docuseal-builder.js`
- **Create**: `app/javascript/embed/docuseal-form.js`
- **Behavior**: Custom elements (`<docuseal-builder>`, `<docuseal-form>`) that:
  1. Accept `data-token` attribute
  2. Create an iframe pointing to embed controller
  3. Communicate via `postMessage` for events (completed, saved, etc.)
- **Serve from**: Replace dummy in `embed_scripts_controller.rb` with real bundle
- **Alternative**: Provide npm package for React/Vue wrappers

#### 5.6 Multi-Tenant Account Isolation

- **Your HRMS integration flow**:
  1. HRMS creates an Account per org via API (or you pre-provision)
  2. Each org gets its own API key
  3. Org admin opens embedded builder → creates templates
  4. HR sends docs via embedded form or API
  5. Employee signs via embedded signing form
- **Key files**: Templates already scoped by `account_id` — isolation exists

#### 5.7 Events & Callbacks

- **postMessage events**: `template.created`, `template.saved`, `form.completed`, `form.declined`
- **Webhook**: Already exists (`SendWebhookRequestJob`) — ensure it fires for embedded flows
- **Redirect**: Allow `redirect_url` param after signing completion

---

### Phase 6: HTML Template API (High effort)

#### 6.1 Controller

- **Create**: `app/controllers/api/templates_html_controller.rb`
- **Route**: `POST /api/templates/html`
- **Input**: HTML string + CSS (or Tailwind subset)
- **Logic**:
  1. Parse HTML for `{{field_name}}` placeholders
  2. Convert HTML → PDF using a rendering engine (wkhtmltopdf, Grover/Puppeteer, or WeasyPrint)
  3. Create template with auto-detected field positions
  4. Store PDF via Active Storage
- **Gem options**: `grover` (Puppeteer-based), `wicked_pdf`, or shell out to `weasyprint`

#### 6.2 Field Detection from HTML

- Parse `{{field:type:name}}` syntax
- Map to DocuSeal field types (signature, text, date, checkbox, etc.)
- Calculate field positions from rendered PDF coordinates

---

### Phase 7: PDF/DOCX Field Tags API (Medium effort)

#### 7.1 PDF with Tags

- **Create**: `app/controllers/api/templates_pdf_controller.rb`
- **Route**: `POST /api/templates/pdf`
- **Logic**:
  1. Accept uploaded PDF
  2. Parse text layer for `{{field_name}}` tags using HexaPDF
  3. Calculate bounding boxes for each tag
  4. Create template with field positions auto-mapped
  5. Optionally remove tag text from rendered PDF

#### 7.2 DOCX with Tags

- **Create**: `app/controllers/api/templates_docx_controller.rb`
- **Route**: `POST /api/templates/docx`
- **Logic**:
  1. Accept DOCX upload
  2. Parse XML for `{{tags}}` using `rubyXL` or `docx` gem
  3. Convert to PDF (LibreOffice headless or similar)
  4. Map tag positions to PDF coordinates
  5. Create template

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

### Embedding Integration Pattern

```
HRMS Backend                    DocuSeal (self-hosted)
─────────────                   ──────────────────────
1. Create account per org  →    POST /api/accounts (need to add)
2. Store org's API key
3. User clicks "Documents" →    Generate JWT embed token
4. Render <docuseal-builder     GET /embed/builder?token=xxx
     data-token="xxx" />        (iframe with template builder)
5. Org admin creates template
6. HR sends for signing    →    POST /api/submissions
7. Employee opens link     →    GET /embed/form?token=xxx
8. Signing completed       ←    Webhook → HRMS callback
```

---

## Getting Started

```bash
# Phase 0: Enable hidden features immediately
# Edit app/views/templates/edit.html.erb and add the data attributes
# Then restart the Rails server to see conditional fields + formulas
```

Next step: Start with Phase 0 (trivial) then move to Phase 5 (embedding) since that's your core need.
