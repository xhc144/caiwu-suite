import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { probeBodyLimit } from './http-body-limit';

const LIMIT = 50 * 1024 * 1024;
async function stop(child: ChildProcess) {
  if (child.exitCode != null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('测试服务未能正常退出'));
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
it('w_tzjl_get：真实 server 拒绝声明及分块超限，整库快照和受管目录无副作用', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-http-rejection-'));
  const token = randomUUID();
  // 通过真实 CLI 启动当前 checkout 的服务；不复制 Fastify 配置或导入 apps 代码。
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CAIWU_DATA_DIR: dir,
      CAIWU_TOKEN: token,
      CAIWU_PORT: '0',
      CAIWU_DEV: '1',
      CAIWU_WEB_DIST: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr!.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`真实服务启动超时：${stderr}`)), 30_000);
      let output = '';
      child.stdout!.on('data', (data: Buffer) => {
        output += data.toString();
        const line = output.split('\n').find((s) => s.startsWith('CAIWU_READY '));
        if (line) {
          clearTimeout(timer);
          const ready = JSON.parse(line.slice('CAIWU_READY '.length)) as { port: number };
          resolve(`http://127.0.0.1:${ready.port}`);
        }
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`真实服务提前退出 ${code}：${stderr}`));
      });
    });
    const call = async <T>(procedure: string, input: unknown): Promise<T> => {
      const response = await fetch(`${base}/trpc/${procedure}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-caiwu-token': token },
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { result: { data: T } }).result.data;
    };
    const book = await call<{ id: string }>('core.books.create', {
      name: '临时拒绝语义测试',
      orgName: '测试单位',
      templateId: 'demo-enterprise',
      product: 'chengben',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'admin',
    });
    const session = await call<{ token: string }>('core.auth.login', {
      bookId: book.id,
      userCode: 'admin',
      password: 'admin',
    });
    const snapshot = () => {
      const raw = new Database(path.join(dir, 'books', `${book.id}.caiwu`), {
        readonly: true,
        fileMustExist: true,
      });
      try {
        return createHash('sha256').update(raw.serialize()).digest('hex');
      } finally {
        raw.close();
      }
    };
    const before = snapshot();
    const bodyBytes = LIMIT + Buffer.byteLength(JSON.stringify({ name: 'HTTP上限', base64: '' }));
    for (const mode of ['declared', 'chunked'] as const) {
      const response = await probeBodyLimit(
        `${base}/trpc/m.backup.upload`,
        { 'x-caiwu-token': token, authorization: `Bearer ${session.token}` },
        { mode, bodyBytes },
      );
      expect(response.complete).toBe(true);
      expect(response.status).toBe(413);
      expect(JSON.parse(response.body)).toMatchObject({
        statusCode: 413,
        code: 'FST_ERR_CTP_BODY_TOO_LARGE',
      });
      expect(response.headers.connection).toBe('close');
      if (mode === 'declared') expect(response.sentBodyBytes).toBe(0);
      else expect(response.sentBodyBytes).toBeGreaterThan(LIMIT);
      expect(snapshot()).toBe(before);
      await expect(readdir(path.join(dir, 'backups'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(stderr).not.toContain('[trpc] m.backup.upload:');
  } finally {
    await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);

it.each(['reset', 'truncated'] as const)(
  'w_tzjl_get：%s 连接错误不能替代完整 413 拒绝证据',
  async (mode) => {
    const server = createHttpServer((_req, res) => {
      if (mode === 'truncated') {
        res.writeHead(413, { 'content-type': 'application/json', 'content-length': '120' });
        res.flushHeaders();
        res.write('{"code":');
      }
      res.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (typeof address !== 'object' || !address) throw new Error('测试 HTTP 监听失败');
      await expect(
        probeBodyLimit(
          `http://127.0.0.1:${address.port}/`,
          {},
          { mode: 'declared', bodyBytes: LIMIT + 1 },
        ),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
