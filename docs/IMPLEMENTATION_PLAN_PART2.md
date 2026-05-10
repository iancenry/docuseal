# OpenSeal Implementation Plan — Part 2

## Remaining Feature Gaps (Beyond SSO & SMS)

Part 1 covered Phases 0–9. This document covers the remaining Pro features not yet implemented.

---

## Feature Gap Summary

| Feature                                 | Pro Price       | OSS Status                         | Effort    | Third-Party Required          |
| --------------------------------------- | --------------- | ---------------------------------- | --------- | ----------------------------- |
| One-off Submission from PDF             | $0.20/doc       | API endpoints missing              | Low       | No                            |
| One-off Submission from DOCX            | $0.20/doc       | API endpoints missing              | Low       | No                            |
| One-off Submission from HTML            | $0.20/doc       | API endpoints missing              | Low       | No                            |
| ID Card Verification                    | $2/verification | UI scaffolding exists, no provider | High      | Yes (Stripe Identity / Jumio) |
| Knowledge-Based Authentication (KBA)    | $2/KBA          | UI scaffolding exists, no provider | High      | Yes (LexisNexis / Socure)     |
| EU Qualified Electronic Signature (QeS) | $2-$4/QeS       | No code exists                     | Very High | Yes (eIDAS TSP)               |
| Import from DocuSign                    | —               | No code exists                     | Medium    | Yes (DocuSign API)            |
| Teams/Tenants UI                        | $20/mo          | Ability flag exists, no UI/models  | Medium    | No                            |

---

## Phase 11: One-off Submission from Raw File APIs (Low effort)

The Pro API provides `POST /submissions/pdf`, `POST /submissions/docx`, and `POST /submissions/html` — convenience endpoints that create a template + submission in a single call without requiring a pre-existing template. All the building blocks exist (Phase 6 HTML, Phase 7 PDF/DOCX template creation + standard submission creation).

### 11.1 Submission from PDF — `POST /api/submissions/pdf`

- **Controller**: `app/controllers/api/submissions_pdf_controller.rb`
- **Logic**:
  1. Accept PDF file (base64 or URL) + submitters array + optional field coordinates
  2. Create a temporary/hidden template using `Templates::CreateFromPdfTags` (Phase 7)
  3. Create submission from that template using `Submissions::CreateFromSubmitters`
  4. Return combined response with submission + submitter details
- **Parameters** (matching Pro API):
  - `name` — Submission name
  - `documents[]` — Array of `{ name, file, fields[] }` (file = base64 or URL)
  - `submitters[]` — Standard submitter array (email, role, values, fields, metadata, etc.)
  - `send_email`, `send_sms`, `order`, `completed_redirect_url`, `bcc_completed`
  - `reply_to`, `expire_at`, `template_ids`, `flatten`, `merge_documents`, `remove_tags`
  - Field types: `heading, text, signature, initials, date, number, image, checkbox, multiple, file, radio, select, cells, stamp, payment, phone, verification, kba, strikethrough`
  - Per-submitter: `require_phone_2fa`, `require_email_2fa`, `invite_by`, `completed`, `order`

### 11.2 Submission from DOCX — `POST /api/submissions/docx`

- **Controller**: `app/controllers/api/submissions_docx_controller.rb`
- **Logic**:
  1. Accept DOCX file (base64 or URL) + submitters array
  2. Create template using `Templates::CreateFromDocx` (Phase 7)
  3. Create submission, return response
- **Parameters**: Same as PDF + `variables` object for `[[variable_name]]` dynamic content

### 11.3 Submission from HTML — `POST /api/submissions/html`

- **Controller**: `app/controllers/api/submissions_html_controller.rb`
- **Logic**:
  1. Accept HTML content with field tags + submitters array
  2. Create template using `Templates::CreateFromHtml` (Phase 6)
  3. Create submission, return response
- **Additional params**:
  - `documents[].html` — HTML with field tags (`<text-field>`, `<signature-field>`, etc.)
  - `documents[].html_header` — Header HTML for every page
  - `documents[].html_footer` — Footer HTML for every page
  - `documents[].size` — Page size (Letter, Legal, A4, etc.)

### 11.4 Routes

