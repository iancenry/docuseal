# Stripe Payments – Multi-Tenant Architecture

Each account (tenant) configures their own Stripe API keys. Payments from document signers go directly to the tenant's Stripe account — OpenSeal never touches the funds.

Tenants configure Stripe via **API only** — they never log into OpenSeal directly. Their backend calls OpenSeal's API using the tenant's API token.

In single-tenant (self-hosted) mode, a Settings → Payments UI is also available.

---

## How It Works

```
┌──────────────┐        API call with          ┌───────────────────────┐
│  Tenant's    │  ──── X-Auth-Token ────────▶  │     OpenSeal          │
│  Backend     │                                │                       │
│  (their app) │  POST /api/stripe_connect      │  Stores Stripe keys   │
│              │  { secret_key: "sk_live_..." } │  per account in       │
│              │                                │  EncryptedConfig      │
└──────────────┘                                └───────────────────────┘
                                                         │
                                                         ▼
                                                  ┌─────────────┐
                                                  │ Stripe API  │
                                                  │ (tenant's   │
                                                  │  account)   │
                                                  └─────────────┘
```

```
┌─────────────────────────────────────────────────────────┐
│                     OpenSeal Instance                   │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Account A  │  │  Account B  │  │  Account C  │     │
│  │  (Acme Co)  │  │  (Beta LLC) │  │  (Gamma Inc)│     │
│  │             │  │             │  │             │     │
│  │ sk_live_A.. │  │ sk_live_B.. │  │ sk_test_C.. │     │
│  │ pk_live_A.. │  │ pk_live_B.. │  │ pk_test_C.. │     │
│  │ whsec_A..   │  │ whsec_B..   │  │ (no webhook)│     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
│         ▼                ▼                ▼             │
│  ┌─────────────────────────────────────────────────┐    │
│  │           EncryptedConfig (per account)          │    │
│  │  key: 'stripe'                                   │    │
│  │  value: { secret_key, publishable_key,           │    │
│  │           webhook_secret } (AES-256 encrypted)   │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
         │                │                │
         ▼                ▼                ▼
   ┌───────────┐   ┌───────────┐   ┌───────────┐
   │ Stripe    │   │ Stripe    │   │ Stripe    │
   │ Account A │   │ Account B │   │ Account C │
   │ (live)    │   │ (live)    │   │ (test)    │
   └───────────┘   └───────────┘   └───────────┘
```

---

## Setup Flow (Per Tenant)

### Via API (multi-tenant / programmatic)

Tenant's backend configures Stripe by calling OpenSeal's API with their API token:

```bash
# 1. Connect Stripe — tenant's backend sends their own Stripe keys
curl -X POST https://your-openseal.com/api/stripe_connect \
  -H "X-Auth-Token: TENANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "secret_key": "sk_live_51Abc...",
    "publishable_key": "pk_live_51Abc...",
    "webhook_secret": "whsec_abc123..."
  }'
# → { "status": "connected" }

# 2. Check connection status
curl https://your-openseal.com/api/stripe_connect \
  -H "X-Auth-Token: TENANT_API_TOKEN"
# → { "status": "connected", "publishable_key_present": true, "webhook_secret_present": true }

# 3. Disconnect Stripe
curl -X DELETE https://your-openseal.com/api/stripe_connect \
  -H "X-Auth-Token: TENANT_API_TOKEN"
# → { "status": "removed" }
```

The secret key is validated against Stripe's API before saving. Invalid keys are rejected with a `422` error. Keys are stored encrypted (Rails encrypted attributes, AES-256-GCM).

### Via Settings UI (single-tenant / self-hosted only)

In single-tenant mode, navigate to **Settings → Payments** and enter keys manually.

### 2. Add payment field to template

In the template editor, drag a **Payment** field onto the document. Click the gear icon to configure:

```
┌────────────────────────────────┐
│  Payment Field Settings        │
│                                │
│  Currency: [ USD ▼ ]           │
│  Price:    [ 49.99   ]         │
│                                │
│  ── OR ──                      │
│                                │
│  Stripe Price ID:              │
│  [ price_1Abc... ]             │
│                                │
│  ── OR ──                      │
│                                │
│  Payment Link ID:              │
│  [ plink_1Abc... ]             │
│                                │
│  ── OR ──                      │
│                                │
│  Formula (dynamic pricing):    │
│  [ {{quantity}} * 25.00 ]      │
└────────────────────────────────┘
```

### 3. Signer pays during signing

```
Signer opens form
       │
       ▼
┌──────────────────────┐
│  Fill out fields...  │
│  Name: [John Doe  ]  │
│  Email: [j@doe.co ]  │
│  [ Next → ]          │
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│  Payment             │
│  Pay $49.99          │
│                      │
│  ┌────────────────┐  │
│  │ Pay with Stripe│  │
│  └────────────────┘  │
└──────────────────────┘
       │
       ▼  (redirect to Stripe Checkout)
┌──────────────────────┐
│  Stripe Checkout     │
│  ┌────────────────┐  │
│  │ 4242...        │  │
│  │ 12/27  123     │  │
│  │ [ Pay $49.99 ] │  │
│  └────────────────┘  │
└──────────────────────┘
       │
       ▼  (redirect back)
┌──────────────────────┐
│  ✓ Payment received  │
│  Continue signing... │
│  [ Next → ]          │
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│  Sign here: [sig]    │
│  [ Complete ]        │
└──────────────────────┘
```

