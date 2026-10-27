import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('w_autobak：后台启动终态与失败日志均不可写时，服务先就绪但后续关闭/退出仍拒绝并保留原句柄', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'backup-startup-write-'));
  try {
    const result = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'modules/backup/test/startup-write-probe.ts', dir],
      { cwd: process.cwd(), timeout: 30_000 },
    );
    expect(result.stderr).toBe('');
    const value = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(value).toMatchObject({
      startState: 'ready',
      state: 'failed',
      rawOpen: true,
      item: { status: 'failed', reason: '文件读写或 SQLite 校验失败' },
      logs: [{ action: 'backup.automatic.start', user_id: 0, user_name: '系统' }],
    });
    for (const key of ['jobError', 'closeError', 'stopError'])
      expect(value[key]).toBe('备份最终状态或日志未能保存，不能安全关闭账套');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 40_000);
