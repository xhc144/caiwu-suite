// 仅负向浏览测试使用：所有模块及其原有宿主能力照常登记，唯独不接入
// withCashierResetProtection。不得作为生产入口或通过环境变量关闭生产能力。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify from 'fastify';
import { buildAppRouter, createRuntime } from '@caiwu/server-kit';
import { serverModuleDirs, serverModules } from '../../../.generated/server-modules';
import { withAutomaticBackup } from '../src/automatic-backup';
import { withInventoryProvider } from '../src/inventory';
import { withSharedDependencies } from '../src/shared-dependencies';

async function main() {
  const dataDir = process.env.CAIWU_DATA_DIR;
  const webDist = process.env.CAIWU_WEB_DIST;
  const token = process.env.CAIWU_TOKEN;
  if (!dataDir || !webDist || !token)
    throw new Error('出纳负向测试宿主必须使用夹具提供的独占目录、网页构建和启动令牌');

  const runtime = createRuntime({
    dataDir,
    exclusiveServer: true,
    modules: serverModules
      .map(withInventoryProvider)
      .map((module) => withAutomaticBackup(module))
      .map(withSharedDependencies),
    moduleDirs: serverModuleDirs,
    devMode: true,
  });
  const router = buildAppRouter(runtime);
  const fastify = Fastify({
    logger: false,
    bodyLimit: 50 * 1024 * 1024,
    routerOptions: { maxParamLength: 5000 },
  });
  fastify.addHook('onClose', async () => runtime.lifecycle.stop());
  try {
    fastify.addHook('onRequest', async (req, reply) => {
      const host = req.headers.host?.split(':')[0];
      if (host !== '127.0.0.1' && host !== 'localhost')
        return reply.code(403).send({ error: 'host not allowed' });
      if (req.url.startsWith('/trpc') && req.headers['x-caiwu-token'] !== token)
        return reply.code(401).send({ error: 'invalid app token' });
    });
    await fastify.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: {
        router,
        createContext: ({ req }) => {
          const auth = req.headers.authorization;
          return { app: runtime, token: auth?.startsWith('Bearer ') ? auth.slice(7) : null };
        },
      },
    } satisfies FastifyTRPCPluginOptions<typeof router>);
    const indexHtml = (await readFile(path.join(webDist, 'index.html'), 'utf8')).replace(
      '</head>',
      `<script>window.__CAIWU_BOOT__=${JSON.stringify({ token })}</script></head>`,
    );
    await fastify.register(fastifyStatic, {
      root: webDist,
      index: false,
      wildcard: false,
      prefix: '/',
    });
    fastify.get('/', (_req, reply) => reply.type('text/html; charset=utf-8').send(indexHtml));
    fastify.get('/healthz', async (_req, reply) => {
      const ok = runtime.lifecycle.state === 'ready';
      return reply.code(ok ? 200 : 503).send({ ok, state: runtime.lifecycle.state });
    });
    fastify.setNotFoundHandler((req, reply) => {
      if (
        req.method === 'GET' &&
        !req.url.startsWith('/trpc') &&
        !path.extname(req.url.split('?')[0]!)
      )
        return reply.type('text/html; charset=utf-8').send(indexHtml);
      return reply.code(404).send({ error: 'not found' });
    });

    await runtime.lifecycle.start();
    await fastify.listen({ host: '127.0.0.1', port: 0 });
    const address = fastify.server.address();
    if (!address || typeof address === 'string') throw new Error('出纳负向测试宿主未取得端口');
    console.log(`CAIWU_READY ${JSON.stringify({ port: address.port, token })}`);
  } catch (error) {
    await fastify.close();
    throw error;
  }

  let shutdown: Promise<void> | undefined;
  const stop = () => {
    shutdown ??= fastify.close();
    void shutdown.then(
      () => process.exit(0),
      (error: unknown) => {
        console.error('出纳负向测试宿主退出失败：', error);
        process.exitCode = 1;
      },
    );
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error('出纳负向测试宿主启动失败：', error);
  process.exit(1);
});
