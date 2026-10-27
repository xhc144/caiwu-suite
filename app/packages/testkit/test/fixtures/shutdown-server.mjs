import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const mode = process.env.CAIWU_TEST_MODE;
if (mode === 'early') {
  console.error('合成启动错误');
  process.exit(7);
}
const server = http.createServer((_req, res) => res.end('ok'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
// 与旧 main 相同，成功只能来自原 handler 等待真实服务关闭之后的 exit(0)。
async function stop() {
  if (mode === 'hang') return;
  if (mode === 'nonzero') {
    console.error('合成关闭故障');
    process.exit(9);
  }
  if (mode === 'signal') {
    process.kill(process.pid, 'SIGKILL');
    return;
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await writeFile(path.join(process.env.CAIWU_DATA_DIR, 'closed'), '真实服务已关闭');
  if (mode === 'stdio') {
    spawn(
      process.execPath,
      ['-e', "setTimeout(() => process.stdout.write('FINAL_STDIO\\n'), 150)"],
      {
        stdio: ['ignore', process.stdout, process.stderr],
        // Windows 的非 detached 子进程会随父进程 Job 关闭而被终止；unref 不会脱离 Job。
        detached: true,
      },
    ).unref();
  }
  process.exit(0);
}
if (mode === 'legacy')
  process.on('SIGTERM', () => {
    void stop();
  });
process.on('message', (message) => {
  if (message?.type === 'EARLY_EXIT') process.exit(0);
  if (message?.type === 'CAIWU_SHUTDOWN' && mode !== 'missing' && mode !== 'legacy') void stop();
});
console.log(`CAIWU_READY ${JSON.stringify({ port: server.address().port })}`);
