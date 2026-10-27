// 无 tsx/应用入口：只诊断 Node 在 Windows 上跨两代继承 stdio 的实际行为。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { writeFileSync, renameSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const [role, mode, port, dir] = process.argv.slice(2);
if (role === 'child') {
  const grandchild = spawn(process.execPath, [self, 'grandchild', mode, port, dir], {
    stdio: ['ignore', process.stdout, process.stderr, 'ipc'],
    detached: mode === 'detached',
  });
  writeFileSync(
    path.join(dir, 'child.json'),
    JSON.stringify({
      event: 'child.spawn',
      pid: process.pid,
      grandchild: grandchild.pid,
      at: Date.now(),
    }),
  );
  if (mode !== 'handshake') process.exit(0);
  grandchild.once('message', () => process.exit(0));
} else if (role === 'grandchild') {
  const trace = [];
  const record = (event, detail) => trace.push({ event, detail, at: Date.now() });
  process.on('exit', (code) => {
    record('grandchild.exit', code);
    writeFileSync(path.join(dir, 'grandchild.tmp'), JSON.stringify(trace));
    renameSync(path.join(dir, 'grandchild.tmp'), path.join(dir, 'grandchild.json'));
  });
  process.on('uncaughtException', (error) => {
    record('grandchild.uncaught', { code: error.code, message: error.message });
    process.exit(3);
  });
  process.stdout.on('error', (error) => record('stdout.error', error.code));
  process.stderr.on('error', (error) => record('stderr.error', error.code));
  const control = net.connect(Number(port), '127.0.0.1');
  control.on('error', () => process.exit(2));
  control.on('close', () => process.exit(process.exitCode ?? 0));
  control.on('data', () => {
    record('grandchild.release');
    let pending = 2;
    const written = (stream) => (error) => {
      record(`${stream}.callback`, error?.code ?? 'ok');
      if (--pending === 0) control.end();
    };
    process.stdout.write('FINAL_STDIO\n', written('stdout'));
    process.stderr.write('FINAL_STDERR\n', written('stderr'));
  });
  record('grandchild.start');
  if (mode === 'handshake') {
    // 首次触碰实际继承的两条流；把接管完成通知给直接父进程。
    let pending = 2;
    const initialized = () => {
      if (--pending === 0) process.send({ ready: true });
    };
    process.stdout.write('STDIO_READY\n', initialized);
    process.stderr.write('STDERR_READY\n', initialized);
  }
} else {
  process.on('uncaughtException', (error) => {
    console.log(`::error title=stdio-probe-driver::${error.stack?.replaceAll('\n', '%0A')}`);
    process.exit(1);
  });
  for (const candidate of ['original', 'handshake', 'detached']) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-stdio-probe-'));
    const events = [];
    const record = (event, detail) => events.push({ event, detail, at: Date.now() });
    const server = net.createServer();
    let socket;
    let exited = false;
    server.on('connection', (connected) => {
      socket = connected;
      socket.on('error', (error) => record('parent.control.error', error.code));
      if (exited) socket.end('release');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let child;
    let closed;
    let timer;
    let output = '';
    let errors = '';
    try {
      child = spawn(
        process.execPath,
        [self, 'child', candidate, String(server.address().port), dataDir],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      closed = once(child, 'close');
      child.stdout.on('data', (chunk) => {
        const hadFinal = output.includes('FINAL_STDIO');
        output += chunk;
        record('parent.stdout.data', String(chunk));
        if (!hadFinal && output.includes('FINAL_STDIO')) record('parent.stdout.final');
      });
      child.stderr.on('data', (chunk) => {
        const hadFinal = errors.includes('FINAL_STDERR');
        errors += chunk;
        record('parent.stderr.data', String(chunk));
        if (!hadFinal && errors.includes('FINAL_STDERR')) record('parent.stderr.final');
      });
      child.stdout.once('close', () => record('parent.stdout.close'));
      child.stderr.once('close', () => record('parent.stderr.close'));
      child.once('exit', (code, signal) => {
        record('parent.child.exit', { code, signal });
        exited = true;
        socket?.end('release');
      });
      child.once('close', (code, signal) =>
        record('parent.child.close', {
          code,
          signal,
          stdoutClosed: child.stdout.closed,
          stderrClosed: child.stderr.closed,
        }),
      );
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('stdio probe 超时')), 5_000);
        }),
      ]);
      // 孙进程 exit handler 先同步写记录，OS 才关闭继承句柄；stdio close 后直接读取。
      // 不用 fs.watch：Node 24.19 / Windows 在该诊断上曾触发原生 fs-event assertion。
      const descendant = await readFile(path.join(dataDir, 'grandchild.json'), 'utf8')
        .then(JSON.parse)
        .catch((error) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        });
      const childRecord = JSON.parse(await readFile(path.join(dataDir, 'child.json'), 'utf8'));
      let grandchildExists = true;
      try {
        // 信号 0 只查询存活状态；绝不按这个 PID 发终止信号。
        process.kill(childRecord.grandchild, 0);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        grandchildExists = false;
      }
      const result = {
        platform: process.platform,
        child: childRecord,
        grandchildExistsAfterClose: grandchildExists,
        mode: candidate,
        events,
        descendant,
        output,
        errors,
      };
      console.log(`::notice title=stdio-probe-${candidate}::${JSON.stringify(result)}`);
      if (process.platform === 'win32' && candidate !== 'detached') {
        assert.equal(output.includes('FINAL_STDIO'), false, JSON.stringify(result));
        assert.equal(grandchildExists, false, JSON.stringify(result));
      }
      if (candidate === 'detached') {
        assert.ok(output.includes('FINAL_STDIO'), JSON.stringify(result));
        assert.ok(errors.includes('FINAL_STDERR'), JSON.stringify(result));
        assert.equal(descendant.find(({ event }) => event === 'grandchild.exit')?.detail, 0);
        const exitedAt = events.findIndex(({ event }) => event === 'parent.child.exit');
        const closedAt = events.findIndex(({ event }) => event === 'parent.child.close');
        assert.equal(events[closedAt].detail.stdoutClosed, true);
        assert.equal(events[closedAt].detail.stderrClosed, true);
        for (const stream of ['stdout', 'stderr']) {
          const dataAt = events.findIndex(({ event }) => event === `parent.${stream}.final`);
          assert.ok(
            exitedAt >= 0 && dataAt > exitedAt && closedAt > dataAt,
            JSON.stringify(result),
          );
        }
      }
    } catch (error) {
      console.log(
        `::warning title=stdio-probe-${candidate}::${JSON.stringify({ platform: process.platform, mode: candidate, error: error.message, child: JSON.parse(await readFile(path.join(dataDir, 'child.json'), 'utf8')), events, output, errors })}`,
      );
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
      socket?.destroy();
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await new Promise((resolve) => server.close(resolve));
      // 先关闭本诊断独占的控制连接/监听器，使仍在启动的孙进程也会自行退出。
      // 只对直接 spawn 返回的 ChildProcess 发信号，不按进程名或未经验证的 PID 清理。
      let cleanupTimer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            cleanupTimer = setTimeout(() => reject(new Error('stdio probe 回收超时')), 2_000);
          }),
        ]);
      } finally {
        clearTimeout(cleanupTimer);
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  }
}
