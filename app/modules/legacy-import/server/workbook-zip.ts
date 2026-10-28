import { createInflateRaw, crc32 } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { workbookNumberInspector, workbookXmlBudget } from './workbook-numbers';

const MAX_BYTES = 8 * 1024 * 1024,
  MAX_EXPANDED_BYTES = 64 * 1024 * 1024,
  MAX_ENTRIES = 2048;
const ZIP_ERROR = '工作簿压缩目录损坏或存在歧义，请重新另存为 .xlsx';
type Entry = {
  name: string;
  method: number;
  flags: number;
  compressed: number;
  expanded: number;
  crc: number;
  start: number;
  end: number;
  recordStart: number;
  recordEnd: number;
};
const invalid = (): never => {
  throw new Error(ZIP_ERROR);
};

function checkExtra(bytes: Buffer, start: number, length: number) {
  const end = start + length;
  let cursor = start;
  while (cursor < end) {
    if (cursor + 4 > end) invalid();
    const type = bytes.readUInt16LE(cursor),
      size = bytes.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + size > end) invalid();
    // 禁止解码器通过 ZIP64 或 Unicode Path 扩展重解释已检查的长度、偏移及名称。
    if (type === 0x0001 || type === 0x7075)
      throw new Error('不支持 ZIP64 或扩展路径工作簿，请重新另存为普通 .xlsx');
    cursor += size;
  }
}

function entriesOf(bytes: Buffer, maxExpandedBytes: number): Entry[] {
  if (bytes.length < 22) throw new Error('文件不是完整的 Excel 工作簿，请重新另存为 .xlsx');
  if (bytes.length > MAX_BYTES) throw new Error('工作簿超过8 MB，请分批导入');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('文件不是完整的 Excel 工作簿，请重新另存为 .xlsx');
  const count = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12),
    offset = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    !count ||
    count > MAX_ENTRIES ||
    count === 0xffff ||
    size === 0xffffffff ||
    offset === 0xffffffff ||
    offset + size !== end
  )
    invalid();
  const entries: Entry[] = [],
    names = new Set<string>();
  let cursor = offset,
    declared = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) invalid();
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10),
      crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20),
      expanded = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28),
      extraLength = bytes.readUInt16LE(cursor + 30),
      commentLength = bytes.readUInt16LE(cursor + 32);
    const recordStart = bytes.readUInt32LE(cursor + 42),
      next = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      flags & ~0x080e ||
      ![0, 8].includes(method) ||
      bytes.readUInt16LE(cursor + 34) !== 0 ||
      next > end ||
      !nameLength ||
      nameLength > 1024 ||
      compressed === 0xffffffff ||
      expanded === 0xffffffff ||
      recordStart === 0xffffffff
    )
      invalid();
    const encodedName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(encodedName);
    } catch {
      return invalid();
    }
    if (!(flags & 0x0800) && encodedName.some((b) => b >= 128))
      throw new Error('工作簿路径编码不明确，请重新另存');
    if (
      Array.from(name).some((c) => c.charCodeAt(0) < 32) ||
      /[\\:]/.test(name) ||
      name.startsWith('/') ||
      name
        .split('/')
        .some(
          (part, i, parts) =>
            part === '.' || part === '..' || (part === '' && i !== parts.length - 1),
        )
    )
      invalid();
    const key = name.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error('工作簿含重复或冲突的压缩条目，请重新另存');
    names.add(key);
    checkExtra(bytes, cursor + 46 + nameLength, extraLength);
    const attrs = bytes.readUInt32LE(cursor + 38),
      unixType = (attrs >>> 16) & 0xf000;
    if (
      unixType === 0xa000 ||
      (((attrs & 0x10) !== 0 || unixType === 0x4000) && !name.endsWith('/'))
    )
      invalid();
    if (recordStart + 30 > offset || bytes.readUInt32LE(recordStart) !== 0x04034b50) invalid();
    const localFlags = bytes.readUInt16LE(recordStart + 6),
      localMethod = bytes.readUInt16LE(recordStart + 8);
    const localNameLength = bytes.readUInt16LE(recordStart + 26),
      localExtraLength = bytes.readUInt16LE(recordStart + 28);
    const start = recordStart + 30 + localNameLength + localExtraLength,
      dataEnd = start + compressed;
    if (
      localFlags !== flags ||
      localMethod !== method ||
      dataEnd > offset ||
      !bytes.subarray(recordStart + 30, recordStart + 30 + localNameLength).equals(encodedName)
    )
      invalid();
    checkExtra(bytes, recordStart + 30 + localNameLength, localExtraLength);
    const localValues = [
      bytes.readUInt32LE(recordStart + 14),
      bytes.readUInt32LE(recordStart + 18),
      bytes.readUInt32LE(recordStart + 22),
    ];
    const expected = [crc, compressed, expanded];
    let recordEnd = dataEnd;
    if (flags & 8) {
      if (localValues.some((v, i) => v !== 0 && v !== expected[i])) invalid();
      const descriptorAt = (position: number) =>
        position + 12 <= offset &&
        bytes.readUInt32LE(position) === crc &&
        bytes.readUInt32LE(position + 4) === compressed &&
        bytes.readUInt32LE(position + 8) === expanded;
      if (
        dataEnd + 4 <= offset &&
        bytes.readUInt32LE(dataEnd) === 0x08074b50 &&
        descriptorAt(dataEnd + 4)
      )
        recordEnd = dataEnd + 16;
      else if (descriptorAt(dataEnd)) recordEnd = dataEnd + 12;
      else invalid();
    } else if (localValues.some((v, i) => v !== expected[i])) invalid();
    if (method === 0 && compressed !== expanded) invalid();
    if (name.endsWith('/') && (expanded !== 0 || crc !== 0)) invalid();
    declared += expanded;
    if (declared > maxExpandedBytes) throw new Error('工作簿声明展开大小超过限制，请分批导入');
    entries.push({
      name,
      method,
      flags,
      compressed,
      expanded,
      crc,
      start,
      end: dataEnd,
      recordStart,
      recordEnd,
    });
    cursor = next;
  }
  if (cursor !== end) invalid();
  let covered = 0;
  for (const entry of [...entries].sort((a, b) => a.recordStart - b.recordStart)) {
    if (entry.recordStart !== covered) invalid();
    covered = entry.recordEnd;
  }
  if (covered !== offset) invalid();
  return entries;
}

