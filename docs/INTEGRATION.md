# OpenSeal Integration Guide

How to integrate OpenSeal document signing and generation into a third-party application (HRMS, CRM, ERP, etc.).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication](#authentication)
3. [Creating Templates](#creating-templates)
4. [Embedding the Builder](#embedding-the-builder)
5. [Field Mapping (Template Configurator)](#field-mapping)
6. [Sending for Signing (with Email)](#sending-for-signing)
7. [Generating Documents Without Email (Storage Only)](#generating-without-email)
8. [Downloading Completed Documents](#downloading-documents)
9. [Webhooks — Reacting to Completions](#webhooks)
10. [Full End-to-End Examples](#full-examples)

---

## Architecture Overview

```
┌───────────────────────────────────────────────────┐
│                Your Application                   │
│                                                   │
│  ┌─────────────┐    ┌──────────────────────────┐  │
│  │ Template     │    │ Field Mapping Table      │  │
│  │ Configurator │───▶│ docuseal_template_id     │  │
│  │ (admin UI)   │    │ field_name → db_column   │  │
│  └──────┬───────┘    └──────────────────────────┘  │
│         │                                          │
│  ┌──────▼───────┐    ┌──────────────────────────┐  │
│  │ Document     │    │ Completed PDFs stored    │  │
│  │ Generator    │───▶│ in your file storage     │  │
│  │ (runtime)    │    │                          │  │
│  └──────────────┘    └──────────────────────────┘  │
└───────────┬───────────────────────────────────────┘
            │  REST API calls
            ▼
┌───────────────────────────────────────────────────┐
│              OpenSeal Instance                    │
│                                                   │
│  Templates ─── Submissions ─── Signed Documents   │
│                                                   │
│  POST /api/templates/html    (create templates)   │
│  POST /api/templates/pdf     (create from PDF)    │
│  POST /api/templates/docx    (create from DOCX)   │
│  GET  /api/templates/:id     (read template)      │
│  POST /api/submissions       (fill & send)        │
│  PUT  /api/submitters/:id    (update & complete)  │
│  GET  /api/submissions/:id/documents (download)   │
└───────────────────────────────────────────────────┘
```

---

## Authentication

All API calls use the `X-Auth-Token` header. Get your token from **Settings > API** in the OpenSeal dashboard.

```
X-Auth-Token: your_api_token_here
```

---

## Creating Templates

### Option A: Upload via API (programmatic)

**HTML with field tags:**

```bash
curl -X POST https://openseal.yourcompany.com/api/templates/html \
  -H "X-Auth-Token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Offer Letter</h1><p>Dear {{Full Name}},</p><p>Role: {{Job Title}}</p><p>Department: {{Department|select|Engineering,Marketing,Sales}}</p><p>Start: {{Start Date|date}}</p><p>{{Signature|signature}}</p>",
    "name": "Offer Letter Template"
  }'
```

**DOCX/DOC with field tags:**

```bash
curl -X POST https://openseal.yourcompany.com/api/templates/docx \
  -H "X-Auth-Token: YOUR_TOKEN" \
  -F "file=@offer_letter.docx" \
  -F "name=Offer Letter Template"
```

**PDF with field tags:**

```bash
curl -X POST https://openseal.yourcompany.com/api/templates/pdf \
  -H "X-Auth-Token: YOUR_TOKEN" \
  -F "file=@contract.pdf" \
  -F "name=Contract Template"
```

**Tag syntax:** `{{Field Name}}`, `{{Field Name|type}}`, `{{Field Name|select|Opt1,Opt2}}`

### Option B: Embedded Builder (visual)

Let admins visually upload and place fields — see [Embedding the Builder](#embedding-the-builder).

---

## Embedding the Builder

Embed the template builder directly in your admin settings page so users can visually place fields on documents.

### 1. Generate an embed token (backend)

```javascript
const resp = await fetch('https://openseal.yourcompany.com/api/embed_tokens', {
  method: 'POST',
  headers: {
    'X-Auth-Token': API_TOKEN,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ user_email: 'admin@yourcompany.com' })
})

const { token } = await resp.json()
```

### 2. Render in your frontend

```html
<script src="https://openseal.yourcompany.com/js/docuseal.js"></script>

<!-- Create a new template -->
<docuseal-builder
  data-token="EMBED_TOKEN_FROM_BACKEND"
  data-host="https://openseal.yourcompany.com"
>
</docuseal-builder>

<!-- Edit an existing template -->
<docuseal-builder
  data-token="EMBED_TOKEN_FROM_BACKEND"
  data-host="https://openseal.yourcompany.com"
  data-template-id="16"
>
</docuseal-builder>
```

### 3. Listen for events

```javascript
document.addEventListener('docuseal:builder:save', (e) => {
  const templateId = e.detail.template_id
  // Save this template ID in your database for later use
  saveTemplateMappingToYourDB(templateId)
})
```

---

## Field Mapping

After creating a template (via API or embedded builder), set up a mapping in your app that connects template fields to your database columns.

### Database schema (your app)

```sql
CREATE TABLE document_template_configs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),                    -- "Offer Letter", "NDA", etc.
  openseal_template_id INTEGER NOT NULL, -- Template ID in OpenSeal
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE field_mappings (
  id SERIAL PRIMARY KEY,
  config_id INTEGER REFERENCES document_template_configs(id),
  openseal_field_name VARCHAR(255),     -- Field name in OpenSeal (e.g. "Full Name")
  source_model VARCHAR(255),            -- Your model (e.g. "Employee")
  source_column VARCHAR(255),           -- Your column (e.g. "full_name")
  default_value TEXT                     -- Fallback if column is null
);
```

### Admin configurator UI flow

1. Fetch template fields: `GET /api/templates/:id` → `response.fields[].name`
2. Show a form: for each field, let admin pick a DB column from a dropdown
3. Save mappings to your `field_mappings` table

### Fetching fields for the mapping UI

```javascript
const resp = await fetch(`${OPENSEAL_URL}/api/templates/${templateId}`, {
  headers: { 'X-Auth-Token': API_TOKEN }
})
const template = await resp.json()

for (const field of template.fields) {
  console.log(`Field: ${field.name} (type: ${field.type})`)
  // → "Full Name" (type: text)
  // → "Department" (type: select, options: Engineering, Marketing, Sales)
  // → "Signature" (type: signature)
}
```

---

## Sending for Signing

When a user triggers document generation (e.g., HR clicks "Send offer letter"):

### With email notification (signer completes via email link)

```javascript
async function sendOfferLetter(employee) {
  const config = await db.query(
    'SELECT * FROM document_template_configs WHERE name = $1',
    ['Offer Letter']
  )
  const mappings = await db.query(
    'SELECT * FROM field_mappings WHERE config_id = $1',
    [config.id]
  )

  // Build values from mappings
  const values = {}
  for (const m of mappings) {
    const val = employee[m.source_column] || m.default_value
    if (val) values[m.openseal_field_name] = val
  }

  const resp = await fetch(`${OPENSEAL_URL}/api/submissions`, {
    method: 'POST',
    headers: {
      'X-Auth-Token': API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      template_id: config.openseal_template_id,
      send_email: true, // Signer gets an email with signing link
      submitters: [
        {
          role: 'First Party',
          email: employee.email,
          name: employee.full_name,
          values // Pre-filled values appear on the form; signer reviews and signs
        }
      ]
    })
  })

  const [submitter] = await resp.json()
  const signingUrl = submitter.embed_src // Direct signing URL
  return submitter
}
```

---

## Generating Without Email

For documents that don't need a signer (e.g., auto-generating a filled contract for storage, payslips, certificates), use `send_email: false` + `completed: true`.

This fills in the values, generates the final PDF, and stores it — **no email sent, no signing form needed**.

```javascript
async function generateDocument(employee) {
  // Create submission with completed: true (no signing needed)
  const resp = await fetch(`${OPENSEAL_URL}/api/submissions`, {
    method: 'POST',
    headers: {
      'X-Auth-Token': API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      template_id: 16,
      send_email: false, // No email sent
      submitters: [
        {
          role: 'First Party',
          email: employee.email, // Required but no email is sent
          completed: true, // Mark as completed immediately
          values: {
            'Full Name': employee.fullName,
            Department: employee.department,
            'Start Date': employee.startDate
          }
        }
      ]
    })
  })

  const [submitter] = await resp.json()

  // Download generated PDF
  const docsResp = await fetch(
    `${OPENSEAL_URL}/api/submissions/${submitter.submission_id}/documents`,
    { headers: { 'X-Auth-Token': API_TOKEN } }
  )
  const docs = await docsResp.json()

  for (const doc of docs) {
    const pdf = await fetch(doc.url)
    const buffer = await pdf.arrayBuffer()
    fs.writeFileSync(`output/${doc.name}.pdf`, Buffer.from(buffer))
  }
}
```

### Two-step approach (create, then complete later)

```javascript
// Step 1: Create submission (not completed yet)
const resp = await fetch(`${OPENSEAL_URL}/api/submissions`, {
  method: 'POST',
  headers: {
    'X-Auth-Token': API_TOKEN,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    template_id: 16,
    send_email: false,
    submitters: [
      {
        role: 'First Party',
        email: 'employee@company.com',
        values: { 'Full Name': 'John Doe' } // Partial values
      }
    ]
  })
})

const submitterId = (await resp.json())[0].id

// Step 2: Later, add more values and mark complete
await fetch(`${OPENSEAL_URL}/api/submitters/${submitterId}`, {
  method: 'PUT',
  headers: {
    'X-Auth-Token': API_TOKEN,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    completed: true,
    values: {
      Department: 'Engineering',
      'Start Date': '2026-06-01'
    }
  })
})
```

---

## Downloading Documents

### Get all documents for a submission

```
GET /api/submissions/:submission_id/documents
```

```javascript
const resp = await fetch(
  `${OPENSEAL_URL}/api/submissions/${submissionId}/documents`,
  { headers: { 'X-Auth-Token': API_TOKEN } }
)

for (const doc of await resp.json()) {
  console.log(doc.name, doc.url)
}
```

### Get a merged single PDF

```
GET /api/submissions/:submission_id/documents?merge=true
```

### Get submission details (includes document URLs)

```
GET /api/submissions/:submission_id
```

Response includes `documents`, `audit_log_url`, `combined_document_url`, and per-submitter status.

---

## Webhooks

Set up webhooks at **Settings > Webhooks** to get notified when events occur.

### Events

| Event                 | Description                    |
| --------------------- | ------------------------------ |
| `form.viewed`         | Signer opened the signing form |
| `form.started`        | Signer began filling the form  |
| `form.completed`      | Signer completed and submitted |
| `form.declined`       | Signer declined to sign        |
| `template.created`    | A new template was created     |
| `template.updated`    | A template was modified        |
| `submission.created`  | A new submission was created   |
| `submission.archived` | A submission was archived      |

### Webhook payload example (form.completed)

```json
{
  "event_type": "form.completed",
  "timestamp": "2026-05-10T12:00:00Z",
  "data": {
    "id": 42,
    "slug": "abc123",
    "email": "signer@example.com",
    "status": "completed",
    "completed_at": "2026-05-10T12:00:00Z",
    "submission_id": 15,
    "values": [
      { "field": "Full Name", "value": "John Doe" },
      { "field": "Department", "value": "Engineering" }
    ],
    "documents": [{ "name": "offer_letter", "url": "https://..." }]
  }
}
```

### Using webhooks in your app

```javascript
// Express webhook handler
app.post('/webhooks/openseal', async (req, res) => {
  const payload = req.body

  if (payload.event_type === 'form.completed') {
    const submitter = payload.data
    const employee = await db.query(
      'SELECT * FROM employees WHERE email = $1',
      [submitter.email]
    )

    if (employee) {
      await db.query(
        'UPDATE employees SET document_status = $1, signed_at = $2 WHERE id = $3',
        ['signed', submitter.completed_at, employee.id]
      )

      // Download and store the signed documents
      for (const doc of submitter.documents) {
        await storeDocument(employee.id, doc.url, doc.name)
      }
    }
  }

  res.sendStatus(200)
})
```

---

## Full Examples

### Example 1: HRMS Offer Letter Flow

```javascript
const OPENSEAL_URL = process.env.OPENSEAL_URL
const API_TOKEN = process.env.OPENSEAL_API_TOKEN

// ── Admin configures once ──────────────────────────────

async function createTemplate(docxPath, name) {
  const fs = require('fs')
  const formData = new FormData()
  formData.append('file', new Blob([fs.readFileSync(docxPath)]), name + '.docx')
  formData.append('name', name)

  const resp = await fetch(`${OPENSEAL_URL}/api/templates/docx`, {
    method: 'POST',
    headers: { 'X-Auth-Token': API_TOKEN },
    body: formData
  })
  return (await resp.json()).id
}

async function getTemplateFields(templateId) {
  const resp = await fetch(`${OPENSEAL_URL}/api/templates/${templateId}`, {
    headers: { 'X-Auth-Token': API_TOKEN }
  })
  const template = await resp.json()
  return template.fields.map((f) => ({ name: f.name, type: f.type }))
}

// ── HR triggers per employee ───────────────────────────

function buildValues(employee, fieldMappings) {
  const values = {}
  for (const m of fieldMappings) {
    const val = employee[m.sourceColumn] ?? m.defaultValue
    if (val != null) values[m.fieldName] = String(val)
  }
  return values
}

async function sendForSigning(templateId, employee, fieldMappings) {
  const values = buildValues(employee, fieldMappings)

  const resp = await fetch(`${OPENSEAL_URL}/api/submissions`, {
    method: 'POST',
    headers: {
      'X-Auth-Token': API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      template_id: templateId,
      send_email: true,
      submitters: [
        {
          role: 'First Party',
          email: employee.email,
          name: `${employee.firstName} ${employee.lastName}`,
          values
        }
      ]
    })
  })

  return resp.json()
}

async function generateWithoutSigning(templateId, employee, fieldMappings) {
  const values = buildValues(employee, fieldMappings)

  const resp = await fetch(`${OPENSEAL_URL}/api/submissions`, {
    method: 'POST',
    headers: {
      'X-Auth-Token': API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      template_id: templateId,
      send_email: false,
      submitters: [
        {
          role: 'First Party',
          email: employee.email,
          completed: true,
          values
        }
      ]
    })
  })

  const [submitter] = await resp.json()
  return downloadDocuments(submitter.submission_id)
}

async function downloadDocuments(submissionId) {
  const resp = await fetch(
    `${OPENSEAL_URL}/api/submissions/${submissionId}/documents`,
    { headers: { 'X-Auth-Token': API_TOKEN } }
  )
  return resp.json()
}
```

### Example 2: Bulk Payslip Generation (no signing needed)

```javascript
async function generatePayslips(employees, templateId) {
  const results = []

  for (const emp of employees) {
    const resp = await fetch(`${OPENSEAL_URL}/api/submissions`, {
      method: 'POST',
      headers: {
        'X-Auth-Token': API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        template_id: templateId,
        send_email: false,
        submitters: [
          {
            role: 'First Party',
            email: emp.email,
            completed: true,
            values: {
              'Employee Name': emp.fullName,
              'Employee ID': emp.employeeId,
              Month: 'May 2026',
              'Basic Salary': `$${emp.basicSalary.toLocaleString()}`,
              Deductions: `$${emp.deductions.toLocaleString()}`,
              'Net Pay': `$${emp.netPay.toLocaleString()}`
            }
          }
        ]
      })
    })

    const [submitter] = await resp.json()
    results.push({
      employeeId: emp.id,
      submissionId: submitter.submission_id
    })
  }

  return results
}
```

### Example 3: Embedded Signing (React + Express)

React component:

```jsx
import { useState, useEffect } from 'react'

function SignDocument({ templateId, signerEmail, values }) {
  const [signingUrl, setSigningUrl] = useState(null)

  useEffect(() => {
    async function createSubmission() {
      const resp = await fetch('/api/internal/create-submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, signerEmail, values })
      })
      const data = await resp.json()
      setSigningUrl(data.signingUrl)
    }
    createSubmission()
  }, [templateId, signerEmail])

  if (!signingUrl) return <div>Loading...</div>

  return (
    <iframe
      src={signingUrl}
      style={{ width: '100%', height: '800px', border: 'none' }}
    />
  )
}
```

Express backend:

```javascript
app.post('/api/internal/create-submission', async (req, res) => {
  const { templateId, signerEmail, values } = req.body

  const resp = await fetch(`${OPENSEAL_URL}/api/submissions`, {
    method: 'POST',
    headers: {
      'X-Auth-Token': API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      template_id: templateId,
      send_email: false, // We're embedding, not emailing
      submitters: [
        {
          role: 'First Party',
          email: signerEmail,
          values: values || {}
        }
      ]
    })
  })

  const [submitter] = await resp.json()
  res.json({ signingUrl: submitter.embed_src })
})
```

Go backend:

```go
func createSubmissionHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TemplateID  int               `json:"templateId"`
		SignerEmail string            `json:"signerEmail"`
		Values      map[string]string `json:"values"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	body, _ := json.Marshal(map[string]any{
		"template_id": req.TemplateID,
		"send_email":  false,
		"submitters": []map[string]any{{
			"role":   "First Party",
			"email":  req.SignerEmail,
			"values": req.Values,
		}},
	})

	httpReq, _ := http.NewRequest("POST", os.Getenv("OPENSEAL_URL")+"/api/submissions",
		bytes.NewReader(body))
	httpReq.Header.Set("X-Auth-Token", os.Getenv("OPENSEAL_API_TOKEN"))
	httpReq.Header.Set("Content-Type", "application/json")

	resp, _ := http.DefaultClient.Do(httpReq)
	defer resp.Body.Close()

	var submitters []map[string]any
	json.NewDecoder(resp.Body).Decode(&submitters)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"signingUrl": submitters[0]["embed_src"].(string),
	})
}
```

---

## Quick Reference

| Use Case                            | Endpoint                             | `send_email` | `completed` |
| ----------------------------------- | ------------------------------------ | :----------: | :---------: |
| Send for signing via email          | `POST /api/submissions`              |    `true`    |    omit     |
| Get signing URL (embed in your app) | `POST /api/submissions`              |   `false`    |    omit     |
| Generate PDF without signing        | `POST /api/submissions`              |   `false`    |   `true`    |
| Update values before completion     | `PUT /api/submitters/:id`            |      —       |    omit     |
| Complete programmatically           | `PUT /api/submitters/:id`            |      —       |   `true`    |
| Download documents                  | `GET /api/submissions/:id/documents` |      —       |      —      |
| List templates                      | `GET /api/templates`                 |      —       |      —      |
| Get template fields                 | `GET /api/templates/:id`             |      —       |      —      |
