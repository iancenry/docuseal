# OpenSeal Embedding Guide

Embed the template builder and signing form into any web application using Web Components.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Your App (HRMS / CRM / SaaS)                  │
│                                                 │
│  ┌──────────────┐     ┌──────────────────────┐  │
│  │ Your Backend │     │ Your Frontend        │  │
│  │              │     │                      │  │
│  │ POST /api/   │────▶│ <docuseal-builder>   │  │
│  │ embed_tokens │     │ <docuseal-form>      │  │
│  │              │     │                      │  │
│  └──────┬───────┘     └──────────┬───────────┘  │
│         │                        │ iframe        │
│         │ JWT token              ▼               │
│         │             ┌──────────────────────┐   │
│         └────────────▶│  OpenSeal Instance   │   │
│                       │  sign.yourapp.com    │   │
│                       └──────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**Key principle:** Your backend generates JWT tokens (keeping the API key secret), then passes them to the frontend which renders the Web Components.

## End-to-End Flow

```
1. Employee clicks "Sign Document" in your app
2. Your backend calls POST /api/embed_tokens with the API key
   (server-to-server — the key never touches the browser)
3. Gets back a short-lived JWT token (expires in 1 hour)
4. Renders the page with <docuseal-form data-token="JWT_HERE">
5. Employee sees the signing form — never knows OpenSeal exists
```

The API key lives in your `.env` file (or secrets manager) on your server. It's never sent to the browser. The only thing the frontend sees is the temporary JWT token, which is scoped to one specific template or submission and expires quickly.

```bash
# .env on your server
OPENSEAL_API_KEY=your_api_key_from_settings
OPENSEAL_HOST=https://sign.yourapp.com
```

## Step 1: Load the JS SDK

Add the script tag to your HTML page or layout. This registers the `<docuseal-builder>` and `<docuseal-form>` custom elements.

```html
<script src="https://sign.yourapp.com/js/docuseal.js"></script>
```

No NPM package needed — just the script tag pointing at your OpenSeal server.

## Step 2: Generate Embed Tokens (Backend)

Your backend calls the OpenSeal API to get a short-lived JWT token. **Never expose your API key to frontend code.**

### Python (Django / Flask / FastAPI)

```python
import requests

def get_embed_token(template_id=None, submission_id=None):
    body = {}
    if template_id:
        body["template_id"] = template_id
    if submission_id:
        body["submission_id"] = submission_id

    resp = requests.post(
        "https://sign.yourapp.com/api/embed_tokens",
        headers={
            "X-Auth-Token": OPENSEAL_API_KEY,  # from env/secrets
            "Content-Type": "application/json",
        },
        json=body,
    )
    return resp.json()  # { "token": "eyJ...", "expires_at": "..." }
```

### Node.js (Express / Fastify)

```javascript
async function getEmbedToken({ templateId, submissionId }) {
  const body = {};
  if (templateId) body.template_id = templateId;
  if (submissionId) body.submission_id = submissionId;

  const resp = await fetch('https://sign.yourapp.com/api/embed_tokens', {
    method: 'POST',
    headers: {
      'X-Auth-Token': process.env.OPENSEAL_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return resp.json(); // { token, expires_at }
}
```

### Ruby (Rails)

```ruby
def embed_token(template_id: nil, submission_id: nil)
  body = {}
  body[:template_id] = template_id if template_id
  body[:submission_id] = submission_id if submission_id

  resp = Net::HTTP.post(
    URI("https://sign.yourapp.com/api/embed_tokens"),
    body.to_json,
    "X-Auth-Token" => ENV["OPENSEAL_API_KEY"],
    "Content-Type" => "application/json"
  )
  JSON.parse(resp.body)
end
```

## Step 3: Embed the Template Builder

Use this when you want admins to create or edit document templates within your app.

```html
<docuseal-builder
  data-token="TOKEN_FROM_BACKEND"
  data-template-id="42"
  data-host="https://sign.yourapp.com"
  data-height="800px"
>
</docuseal-builder>

<script>
  const builder = document.querySelector('docuseal-builder');

  builder.addEventListener('docuseal:builder:save', (e) => {
    console.log('Template saved:', e.detail);
  });

  builder.addEventListener('docuseal:builder:upload', (e) => {
    console.log('Document uploaded:', e.detail);
  });
</script>
```

