import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import { createTestApp } from '@caiwu/testkit';
import type { Page } from '@playwright/test';
import server from '../server';

// 只解析已经安装的依赖，不导入 apps/server 的实现或生成注册表。
const dependencyRequire = createRequire(path.resolve('apps/server/package.json'));
type FastifyServer = Parameters<typeof fastifyTRPCPlugin>[0];
const Fastify = dependencyRequire('fastify') as (opts: {
  logger: boolean;
  bodyLimit: number;
  routerOptions: { maxParamLength: number };
}) => FastifyServer;
const staticPlugin = dependencyRequire('@fastify/static') as Parameters<
  FastifyServer['register']
>[0];
export async function browserRuntime() {
  const app = await createTestApp({ modules: [server] });
  const http = Fastify({
    logger: false,
    bodyLimit: 50 * 1024 * 1024,
    routerOptions: { maxParamLength: 5000 },
  });
  const bootToken = 'voucher-book-independent-e2e';
  try {
    http.addHook('onRequest', async (req, reply) => {
      if (!req.headers.host?.startsWith('127.0.0.1:'))
        return reply.code(403).send({ error: 'host' });
      if (req.url.startsWith('/trpc') && req.headers['x-caiwu-token'] !== bootToken)
        return reply.code(401).send({ error: 'token' });
    });
    await http.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: {
        router: app.router,
        createContext: ({ req }) => ({
          app: app.runtime,
          token: req.headers.authorization?.replace(/^Bearer /, '') ?? null,
        }),
      },
    } satisfies FastifyTRPCPluginOptions<typeof app.router>);
    const dist = path.resolve('apps/web/dist');
    const html = readFileSync(path.join(dist, 'index.html'), 'utf8').replace(
      '</head>',
      `<script>window.__CAIWU_BOOT__=${JSON.stringify({ token: bootToken })}</script></head>`,
    );
    await http.register(staticPlugin, { root: dist, index: false, wildcard: false });
    http.setNotFoundHandler((req, reply) => {
      if (
        req.method === 'GET' &&
        !req.url.startsWith('/trpc') &&
        !path.extname(req.url.split('?')[0]!)
      )
        return reply.type('text/html').send(html);
      return reply.code(404).send({ error: 'not found' });
    });
    http.get('/', (_req, reply) => reply.type('text/html').send(html));
    const address = await http.listen({ host: '127.0.0.1', port: 0 });
    return {
      app,
      address,
      async login(page: Page, code: string, password: string) {
        const session = await app
          .core(null)
          .auth.login({ bookId: app.book.id, userCode: code, password });
        await page.goto(address);
        await page.evaluate((s) => sessionStorage.setItem('caiwu.session', JSON.stringify(s)), {
          token: session.token,
          user: session.user,
          book: session.book,
          bookId: app.book.id,
        });
        await page.goto(`${address}/m/voucher-book`);
      },
      async close() {
        await http.close();
        await app.close();
      },
    };
  } catch (e) {
    await http.close();
    await app.close();
    throw e;
  }
}
