import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function withResource<T, R extends { destroy: () => void }>(
  create: () => R,
  job: (resource: R) => Promise<T>,
  timeoutMs = 120_000,
): Promise<T> {
  const resource = create();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      job(resource),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('打印等待超时，请重新选择打印机或存为 PDF')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    resource.destroy();
  }
}

export type TargetState = { size: number; mtimeMs: number; ino: number; dev: number };

export async function targetState(file: string): Promise<TargetState | null> {
  try {
    const stat = await lstat(file);
    if (stat.isDirectory()) throw new Error('所选位置是文件夹，请重新选择文件名');
    return { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, dev: stat.dev };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function atomicPdfWrite(
  file: string,
  data: Uint8Array,
  expected: TargetState | null = null,
) {
  const tmp = path.join(path.dirname(file), `.caiwu-pdf-${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, data, { flag: 'wx', mode: 0o600 });
    const current = await targetState(file);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      throw new Error('所选文件在确认后发生了变化，请重新选择保存位置并确认');
    }
    if (expected === null) {
      // COPYFILE_EXCL 在创建目标时再次原子检查，避免渲染期间出现的新文件被未经确认覆盖。
      await copyFile(tmp, file, constants.COPYFILE_EXCL);
    } else {
      await rename(tmp, file);
    }
  } finally {
    await rm(tmp, { force: true });
  }
}

/** 保存对话框取消时甚至不创建打印窗；所有错误统一为可操作的中文提示。 */
export async function exportPdf(adapter: {
  choose: () => Promise<string | null>;
  render: () => Promise<Uint8Array>;
  write: (file: string, data: Uint8Array) => Promise<void>;
  failed: (error: unknown) => void;
}): Promise<string | null> {
  const file = await adapter.choose();
  if (file === null) return null;
  try {
    const data = await adapter.render();
    await adapter.write(file, data);
    return file;
  } catch (error) {
    adapter.failed(error);
    throw new Error('PDF 未保存成功，请检查目标文件是否被占用、目录写入权限和磁盘空间后重试', {
      cause: error,
    });
  }
}
