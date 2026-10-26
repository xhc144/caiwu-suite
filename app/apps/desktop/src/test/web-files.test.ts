import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertWebFiles } from '../web-files';

it('服务 READY 之前检查网页入口和资源；缺失/空白页面不能显示为正常启动', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'm21-web-files-'));
  try {
    expect(() => assertWebFiles(dir)).toThrow(/页面文件不完整/);
    writeFileSync(
      path.join(dir, 'index.html'),
      '<div id="root"></div><script type="module" src="/assets/index.js"></script>',
    );
    expect(() => assertWebFiles(dir)).toThrow(/重新安装/);
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'index.js'), 'export {};');
    expect(() => assertWebFiles(dir)).not.toThrow();
    writeFileSync(path.join(dir, 'index.html'), '');
    expect(() => assertWebFiles(dir)).toThrow(/页面文件不完整/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
