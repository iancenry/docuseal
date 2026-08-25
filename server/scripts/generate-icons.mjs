#!/usr/bin/env node
// Scans the Rails icon partials (app/views/icons/_*.html.erb) and bakes them
// into server/views/partials/icons.njk as a single {% icon(name, cls) %} macro.
//
// Usage: node scripts/generate-icons.mjs   (run from server/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const iconsDir = path.join(root, 'app/views/icons');
const outFile = path.join(root, 'server/views/partials/icons.njk');

const files = fs.readdirSync(iconsDir).filter((f) => f.endsWith('.html.erb'));
const icons = {};

for (const file of files) {
  const name = file.replace(/^_/, '').replace(/\.html\.erb$/, '');
  // The class attribute holds ERB (<%= local_assigns[:class] %>); its `%>` would
  // break naive <svg> tag matching, so strip it first.
  const raw = fs
    .readFileSync(path.join(iconsDir, file), 'utf8')
    .replace(/\sclass="<%[\s\S]*?%>"/g, '');

  const openMatch = raw.match(/<svg([^>]*)>/);
  const closeIdx = raw.lastIndexOf('</svg>');
  if (!openMatch || closeIdx === -1) {
    console.warn(`[generate-icons] SKIP ${file}: no <svg> element found`);
    continue;
  }
  const attrs = openMatch[1].replace(/\sxmlns="[^"]*"/g, '').trim();

  const inner = raw.slice(openMatch.index + openMatch[0].length, closeIdx).trim();
  // The only ERB in these partials is the stripped class attribute above.
  if (inner.includes('<%')) {
    console.warn(`[generate-icons] SKIP ${file}: contains ERB logic inside markup`);
    continue;
  }

  icons[name] = { a: attrs, c: inner };
}

const names = Object.keys(icons).sort();
if (names.length === 0) {
  console.error('[generate-icons] No icons extracted; refusing to overwrite macro.');
  process.exit(1);
}

// Nunjucks {% set %} cannot parse NESTED dict literals ("parseAggregate" error),
// so the map is flattened: name__a -> svg attrs, name__c -> inner markup.
const flat = {};
for (const n of names) {
  flat[`${n}__a`] = icons[n].a;
  flat[`${n}__c`] = icons[n].c;
}
const json = JSON.stringify(flat);

const header = `{#
  GENERATED FILE — do not edit by hand.
  Source of truth: app/views/icons/_*.html.erb (Rails icon partials).
  Regenerate with: cd server && node scripts/generate-icons.mjs
#}
{% macro icon(name, cls = '') -%}
{%- set __icons = ${json} -%}
{%- set __a = __icons[name ~ '__a'] -%}
{%- set __c = __icons[name ~ '__c'] -%}
{%- if __c -%}
<svg{{ __a | safe }} class="{{ cls }}" aria-hidden="true">{{ __c | safe }}</svg>
{%- else -%}
<!-- unknown icon: {{ name }} -->
{%- endif -%}
{%- endmacro %}
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, header);
console.log(`[generate-icons] Wrote ${names.length} icons to ${path.relative(root, outFile)}`);
