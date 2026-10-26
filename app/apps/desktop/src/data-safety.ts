import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

/** Windows 使用 path.win32 的大小写不敏感比较；边界以路径段计算。 */
export function treesOverlap(left: string, right: string, paths = path): boolean {
  const contains = (parent: string, target: string) => {
    const relative = paths.relative(paths.resolve(parent), paths.resolve(target));
    return (
      relative === '' ||
      (relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative))
    );
  };
  return contains(left, right) || contains(right, left);
}

/** 未创建的子目录也通过最近存在的父目录解析；拒绝悬空链接或不可访问路径。 */
export function canonicalPath(input: string): string {
  let cursor = path.resolve(input);
  const suffix: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(cursor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        if (lstatSync(cursor).isSymbolicLink())
          throw new Error('数据路径包含悬空链接，请修复链接或另选本机文件夹', { cause: error });
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

export function assertDataOutsideInstall(
  dataDir: string,
  installDir: string,
  configDir?: string,
): void {
  const install = canonicalPath(installDir);
  const protectedPaths = [
    dataDir,
    path.join(dataDir, 'books'),
    path.join(dataDir, 'backups'),
    path.join(dataDir, 'backup'),
  ];
  if (configDir) protectedPaths.push(configDir, path.join(configDir, 'logs'));
  for (const protectedPath of protectedPaths) {
    if (treesOverlap(canonicalPath(protectedPath), install)) {
      throw new Error(
        '数据、账套、备份或用户配置目录与软件安装目录相交，请选择安装目录之外且不包含安装目录的独立数据文件夹',
      );
    }
  }
}
