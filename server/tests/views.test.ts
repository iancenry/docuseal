import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import nunjucks from 'nunjucks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.resolve(__dirname, '../views');

let env: nunjucks.Environment;

beforeAll(() => {
  env = new nunjucks.Environment(new nunjucks.FileSystemLoader(VIEWS_DIR), { autoescape: true });
});

describe('generated icon macro', () => {
  const macroFile = path.join(VIEWS_DIR, 'partials/icons.njk');

  it('bakes 145 icons extracted from Rails partials', () => {
    expect(fs.existsSync(macroFile)).toBe(true);
    const source = fs.readFileSync(macroFile, 'utf8');
    expect(source).not.toContain('<%');
    expect((source.match(/"[a-z0-9_]+__c":"/g) ?? []).length).toBe(145);
  });

  it('renders a known icon with the given class', () => {
    const result = env.renderString(
      '{% import "partials/icons.njk" as icons %}{{ icons.icon("settings", "w-5 h-5") }}',
    );
    expect(result).toContain('<svg');
    expect(result).toContain('class="w-5 h-5"');
    expect(result).toContain('</svg>');
  });

  it('renders a placeholder comment for an unknown icon', () => {
    const result = env.renderString(
      '{% import "partials/icons.njk" as icons %}{{ icons.icon("nope") }}',
    );
    expect(result).toContain('unknown icon: nope');
  });
});

describe('njk pages', () => {
  it('base layout links built css or degrades gracefully', () => {
    const styled = env.renderString('{% extends "layouts/base.njk" %}', { webCssHref: '/assets/web.css' });
    expect(styled).toContain('href="/assets/web.css"');
    const unstyled = env.renderString('{% extends "layouts/base.njk" %}', { webCssHref: null });
    expect(unstyled).toContain('web/dist/web.css not found');
  });

  it('sign_in page posts to /sign_in and shows ?error= flash', () => {
    const html = env.render('sign_in.njk', { webCssHref: null, flashError: 'Invalid Email or password.' });
    expect(html).toContain('action="/sign_in"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('Invalid Email or password.');
    expect(html).toContain('/passwords/new');
  });

  it('dashboard fetches /templates client-side and stubs pagination', () => {
    const html = env.render('dashboard.njk', { webCssHref: '/assets/web.css' });
    expect(html).toContain("/templates?page='");
    expect(html).toContain('id="tpl-prev"');
    expect(html).toContain('id="tpl-next"');
  });
});