---

## API Endpoints

| Method   | Path                               | Auth                       | Purpose                                      |
| -------- | ---------------------------------- | -------------------------- | -------------------------------------------- |
| `GET`    | `/api/stripe_connect`              | API token (`X-Auth-Token`) | Check Stripe connection status               |
| `POST`   | `/api/stripe_connect`              | API token (`X-Auth-Token`) | Configure Stripe keys for account            |
| `DELETE` | `/api/stripe_connect`              | API token (`X-Auth-Token`) | Remove Stripe configuration                  |
| `POST`   | `/api/stripe_payments`             | None (submitter slug)      | Create Stripe Checkout session (signer flow) |
| `PUT`    | `/api/stripe_payments/:session_id` | None (submitter slug)      | Verify payment after redirect (signer flow)  |
| `POST`   | `/api/stripe_webhooks`             | Stripe signature           | Handle `checkout.session.completed`          |
| `GET`    | `/settings/payments`               | Session (admin)            | Settings UI (single-tenant only)             |
| `POST`   | `/settings/payments`               | Session (admin)            | Save keys via UI (single-tenant only)        |
| `DELETE` | `/settings/payments`               | Session (admin)            | Remove keys via UI (single-tenant only)      |

---

## Multi-Tenant Isolation

### Thread-safe API keys

Every Stripe API call passes the tenant's key per-request — never sets the global `Stripe.api_key`:

```ruby
# ✗ WRONG — global state, race condition between tenants
Stripe.api_key = config['secret_key']
Stripe::Checkout::Session.create(params)

# ✓ CORRECT — per-request, thread-safe
Stripe::Checkout::Session.create(params, { api_key: config['secret_key'] })
```

### Data flow isolation

```
Signer submits form
       │
       ▼
submitter.slug ──→ Submitter ──→ submitter.account
                                       │
                                       ▼
                              EncryptedConfig.find_by(
                                account: submitter.account,
                                key: 'stripe'
                              )
                                       │
                                       ▼
                              Stripe API call with
                              THAT account's secret_key
```

Each payment request:

1. Looks up the **submitter** by slug
2. Follows `submitter → submission → template → account`
3. Loads that **account's** encrypted Stripe config
4. Makes Stripe API calls with **that account's** key

There is no cross-tenant contamination possible.

### Webhook routing

A single webhook endpoint (`/api/stripe_webhooks`) serves all tenants:

```
Stripe POST /api/stripe_webhooks
       │
       ▼
  Read signature header
       │
       ▼
  For each EncryptedConfig where key='stripe':
    Try verify(payload, signature, config.webhook_secret)
    ├─ SignatureVerificationError → next
    └─ Success → matched! Process event for this tenant
       │
       ▼
  Extract submitter_slug from session.metadata
       │
       ▼
  Update submitter.values[payment_field_uuid] = session.id
```

### Pricing modes

| Mode             | Config                             | Use case                             |
| ---------------- | ---------------------------------- | ------------------------------------ |
| **Fixed price**  | `currency: 'USD', price: 49.99`    | Simple one-time payment              |
| **Price ID**     | `price_id: 'price_1Abc...'`        | Stripe-managed price (subscriptions) |
| **Payment Link** | `payment_link_id: 'plink_1Abc...'` | Pre-built Stripe payment link        |
| **Formula**      | `formula: '{{quantity}} * 25.00'`  | Dynamic pricing based on form fields |

Formula example — a form with a "Number of licenses" field:

```
Formula: {{num_licenses}} * 29.99

If signer enters 5 → checkout amount = $149.95
```

---

## Webhook Setup (Per Tenant)

Each tenant creates their own webhook in the Stripe Dashboard:

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Set URL: `https://your-openseal-domain.com/api/stripe_webhooks`
4. Select event: `checkout.session.completed`
5. Copy the **Signing secret** (`whsec_...`)
6. Paste it in Settings → Payments → Webhook Signing Secret

The webhook is optional — payments still work via redirect confirmation without it. The webhook adds reliability (handles cases where the user closes the browser before the redirect completes).

---

## Security

- **Encrypted storage**: All Stripe keys stored via Rails `encrypts` (AES-256-GCM)
- **Key validation**: Secret keys validated against Stripe API before saving
- **No global state**: Per-request API key passing prevents cross-tenant leaks
- **Webhook verification**: Cryptographic signature verification per Stripe's spec
- **No raw card data**: All payment handled by Stripe Checkout (PCI DSS compliant)
- **Authorization**: Settings restricted to users with `manage` permission on `EncryptedConfig`
