/* eslint-disable @typescript-eslint/no-require-imports -- 测试须在加载真实 CommonJS main 前替换宿主 spawn/fork。 */
// 仅测试入口；不打入安装包。加载真正的 main.cjs，仅用合成子进程替换服务。
const { app, dialog, utilityProcess } = require('electron');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const fixture = path.join(__dirname, 'shutdown-service.mjs');
const output = process.env.M21_QA_HOST_EVENTS;
const record = (value) => fs.appendFileSync(output, `${JSON.stringify(value)}\n`);
if (process.env.M21_QA_HOST === 'utility') {
  // 模拟安装布局；仍调用真实 utilityProcess.fork，stdout/退出码由 Electron 提供。
  Object.defineProperty(app, 'isPackaged', { get: () => true });
  Object.defineProperty(process, 'resourcesPath', { value: process.env.M21_QA_RESOURCES });
  const fork = utilityProcess.fork.bind(utilityProcess);
  utilityProcess.fork = (file, args, options) =>
    fork(file.endsWith('server.cjs') ? fixture : file, args, options);
} else {
  const spawn = cp.spawn;
  cp.spawn = (file, args, options) =>
    spawn(file, args.includes('apps/desktop/src/server-entry.ts') ? [fixture] : args, options);
}
app.relaunch = () => record({ event: 'relaunch-requested' });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.M21_QA_NEXT_DIR] });
dialog.showMessageBoxSync = () => (globalThis.__m21Discard ? 1 : 0);
dialog.showErrorBox = (title, message) => record({ event: 'error', title, message });
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1);
  if (options.title === '更改下次启动位置') return { response: 1 };
  record({ event: 'dialog', ...options });
  return new Promise((resolve) => {
    globalThis.__m21Respond = (response) => resolve({ response });
  });
};
require('../dist/main.cjs');
