import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { spawnLocalServer, type ShutdownProtocol } from '../src/local-server';

const cwd = fileURLToPath(new URL('../../../', import.meta.url));
const entry = fileURLToPath(new URL('./fixtures/shutdown-server.mjs', import.meta.url));

async function fixture(mode: string, protocol: ShutdownProtocol = 'native') {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-testkit-shutdown-'));
  await writeFile(path.join(dataDir, 'keep'), '合成故障证据');
  return {
    dataDir,
    server: spawnLocalServer({
      cwd,
      entry,
      dataDir,
      shutdownProtocol: protocol,
      env: { CAIWU_TEST_MODE: mode },
    }),
  };
}

// 故障目录由 helper 保留；断言后才由回归测试清理自己的合成输入。
async function retained(dataDir: string) {
  expect(await readFile(path.join(dataDir, 'keep'), 'utf8')).toBe('合成故障证据');
  await rm(dataDir, { recursive: true });
}

describe('真实 Node 子进程退出（无 kill/send mock）', () => {
  it('旧 SIGTERM handler：桥接触发真实 HTTP close，等待退出和完整 stdio', async () => {
    const { server, dataDir } = await fixture('legacy', 'sigterm-bridge');
    const port = await server.ready();
    expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('ok');
    await server.close();
    expect(server.child.exitCode).toBe(0);
    expect(server.child.signalCode).toBe(null);
    expect(await readFile(path.join(dataDir, 'closed'), 'utf8')).toBe('真实服务已关闭');
    await retained(dataDir);
  });

  it('PR77 原生 IPC：真实 main 的正常 stop 释放目录锁，允许重新启动', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-testkit-native-'));
    const options = {
      cwd,
      dataDir,
      shutdownProtocol: 'native' as const,
      env: { CAIWU_PORT: '0', CAIWU_TOKEN: 'testkit-token', CAIWU_DEV: '1' },
    };
    const server = spawnLocalServer(options);
    try {
      const port = await server.ready();
      const created = await fetch(`http://127.0.0.1:${port}/trpc/core.books.create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-caiwu-token': 'testkit-token' },
        body: JSON.stringify({
          name: '合成退出回归',
          orgName: '合成单位',
          templateId: 'demo-enterprise',
          product: 'chengben',
          startYear: 2026,
          startMonth: 1,
          adminPassword: 'admin',
        }),
      });
      expect(created.ok).toBe(true);
      expect(await readdir(dataDir)).toContain('.caiwu-runtime.lock');
    } finally {
      await server.close();
    }
    expect(await readdir(dataDir)).not.toContain('.caiwu-runtime.lock');
    const restarted = spawnLocalServer(options);
    try {
      await restarted.ready();
    } finally {
      await restarted.close();
    }
    await rm(dataDir, { recursive: true });
  });

  it('exit 之后仍等待继承 stdout 的进程完成', async () => {
    const { server, dataDir } = await fixture('stdio');
    await server.ready();
    let output = '';
    const events: { event: string; at: number }[] = [];
    const record = (event: string) => events.push({ event, at: Date.now() });
    server.child.once('exit', () => record('exit'));
    server.child.once('close', () => record('close'));
    server.child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (chunk.toString().includes('FINAL_STDIO')) record('FINAL_STDIO');
    });
    await server.close();
    record('close.resolved');
    expect(output).toContain('FINAL_STDIO');
    expect(
      events.map(({ event }) => event),
      JSON.stringify(events),
    ).toEqual(['exit', 'FINAL_STDIO', 'close', 'close.resolved']);
    expect(server.child.exitCode).toBe(0);
    expect(server.child.signalCode).toBe(null);
    await retained(dataDir);
  });

  for (const mode of ['nonzero', 'signal', 'hang'])
    it(`${mode}：关闭失败保留目录，强制清理不转成通过`, async () => {
      const { server, dataDir } = await fixture(mode);
      const port = await server.ready();
      const guard = await fixture('normal');
      const guardPort = await guard.server.ready();
      try {
        const closing = server.close(mode === 'hang' ? 150 : 5_000);
        // 重复请求不能以更大的预算重新启动关闭或把失败变为成功。
        expect(server.close()).toBe(closing);
        await expect(closing).rejects.toThrow(mode === 'nonzero' ? '合成关闭故障' : '保留临时目录');
        expect(server.child.exitCode !== null || server.child.signalCode !== null).toBe(true);
        if (mode === 'nonzero') expect(server.child.exitCode).toBe(9);
        await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
        // 同时运行的另一个真实进程必须仍可响应，不能靠范围 kill 清理失败服务。
        expect(await (await fetch(`http://127.0.0.1:${guardPort}`)).text()).toBe('ok');
        expect(guard.server.child.exitCode).toBe(null);
        expect(guard.server.child.signalCode).toBe(null);
      } finally {
        await guard.server.close();
        await retained(guard.dataDir);
      }
      await retained(dataDir);
    });

  it('桥接拒绝不存在的 handler，不能直接 exit(0)', async () => {
    const { server, dataDir } = await fixture('missing', 'sigterm-bridge');
    await server.ready();
    await expect(server.close()).rejects.toThrow('missing SIGTERM handler');
    await retained(dataDir);
  });

  it('IPC 存在但没有原生协议支持时超时失败', async () => {
    const { server, dataDir } = await fixture('legacy');
    await server.ready();
    await expect(server.close(150)).rejects.toThrow('等待服务超时');
    await retained(dataDir);
  });

  it('请求关闭前提前正常退出也失败（spawn 时已记录）', async () => {
    const { server, dataDir } = await fixture('normal');
    await server.ready();
    const exited = once(server.child, 'exit');
    server.child.send({ type: 'EARLY_EXIT' });
    await exited;
    await expect(server.close()).rejects.toThrow('请求正常关闭前服务已退出：0/null');
    await retained(dataDir);
  });

  it('IPC 断开时发送失败，不能强杀后通过', async () => {
    const { server, dataDir } = await fixture('normal');
    await server.ready();
    server.child.disconnect();
    await expect(server.close()).rejects.toThrow('IPC 已断开');
    await retained(dataDir);
  });

  it('启动异常保留 stderr 和目录', async () => {
    const { server, dataDir } = await fixture('early');
    await expect(server.ready()).rejects.toThrow('合成启动错误');
    await expect(server.close()).rejects.toThrow('保留临时目录');
    await retained(dataDir);
  });

  it('spawn error 不丢失、不挂起', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-testkit-spawn-'));
    const server = spawnLocalServer({
      cwd,
      dataDir,
      shutdownProtocol: 'native',
      executable: path.join(dataDir, 'nonexistent-node'),
    });
    await expect(server.ready()).rejects.toThrow('ENOENT');
    await expect(server.close()).rejects.toThrow('ENOENT');
    await rm(dataDir, { recursive: true });
  });
});