## Step 4: Create a Submission via API (Backend)

Before showing the signing form, create a submission to get a `submission_id`.

```bash
curl -X POST https://sign.yourapp.com/api/submissions \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": 42,
    "submitters": [
      { "email": "employee@company.com", "role": "First Party" }
    ]
  }'
# Returns: { "id": 123, "submitters": [...] }
```

## Step 5: Embed the Signing Form

Use this when signers need to fill out and sign a document.

```html
<docuseal-form
  data-token="SUBMISSION_SCOPED_TOKEN"
  data-submission-id="123"
  data-email="employee@company.com"
  data-host="https://sign.yourapp.com"
  data-height="700px"
>
</docuseal-form>

<script>
  const form = document.querySelector('docuseal-form');

  form.addEventListener('docuseal:form:complete', (e) => {
    console.log('Form submitted!', e.detail);
    // Update your DB, show success message, redirect, etc.
  });

  form.addEventListener('docuseal:form:completed', (e) => {
    console.log('Form was already completed', e.detail);
  });
</script>
```

## Full React Example

```jsx
import { useEffect, useRef, useState } from 'react';

function DocumentSigner({ submissionId, email }) {
  const containerRef = useRef(null);
  const [token, setToken] = useState(null);

  useEffect(() => {
    // Fetch token from YOUR backend (not OpenSeal directly)
    fetch('/api/signing-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submission_id: submissionId })
    })
      .then((r) => r.json())
      .then((data) => setToken(data.token));
  }, [submissionId]);

  useEffect(() => {
    if (!token || !containerRef.current) return;

    const el = document.createElement('docuseal-form');
    el.setAttribute('data-token', token);
    el.setAttribute('data-submission-id', submissionId);
    el.setAttribute('data-email', email);
    el.setAttribute('data-host', 'https://sign.yourapp.com');
    el.setAttribute('data-height', '700px');

    el.addEventListener('docuseal:form:complete', (e) => {
      console.log('Signed!', e.detail);
    });

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(el);
  }, [token]);

  return <div ref={containerRef}>Loading signing form...</div>;
}
```

## Multi-Tenant Integration

In a multi-tenant setup (e.g., each customer of your SaaS gets their own templates), scope JWT tokens per tenant:

```python
# Your backend — when a new tenant needs a template
# Step 1: Create a blank template via API
resp = requests.post("https://sign.yourapp.com/api/templates",
    headers={"X-Auth-Token": API_KEY},
    json={"name": f"Contract for {tenant_name}"}
)
template_id = resp.json()["id"]
# Store template_id in your DB linked to this tenant

# Step 2: Generate a scoped JWT for ONLY this template
token = get_embed_token(template_id=template_id)
# The token can only access this one template — tenant isolation is enforced
```

## PostMessage Events Reference

| Event                     | Fired When                    | Data               |
| ------------------------- | ----------------------------- | ------------------ |
| `docuseal:builder:save`   | Template is saved in builder  | Template details   |
| `docuseal:builder:upload` | Document uploaded to template | Upload details     |
| `docuseal:form:complete`  | Signer completes and submits  | Submission details |
| `docuseal:form:completed` | Form was already completed    | Submission details |

## Integration Pattern (HRMS Example)

```
HRMS Backend                    OpenSeal (self-hosted)
─────────────                   ──────────────────────
1. Store org's API key
2. User clicks "Documents" →    Generate JWT embed token
3. Render <docuseal-builder     GET /embed/builder?token=xxx
     data-token="xxx" />        (iframe with template builder)
4. Org admin creates template
5. HR sends for signing    →    POST /api/submissions
6. Employee opens link     →    GET /embed/form?token=xxx
7. Signing completed       ←    Webhook → HRMS callback
```

## Security Notes

- **Never expose your API key** to frontend code. Always generate tokens server-side.
- Tokens are scoped (template or submission) and expire after 1 hour.
- Scope enforcement prevents a token for template 1 from accessing template 2.
- All embed endpoints use CORS headers and `frame-ancestors *` CSP to allow embedding from any origin.
- Builder iframes use `sandbox` attributes to prevent top-level navigation.
- Navigation guards in the embed layout prevent the iframe from breaking out to the full application.

## Testing

Visit **Settings → Embed Playground** (or `/embed_test.html`) on your OpenSeal instance to interactively test token generation, the builder component, and the signing form without writing any code.
