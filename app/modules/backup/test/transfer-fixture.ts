import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MetadataSchema } from '../shared';
import { hashFile, MAGIC, writePackage } from '../server/files';

/** 只给测试使用：给有效包的 JSON 元数据补合法空白，精确覆盖整个文件的 MiB 边界。 */
export function padPortablePackage(bytes: Buffer, targetBytes: number): Buffer {
  if (!bytes.subarray(0, 8).equals(MAGIC)) throw new Error('测试前置不是有效备份包');
  const offset = 12 + bytes.readUInt32BE(8);
  const json = Buffer.from(
    JSON.stringify(MetadataSchema.parse(JSON.parse(bytes.subarray(12, offset).toString()))),
  );
  const snapshot = bytes.subarray(offset);
  const jsonLength = targetBytes - 12 - snapshot.length;
  if (jsonLength < json.length || jsonLength > 1024 * 1024)
    throw new Error('测试备份与边界大小相差过大');
  const header = Buffer.alloc(12);
  MAGIC.copy(header);
  header.writeUInt32BE(jsonLength, 8);
  return Buffer.concat([header, json, Buffer.alloc(jsonLength - json.length, 32), snapshot]);
}

/**
 * HTTP 测试的账套由真实服务创建；仅在本地临时文件里加入大设置值，
 * 再由 SQLite online backup 和生产打包函数生成可校验包，不增加造数 API。
 */
export async function largePortableFixture(seed: Buffer, targetBytes: number, dir: string) {
  const offset = 12 + seed.readUInt32BE(8);
  const metadata = MetadataSchema.parse(JSON.parse(seed.subarray(12, offset).toString()));
  const source = path.join(dir, 'source.caiwu');
  const snapshot = path.join(dir, 'snapshot.caiwu');
  const packed = path.join(dir, 'fixture.caiwubak');
  await writeFile(source, seed.subarray(offset), { flag: 'wx', mode: 0o600 });
  const raw = new Database(source);
  try {
    const pageSize = raw.pragma('page_size', { simple: true }) as number;
    const setting = raw.prepare(
      'INSERT INTO book_setting(scope,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    );
    // seed 包含实际已加载模块的全部 schema/数据，不能假定它小于固定预留空间。
    let fillerBytes = Math.max(0, targetBytes - seed.length - pageSize);
    let fits = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      setting.run(
        'backup',
        'transferFixture',
        JSON.stringify('x'.repeat(fillerBytes)),
        new Date().toISOString(),
      );
      // 缩短填充值时也回收溢出页，让下一次测量反映真实占用，而非 freelist。
      raw.exec('VACUUM');
      const length = (raw.pragma('page_count', { simple: true }) as number) * pageSize;
      const manifestBytes = Buffer.byteLength(JSON.stringify({ ...metadata, length }));
      const spareBytes = targetBytes - 12 - length;
      if (spareBytes >= manifestBytes && spareBytes <= 1024 * 1024) {
        fits = true;
        break;
      }
      const next = fillerBytes + spareBytes - manifestBytes - pageSize;
      if (next < 0 || next === fillerBytes) break;
      fillerBytes = next;
    }
    if (!fits) throw new Error('测试种子与元数据无法构造指定尺寸的有效包');
    await raw.backup(snapshot);
  } finally {
    raw.close();
  }
  const updated = {
    ...metadata,
    length: (await stat(snapshot)).size,
    sha256: await hashFile(snapshot),
  };
  await writePackage(snapshot, packed, updated);
  return { bytes: padPortablePackage(await readFile(packed), targetBytes), metadata: updated };
}
