import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** 服务只提供 API 时也会 READY；先拒绝缺失的网页，避免打开 HTTP 404/空白页面。 */
export function assertWebFiles(root: string): void {
  try {
    const index = path.join(root, 'index.html');
    const metadata = statSync(index);
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > 1024 * 1024)
      throw new Error('invalid index');
    const html = readFileSync(index, 'utf8');
    const assets = [...html.matchAll(/(?:src|href)=["']((?:\.?\/)?assets\/[^"']+)["']/gu)].map(
      (match) => match[1]!.replace(/^\.?\//u, '').split(/[?#]/u)[0]!,
    );
    if (!/id\s*=\s*["']root["']/u.test(html) || !assets.some((asset) => asset.endsWith('.js')))
      throw new Error('invalid entry');
    for (const asset of assets) {
      const relative = path.relative(root, path.resolve(root, asset));
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new Error('invalid asset');
      const file = statSync(path.join(root, asset));
      if (!file.isFile() || file.size === 0) throw new Error('missing asset');
    }
  } catch (error) {
    throw new Error('软件页面文件不完整或无法读取，请重新安装完整软件包后重试', { cause: error });
  }
}