/** 实际解压逐块计量且不聚合；所有条目校验通过前不得调用 ExcelJS。测试仅可下调预算。 */
export async function validateWorkbookZip(
  bytes: Buffer,
  maxExpandedBytes = MAX_EXPANDED_BYTES,
): Promise<void> {
  if (
    !Number.isSafeInteger(maxExpandedBytes) ||
    maxExpandedBytes < 1 ||
    maxExpandedBytes > MAX_EXPANDED_BYTES
  )
    throw new Error('工作簿解压预算无效');
  const entries = entriesOf(bytes, maxExpandedBytes),
    deadline = performance.now() + 10000;
  let total = 0;
  const xmlBudget = workbookXmlBudget();
  for (const entry of entries) {
    let actual = 0,
      checksum = 0;
    // 匹配 ExcelJS 的工作表入口，同时覆盖前缀/后缀变体，避免未经检查的数值进入 parseFloat。
    const numbers = /[.]xml|[.]rels/.test(entry.name)
      ? workbookNumberInspector(entry.name, xmlBudget)
      : undefined;
    const consume = (chunk: Buffer) => {
      actual += chunk.length;
      total += chunk.length;
      if (total > maxExpandedBytes)
        throw new Error('工作簿实际解压大小超过限制，已中止读取，请分批导入');
      if (actual > entry.expanded)
        throw new Error('工作簿实际解压大小超过声明值，已中止读取，请重新导出');
      if (performance.now() > deadline)
        throw new Error('工作簿受限解压超时，已中止读取，请分批导入');
      checksum = crc32(chunk, checksum);
      numbers?.write(chunk);
    };
    if (entry.method === 0) {
      for (let at = entry.start; at < entry.end; at += 16384)
        consume(bytes.subarray(at, Math.min(at + 16384, entry.end)));
    } else {
      const inflater = createInflateRaw({ chunkSize: 16384 });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - performance.now()));
      try {
        await pipeline(
          Readable.from([bytes.subarray(entry.start, entry.end)]),
          inflater,
          new Writable({
            write(chunk: Buffer, _encoding, callback) {
              try {
                consume(chunk);
                callback();
              } catch (error) {
                callback(error instanceof Error ? error : new Error(ZIP_ERROR));
              }
            },
          }),
          { signal: controller.signal },
        );
        if (inflater.bytesWritten !== entry.compressed)
          throw new Error('工作簿压缩条目含尾随数据，请重新导出');
      } catch (error) {
        if (controller.signal.aborted)
          throw new Error('工作簿受限解压超时，已中止读取，请分批导入', { cause: error });
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          String(error.code).startsWith('Z_')
        )
          throw new Error('工作簿压缩数据损坏，已中止读取，请重新导出', { cause: error });
        throw error;
      } finally {
        clearTimeout(timer);
        inflater.destroy();
      }
    }
    if (actual !== entry.expanded) throw new Error('工作簿实际解压大小与声明不一致，请重新导出');
    if (checksum !== entry.crc) throw new Error('工作簿条目校验失败，请重新导出');
    numbers?.end();
  }
}
