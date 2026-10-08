// Syntax-check every JS file (node --check) and import every library module to catch missing/renamed exports,
// which would otherwise only fail in the browser. Page modules touch the DOM at import time, so they are
// exercised by the browser smoke test instead.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') || p.endsWith('.mjs') ? [p] : [];
});

const files = [...walk(join(root, 'site/assets/js')), ...walk(join(root, 'tests')), ...walk(join(root, 'scripts'))];
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    failed += 1;
    console.error(`SYNTAX ${f}\n${e.stderr}`);
  }
}
for (const f of walk(join(root, 'site/assets/js/lib')).concat(join(root, 'site/assets/js/config.js'))) {
  try {
    await import(pathToFileURL(f).href);
  } catch (e) {
    failed += 1;
    console.error(`IMPORT ${f}: ${e.message}`);
  }
}
console.log(`${files.length} files checked, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
