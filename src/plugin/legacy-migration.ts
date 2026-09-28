import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';

// The legacy identifier is used only for one-way import, never as the new plugin identity.
const LEGACY_ID = 'deepsidian';
const ROOTS = ['data.json', 'memory', '.runtime/sessions', '.runtime/attachments', '.runtime/.anonymous-user-id', '.memory-runtime/sessions', '.memory-runtime/attachments', '.memory-runtime/.anonymous-user-id'];
const PENDING = '.legacy-import.json';
const DONE = '.legacy-import-complete.json';
type Item = { path: string; hash: string };
type Pending = { version: 1; stage: string; items: Item[] };
async function exists(path: string) {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function safe(root: string, path = '') {
  const full = resolve(root, path), rel = relative(resolve(root), full);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('迁移路径越界');
  for (const part of [root, ...rel.split(/[\\/]/).filter(Boolean).map((_, i, parts) => join(root, ...parts.slice(0, i + 1)))]) {
    try { if ((await lstat(part)).isSymbolicLink()) throw Error('迁移目录不允许符号链接'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return full;
}
const hash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
async function publishText(path: string, text: string) {
  const temporary = join(dirname(path), `.import-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }
}
function allowed(path: string) {
  return !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..') && ROOTS.some(root => path === root || path.startsWith(root + '/'));
}
async function inventory(root: string, path: string, items: Item[]) {
  const full = await safe(root, path);
  if (!await exists(full)) return;
  const stat = await lstat(full);
  if (stat.isDirectory()) {
    for (const name of (await readdir(full)).sort()) await inventory(root, `${path}/${name}`, items);
  } else if (stat.isFile()) {
    if (/^writer\.lock(?:\.guard)?$/.test(path.split('/').at(-1)!)) throw Error('旧版记忆仍有写入锁；请先关闭旧版并确认锁已释放');
    items.push({ path, hash: await hash(full) });
  } else throw Error('迁移遇到不支持的文件类型');
}

/** Copy-only, resumable import. Never merges independent stores or deletes legacy data. */
export async function migrateLegacyData(options: { pluginsDirectory: string; destination: string; legacyEnabled: boolean }): Promise<'none' | 'migrated' | 'already-migrated'> {
  if (options.legacyEnabled) throw Error('请先在第三方插件中禁用旧版插件，再启用 Deepseedian，以免两个版本同时写入');
  const parent = resolve(options.pluginsDirectory), destination = resolve(options.destination);
  if (dirname(destination) !== parent || destination === join(parent, LEGACY_ID)) throw Error('新插件安装目录无效');
  await safe(parent);
  const source = await safe(parent, LEGACY_ID);
  await safe(parent, relative(parent, destination));
  await mkdir(destination, { recursive: true });
  const donePath = await safe(destination, DONE);
  if (await exists(donePath)) {
    const done = JSON.parse(await readFile(donePath, 'utf8')) as { version?: number; importedAt?: string; files?: number };
    if (done.version !== 1 || typeof done.importedAt !== 'string' || !Number.isSafeInteger(done.files)) throw Error('迁移完成记录无效；请保留数据并检查记录');
    return 'already-migrated';
  }
  const pendingPath = await safe(destination, PENDING);
  let pending: Pending;
  if (await exists(pendingPath)) {
    pending = JSON.parse(await readFile(pendingPath, 'utf8')) as Pending;
    if (pending.version !== 1 || !/^\.legacy-stage-[\da-f-]{36}$/.test(pending.stage) || !Array.isArray(pending.items) || pending.items.some(item => !item || typeof item.path !== 'string' || !allowed(item.path) || !/^[a-f\d]{64}$/.test(item.hash)) || new Set(pending.items.map(item => item.path)).size !== pending.items.length) throw Error('迁移记录无效；请保留两份数据并检查记录');
  } else {
    if (!await exists(source)) return 'none';
    const items: Item[] = [];
    for (const root of ROOTS) await inventory(source, root, items);
    if (!items.length) return 'none';
    for (const root of ROOTS) if (await exists(await safe(destination, root))) throw Error('新旧插件都已有数据，已停止自动迁移；两份数据均保留，请先备份并选择要使用的数据');
    pending = { version: 1, stage: `.legacy-stage-${randomUUID()}`, items };
    const stage = await safe(destination, pending.stage);
    await mkdir(stage);
    for (const item of items) {
      const staged = await safe(stage, item.path);
      await mkdir(dirname(staged), { recursive: true });
      await copyFile(await safe(source, item.path), staged, constants.COPYFILE_EXCL);
      if (await hash(staged) !== item.hash || await hash(await safe(source, item.path)) !== item.hash) throw Error('迁移期间旧数据发生变化；已停止，请关闭旧版后重试');
    }
    const verified: Item[] = [];
    for (const root of ROOTS) await inventory(source, root, verified);
    if (JSON.stringify(verified) !== JSON.stringify(items)) throw Error('迁移期间旧数据发生变化；已停止，请关闭旧版后重试');
    await publishText(pendingPath, JSON.stringify(pending));
  }
  const stage = await safe(destination, pending.stage);
  const currentSource: Item[] = [];
  for (const root of ROOTS) await inventory(source, root, currentSource);
  if (JSON.stringify(currentSource) !== JSON.stringify(pending.items)) throw Error('旧版数据在迁移期间已改变，已停止；请保留两份数据并重新选择迁移来源');
  // Validate every destination before resuming any copy; changed partial imports must not be overwritten.
  for (const item of pending.items) {
    const target = await safe(destination, item.path);
    if (await hash(await safe(stage, item.path)) !== item.hash) throw Error('迁移暂存数据已改变，已停止');
    if (await exists(target) && await hash(target) !== item.hash) throw Error('迁移目标已被修改，已停止；不会覆盖已有数据');
  }
  for (const item of pending.items) {
    const target = await safe(destination, item.path);
    if (!await exists(target)) {
      await mkdir(dirname(target), { recursive: true });
      // Publish complete bytes without replacing a file another process created meanwhile.
      const temporary = join(dirname(target), `.import-${randomUUID()}.tmp`);
      try {
        await copyFile(await safe(stage, item.path), temporary, constants.COPYFILE_EXCL);
        await link(temporary, target);
      } finally {
        await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      }
    }
  }
  // Keep the import manifest/staging as a recovery snapshot; old files remain untouched.
  await publishText(await safe(destination, DONE), JSON.stringify({ version: 1, importedAt: new Date().toISOString(), files: pending.items.length }));
  return 'migrated';
}

export async function legacyPluginEnabled(configDirectory: string): Promise<boolean> {
  const file = join(configDirectory, 'community-plugins.json');
  if (!await exists(file)) return false;
  const ids: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw Error('无法读取已启用插件列表，已停止迁移');
  return ids.includes(LEGACY_ID);
}
