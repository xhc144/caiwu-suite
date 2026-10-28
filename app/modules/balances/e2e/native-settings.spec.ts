import { expect, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Settings } from '../shared';
import { test } from './fixture';

type CloseState = { request?: (id: string) => void; replies: { id: string; allowed: boolean }[] };
async function host(page: Page) {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const state: CloseState = { replies: [] };
    Object.assign(window, {
      balancesClose: state,
      caiwuDesktopHost: {
        closing: {
          onRequest: (handler: (id: string) => void) => {
            state.request = handler;
            return () => {
              state.request = undefined;
            };
          },
          respond: (id: string, allowed: boolean) => state.replies.push({ id, allowed }),
        },
      },
    });
  });
}
async function requestClose(page: Page, id: string) {
  await page.evaluate(
    (requestId) =>
      (window as unknown as { balancesClose: CloseState }).balancesClose.request!(requestId),
    id,
  );
}
async function response(page: Page, id: string, allowed: boolean) {
  await expect
    .poll(() =>
      page.evaluate(
        (requestId) =>
          (window as unknown as { balancesClose: CloseState }).balancesClose.replies.find(
            (r) => r.id === requestId,
          )?.allowed,
        id,
      ),
    )
    .toBe(allowed);
}

test('w_zw_ye_1 原生关闭通过共享保护取消/保存，版本冲突保留设置草稿，重新读取后可保存并退出', async ({
  page,
  localServer,
}) => {
  await host(page);
  const { token } = await loginWithNewBook(page, localServer.request);
  await page.goto(`${localServer.url}/m/balances`);
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '展示设置', exact: true });
  await drawer.getByLabel('默认显示级次', { exact: true }).selectOption('-1');
  await requestClose(page, 'cancel');
  const guard = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await expect(guard).toContainText('汇总余额表展示设置');
  await guard.getByRole('button', { name: /取\s*消/ }).click();
  await response(page, 'cancel', false);
  await expect(drawer.getByLabel('默认显示级次', { exact: true })).toHaveValue('-1');
  await callApi(
    localServer.request,
    'm.balances.saveSettings',
    { revision: 0, display: { level: 2, onlyActivity: false } },
    { token },
  );
  await requestClose(page, 'failed');
  await guard.getByRole('button', { name: '保存并继续', exact: true }).click();
  await response(page, 'failed', false);
  await expect(drawer.getByRole('alert')).toContainText('没有覆盖');
  await expect(drawer.getByLabel('默认显示级次', { exact: true })).toHaveValue('-1');
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  await expect(drawer.getByLabel('默认显示级次', { exact: true })).toHaveValue('2');
  await drawer.getByLabel('默认显示级次', { exact: true }).selectOption('-1');
  await drawer.getByLabel('默认辅助显示级次', { exact: true }).selectOption('1');
  await drawer.getByLabel('默认辅助排列', { exact: true }).selectOption('account');
  await requestClose(page, 'saved');
  await guard.getByRole('button', { name: '保存并继续', exact: true }).click();
  await response(page, 'saved', true);
  await expect(drawer).toHaveCount(0);
  const metadata = await callApi<{ settings: Settings }>(
    localServer.request,
    'm.balances.metadata',
    undefined,
    { token, method: 'GET' },
  );
  expect(metadata.settings).toMatchObject({
    revision: 2,
    display: { level: -1, dimensionLevel: 1, dimensionOrder: 'account' },
  });
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  await drawer.getByLabel('默认显示级次', { exact: true }).selectOption('2');
  await requestClose(page, 'discarded');
  await guard.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
  await response(page, 'discarded', true);
  await expect(drawer).toHaveCount(0);
});

test('w_zw_ye_1 保存期间编辑后改回提交值，按最终内容判断可保存并关闭', async ({
  page,
  localServer,
}) => {
  await host(page);
  const { token } = await loginWithNewBook(page, localServer.request);
  await page.goto(`${localServer.url}/m/balances`);
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '展示设置', exact: true });
  await drawer.getByLabel('默认显示级次', { exact: true }).selectOption('3');
  let arrived!: () => void;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/trpc/m.balances.saveSettings**',
    async (route) => {
      arrived();
      await resume;
      await route.continue();
    },
    { times: 1 },
  );
  await requestClose(page, 'same-content');
  await page
    .getByRole('dialog', { name: '有未保存内容', exact: true })
    .getByRole('button', { name: '保存并继续', exact: true })
    .click();
  await pending;
  await drawer.getByLabel('默认显示级次', { exact: true }).selectOption('4');
  await drawer.getByLabel('默认显示级次', { exact: true }).selectOption('3');
  release();
  await response(page, 'same-content', true);
  await expect(drawer).toHaveCount(0);
  const metadata = await callApi<{ settings: Settings }>(
    localServer.request,
    'm.balances.metadata',
    undefined,
    { token, method: 'GET' },
  );
  expect(metadata.settings).toMatchObject({ revision: 1, display: { level: 3 } });
});

test('w_zw_ye_1 保存等待期间的新编辑不丢失，原生关闭回应拒绝，随后可按新版本保存', async ({
  page,
  localServer,
}) => {
  await host(page);
  const { bookId, token } = await loginWithNewBook(page, localServer.request);
  await page.goto(`${localServer.url}/m/balances`);
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '展示设置', exact: true });
  await drawer.getByLabel('默认显示级次', { exact: true }).selectOption('3');
  let arrived!: () => void;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/trpc/m.balances.saveSettings**',
    async (route) => {
      arrived();
      await resume;
      await route.continue();
    },
    { times: 1 },
  );
  await requestClose(page, 'changed');
  await page
    .getByRole('dialog', { name: '有未保存内容', exact: true })
    .getByRole('button', { name: '保存并继续', exact: true })
    .click();
  await pending;
  await drawer.getByLabel('默认显示级次', { exact: true }).selectOption('4');
  release();
  await response(page, 'changed', false);
  await expect(drawer.getByLabel('默认显示级次', { exact: true })).toHaveValue('4');
  const key = `balances.settingsDraft.${bookId}`;
  await expect
    .poll(() =>
      page.evaluate((storageKey) => JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'), key),
    )
    .toMatchObject({ base: { revision: 1, display: { level: 3 } }, display: { level: 4 } });
  await requestClose(page, 'saved');
  await page
    .getByRole('dialog', { name: '有未保存内容', exact: true })
    .getByRole('button', { name: '保存并继续', exact: true })
    .click();
  await response(page, 'saved', true);
  await expect(drawer).toHaveCount(0);
  const metadata = await callApi<{ settings: Settings }>(
    localServer.request,
    'm.balances.metadata',
    undefined,
    { token, method: 'GET' },
  );
  expect(metadata.settings).toMatchObject({ revision: 2, display: { level: 4 } });
});
