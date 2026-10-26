import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createTestBook } from '@caiwu/testkit';
import { ServiceSession } from '../lifecycle';

it('桌面服务集成：独立 testkit 账套 → 随机端口/令牌 → 登录壳 → 正常退出 → 重开仍读原账套', async () => {
  const fixture = await createTestBook();
  await fixture.store.closeAll();
  let running: ServiceSession | null = null;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = randomBytes(24).toString('hex');
      let rejectExit: (error: Error) => void = () => {};
      const exited = new Promise<never>((_resolve, reject) => {
        rejectExit = reject;
      });
      const current = new ServiceSession(
        () => {},
        () => rejectExit(new Error('本地服务提前退出')),
      );
      running = current;
      const port = await current.start(() => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', 'apps/desktop/src/server-entry.ts'],
          {
            cwd: path.resolve(import.meta.dirname, '../../../..'),
            env: {
              ...process.env,
              CAIWU_PORT: '0',
              CAIWU_TOKEN: token,
              CAIWU_DATA_DIR: fixture.dataDir,
              CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
              CAIWU_DEV: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          },
        );
        return {
          events: child,
          stdout: child.stdout,
          stderr: child.stderr,
          requestStop: () => child.send('caiwu:shutdown'),
          forceStop: () => {
            child.kill('SIGKILL');
          },
        };
      }, token);
      const origin = `http://127.0.0.1:${port}`;
      const res = await Promise.race([
        fetch(`${origin}/trpc/core.books.list`, { headers: { 'x-caiwu-token': token } }),
        exited,
      ]);
      expect(res).toBeDefined();
      const body = (await res!.json()) as { result: { data: { id: string; name: string }[] } };
      expect(body.result.data).toEqual([
        expect.objectContaining({ id: fixture.info.id, name: '测试账套' }),
      ]);
      expect((await fetch(`${origin}/trpc/core.books.list`)).status).toBe(401);
      const login = await fetch(`${origin}/trpc/core.auth.login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-caiwu-token': token },
        body: JSON.stringify({ bookId: fixture.info.id, userCode: 'admin', password: 'admin' }),
      });
      expect(login.ok).toBe(true);
      await current.stop();
      await expect(fetch(`${origin}/healthz`)).rejects.toThrow();
    }
  } finally {
    await running?.stop();
    await fixture.close();
  }
}, 20_000);
