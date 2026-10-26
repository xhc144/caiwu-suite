// Playwright E2E 的帮助函数。用法：
//   import { test, expect } from '@playwright/test';
//   import { loginWithNewBook } from '@caiwu/testkit/e2e';
//   test('...', async ({ page, request }) => {
//     const { bookId } = await loginWithNewBook(page, request);
//     await page.goto('/m/example/memos');
//   });
import type { APIRequestContext, Page } from '@playwright/test';

/** E2E 服务的启动令牌（playwright.config.ts 里设置） */
export const E2E_APP_TOKEN = process.env.CAIWU_E2E_TOKEN ?? 'e2e-token';

/** 直接调接口（tRPC over HTTP）。query 用 GET，mutation 用 POST。 */
export async function callApi<T = unknown>(
  request: APIRequestContext,
  procedure: string,
  input?: unknown,
  opts: { token?: string; method?: 'GET' | 'POST' } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'x-caiwu-token': E2E_APP_TOKEN };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const method =
    opts.method ??
    (/\.(list|get|me|bootstrap|templates|current|items|balances|entries|categories)$/.test(
      procedure,
    )
      ? 'GET'
      : 'POST');
  const res =
    method === 'GET'
      ? await request.get(
          `/trpc/${procedure}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
          { headers },
        )
      : await request.post(`/trpc/${procedure}`, { headers, data: input ?? {} });
  const body = (await res.json()) as {
    result?: { data: T };
    error?: { message: string; data?: { business?: { message: string } } };
  };
  if (!res.ok() || body.error)
    throw new Error(
      `${procedure} 失败：${body.error?.data?.business?.message ?? body.error?.message ?? res.status()}`,
    );
  return body.result!.data;
}

export interface E2EBook {
  bookId: string;
  token: string;
  bookName: string;
}

/**
 * 通过接口新建一个演示账套（名称唯一，测试之间互不影响）并以 admin 登录，
 * 然后把登录状态注入页面（之后 page.goto 任何地址都是已登录）。
 */
export interface NewBookOptions {
  name?: string;
  /** 预置演示数据（部门、客供、项目等，见 DEMO_DIMENSIONS），默认 true */
  seed?: boolean;
  product?: 'qingsong' | 'minfei' | 'chengben';
  startYear?: number;
  startMonth?: number;
}

/** 只新建账套（管理员 admin / admin），不登录。返回账套 id 和名称。 */
export async function createBook(request: APIRequestContext, opts: NewBookOptions = {}) {
  const bookName = opts.name ?? `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const book = await callApi<{ id: string }>(request, 'core.books.create', {
    name: bookName,
    orgName: 'E2E 测试单位',
    templateId: 'demo-enterprise',
    product: opts.product ?? 'chengben',
    startYear: opts.startYear ?? 2026,
    startMonth: opts.startMonth ?? 1,
    adminPassword: 'admin',
  });
  return { bookId: book.id, bookName };
}

export async function loginWithNewBook(
  page: Page,
  request: APIRequestContext,
  opts: NewBookOptions = {},
): Promise<E2EBook> {
  const { bookId, bookName } = await createBook(request, opts);
  const book = { id: bookId };
  const login = await callApi<{ token: string; user: unknown; book: unknown }>(
    request,
    'core.auth.login',
    {
      bookId: book.id,
      userCode: 'admin',
      password: 'admin',
    },
  );
  if (opts.seed !== false) await callApi(request, 'core.dev.seedDemo', {}, { token: login.token });
  const session = { token: login.token, bookId: book.id, user: login.user, book: login.book };
  await page.addInitScript(
    (s) => sessionStorage.setItem('caiwu.session', JSON.stringify(s)),
    session,
  );
  return { bookId: book.id, token: login.token, bookName };
}
