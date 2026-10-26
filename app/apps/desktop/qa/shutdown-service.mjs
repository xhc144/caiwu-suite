// 合成退出子进程：Node IPC 与 Electron utilityProcess 共用，不接触真实账套。
import http from 'node:http';
import fs from 'node:fs';
const mode = process.env.M21_QA_STOP_MODE || 'delay';
const marker = process.env.M21_QA_MARKER;
const record = (value) => {
  if (marker) fs.appendFileSync(marker, `${value}\n`);
};
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><body>合成退出测试<button>编辑</button></body></html>');
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  record('stop-requested');
  if (mode === 'hang') return;
  if (mode === 'signal') {
    process.kill(process.pid, 'SIGKILL');
    return;
  }
  if (mode === 'refuse') {
    record('refused');
    process.exit(1);
  }
  setTimeout(
    () => {
      // 模拟完整任务终态和日志完成之后才退出。
      record('job-complete');
      record('terminal-written');
      record('log-written');
      server.close(() => process.exit(0));
    },
    Number(process.env.M21_QA_STOP_DELAY || 6000),
  );
};
process.on('SIGTERM', stop);
process.on('message', (data) => {
  if (data === 'caiwu:shutdown') stop();
});
process.parentPort?.on('message', ({ data }) => {
  if (data === 'caiwu:shutdown') stop();
});
// 仅夹具自身的已知哨兵；宿主不能为了正常退出删除它。
if (process.env.M21_QA_LOCK) fs.writeFileSync(process.env.M21_QA_LOCK, 'synthetic-owned-lock');
server.listen(0, '127.0.0.1', () => {
  console.log(
    `CAIWU_READY ${JSON.stringify({ port: server.address().port, token: process.env.CAIWU_TOKEN })}`,
  );
  record('ready');
  if (mode === 'exit0') setTimeout(() => process.exit(0), 50);
});