```ruby
# config/routes.rb — inside api namespace
namespace :api do
  resources :submissions, only: %i[index show create] do
    collection do
      post 'pdf', to: 'submissions_pdf#create'
      post 'docx', to: 'submissions_docx#create'
      post 'html', to: 'submissions_html#create'
    end
  end
end
```

### 11.5 Response Format

All three endpoints return the same shape as the standard `POST /api/submissions` — a submission object with embedded submitter details including `embed_src` URLs:

```json
{
  "id": 5,
  "name": "Test Submission",
  "submitters": [
    {
      "id": 1,
      "uuid": "884d545b-...",
      "email": "john.doe@example.com",
      "slug": "pAMimKcyrLjqVt",
      "status": "sent",
      "embed_src": "https://yourdomain.com/s/pAMimKcyrLjqVt",
      "role": "First Party"
    }
  ],
  "source": "api",
  "status": "pending",
  "schema": [...],
  "fields": [...],
  "expire_at": null,
  "created_at": "2026-05-10T..."
}
```

### Testing

```bash
# Submission from PDF with text tags
curl -X POST http://localhost:4000/api/submissions/pdf \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [{ "name": "Contract", "file": "BASE64_PDF_CONTENT" }],
    "submitters": [{ "role": "First Party", "email": "john@example.com" }]
  }'

# Submission from HTML with field tags
curl -X POST http://localhost:4000/api/submissions/html \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Quick Agreement",
    "documents": [{
      "name": "Agreement",
      "html": "<h1>Agreement</h1><p>I, <text-field name=\"Full Name\" role=\"First Party\"></text-field>, agree to the terms.</p><p><signature-field name=\"Signature\" role=\"First Party\"></signature-field></p>"
    }],
    "submitters": [{ "role": "First Party", "email": "signer@example.com" }]
  }'

# Submission from DOCX with variables
curl -X POST http://localhost:4000/api/submissions/docx \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Offer Letter",
    "variables": { "employee_name": "Jane Smith", "salary": "$120,000" },
    "documents": [{ "name": "Offer", "file": "BASE64_DOCX_CONTENT" }],
    "submitters": [{ "role": "First Party", "email": "jane@example.com" }]
  }'
```

---

## Phase 12: Enable ID Verification & KBA Field Types (Medium effort)

The template builder already has `verification` and `kba` field types built into the Vue components. They're gated by `withVerification` and `withKba` props that default to `null` (hidden). The signing form also has handling code for these types. The gap is:

1. The template edit view doesn't pass the data attributes to enable them
2. No third-party verification provider is integrated

### 12.1 Enable Builder Field Types

- **File**: `app/views/templates/edit.html.erb`
- **Change**: Add `data-with-verification="true"` and `data-with-kba="true"` to the builder element
- **Effect**: `verification` and `kba` field types appear in the field type picker
- **Effort**: Trivial (same as Phase 0 quick wins)

### 12.2 ID Verification Provider Integration

The `verification` field type in the signing form triggers a verification flow before the submitter can proceed. A provider integration is needed.

**Option A: Stripe Identity** (recommended if Stripe already connected)

- **Create**: `lib/identity_verification.rb`
- **Logic**:
  1. When submitter reaches a `verification` field, create a Stripe Identity VerificationSession
  2. Embed the Stripe Identity verification modal (ID photo + selfie)
  3. On success, store verification result in submitter values
  4. Log `start_verification` and `complete_verification` events (event types already defined)
- **Config**: Reuse existing Stripe config from `EncryptedConfig::STRIPE_KEY`
- **Cost**: $1.50/verification via Stripe

**Option B: Self-hosted stub (no-cost alternative)**

- Accept an uploaded photo of government ID
- Store as an attachment on the submitter
- Mark field as "verified" (manual review by admin)
- No actual automated ID validation

### 12.3 KBA Provider Integration

KBA asks the submitter identity-probing questions (e.g., "Which of these addresses have you lived at?").

- **Create**: `lib/kba_verification.rb`
- **Provider**: LexisNexis InstantID, Socure, or TransUnion
- **Logic**:
  1. When submitter reaches a `kba` field, call provider API with submitter's name + address
  2. Display the provider's challenge questions in the signing form
  3. Verify answers, store pass/fail result
  4. Log `start_verification` / `complete_verification` events
