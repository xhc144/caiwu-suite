import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, type APIRequestContext } from '@playwright/test';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import analysis from '../server';

export type Isolated = {
  origin: string;
  request: APIRequestContext;
  seed: (bookId: string, fn: (svc: CoreServices) => Promise<void>) => Promise<void>;
};
const appRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const test = base.extend<{ isolated: Isolated }>({
  isolated: async ({ playwright }, use) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-analysis-e2e-'));
    const server = spawnLocalServer({
      dataDir,
      cwd: appRoot,
      shutdownProtocol: 'native',
      env: {
        CAIWU_PORT: '0',
        CAIWU_TOKEN: 'e2e-token',
        CAIWU_DEV: '1',
        CAIWU_WEB_DIST: path.join(appRoot, 'apps/web/dist'),
      },
    });
    let request: APIRequestContext | undefined;
    try {
      const origin = `http://127.0.0.1:${await server.ready()}`;
      request = await playwright.request.newContext({ baseURL: origin });
      await use({
        origin,
        request,
        seed: async (bookId, fn) => {
          // 仅打开本夹具创建的目录；通过真实请求/账套租约登记辅助 runtime。
          const runtime = createRuntime({ dataDir, modules: [analysis], devMode: true });
          try {
            await runtime.lifecycle.request(() =>
              runtime.bookStore.withBook(bookId, async (book) => {
                const user = (await loadServiceUser(book.db, 1))!;
                await fn(
                  createCoreServices({
                    db: book.db,
                    user,
                    moduleId: null,
                    now: runtime.now,
                    modules: runtime.modules.lookup,
                  }),
                );
              }),
            );
          } finally {
            await runtime.bookStore.closeAll();
          }
        },
      });
    } finally {
      await request?.dispose();
      await server.close(); // 只有确认正常退出后才移除本夹具目录；失败保留证据。
      await rm(dataDir, { recursive: true, force: true });
    }
  },
});
export { expect } from '@playwright/test';
