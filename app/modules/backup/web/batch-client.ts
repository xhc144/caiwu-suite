import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { ModuleShell } from '@caiwu/server-kit';
import { appToken, requestActivity, sessionStore } from '@caiwu/web-kit';
import type { BackupRouter } from '../server/router';

/** 队列排队到实际 HTTP 发送之间也可能切账，启动时固定原会话并在发送前复核。 */
export function batchClient(token: string) {
  const requireCurrent = () => {
    if (sessionStore.get()?.token !== token)
      throw new DOMException('账套或操作员已变化', 'AbortError');
  };
  return createTRPCClient<ModuleShell<'backup', BackupRouter>>({
    links: [
      httpBatchLink({
        url: '/trpc',
        headers() {
          requireCurrent();
          return { 'x-caiwu-token': appToken(), authorization: `Bearer ${token}` };
        },
        fetch: async (input, init) => {
          requireCurrent();
          const done = requestActivity.start();
          try {
            const response = await fetch(input, init);
            requireCurrent();
            return response;
          } finally {
            done();
          }
        },
      }),
    ],
  }).m.backup;
}
