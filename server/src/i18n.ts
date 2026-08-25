import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../../config/locales');
const FALLBACK_LOCALE = 'en';

type Dict = Record<string, unknown>;

let cache: Map<string, Dict> | null = null;

function loadLocales(): Map<string, Dict> {
  if (cache) return cache;
  cache = new Map();
  const file = path.join(LOCALES_DIR, 'i18n.yml');
  if (!fs.existsSync(file)) return cache;
  const docs = yamlLoad(fs.readFileSync(file, 'utf8')) as Record<string, Dict>;
  for (const [locale, dict] of Object.entries(docs)) {
    cache.set(locale, (dict ?? {}) as Dict);
  }
  return cache;
}

export function availableLocales(): string[] {
  return [...loadLocales().keys()];
}

function lookup(dict: Dict, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Dict)) {
      node = (node as Dict)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

export function t(key: string, locale = FALLBACK_LOCALE, vars?: Record<string, string | number>): string {
  const dicts = loadLocales();
  let value = lookup(dicts.get(locale) ?? {}, key);
  if (value === undefined && locale !== FALLBACK_LOCALE) {
    value = lookup(dicts.get(FALLBACK_LOCALE) ?? {}, key);
  }
  if (value === undefined) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replaceAll(`%{${k}}`, String(v));
    }
  }
  return value;
}