- **Config**: Store provider API key in `EncryptedConfig` (new key: `kba_provider`)

### 12.4 Settings UI

- **File**: Create `app/views/verification_settings/index.html.erb`
- **Route**: `resource :verification, only: [:index, :create], controller: 'verification_settings'`
- **Fields**: Provider selection (Stripe Identity / Manual), API key configuration
- **Nav**: Add "Verification" link to settings nav

---

## Phase 13: EU Qualified Electronic Signature — QeS (Very High effort)

EU Qualified Electronic Signatures (QeS) provide the highest legal assurance under eIDAS regulation. They require integration with an EU-certified Trust Service Provider (TSP).

### 13.1 Architecture

```
Submitter fills form → Signs with standard signature →
  → QeS requested → TSP remote signing flow:
    1. Submitter authenticates with TSP (video ident or eID)
    2. TSP issues qualified certificate
    3. TSP applies qualified signature to PDF
    4. Qualified timestamp added
  → Signed PDF stored with QeS seal
```

### 13.2 TSP Integration

- **Providers** (EU-certified):
  - Swisscom (CH) — REST API, €2-4/signature
  - D-Trust (DE) — REST API
  - InfoCert (IT) — SOAP/REST
  - Namirial (IT) — REST API
- **Create**: `lib/qualified_signature.rb`
- **Protocol**: CSC API (Cloud Signature Consortium) — standard REST protocol supported by most TSPs
- **Flow**:
  1. `POST /csc/v2/credentials/list` — list user's signing certificates
  2. `POST /csc/v2/credentials/authorize` — authorize signing with OTP/PIN
  3. `POST /csc/v2/signatures/signHash` — sign document hash remotely
  4. Embed qualified signature into PDF using HexaPDF

### 13.3 Configuration

- **Store**: TSP credentials in `EncryptedConfig` (new key: `qes_provider`)
- **Settings**: TSP URL, client ID, client secret, default certificate policy
- **Per-template**: Option to require QeS for specific submitter roles

### 13.4 Considerations

- Requires submitter identity verification (video ident) — usually handled by the TSP
- Each signature costs €2-4 — need metering/billing or flat-rate TSP contract
- TSP must be on the EU Trusted List
- Not needed for most use cases outside EU financial/government sector

---

## Phase 14: Import from DocuSign (Medium effort)

Allow users to migrate their DocuSign templates and envelope data into OpenSeal.

### 14.1 DocuSign API Integration

- **Create**: `lib/docusign_import.rb`
- **Auth**: OAuth 2.0 with DocuSign (Authorization Code Grant)
- **Gems**: `docusign_esign` or raw HTTP calls

### 14.2 Template Import

- **Logic**:
  1. User connects DocuSign account via OAuth
  2. Fetch templates list via `GET /v2.1/accounts/{accountId}/templates`
  3. For each selected template:
     - Download template documents (PDF)
     - Map DocuSign tabs (fields) to OpenSeal field types
     - Create OpenSeal template with mapped fields at correct positions
  4. Field type mapping:
     - `signHereTabs` → `signature`
     - `textTabs` → `text`
     - `dateTabs` → `date`
     - `checkboxTabs` → `checkbox`
     - `initialHereTabs` → `initials`
     - `numberTabs` → `number`
     - `listTabs` → `select`

### 14.3 Controller & UI

- **Controller**: `app/controllers/docusign_import_controller.rb`
- **Views**: OAuth connect button, template selection list, import progress
- **Route**: `resource :docusign_import, only: [:new, :create]` + OAuth callback

### 14.4 Considerations

- DocuSign API rate limits (1000 calls/hour for individual plans)
- Some DocuSign field types have no direct OpenSeal equivalent (e.g., radio button groups)
- Envelope (submission) history import is optional — high volume, less useful

---

## Phase 15: Teams & Tenants UI (Medium effort)

The ability flag `can?(:manage, :tenants)` already exists and is granted to admins. This phase adds the actual data model and UI for managing multiple teams/tenants within a single OpenSeal instance.

### 15.1 Data Model

```ruby
# db/migrate/xxx_create_teams.rb
create_table :teams do |t|
  t.references :account, null: false, foreign_key: true
  t.string :name, null: false
  t.text :description
  t.timestamps
end

# Add team_id to users (optional — users can belong to a team)
add_reference :users, :team, foreign_key: true
```

