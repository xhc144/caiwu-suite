// 无 tsx/应用入口：只诊断 Node 在 Windows 上跨两代继承 stdio 的实际行为。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { watch, writeFileSync, renameSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const [role, mode, port, dir] = process.argv.slice(2);
if (role === 'child') {
  const grandchild = spawn(process.execPath, [self, 'grandchild', mode, port, dir], {
    stdio: ['ignore', process.stdout, process.stderr, 'ipc'],
  });
  if (mode === 'original') process.exit(0);
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
  for (const candidate of ['original', 'handshake']) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-stdio-probe-'));
    const events = [];
    const record = (event, detail) => events.push({ event, detail, at: Date.now() });
    const server = net.createServer();
    let socket;
    let exited = false;
    server.on('connection', (connected) => {
      socket = connected;
      if (exited) socket.end('release');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let child;
    let watcher;
    let timer;
    let output = '';
    let errors = '';
    try {
      const finished = new Promise((resolve, reject) => {
        watcher = watch(dataDir, async (_event, name) => {
          if (name !== 'grandchild.json') return;
          // exit handler uses one synchronous write; rename/change may arrive before it returns.
          try {
            const value = JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));
            resolve(value);
          } catch {
            /* 下一次 change 事件继续读取。 */
          }
        });
        timer = setTimeout(() => reject(new Error('stdio probe 超时')), 5_000);
      });
      child = spawn(
        process.execPath,
        [self, 'child', candidate, String(server.address().port), dataDir],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const closed = once(child, 'close');
      child.stdout.on('data', (chunk) => {
        output += chunk;
        record('parent.stdout.data', String(chunk));
      });
      child.stderr.on('data', (chunk) => {
        errors += chunk;
        record('parent.stderr.data', String(chunk));
      });
      child.once('exit', (code, signal) => {
        record('parent.child.exit', { code, signal });
        exited = true;
        socket?.end('release');
      });
      child.once('close', (code, signal) => record('parent.child.close', { code, signal }));
      const descendant = await finished;
      await closed;
      const result = {
        platform: process.platform,
        mode: candidate,
        events,
        descendant,
        output,
        errors,
      };
      console.log(`::notice title=stdio-probe-${candidate}::${JSON.stringify(result)}`);
      if (candidate === 'handshake') {
        assert.ok(output.includes('FINAL_STDIO'), JSON.stringify(result));
        assert.ok(errors.includes('FINAL_STDERR'), JSON.stringify(result));
      }
    } catch (error) {
      console.log(`::warning title=stdio-probe-${candidate}::${JSON.stringify({ platform: process.platform, mode: candidate, error: error.message, events, output, errors })}`);
      if (candidate === 'handshake') process.exitCode = 1;
    } finally {
      clearTimeout(timer);
      watcher?.close();
      socket?.destroy();
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await new Promise((resolve) => server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    }
  }
}
