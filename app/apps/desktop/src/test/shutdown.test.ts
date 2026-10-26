import { expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ServiceSession, ServiceStopError } from '../lifecycle';

async function start(mode: string, dir: string, delay = 6000) {
  let child!: ChildProcess;
  const session = new ServiceSession(
    () => {},
    () => {},
  );
  await session.start(() => {
    child = spawn(process.execPath, [path.resolve('apps/desktop/qa/shutdown-service.mjs')], {
      env: {
        ...process.env,
        CAIWU_TOKEN: 'shutdown-test',
        M21_QA_STOP_MODE: mode,
        M21_QA_STOP_DELAY: String(delay),
        M21_QA_MARKER: path.join(dir, 'events'),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    return {
      events: child,
      stdout: child.stdout,
      stderr: child.stderr,
      requestStop: () => child.send('caiwu:shutdown'),
      forceStop: () => child.kill('SIGKILL'),
    };
  }, 'shutdown-test');
  return { session, child };
}

it('真实 Node 子进程：超过旧 5 秒仍等完整任务/终态/日志，重复退出只发一次消息', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'm21-stop-'));
  const { session, child } = await start('delay', dir);
  try {
    const before = Date.now();
    const first = session.stop();
    expect(session.stop()).toBe(first);
    await first;
    expect(Date.now() - before).toBeGreaterThanOrEqual(5900);
    expect(child.exitCode).toBe(0);
    expect(readFileSync(path.join(dir, 'events'), 'utf8').trim().split('\n')).toEqual([
      'ready',
      'stop-requested',
      'job-complete',
      'terminal-written',
      'log-written',
    ]);
    await session.stop();
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(child.stdout!.listenerCount('data')).toBe(0);
    expect(child.stderr!.listenerCount('data')).toBe(0);
  } finally {
    await session.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('真实 Node 子进程：拒绝 exit1、信号和意外 exit0 都不能作为正常完成', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'm21-stop-'));
  try {
    for (const mode of ['refuse', 'signal']) {
      const { session, child } = await start(mode, dir);
      const result = await session.stop().catch((error: unknown) => error);
      expect(result).toBeInstanceOf(ServiceStopError);
      expect((result as ServiceStopError).outcome).toBe(
        child.signalCode ? 'terminated' : 'refused',
      );
      expect((result as ServiceStopError).exitCode).toBe(child.exitCode);
      expect((result as ServiceStopError).signal).toBe(child.signalCode);
      await expect(session.stop()).rejects.toBeInstanceOf(ServiceStopError);
      expect(child.listenerCount('exit')).toBe(0);
      expect(child.listenerCount('close')).toBe(0);
    }
    const { session, child } = await start('exit0', dir);
    await once(child, 'exit');
    expect(child.exitCode).toBe(0);
    await expect(session.stop()).rejects.toMatchObject({ outcome: 'unexpected' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('真实 Node 子进程：超时不强杀，可继续等同一任务；显式强制终止永不算成功', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'm21-stop-'));
  try {
    const delayed = await start('delay', dir, 350);
    await expect(delayed.session.stop(30)).rejects.toMatchObject({ outcome: 'timeout' });
    expect(delayed.session.alive).toBe(true);
    for (let i = 0; i < 3; i++) {
      await expect(delayed.session.stop(30)).rejects.toMatchObject({ outcome: 'timeout' });
      expect(delayed.child.listenerCount('exit')).toBe(1);
      expect(delayed.child.listenerCount('close')).toBe(1);
    }
    await delayed.session.stop();
    expect(readFileSync(path.join(dir, 'events'), 'utf8').match(/stop-requested/g)).toHaveLength(1);
    const hung = await start('hang', dir);
    await expect(hung.session.stop(30)).rejects.toMatchObject({ outcome: 'timeout' });
    await hung.session.terminate();
    await expect(hung.session.stop()).rejects.toMatchObject({ outcome: 'forced' });
    expect(hung.child.listenerCount('exit')).toBe(0);
    expect(hung.child.listenerCount('close')).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