### 15.2 Template & Submission Scoping

- Templates can be scoped to a team (visible only to team members)
- Submissions inherit team scope from their template
- Account admins see everything; team members see only their team's data

### 15.3 Controller & Views

- **Controller**: `app/controllers/teams_controller.rb` (CRUD)
- **Views**: Team list, create/edit form, member management
- **Nav**: Add "Teams" to settings sidebar (guarded by `can?(:manage, :tenants)`)
- **Scoping**: Add `before_action :scope_to_team` for template/submission controllers

### 15.4 Considerations

- For the HRMS use case, each account already maps to one org — teams add sub-org grouping
- Alternative: Use template folders for lightweight team separation (already exists)
- If using API-first multi-tenant architecture, this is less important (each tenant = separate account)

---

## Priority Order (Part 2)

| Priority | Phase     | Feature                           | Rationale                                              |
| -------- | --------- | --------------------------------- | ------------------------------------------------------ |
| 🔴 P0    | 11        | One-off Submission APIs           | Low effort, high value — completes API parity with Pro |
| 🟠 P1    | 12.1      | Enable Verification/KBA fields    | Trivial toggle, enables the field types in builder     |
| 🟡 P2    | 12.2-12.3 | Verification provider integration | Only if identity verification is a requirement         |
| 🟡 P2    | 15        | Teams/Tenants UI                  | Only if sub-org grouping needed beyond folders         |
| 🟢 P3    | 14        | DocuSign Import                   | Nice-to-have for migration                             |
| 🟢 P3    | 13        | EU Qualified Signatures           | Very niche, high cost/complexity                       |

---

## What's Already Complete (Part 1 Recap)

| Phase | Feature                                      | Status                                       |
| ----- | -------------------------------------------- | -------------------------------------------- |
| 0     | Conditional Fields, Formulas, Phone, Payment | ✅ DONE                                      |
| 1     | Automated Reminders                          | ✅ DONE                                      |
| 2     | Company Logo & Branding                      | ✅ DONE                                      |
| 3     | User Roles & Permissions                     | ✅ DONE                                      |
| 4     | Bulk Send from Spreadsheet                   | ✅ DONE                                      |
| 5     | Template Embedding (Builder + Form)          | ✅ DONE                                      |
| 6     | HTML Template API                            | ✅ DONE                                      |
| 7     | PDF/DOCX Field Tags API                      | ✅ DONE                                      |
| 8     | SMS Verification                             | ⏳ Not implemented (optional)                |
| 9     | Stripe Payments                              | ✅ DONE                                      |
| 10    | SSO / SAML                                   | ⏳ Skipped (not needed for API architecture) |

---

## Technical Notes

### Existing Code That Supports Part 2

| Building Block                       | Location                                           | Used By                      |
| ------------------------------------ | -------------------------------------------------- | ---------------------------- |
| PDF tag parsing + field extraction   | `lib/templates/create_from_pdf_tags.rb`            | Phase 11.1                   |
| DOCX conversion + tag parsing        | `lib/templates/create_from_docx.rb`                | Phase 11.2                   |
| HTML-to-PDF rendering                | `lib/templates/create_from_html.rb`                | Phase 11.3                   |
| Submission creation from submitters  | `lib/submissions/create_from_submitters.rb`        | Phase 11 (all)               |
| `verification` field type in builder | `app/javascript/template_builder/fields.vue`       | Phase 12                     |
| `kba` field type in builder          | `app/javascript/template_builder/fields.vue`       | Phase 12                     |
| `withVerification` / `withKba` props | `app/javascript/application.js`                    | Phase 12                     |
| Verification event types             | `start_verification`, `complete_verification`      | Phase 12                     |
| HexaPDF digital signatures           | `lib/submissions/generate_result_attachments.rb`   | Phase 13                     |
| `can?(:manage, :tenants)` ability    | `lib/ability.rb`                                   | Phase 15                     |
| EncryptedConfig model                | `app/models/encrypted_config.rb`                   | Phases 12, 13                |
| Stripe integration pattern           | `app/controllers/api/stripe_connect_controller.rb` | Phase 12.2 (Stripe Identity) |
