// The signup page must not carry inline script.
//
// The mail host serves `script-src 'self' 'wasm-unsafe-eval'` — no 'unsafe-inline', no hash. The
// registration logic used to live in an inline module, so the browser blocked the whole thing and
// the page looked fine while being inert: the submit fell through to a native GET, which put the
// password in the URL, the browser history, the access log and the CSP report log, and no account
// was ever created. A same-origin file is covered by 'self', so the module lives in signup.js.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(root, 'public', 'signup.html'), 'utf8');

describe('signup page under the mail CSP', () => {
  it('loads its script same-origin instead of inline', () => {
    expect(html).toMatch(/<script type="module" src="\/signup\.js"><\/script>/);
    // Any inline <script> body (rather than an empty, external-only tag) would be blocked.
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    expect(inline).toEqual([]);
  });

  it('never puts credentials in the URL when the script cannot run', () => {
    // With JavaScript blocked there is no preventDefault, so a GET form would serialise the
    // password into the query string. A POST keeps it out of the URL even then.
    expect(html).toMatch(/<form id="f"[^>]*method="post"/);
    expect(html).toMatch(/<form id="r"[^>]*method="post"/);
    expect(html).not.toMatch(/<form id="f"[^>]*method="get"/);
  });

  it('tells a JavaScript-less visitor why nothing happens', () => {
    expect(html).toMatch(/<noscript>/);
  });

  it('keeps the flow the server enforces', () => {
    const js = readFileSync(path.join(root, 'public', 'signup.js'), 'utf8');
    // Proof of work is mandatory, and approval answers are not treated as success.
    expect(js).toMatch(/\/api\/signup\/challenge/);
    expect(js).toMatch(/pow_challenge/);
    expect(js).toMatch(/res\.status === 202/);
    expect(js).not.toMatch(/window\.location\.href = '\/login';?\s*\n\s*\}\s*\n\s*\/\/ 202/);
  });
});
