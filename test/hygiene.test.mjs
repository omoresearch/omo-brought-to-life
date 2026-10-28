// Repo hygiene: no secrets, no machine paths, and the README's abilities
// table matches the tools the body really serves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODY_TOOLS } from '../body/body.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'logs']);
const TEXT = /\.(m?js|json|md|py|sh|ya?ml|html|java|patch|txt)$/;

function files(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (TEXT.test(name) && name !== 'package-lock.json') out.push(full);
  }
  return out;
}

const SECRET = [
  /\bgh[opsu]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bsk-[A-Za-z0-9_-]{20,}/, // OpenAI-style keys
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, // JWTs
  /Bearer [A-Za-z0-9._-]{20,}/, // literal bearer tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

test('no secrets or tokens in tracked text files', () => {
  for (const file of files()) {
    if (file === fileURLToPath(import.meta.url)) continue;
    const text = readFileSync(file, 'utf8');
    for (const re of SECRET) assert.doesNotMatch(text, re, `${path.relative(ROOT, file)} matches ${re}`);
  }
});

test('no machine-specific home paths', () => {
  for (const file of files()) {
    if (file === fileURLToPath(import.meta.url)) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\/home\/[a-z]+\//, path.relative(ROOT, file));
  }
});

test('every body tool is documented in the README abilities table, and nothing more', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const documented = new Set([...readme.matchAll(/`(body_[a-z_]+)`/g)].map((m) => m[1]));
  const served = BODY_TOOLS.map((t) => t.name);
  for (const name of served) assert.ok(documented.has(name), `${name} missing from README`);
  for (const name of documented) assert.ok(served.includes(name), `README lists ${name}, which the body does not serve`);
});
