// 本地服务入口。环境变量：
//   CAIWU_DATA_DIR  数据目录（默认 app/.data）
//   CAIWU_PORT      端口（默认 0 = 随机）
//   CAIWU_TOKEN     启动令牌（默认随机）
//   CAIWU_DEV       1 = 开发模式（显示示范模块、演示模板）
//   CAIWU_WEB_DIST  前端构建目录（给了就同时提供网页）
// 启动成功后在标准输出打印一行：CAIWU_READY {"port":...,"token":"..."}（Electron 据此连接）。
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverModuleDirs, serverModules } from '../../../.generated/server-modules';
import { createServer } from './server';

// 打包后（Electron）一定会传 CAIWU_DATA_DIR；只有开发时才用 app/.data
const defaultDataDir = () =>
  path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'), '.data');

async function main() {
  const token = process.env.CAIWU_TOKEN || randomBytes(24).toString('hex');
  const { fastify } = await createServer({
    dataDir: process.env.CAIWU_DATA_DIR || defaultDataDir(),
    token,
    modules: serverModules,
    moduleDirs: serverModuleDirs,
    devMode: process.env.CAIWU_DEV === '1',
    webDist: process.env.CAIWU_WEB_DIST || undefined,
    version: process.env.CAIWU_VERSION || '0.1.0-dev',
  });
  try {
    await fastify.listen({ host: '127.0.0.1', port: Number(process.env.CAIWU_PORT ?? 0) });
  } catch (error) {
    await fastify.close();
    throw error;
  }
  const address = fastify.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  console.log(`CAIWU_READY ${JSON.stringify({ port, token })}`);

  let shutdown: Promise<void> | undefined;
  const stop = () => {
    shutdown ??= fastify.close();
    void shutdown.then(
      () => process.exit(0),
      (error: unknown) => {
        console.error('本地服务退出未完成：', error);
        process.exitCode = 1;
        if (process.connected) process.disconnect();
      },
    );
  };
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, stop);
  }
  // Windows 宿主可通过 Node IPC 等待正常退出；强制终止不能执行 hook。
  if (process.send) {
    process.on('message', (message) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'CAIWU_SHUTDOWN'
      )
        stop();
    });
  }
}

main().catch((err: unknown) => {
  console.error('本地服务启动失败：', err);
  process.exit(1);
});
