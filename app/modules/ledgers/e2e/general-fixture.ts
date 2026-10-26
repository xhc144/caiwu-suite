import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { request as playwrightRequest } from '@playwright/test';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import server from '../server';

/** 独占临时目录/随机端口；显式原生退出协议，失败保留账套供排查。 */
export async function startGeneralEnvironment() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-general-e2e-'));
  const local = spawnLocalServer({
    dataDir,
    shutdownProtocol: 'native',
    env: {
      CAIWU_PORT: '0',
      CAIWU_TOKEN: 'e2e-token',
      CAIWU_DEV: '1',
      CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
    },
  });
  const port = await local.ready();
  const baseURL = `http://127.0.0.1:${port}`;
  const request = await playwrightRequest.newContext({ baseURL });
  return {
    baseURL,
    request,
    async withBook<T>(bookId: string, fn: (svc: CoreServices) => Promise<T>) {
      const runtime = createRuntime({ dataDir, modules: [server], devMode: true });
      try {
        const book = runtime.bookStore.open(bookId);
        const user = (await loadServiceUser(book.db, 1))!;
        return await fn(
          createCoreServices({
            db: book.db,
            user,
            moduleId: null,
            now: runtime.now,
            modules: runtime.modules.lookup,
          }),
        );
      } finally {
        await runtime.bookStore.closeAll();
      }
    },
    async close() {
      await request.dispose();
      await local.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
export type GeneralEnvironment = Awaited<ReturnType<typeof startGeneralEnvironment>>;
