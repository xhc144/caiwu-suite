import { constants, createWriteStream, type BigIntStats } from 'node:fs';
import { lstat, mkdir, open, realpath, rm, statfs, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { BusinessError } from '@caiwu/core';
import { coreMigrations } from '@caiwu/core/server';
import type { AppRuntime } from '@caiwu/server-kit';
import {
  DirectorySchema,
  IdSchema,
  MetadataSchema,
  TRANSFER_LIMIT,
  type BackupMetadata,
} from '../shared';

export const MAGIC = Buffer.from('CAIWUBK1');
export const MAX_LOCAL = 1024 * 1024 * 1024;
export const fail = (code: string, message: string, hint = '请检查备份文件或目录后重试') =>
  new BusinessError({ code: `BACKUP_${code}`, message, hint });
export function fileError(error: unknown): BusinessError {
  if (error instanceof BusinessError) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  const reason =
    code === 'ENOSPC'
      ? '磁盘空间不足'
      : code === 'EACCES' || code === 'EPERM'
        ? '目录不可写或无读取权限'
        : code === 'ELOOP'
          ? '文件或目录是符号链接'
          : code === 'ENOENT'
            ? '文件或目录不存在'
            : '文件读写或 SQLite 校验失败';
  return fail('IO', reason, '请检查可用空间、目录权限和文件完整性；原账套未被覆盖');
}
export async function directory(dataDir: string, owner: string, name: string) {
  IdSchema.parse(owner);
  DirectorySchema.parse(name);
  let dir = await realpath(dataDir);
  for (const segment of ['backups', owner, name]) {
    dir = path.join(dir, segment);
    await mkdir(dir, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'EEXIST') throw e;
    });
    const s = await lstat(dir);
    if (!s.isDirectory() || s.isSymbolicLink())
      throw fail('PATH', '受管备份目录不能是符号链接或普通文件');
  }
  return dir;
}
export async function probeDirectory(dir: string, required = 0) {
  const space = await statfs(dir);
  if (space.bavail * space.bsize < required) throw fail('SPACE', '磁盘空间不足，无法保存完整备份');
  const file = path.join(dir, `.${randomUUID()}.probe`);
  const h = await open(file, 'wx', 0o600);
  await h.close();
  await rm(file);
}
export function packagePath(dir: string, id: string) {
  return path.join(dir, `${IdSchema.parse(id)}.caiwubak`);
}
function requireRegular(s: BigIntStats) {
  if (s.isSymbolicLink()) throw fail('FILE', '受管备份文件不能是符号链接');
  if (!s.isFile() || s.size > BigInt(MAX_LOCAL + 1024 * 1024) || s.nlink !== 1n || s.ino <= 0n)
    throw fail('FILE', '备份不是可核对身份的受管普通文件或文件过大');
}
function sameFile(expected: BigIntStats, actual: BigIntStats) {
  requireRegular(actual);
  if (
    expected.dev !== actual.dev ||
    expected.ino !== actual.ino ||
    expected.size !== actual.size ||
    expected.mtimeNs !== actual.mtimeNs ||
    expected.ctimeNs !== actual.ctimeNs
  )
    throw fail('CHANGED', '受管备份文件在读取期间被替换或修改');
}
/**
 * lstat 在打开前拒绝链接；没有 O_NOFOLLOW 的平台也必须核对路径和句柄身份。
 * 回调只读同一句柄，完成后再次核对。此检查不能隔离拥有目录写权限的本地进程，
 * 也不声称消除目录替换、同 inode 写入等所有本地竞态。
 */
