import { test as base, type Page } from '@playwright/test';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import periodCloseServer from '../server';

// 复用已安装的 Fastify 依赖，不加载 apps/server 的任何实现，也不更改依赖清单。
const requireServerDependency = createRequire(path.resolve('apps/server/package.json'));
type Request = { url: string; headers: Record<string, string | undefined> };
type Reply = {
  code: (n: number) => Reply;
  type: (type: string) => Reply;
  send: (body: unknown) => unknown;
};
type HttpServer = {
  addHook: (name: string, hook: (req: Request, reply: Reply) => Promise<unknown>) => void;
  register: (plugin: unknown, opts: unknown) => Promise<unknown>;
  get: (route: string, handler: (req: Request, reply: Reply) => unknown) => void;
  setNotFoundHandler: (handler: (req: Request, reply: Reply) => unknown) => void;
  listen: (opts: { host: string; port: number }) => Promise<unknown>;
  close: () => Promise<void>;
  server: Server;
};
const Fastify = requireServerDependency('fastify') as (opts: {
  logger: boolean;
  routerOptions: { maxParamLength: number };
}) => HttpServer;
export type LocalFixture = {
  app: TestApp;
  url: string;
  login: (page: Page) => Promise<void>;
  seedAudited: () => Promise<{ reviewer: CoreServices; ids: number[] }>;
};
export const test = base.extend<{ local: LocalFixture }>({
  local: async ({ browserName: _browserName }, use) => {
    const app = await createTestApp({ modules: [periodCloseServer] });
    const server = Fastify({ logger: false, routerOptions: { maxParamLength: 5000 } });
    const appToken = 'period-close-independent-e2e';
    try {
      server.addHook('onRequest', async (req, reply) => {
        if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host ?? ''))
          return reply.code(403).send({ error: 'host not allowed' });
        if (req.url.startsWith('/trpc') && req.headers['x-caiwu-token'] !== appToken)
          return reply.code(401).send({ error: 'invalid app token' });
      });
      await server.register(fastifyTRPCPlugin, {
        prefix: '/trpc',
        trpcOptions: {
          router: app.router,
          createContext: ({ req }: { req: Request }) => ({
            app: app.runtime,
            token: req.headers.authorization?.replace(/^Bearer /, '') ?? null,
          }),
        },
      });
      const dist = path.resolve('apps/web/dist');
      const index = (await readFile(path.join(dist, 'index.html'), 'utf8')).replace(
        '</head>',
        `<script>window.__CAIWU_BOOT__=${JSON.stringify({ token: appToken })}</script></head>`,
      );
      const sendIndex = (_req: Request, reply: Reply) =>
        reply.type('text/html; charset=utf-8').send(index);
      server.get('/', sendIndex);
      server.get('/assets/*', async (req, reply) => {
        const pathname = decodeURIComponent(req.url.split('?')[0]!);
        const file = path.resolve(dist, `.${pathname}`);
        if (!file.startsWith(`${dist}${path.sep}`)) return reply.code(403).send('禁止访问');
        const type =
          {
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.svg': 'image/svg+xml',
          }[path.extname(file)] ?? 'application/octet-stream';
        return reply.type(type).send(await readFile(file));
      });
      server.setNotFoundHandler((req, reply) =>
        req.url.startsWith('/trpc') ? reply.code(404).send('未找到接口') : sendIndex(req, reply),
      );
      await server.listen({ host: '127.0.0.1', port: 0 });
      const address = server.server.address();
      if (!address || typeof address === 'string') throw new Error('独立服务未获得动态端口');
      const url = `http://127.0.0.1:${address.port}`;
      const login = async (page: Page) => {
        const result = await app
          .core(null)
          .auth.login({ bookId: app.book.id, userCode: 'admin', password: 'admin' });
        await page.addInitScript(
          (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
          { ...result, bookId: app.book.id },
        );
      };
      await app.svc.opening.upsert({
        year: 2026,
        accountId: (await app.svc.accounts.require('1001')).id,
        balance: 0,
      });
      await use({
        app,
        url,
        login,
        seedAudited: async () => {
          await app.addUser('A');
          await app.addUser('B');
          const userSvc = async (code: string) => {
            const db = app.runtime.bookStore.open(app.book.id).db;
            const row = await db
              .selectFrom('app_user')
              .select('id')
              .where('code', '=', code)
              .executeTakeFirstOrThrow();
            return createCoreServices({
              ...app.svc.ctx,
              user: (await loadServiceUser(db, row.id))!,
            });
          };
          const maker = await userSvc('A');
          const reviewer = await userSvc('B');
          const vouchers = await seedVouchers(maker, [
            {
              date: '2026-01-05',
              lines: [
                { account: '1001', debit: 100000 },
                { account: '6001', credit: 100000 },
              ],
            },
            {
              date: '2026-01-06',
              lines: [
                { account: '6602', debit: 25000, dims: { department: '01' } },
                { account: '1001', credit: 25000 },
              ],
            },
          ]);
          await reviewer.vouchers.changeStatus({ ids: vouchers.map((v) => v.id), to: 'audited' });
          return { reviewer, ids: vouchers.map((v) => v.id) };
        },
      });
    } finally {
      await server.close();
      await app.close();
    }
  },
});
export { expect } from '@playwright/test';
