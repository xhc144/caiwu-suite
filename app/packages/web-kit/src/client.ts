import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, type TRPCClient } from '@trpc/client';
import type { AnyTRPCRouter } from '@trpc/server';
import { createTRPCOptionsProxy, type TRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { CoreShell, ModuleShell } from '@caiwu/server-kit';
import { getBusinessError, showError } from './notify';
import { requestActivity } from './loading';
import { sessionStore } from './session';

declare global {
  interface Window {
    __CAIWU_BOOT__?: { token: string };
  }
}

/** 启动令牌：生产环境由本地服务注入页面；开发环境（vite）由 dev 脚本通过环境变量传入。 */
export function appToken(): string {
  return (
    window.__CAIWU_BOOT__?.token ?? (import.meta.env.VITE_CAIWU_TOKEN as string | undefined) ?? ''
  );
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
  // 失败的写操作统一弹出业务提示；需要自己处理的在 mutationOptions 里加 meta: { silent: true }
  mutationCache: new MutationCache({
    onError: (error, _v, _c, mutation) => {
      if (!mutation.meta?.silent) showError(error);
    },
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      const b = getBusinessError(error);
      if (b?.code === 'UNAUTHORIZED') sessionStore.set(null);
      else if (!query.meta?.silent) showError(error);
    },
  }),
});

/** 底层客户端（不带类型）。页面里请用 coreApi / moduleApi。 */
export const trpcClient: TRPCClient<AnyTRPCRouter> = createTRPCClient<AnyTRPCRouter>({
  links: [
    httpBatchLink({
      url: '/trpc',
      fetch: async (input, init) => {
        const token = sessionStore.get()?.token;
        const done = requestActivity.start();
        try {
          const response = await fetch(input, init);
          if (sessionStore.get()?.token !== token)
            throw new DOMException('账套或操作员已变化', 'AbortError');
          return response;
        } finally {
          done();
        }
      },
      maxURLLength: 4000,
      headers() {
        const token = sessionStore.get()?.token;
        return {
          'x-caiwu-token': appToken(),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        };
      },
    }),
  ],
});

/** 核心接口：coreApi.accounts.list.queryOptions() 等。 */
export const coreApi = createTRPCOptionsProxy<CoreShell>({
  client: trpcClient as unknown as TRPCClient<CoreShell>,
  queryClient,
}).core;

/**
 * 模块接口：类型来自模块自己的 router，不依赖其它模块。
 *
 *   import type { ExampleRouter } from '../server/router';
 *   export const api = moduleApi<ExampleRouter>('example');
 *   useQuery(api.memos.list.queryOptions({}))
 */
export function moduleApi<R extends AnyTRPCRouter>(moduleId: string) {
  const proxy = createTRPCOptionsProxy<ModuleShell<string, R>>({
    client: trpcClient as unknown as TRPCClient<ModuleShell<string, R>>,
    queryClient,
  }) as unknown as { m: Record<string, unknown> };
  return proxy.m[moduleId] as TRPCOptionsProxy<ModuleShell<'x', R>>['m']['x'];
}