export async function withRegularFile<T>(
  file: string,
  read: (handle: FileHandle, info: BigIntStats) => Promise<T>,
) {
  const before = await lstat(file, { bigint: true });
  requireRegular(before);
  const h = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const unchanged = async () => {
      sameFile(before, await h.stat({ bigint: true }));
      sameFile(before, await lstat(file, { bigint: true }));
    };
    await unchanged();
    const result = await read(h, before);
    await unchanged();
    return result;
  } finally {
    await h.close();
  }
}
export async function regularFile(file: string) {
  return withRegularFile(file, async (_h, info) => info);
}
async function* chunks(h: FileHandle, start: number, end: number) {
  for (let position = start; position < end;) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, end - position));
    const { bytesRead } = await h.read(buffer, 0, buffer.length, position);
    if (!bytesRead) throw fail('CHANGED', '受管备份文件在读取期间被截短');
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}
export async function hashFile(file: string, start = 0) {
  return withRegularFile(file, async (h, info) => {
    const hash = createHash('sha256');
    for await (const part of chunks(h, start, Number(info.size))) hash.update(part);
    return hash.digest('hex');
  });
}
export function migrationList(app: AppRuntime) {
  return [{ scope: 'core', migrations: coreMigrations }, ...app.modules.migrationSets()]
    .flatMap((s) =>
      s.migrations.map((m) => ({
        scope: s.scope,
        id: m.id,
        checksum: createHash('sha256').update(m.sql.replace(/\r\n/g, '\n').trim()).digest('hex'),
      })),
    )
    .sort((a, b) =>
      a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
}
export function inspectSqlite(file: string, app: AppRuntime, expected?: BackupMetadata) {
  const raw = new Database(file, { readonly: true, fileMustExist: true });
  try {
    raw.pragma('trusted_schema = OFF');
    raw.pragma('query_only = ON');
    const badSchema = raw
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type IN ('trigger','view') OR upper(sql) LIKE '%CREATE VIRTUAL TABLE%' LIMIT 1",
      )
      .get();
    if (badSchema) throw fail('SCHEMA', '备份包含本版本未支持的触发器、视图或虚拟表');
    const integrity = raw.pragma('integrity_check') as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok')
      throw fail('INTEGRITY', 'SQLite 完整性检查未通过');
    const required = [
      'book_info',
      'book_setting',
      'app_user',
      'user_permission',
      'period',
      'account',
      'voucher',
      'voucher_line',
      'operation_log',
      '_migration',
    ];
    const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as {
      name: string;
    }[];
    for (const name of required)
      if (!tables.some((t) => t.name === name)) throw fail('CORE_TABLE', `备份缺少核心表：${name}`);
    if ((raw.pragma('foreign_key_check') as unknown[]).length)
      throw fail('FOREIGN_KEY', '备份的关联数据不完整');
    const b = raw.prepare('SELECT * FROM book_info WHERE id = 1').get() as
      | {
          book_id: string;
          name: string;
          org_name: string;
          product: string;
          regime: string;
          template_id: string;
          template_version: string;
          start_period: number;
        }
      | undefined;
    if (!b || (raw.prepare('SELECT count(*) AS n FROM book_info').get() as { n: number }).n !== 1)
      throw fail('METADATA', '备份缺少唯一的账套元信息');
    const period = raw
      .prepare(
        "SELECT period FROM period ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, CASE status WHEN 'open' THEN period ELSE -period END LIMIT 1",
      )
      .get() as { period: number } | undefined;
    if (!period) throw fail('PERIOD', '备份缺少会计期间');
    const book = {
      id: b.book_id,
      name: b.name,
      orgName: b.org_name,
      product: b.product,
      regime: b.regime,
      templateId: b.template_id,
      templateVersion: b.template_version,
      startPeriod: b.start_period,
      currentPeriod: period.period,
    };
    const migrations = raw
      .prepare('SELECT scope, id, checksum FROM _migration ORDER BY scope,id')
      .all() as BackupMetadata['migrations'];
    const installed = migrationList(app);
    if (JSON.stringify(migrations) !== JSON.stringify(installed))
      throw fail(
        'MIGRATION',
        '备份迁移版本与已安装模块不兼容',
        '请使用具有相同模块和迁移版本的应用；预览不会升级备份',
      );
    if (
      expected &&
      (JSON.stringify(book) !== JSON.stringify(expected.book) ||
        JSON.stringify(migrations) !== JSON.stringify(expected.migrations))
    )
      throw fail('METADATA', '包元数据与 SQLite 内的账套信息或迁移版本不一致');
    return { book, migrations };
  } finally {
    raw.close();
  }
}
export async function writePackage(
  snapshot: string,
  destination: string,
  metadata: BackupMetadata,
) {
  const json = Buffer.from(JSON.stringify(metadata));
  const header = Buffer.alloc(12);
  MAGIC.copy(header);
  header.writeUInt32BE(json.length, 8);
  const out = await open(destination, 'wx', 0o600);
  try {
    await out.writeFile(Buffer.concat([header, json]));
    await withRegularFile(snapshot, async (h, info) => {
      for await (const part of chunks(h, 0, Number(info.size))) await out.writeFile(part);
    });
    await out.sync();
  } finally {
    await out.close();
  }
}
export async function validatePackage(file: string, app: AppRuntime, includeContent = false) {
  const snapshot = path.join(path.dirname(file), `.${randomUUID()}.checking`);
  try {
    return await withRegularFile(file, async (h, info) => {
      const size = Number(info.size);
      if (includeContent && size > TRANSFER_LIMIT)
        throw fail('TRANSFER_SIZE', '备份超过浏览器传输上限 32 MiB');
      const head = Buffer.alloc(12);
      if ((await h.read(head, 0, 12, 0)).bytesRead !== 12 || !head.subarray(0, 8).equals(MAGIC))
        throw fail('FORMAT', '不是新版可携带备份包；原版 SQL Anywhere .bak 暂不支持');
      const length = head.readUInt32BE(8);
      const offset = 12 + length;
      if (length < 2 || length > 1024 * 1024 || offset >= size)
        throw fail('MANIFEST', '备份元数据缺失、过大或文件未完成');
      const json = Buffer.alloc(length);
      await h.read(json, 0, length, 12);
      let parsed: unknown;
      try {
        parsed = JSON.parse(json.toString('utf8'));
      } catch {
        throw fail('MANIFEST', '备份元数据不是有效 JSON');
      }
      const result = MetadataSchema.safeParse(parsed);
      if (!result.success) throw fail('VERSION', '备份格式版本不兼容或缺少必要元数据');
      const metadata = result.data;
      const version = (v: string) =>
        /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(v)?.slice(1).map(Number);
      const sourceVersion = version(metadata.appVersion);
      const currentVersion = version(app.version);
      if (
        !sourceVersion ||
        !currentVersion ||
        sourceVersion.some(
          (n, i) =>
            n > currentVersion[i]! &&
            sourceVersion.slice(0, i).every((p, j) => p === currentVersion[j]),
        )
      )
        throw fail(
          'APP_VERSION',
          '备份来自更新或无法识别的应用版本',
          '请在相同或更新且迁移版本兼容的应用中恢复',
        );
      if (size - offset !== metadata.length) throw fail('LENGTH', '备份长度不符，文件可能未完成');
      const sqliteHeader = Buffer.alloc(16);
      await h.read(sqliteHeader, 0, 16, offset);
      if (!sqliteHeader.equals(Buffer.from('SQLite format 3\0')))
        throw fail('HEADER', '备份内容不是 SQLite 数据库');
      const digest = createHash('sha256');
      const payloadDigest = createHash('sha256');
      const content = includeContent ? Buffer.alloc(size) : undefined;
      await pipeline(
        (async function* () {
          let position = 0;
          for await (const part of chunks(h, 0, size)) {
            digest.update(part);
            content?.set(part, position);
            const payload = part.subarray(Math.max(0, offset - position));
            position += part.length;
            if (payload.length) {
              payloadDigest.update(payload);
              yield payload;
            }
          }
        })(),
        createWriteStream(snapshot, { flags: 'wx', mode: 0o600 }),
      );
      if (payloadDigest.digest('hex') !== metadata.sha256)
        throw fail('DIGEST', '备份 SHA-256 摘要不符，文件已损坏或被修改');
      inspectSqlite(snapshot, app, metadata);
      return { metadata, snapshot, digest: digest.digest('hex'), bytes: size, content };
    });
  } catch (e) {
    await rm(snapshot, { force: true });
    throw e;
  }
}
