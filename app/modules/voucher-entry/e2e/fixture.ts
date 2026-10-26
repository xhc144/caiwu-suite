// 本模块测试专用本地 HTTP 服务：真实 core/runtime/数据库；没有生产 seed 接口。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import { createTestApp, seedReferenceData } from '@caiwu/testkit';
import { E2E_APP_TOKEN } from '@caiwu/testkit/e2e';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import server from '../server';
import { defineManifest } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
const sourceManifest = defineManifest({
  id: 'voucher-entry-fixture',
  name: '测试来源单据',
  products: 'all',
  sources: [{ type: 'document', name: '测试单据', path: '/documents/{id}' }],
});
const sourceKit = moduleKit(sourceManifest);
const sourceModule = defineServerModule(sourceManifest, {
  router: sourceKit.router({}),
  migrations: [],
});

export async function fixture() {
  const app = await createTestApp({ modules: [server, sourceModule] });
  const handler = createHTTPHandler({
    router: app.router,
    basePath: '/trpc/',
    createContext: ({ req }) => ({
      app: app.runtime,
      token: req.headers.authorization?.replace(/^Bearer /, '') ?? null,
    }),
  });
  const webRoot = path.resolve('apps/web/dist');
  const html = readFileSync(path.join(webRoot, 'index.html'), 'utf8').replace(
    '</head>',
    `<script>window.__CAIWU_BOOT__=${JSON.stringify({ token: E2E_APP_TOKEN })}</script></head>`,
  );
  const http = createServer((req, res) => {
    if (req.url?.startsWith('/trpc/')) {
      if (req.headers['x-caiwu-token'] !== E2E_APP_TOKEN) {
        res.writeHead(401);
        res.end();
        return;
      }
      handler(req, res);
      return;
    }
    const asset = req.url?.split('?')[0] ?? '/';
    if (asset.startsWith('/assets/') && !asset.includes('..')) {
      try {
        res.setHeader('content-type', asset.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(readFileSync(path.join(webRoot, asset)));
      } catch {
        res.writeHead(404);
        res.end();
      }
    } else {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html);
    }
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('测试 HTTP 服务未启动');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async svc(bookId: string, moduleId: string | null = null) {
      const db = app.runtime.bookStore.open(bookId).db;
      return createCoreServices({
        db,
        user: (await loadServiceUser(db, 1))!,
        moduleId,
        now: app.runtime.now,
        modules: app.runtime.modules.lookup,
      });
    },
    async seed(bookId: string) {
      const svc = await this.svc(bookId);
      await seedReferenceData(svc, 202601);
      const cf = (await svc.dimensions.getByCode('cashflow', 'CF01'))!;
      await svc.db
        .updateTable('dimension_item')
        .set({ attrs: JSON.stringify({ cashflowDirection: 'inflow' }) })
        .where('id', '=', cf.id)
        .execute();
      const account = await svc.accounts.require('6602');
      await svc.db
        .insertInto('account_dimension')
        .values({
          account_id: account.id,
          dimension_type: 'project',
          required: 1,
          default_item_id: null,
        })
        .execute();
      return svc;
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
      await app.close();
    },
  };
}
