import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export type Bounds = { x: number; y: number; width: number; height: number };
export type WindowState = Bounds & { maximized: boolean };
export type Settings = { version: 1; dataDir?: string; window?: WindowState };

export function validDirectory(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    !raw.trim() ||
    raw.length > 4096 ||
    raw.includes('\0') ||
    !path.isAbsolute(raw)
  ) {
    throw new Error('数据目录必须是完整路径，请重新选择一个本机目录');
  }
  return path.normalize(raw);
}

export function readSettings(file: string): Settings {
  if (!existsSync(file)) return { version: 1 };
  try {
    if (statSync(file).size > 16_384) throw new Error('过大');
    const value = JSON.parse(readFileSync(file, 'utf8')) as Settings;
    if (!value || value.version !== 1) throw new Error('版本不支持');
    if (value.dataDir !== undefined) validDirectory(value.dataDir);
    if (value.window !== undefined) {
      const w = value.window;
      if (
        !w ||
        ![w.x, w.y, w.width, w.height].every((n) => Number.isSafeInteger(n)) ||
        w.width < 1 ||
        w.height < 1 ||
        typeof w.maximized !== 'boolean'
      ) {
        throw new Error('窗口配置不合法');
      }
    }
    return { version: 1, dataDir: value.dataDir, window: value.window };
  } catch {
    throw new Error(
      '桌面配置损坏或版本不受支持；请先保留配置副本，再选择数据目录，原账套不会被移动或删除',
    );
  }
}

export function writeSettings(file: string, value: Settings): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function resolveDataDir(env: string | undefined, settings: Settings, documents: string) {
  return validDirectory(env || settings.dataDir || path.join(documents, '财务账套'));
}

export function directoryError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOSPC' || code === 'EDQUOT')
    return '数据目录所在磁盘空间不足，请清理空间或选择其他磁盘后重试';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')
    return '数据目录不可写，请在当前用户有写入权限的本机文件夹中重新选择';
  if (code === 'ENOTDIR' || code === 'EEXIST')
    return '所选位置不是文件夹，请选择一个可写的本机文件夹';
  return '无法访问数据目录，请检查磁盘连接、目录权限和剩余空间后重试';
}

export function checkDataDir(raw: string): void {
  const dir = validDirectory(raw);
  let probe: string | undefined;
  try {
    mkdirSync(dir, { recursive: true });
    if (!statSync(dir).isDirectory()) throw Object.assign(new Error(), { code: 'ENOTDIR' });
    const fs = statfsSync(dir, { bigint: true });
    if (fs.bavail * fs.bsize < 64n * 1024n * 1024n) {
      throw Object.assign(new Error(), { code: 'ENOSPC' });
    }
    probe = path.join(dir, `.caiwu-write-${randomUUID()}`);
    const fd = openSync(probe, 'wx', 0o600);
    try {
      writeFileSync(fd, '财务软件目录写入检查');
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    throw new Error(directoryError(error), { cause: error });
  } finally {
    if (probe) rmSync(probe, { force: true });
  }
}

/** 选择、验证、确认全部完成之后才交给调用方提交配置。取消不会写配置。 */
export async function chooseDataDir(adapter: {
  choose: () => Promise<string | null>;
  validate: (dir: string) => void;
  confirm: (dir: string) => Promise<boolean>;
}): Promise<string | null> {
  const raw = await adapter.choose();
  if (raw === null) return null;
  const dir = validDirectory(raw);
  adapter.validate(dir);
  return (await adapter.confirm(dir)) ? dir : null;
}

export function visibleBounds(saved: Bounds | undefined, screens: readonly Bounds[]): Bounds {
  const first = screens[0] ?? { x: 0, y: 0, width: 1440, height: 900 };
  const b = saved ?? { ...first, width: 1440, height: 900 };
  const area = (s: Bounds) =>
    Math.max(0, Math.min(b.x + b.width, s.x + s.width) - Math.max(b.x, s.x)) *
    Math.max(0, Math.min(b.y + b.height, s.y + s.height) - Math.max(b.y, s.y));
  const screen = screens.reduce((best, item) => (area(item) > area(best) ? item : best), first);
  const width = Math.min(screen.width, Math.max(1024, b.width));
  const height = Math.min(screen.height, Math.max(640, b.height));
  return {
    x: Math.max(screen.x, Math.min(b.x, screen.x + screen.width - width)),
    y: Math.max(screen.y, Math.min(b.y, screen.y + screen.height - height)),
    width,
    height,
  };
}
