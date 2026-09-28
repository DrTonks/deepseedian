import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

test('source export preserves check configuration and release version metadata', { timeout: 30000 }, async () => {
  // Export must be outside the checkout. Keep uniquely named fixtures in its
  // sibling .runs directory; never overwrite or remove an existing export.
  const runs = resolve('..', '.runs');
  await mkdir(runs, { recursive: true });
  const fixture = await mkdtemp(join(runs, 'source-export-'));
  const destination = join(fixture, 'export');
  await promisify(execFile)(process.execPath, ['scripts/package-source.mjs', destination]);

  for (const file of ['eslint.config.mjs', 'tsconfig.json', 'package.json', 'package-lock.json', 'manifest.json', 'versions.json', '.github/workflows/ci.yml']) {
    assert.deepEqual(await readFile(join(destination, file)), await readFile(file), `${file} must survive source export`);
  }
  const pkg = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.check, /npm run lint/);
  assert.equal(pkg.scripts.lint, 'eslint src/plugin');
  const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
  const versions = JSON.parse(await readFile(join(destination, 'versions.json'), 'utf8'));
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  const files = await readdir(destination);
  for (const excluded of ['node_modules', '.runs', '.git', 'dist', 'data.json']) {
    assert.ok(!files.includes(excluded), `${excluded} must remain private/local`);
  }
  await assert.rejects(promisify(execFile)(process.execPath, ['scripts/package-source.mjs', destination]), /already exists/);
});
