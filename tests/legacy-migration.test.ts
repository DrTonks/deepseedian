import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, access, unlink, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrateLegacyData, legacyPluginEnabled } from '../src/plugin/legacy-migration.ts';
import { MemoryStore, encodeEntries, decodeEntries } from '../src/plugin/memory/store.ts';
async function fixture() {
  await mkdir('.runs', { recursive: true });
  const pluginsDirectory = await mkdtemp(resolve('.runs/rename-'));
  const destination = join(pluginsDirectory, 'deepseedian'), old = join(pluginsDirectory, 'deepsidian');
  await mkdir(old);
  return { pluginsDirectory, destination, old, legacyEnabled: false };
}
async function put(root: string, path: string, content: string) {
  const full = join(root, path); await mkdir(resolve(full, '..'), { recursive: true }); await writeFile(full, content);
}
test('identity migration copies settings, memory and sessions; excludes generated code and preserves originals', async () => {
  const f = await fixture();
  const entry = { id: randomUUID(), text: '偏好例子', source: 'explicit', createdAt: new Date().toISOString() };
  const legacy = encodeEntries([entry]).replaceAll('deepseedian-entry', 'deepsidian-entry');
  await put(f.old, 'data.json', JSON.stringify({ chats: [{ id: 'session-a' }], settings: { manageMemory: false } }));
  await put(f.old, 'memory/topics/general.md', legacy);
  await put(f.old, '.runtime/sessions/vault/a.json', '{"id":"session-a"}');
  await put(f.old, '.memory-runtime/sessions/vault/b.json', '{"id":"organizer-b"}');
  await put(f.old, '.runtime/attachments/v1/image-id', 'synthetic image');
  await put(f.old, '.memory-runtime/attachments/v1/organizer-id', 'synthetic organizer asset');
  await put(f.old, '.runtime/profiles/node_modules/stale.js', 'old');
  await put(f.old, '.runtime/bridge-old.mjs', 'old');
  await put(f.old, '.runtime/deepsidian.patch.json', 'old');
  assert.equal(await migrateLegacyData(f), 'migrated');
  assert.equal(await readFile(join(f.destination, 'data.json'), 'utf8'), await readFile(join(f.old, 'data.json'), 'utf8'));
  assert.deepEqual(decodeEntries(await readFile(join(f.destination, 'memory/topics/general.md'), 'utf8')), [entry]);
  assert.equal(await readFile(join(f.old, 'memory/topics/general.md'), 'utf8'), legacy);
  for (const path of ['.runtime/profiles', '.runtime/bridge-old.mjs', '.runtime/deepsidian.patch.json']) await assert.rejects(access(join(f.destination, path)));
  await access(join(f.destination, '.memory-runtime/sessions/vault/b.json'));
  assert.equal(await readFile(join(f.destination, '.runtime/attachments/v1/image-id'), 'utf8'), 'synthetic image');
  assert.equal(await readFile(join(f.destination, '.memory-runtime/attachments/v1/organizer-id'), 'utf8'), 'synthetic organizer asset');
  await writeFile(join(f.destination, 'data.json'), 'new session');
  assert.equal(await migrateLegacyData(f), 'already-migrated');
  assert.equal(await readFile(join(f.destination, 'data.json'), 'utf8'), 'new session');
});
test('old enabled plugin and independent destination data block all automatic imports', async () => {
  const f = await fixture(); await put(f.old, 'data.json', 'old');
  await assert.rejects(migrateLegacyData({ ...f, legacyEnabled: true }), /禁用旧版/);
  await put(f.destination, 'data.json', 'new');
  await assert.rejects(migrateLegacyData(f), /新旧插件都已有数据/);
  assert.equal(await readFile(join(f.destination, 'data.json'), 'utf8'), 'new');
  await put(f.pluginsDirectory, 'community-plugins.json', '["deepsidian"]');
  assert.equal(await legacyPluginEnabled(f.pluginsDirectory), true);
});
test('interrupted migration resumes byte-for-byte and refuses changed partial imports', async () => {
  const f = await fixture(); await put(f.old, 'data.json', 'old'); await put(f.old, 'memory/RULES.md', 'rules');
  await migrateLegacyData(f);
  await unlink(join(f.destination, '.legacy-import-complete.json'));
  await unlink(join(f.destination, 'memory/RULES.md'));
  assert.equal(await migrateLegacyData(f), 'migrated');
  assert.equal(await readFile(join(f.destination, 'memory/RULES.md'), 'utf8'), 'rules');
  await unlink(join(f.destination, '.legacy-import-complete.json'));
  await writeFile(join(f.destination, 'data.json'), 'edited');
  await assert.rejects(migrateLegacyData(f), /目标已被修改/);
  assert.equal(await readFile(join(f.destination, 'data.json'), 'utf8'), 'edited');
});
test('migration rejects escaping journal entries and active memory writer locks', async () => {
  const f = await fixture(); await put(f.old, 'memory/writer.lock', '{}');
  await assert.rejects(migrateLegacyData(f), /写入锁/);
  assert.deepEqual(await readdir(f.destination), []);
  await put(f.destination, '.legacy-import.json', JSON.stringify({ version: 1, stage: `.legacy-stage-${randomUUID()}`, items: [{ path: 'memory/../../outside', hash: 'a'.repeat(64) }] }));
  await assert.rejects(migrateLegacyData(f), /记录无效/);
});
test('legacy memory is readable, new saves use new markers, both marker families reject injection', async () => {
  const f = await fixture(); const store = new MemoryStore(join(f.old, 'memory'));
  let snapshot = await store.snapshot(); await store.update(snapshot.revision, { add: '旧偏好', source: 'explicit' });
  const path = join(f.old, 'memory/topics/general.md');
  await writeFile(path, (await readFile(path, 'utf8')).replaceAll('deepseedian-entry', 'deepsidian-entry'));
  snapshot = await store.snapshot(); assert.equal(snapshot.entries[0]?.text, '旧偏好');
  await store.update(snapshot.revision, { add: '新偏好', source: 'explicit' });
  assert.doesNotMatch(await readFile(path, 'utf8'), /deepsidian-entry/);
  snapshot = await store.snapshot();
  for (const marker of ['deepsidian', 'deepseedian']) await assert.rejects(store.update(snapshot.revision, { add: `<!-- ${marker}-entry -->`, source: 'explicit' }), /保留/);
});

test('resume refuses legacy changes after a prepared import', async () => {
  const f = await fixture(); await put(f.old, 'data.json', 'old');
  await migrateLegacyData(f); await unlink(join(f.destination, '.legacy-import-complete.json'));
  await put(f.old, 'data.json', 'new old session');
  await assert.rejects(migrateLegacyData(f), /旧版数据在迁移期间已改变/);
  assert.equal(await readFile(join(f.destination, 'data.json'), 'utf8'), 'old');
  assert.equal(await readFile(join(f.old, 'data.json'), 'utf8'), 'new old session');
});
