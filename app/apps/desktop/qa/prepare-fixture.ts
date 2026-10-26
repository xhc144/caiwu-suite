// 在重编译 Electron ABI 之前用 Node + testkit 创建独立合成账套。绝不读取用户账套。
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestBook } from '@caiwu/testkit';

const target = process.argv[2];
if (!target || !path.isAbsolute(target)) throw new Error('请提供全新的绝对临时目录');
mkdirSync(target); // 已存在则停止，避免覆盖任何既有数据。
const fixture = await createTestBook();
try {
  await fixture.store.closeAll();
  const dataDir = path.join(target, 'data');
  const configDir = path.join(target, 'config');
  cpSync(fixture.dataDir, dataDir, { recursive: true, errorOnExist: true, force: false });
  mkdirSync(path.join(dataDir, 'backups'));
  cpSync(
    path.join(dataDir, 'books', `${fixture.info.id}.caiwu`),
    path.join(dataDir, 'backups', '合成账套备份.caiwu'),
  );
  mkdirSync(configDir);
  writeFileSync(
    path.join(configDir, 'desktop-settings.json'),
    JSON.stringify({ version: 1, dataDir }),
  );
  writeFileSync(
    path.join(target, 'fixture.json'),
    JSON.stringify({ bookId: fixture.info.id, dataDir, configDir }),
  );
  console.log('桌面回归合成账套已准备（未输出令牌、密码或账套内容）');
} finally {
  await fixture.close();
}
