import Database from 'better-sqlite3';
import { BookStore, TemplateRegistry } from '@caiwu/core/server';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** 仅在服务正常退出后调用。借用现有 core 独占租约，不迁移或修改原账套。 */
export async function backupBeforeUpdate(dataDir: string, version: string): Promise<void> {
  const store = new BookStore({
    dataDir,
    exclusiveServer: true,
    templates: new TemplateRegistry({ devMode: false }),
    migrationSets: () => [],
  });
  try {
    const backupRoot = path.join(dataDir, 'backups');
    await mkdir(backupRoot, { recursive: true });
    if ((await lstat(backupRoot)).isSymbolicLink()) throw new Error('更新前备份目录不支持目录链接');
    const directory = path.join(backupRoot, `更新前-${randomUUID()}`);
    await mkdir(directory);
    const files: { file: string; sha256: string }[] = [];
    for (const name of await readdir(store.booksDir)) {
      if (!name.endsWith('.caiwu')) continue;
      const id = name.slice(0, -6);
      if (!BookStore.isValidId(id)) throw new Error('账套目录存在无法识别的账套文件，已停止更新');
      const file = store.pathOf(id);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw new Error('账套文件存在链接或类型异常，已停止更新');
      const raw = new Database(file, { readonly: true, fileMustExist: true });
      const snapshot = path.join(directory, name);
      try {
        await raw.backup(snapshot);
      } finally {
        raw.close();
      }
      const checked = new Database(snapshot, { readonly: true, fileMustExist: true });
      try {
        const foreignKeys = checked.pragma('foreign_key_check');
        if (
          checked.pragma('integrity_check', { simple: true }) !== 'ok' ||
          !Array.isArray(foreignKeys) ||
          foreignKeys.length
        )
          throw new Error('更新前账套备份校验失败');
        const info = checked.prepare('SELECT id FROM book_info WHERE id = 1').get();
        if (!info) throw new Error('更新前备份不是有效账套');
      } finally {
        checked.close();
      }
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(snapshot)) hash.update(chunk);
      files.push({ file: name, sha256: hash.digest('hex') });
    }
    await writeFile(
      path.join(directory, '备份清单.json.part'),
      JSON.stringify({
        schema: 1,
        beforeVersion: version,
        createdAt: new Date().toISOString(),
        files,
      }),
      { flag: 'wx', mode: 0o600 },
    );
    await rename(path.join(directory, '备份清单.json.part'), path.join(directory, '备份清单.json'));
    // 保留成功和失败备份，不裁剪或覆盖任何既有备份。
  } finally {
    await store.dispose();
  }
}

export async function prepareUpdateInstall(ops: {
  stop: () => Promise<boolean>;
  requested?: () => boolean;
  backup: () => Promise<void>;
  verify: () => Promise<void>;
  launch: () => Promise<void>;
}): Promise<boolean> {
  if (!(await ops.stop()) || ops.requested?.() === false) return false;
  await ops.backup();
  await ops.verify();
  await ops.launch();
  return true;
}
