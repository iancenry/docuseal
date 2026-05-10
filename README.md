<p align="center">
  <img src="public/logo.png" alt="OpenSeal" width="200" />
</p>
<h1 align="center" style="border-bottom: none">
  OpenSeal
</h1>
<h3 align="center">
  Self-hosted document signing with all features unlocked — built on DocuSeal
</h3>
<p align="center">
  <em>API-first • Multi-tenant ready • Embeddable • Zero per-document fees</em>
</p>

---

> **Built on [DocuSeal](https://github.com/docusealco/docuseal)** — the excellent open-source document signing platform created by [DocuSeal LLC](https://www.docuseal.com). This project extends the OSS edition with all Pro features unlocked for self-hosted use. All credit for the core platform goes to the DocuSeal team. If you need a managed cloud solution, check out [DocuSeal Cloud](https://www.docuseal.com/pricing).

---

## What is OpenSeal?

OpenSeal is a self-hosted fork of [DocuSeal](https://github.com/docusealco/docuseal) with every Pro/Enterprise feature gate removed and fully implemented. No usage-based pricing, no feature paywalls — just a complete document signing platform you own and control.

It's designed for developers and businesses who want to embed document signing into their own products (SaaS platforms, HRMS, CRMs, legal tech) via API and embeddable components, with full multi-tenant isolation.

## Features

Everything in DocuSeal OSS, plus all Pro features — unlocked and working:

### Core Platform

- PDF form fields builder (WYSIWYG)
- 16+ field types (Signature, Date, File, Checkbox, Phone, Payment, etc.)
- Multiple submitters per document with ordered/random signing
- Automated emails via SMTP, Gmail, or Outlook
- Files storage on disk, AWS S3, Google Storage, or Azure Cloud
- Automatic PDF eSignature with trusted certificate
- PDF signature verification and audit log
- Mobile-optimized signing experience
- 7 UI languages, signing available in 14 languages
- Easy to deploy in minutes

### Unlocked Pro Features

- **Company logo & white-label** — custom branding on forms and emails
- **User roles** — Admin, Editor, and Viewer with granular permissions
- **Automated reminders** — configurable first/second/third reminder intervals
- **Conditional fields & formulas** — dynamic forms with calculated values
- **Bulk send** — CSV/XLSX spreadsheet import for batch signature requests
- **Stripe payments** — collect payments during signing (0% platform fee)
- **API & Webhooks** — full REST API for templates, submissions, and submitters
- **Embedded signing form** — `<docuseal-form>` Web Component (JS, React, Vue, Angular)
- **Embedded form builder** — `<docuseal-builder>` Web Component with JWT auth
- **HTML Template API** — create PDF templates from HTML with field tags
- **PDF/DOCX Field Tags API** — upload tagged documents, auto-detect fields
- **Template merge & clone APIs** — combine and duplicate templates programmatically
- **Email 2FA** — require email verification before form access
- **Allow decline & delegate** — signers can decline or delegate to another party
- **Shared link signing & in-person signing**
- **Witness invitations** — invite a witness to co-sign

### Multi-Tenant Architecture

- Each tenant gets a separate account with isolated data
- Tenants configure their own SMTP, Stripe, webhooks, and branding via API
- JWT-authenticated embedded components for tenant-facing UIs
- Thread-safe — no global state leaks between tenant requests
- Settings UI hidden in multi-tenant mode (tenants interact via API only)

## Quick Start

### Docker Compose (recommended)

```sh
git clone https://github.com/iancenry/docuseal.git openseal
cd openseal
sudo HOST=your-domain.com docker compose up
```

This starts OpenSeal with PostgreSQL and Caddy (auto-SSL) on ports 80/443.

### Docker (standalone)

```sh
docker run --name openseal -p 3000:3000 \
  -v ./data:/data \
  -e DATABASE_URL=postgresql://user:pass@host:5432/openseal \
  docuseal/docuseal
```

### Local Development

```sh
# Prerequisites: Ruby (via rbenv), Node.js, PostgreSQL, Redis
git clone https://github.com/iancenry/docuseal.git openseal
cd openseal
bin/setup
DATABASE_URL=postgresql://localhost/openseal_dev REDIS_URL=redis://localhost:6379 bin/rails s
```

## API Usage

OpenSeal exposes the same API as DocuSeal Pro. Authenticate with `X-Auth-Token` header.

### Create a template from HTML

```bash
curl -X POST http://localhost:3000/api/templates/html \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Agreement</h1><p>I, {{Full Name}}, agree.</p><p>{{Signature|signature}}</p>",
    "name": "My Template"
  }'
```

### Send for signature

```bash
curl -X POST http://localhost:3000/api/submissions \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": 1,
    "send_email": true,
    "submitters": [{ "role": "First Party", "email": "signer@example.com" }]
  }'
```

### Embed in your app

```html
<script src="https://your-openseal-host.com/js/docuseal.js"></script>

<!-- Signing form -->
<docuseal-form
  data-src="https://your-openseal-host.com/d/TEMPLATE_SLUG"
  data-email="signer@example.com"
>
</docuseal-form>

<!-- Form builder (requires JWT token) -->
<docuseal-builder
  data-token="JWT_TOKEN"
  data-host="https://your-openseal-host.com"
>
</docuseal-builder>
```

## Documentation

| Document                                                          | Description                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Implementation Plan (Part 1)](docs/IMPLEMENTATION_PLAN.md)       | Phases 0–10: all unlocked Pro features                                             |
| [Implementation Plan (Part 2)](docs/IMPLEMENTATION_PLAN_PART2.md) | Phases 11–15: remaining gaps (one-off submission APIs, ID verification, QeS, etc.) |
| [Embedding Guide](docs/EMBEDDING.md)                              | Multi-tenant embedding architecture, JWT auth, React examples                      |
| [Stripe Payments Guide](docs/STRIPE_PAYMENTS.md)                  | Payment integration, webhook setup, multi-tenant Stripe config                     |
| [DocuSeal API Reference](https://www.docuseal.com/docs/api)       | Full API documentation (upstream, compatible)                                      |

## Implementation Status

| Phase | Feature                                      | Status      |
| ----- | -------------------------------------------- | ----------- |
| 0     | Conditional Fields, Formulas, Phone, Payment | ✅ Done     |
| 1     | Automated Reminders                          | ✅ Done     |
| 2     | Company Logo & Branding                      | ✅ Done     |
| 3     | User Roles & Permissions                     | ✅ Done     |
| 4     | Bulk Send from Spreadsheet                   | ✅ Done     |
| 5     | Embedded Signing Form & Builder              | ✅ Done     |
| 6     | HTML Template API                            | ✅ Done     |
| 7     | PDF/DOCX Field Tags API                      | ✅ Done     |
| 8     | SMS Verification                             | ⏳ Optional |
| 9     | Stripe Payments                              | ✅ Done     |
| 10    | SSO / SAML                                   | ⏳ Optional |
| 11    | One-off Submission APIs (PDF/DOCX/HTML)      | 🔜 Planned  |
| 12    | ID Verification & KBA                        | 🔜 Planned  |
| 13    | EU Qualified Signatures (QeS)                | 🔜 Planned  |
| 14    | DocuSign Import                              | 🔜 Planned  |
| 15    | Teams & Tenants UI                           | 🔜 Planned  |

## Acknowledgments

This project would not exist without **[DocuSeal](https://github.com/docusealco/docuseal)** by [DocuSeal LLC](https://www.docuseal.com). The DocuSeal team built an outstanding open-source document signing platform — clean architecture, great API design, and a genuinely useful product. OpenSeal simply extends their work for self-hosted power users.

- **DocuSeal GitHub**: [github.com/docusealco/docuseal](https://github.com/docusealco/docuseal)
- **DocuSeal Cloud**: [docuseal.com](https://www.docuseal.com)
- **DocuSeal Discord**: [discord.gg/qygYCDGck9](https://discord.gg/qygYCDGck9)

If you're looking for a managed solution with support, SSO, compliance certifications (SOC 2, HIPAA), and zero operational overhead — **use [DocuSeal Cloud](https://www.docuseal.com/pricing)**. It's a great product.

## License

Distributed under the AGPLv3 License with Section 7(b) Additional Terms requiring original DocuSeal attribution in interactive user interfaces. See [LICENSE](LICENSE) and [LICENSE_ADDITIONAL_TERMS](LICENSE_ADDITIONAL_TERMS) for details.
Unless otherwise noted, all files © 2023-2026 DocuSeal LLC.

## Tools

- [Signature Maker](https://www.docuseal.com/online-signature)
- [Sign Document Online](https://www.docuseal.com/sign-documents-online)
- [Fill PDF Online](https://www.docuseal.com/fill-pdf)
