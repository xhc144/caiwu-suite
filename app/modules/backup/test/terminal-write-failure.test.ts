import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('w_bf：最终状态/日志持久化失败不吞错，维护、关闭和退出均明确失败并保留真实句柄', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'backup-final-write-'));
  try {
    // 故障进程自然结束后才清理合成目录，不绕过生产关闭门或删除运行中的锁。
    const result = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'modules/backup/test/terminal-write-probe.ts', dir],
      { cwd: process.cwd(), timeout: 30_000 },
    );
    expect(result.stderr).toBe('');
    const evidence = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(evidence).toMatchObject({
      responseStatus: 'running',
      prepared: false,
      runtimeState: 'failed',
      rawOpen: true,
      item: { status: 'failed', reason: '文件读写或 SQLite 校验失败' },
      logs: [{ action: 'backup.manual.start' }],
    });
    for (const key of ['jobError', 'maintenanceError', 'closeError', 'stopError'])
      expect(evidence[key]).toBe('备份最终状态或日志未能保存，不能安全关闭账套');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 40_000);
