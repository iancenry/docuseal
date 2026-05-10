# HTML Template API

Create document templates by sending HTML instead of uploading PDFs.

## Endpoint

```
POST /api/templates/html
```

## Authentication

Include your API key in the `X-Auth-Token` header.

## Parameters

| Parameter     | Type   | Required | Description                                  |
| ------------- | ------ | -------- | -------------------------------------------- |
| `html`        | string | Yes      | HTML content with optional `{{field}}` tags  |
| `name`        | string | No       | Template name (defaults to "Untitled")       |
| `css`         | string | No       | Custom CSS styles injected into the document |
| `external_id` | string | No       | Your own ID for the template                 |
| `folder_name` | string | No       | Folder to place the template in              |

## Field Tag Syntax

Embed field placeholders in your HTML using double curly braces:

```
{{Field Name}}              → text field
{{Field Name|type}}         → typed field
{{Field Name|select|A,B,C}} → select/radio/multiple with options
```

### Supported Field Types

| Type        | Tag Example                         | Notes                     |
| ----------- | ----------------------------------- | ------------------------- |
| `text`      | `{{Full Name}}` or `{{Name\|text}}` | Default type              |
| `date`      | `{{Start Date\|date}}`              |                           |
| `signature` | `{{Signature\|signature}}`          | Renders as a larger area  |
| `initials`  | `{{Initials\|initials}}`            | Renders as a larger area  |
| `checkbox`  | `{{I Agree\|checkbox}}`             | Not required by default   |
| `image`     | `{{Photo\|image}}`                  | Renders as a larger area  |
| `stamp`     | `{{Stamp\|stamp}}`                  | Not required by default   |
| `select`    | `{{Dept\|select\|Eng,Sales,HR}}`    | Options after second `\|` |
| `radio`     | `{{Choice\|radio\|A,B,C}}`          | Options after second `\|` |
| `multiple`  | `{{Skills\|multiple\|JS,Ruby,Go}}`  | Multi-select options      |
| `number`    | `{{Amount\|number}}`                |                           |
| `phone`     | `{{Phone\|phone}}`                  |                           |
| `file`      | `{{Upload\|file}}`                  |                           |
| `cells`     | `{{Code\|cells}}`                   |                           |
| `payment`   | `{{Payment\|payment}}`              |                           |

## Examples

### Basic Template

```bash
curl -X POST http://localhost:4000/api/templates/html \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Agreement</h1><p>I, {{Full Name}}, agree to the terms.</p><p>Date: {{Date|date}}</p><p>{{Signature|signature}}</p>",
    "name": "Simple Agreement"
  }'
```

### With Custom CSS

```bash
curl -X POST http://localhost:4000/api/templates/html \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Invoice #1234</h1><table><tr><td>Item</td><td>Amount</td></tr><tr><td>Service</td><td>{{Amount}}</td></tr></table><p>Authorized: {{Signature|signature}}</p>",
    "name": "Invoice",
    "css": "h1 { color: #2563eb; } table { width: 100%; border-collapse: collapse; } td { border: 1px solid #ccc; padding: 8px; }"
  }'
```

### Select Field with Options

```bash
curl -X POST http://localhost:4000/api/templates/html \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<p>Department: {{Department|select|Engineering,Marketing,Sales,HR}}</p>",
    "name": "Department Form"
  }'
```

### Full Document with All Field Types

```bash
curl -X POST http://localhost:4000/api/templates/html \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>Employment Agreement</h1><p>Employee: {{Full Name}}</p><p>Position: {{Job Title|text}}</p><p>Department: {{Department|select|Engineering,Marketing,Sales,HR,Finance}}</p><p>Start Date: {{Start Date|date}}</p><p>Accept Terms: {{I Agree|checkbox}}</p><p>Signature: {{Signature|signature}}</p>",
    "name": "Employment Agreement",
    "css": "h1 { color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 8px; } p { line-height: 1.8; }"
  }'
```

### Full HTML Document (no wrapping applied)

If your HTML includes an `<html>` tag, it is rendered as-is without any default wrapping or styles:

```bash
curl -X POST http://localhost:4000/api/templates/html \
  -H "X-Auth-Token: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<!DOCTYPE html><html><head><style>body { font-family: Georgia; margin: 60px; }</style></head><body><h1>Contract</h1><p>Name: {{Name}}</p></body></html>",
    "name": "Custom Styled Contract"
  }'
```

## Response

Returns the created template in the same format as `GET /api/templates/:id`:

```json
{
  "id": 10,
  "name": "Employment Agreement",
  "fields": [
    {
      "uuid": "...",
      "name": "Full Name",
      "type": "text",
      "required": true,
      "areas": [{ "page": 0, "x": 0.19, "y": 0.16, "w": 0.15, "h": 0.02 }]
    }
  ],
  "documents": [
    {
      "id": 33,
      "url": "http://localhost:4000/file/.../employment-agreement.pdf",
      "preview_image_url": "http://localhost:4000/file/.../0.png",
      "filename": "employment-agreement.pdf"
    }
  ],
  "submitters": [{ "name": "First Party", "uuid": "..." }],
  "source": "api",
  "created_at": "2026-05-10T09:24:17.878Z"
}
```

## Error Responses

| Status | Body                                               | Cause                       |
| ------ | -------------------------------------------------- | --------------------------- |
| 401    | `{"error": "Not authenticated"}`                   | Missing/invalid API key     |
| 422    | `{"error": "HTML content is required"}`            | Empty `html` parameter      |
| 422    | `{"error": "HTML content exceeds 2MB limit"}`      | HTML too large              |
| 422    | `{"error": "Failed to create template from HTML"}` | Server-side rendering error |

## How It Works

1. **Parse** — `{{field|type}}` tags are extracted from the HTML and replaced with invisible marker `<span>` elements
2. **Render** — Puppeteer (headless Chromium) renders the HTML to a PDF at A4 dimensions
3. **Detect** — Field positions are captured via `getBoundingClientRect()` before PDF generation
4. **Store** — The PDF is saved via Active Storage and preview images are generated
5. **Map** — CSS pixel coordinates are converted to normalized PDF coordinates (0–1 range) for field placement

## Security

- **SSRF protection** — All external network requests (images, scripts, stylesheets) are blocked during rendering. Only `data:` URIs are allowed.
- **Timeout** — Rendering is capped at 60 seconds to prevent resource exhaustion.
- **Size limit** — HTML input is limited to 2MB.
- **Error messages** — Internal errors return a generic message in production; details are logged to Rollbar.
