import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

test('w_xt_fbwh：汇率取消继续、校验失败留稿，保存后Ctrl+F4关闭标签；预设未来期间不改变当前账期', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  await page.goto('/m/masterdata/reference?kind=currencies');
  const openRates = () =>
    page
      .getByRole('row')
      .filter({ hasText: 'USD' })
      .getByRole('button', { name: '汇率', exact: true })
      .click();
  await openRates();
  const drawer = page.getByRole('dialog', { name: 'USD 期间汇率', exact: true });
  await drawer.getByLabel('期间（年月）', { exact: true }).fill('202712');
  await drawer.getByLabel('汇率', { exact: true }).fill('7.123456789');
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: '有未保存的修改', exact: true });
  await unsaved.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(drawer.getByLabel('汇率', { exact: true })).toHaveValue('7.123456789');
  await drawer.getByLabel('汇率', { exact: true }).fill('0');
  await page.keyboard.press('Control+F4');
  await unsaved.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(page.getByText('汇率必须是正十进制字符串', { exact: true })).toBeVisible();
  await expect(drawer.getByLabel('汇率', { exact: true })).toHaveValue('0');
  await unsaved.getByRole('button', { name: '继续编辑', exact: true }).click();
  await drawer.getByLabel('汇率', { exact: true }).fill('7.123456789');
  await page.keyboard.press('Control+F4');
  await unsaved.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('dialog', { name: '有未保存内容', exact: true })).not.toBeVisible();
  const result = await callApi<{ rates: { period: number; rate: string }[] }>(
    request,
    'm.masterdata.reference.rates',
    { currency: 'USD' },
    { token: book.token, method: 'GET' },
  );
  expect(result.rates).toContainEqual({
    currency_code: 'USD',
    period: 202712,
    rate: '7.123456789',
  });
  const period = await callApi<{ period: number }>(request, 'core.periods.current', undefined, {
    token: book.token,
  });
  expect(period.period).toBe(202601);
});

test('w_xt_bmwh：修改分级规则关闭前可保存、放弃，保存失败保留原输入和现有档案', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/masterdata/dimensions?type=department');
  await page.getByRole('button', { name: '分级规则', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '分级规则', exact: true });
  await drawer.getByLabel('每级长度', { exact: true }).fill('3-2');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: '有未保存的修改', exact: true });
  await unsaved.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(drawer.getByLabel('每级长度', { exact: true })).toHaveValue('3-2');
  await expect(unsaved).toBeVisible();
  await unsaved.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '行政部' })).toBeVisible();
});

test('w_xt_fbwh：桌面退出请求使用实际汇率草稿；失败和取消拒绝退出，放弃后才允许', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      masterdataClose?: {
        request?: (id: string) => void;
        results: { id: string; allowed: boolean }[];
      };
      caiwuDesktopHost?: unknown;
    };
    host.masterdataClose = { results: [] };
    host.caiwuDesktopHost = {
      closing: {
        onRequest: (callback: (id: string) => void) => {
          host.masterdataClose!.request = callback;
          return () => {
            host.masterdataClose!.request = undefined;
          };
        },
        respond: (id: string, allowed: boolean) =>
          host.masterdataClose!.results.push({ id, allowed }),
      },
    };
  });
  await loginWithNewBook(page, request);
  await page.goto('/m/masterdata/reference?kind=currencies');
  await page
    .getByRole('row')
    .filter({ hasText: 'USD' })
    .getByRole('button', { name: '汇率', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: 'USD 期间汇率', exact: true });
  await drawer.getByLabel('汇率', { exact: true }).fill('0');
  const close = (id: string) =>
    page.evaluate((requestId) => {
      const host = window as Window & { masterdataClose?: { request?: (id: string) => void } };
      if (!host.masterdataClose?.request) throw new Error('未注册退出监听');
      host.masterdataClose.request(requestId);
    }, id);
  const results = () =>
    page.evaluate(
      () =>
        (window as Window & { masterdataClose?: { results: { id: string; allowed: boolean }[] } })
          .masterdataClose?.results,
    );
  await close('failed');
  const dialog = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await expect(dialog).toContainText('USD 期间汇率');
  await dialog.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect.poll(results).toEqual([{ id: 'failed', allowed: false }]);
  await expect(drawer.getByLabel('汇率', { exact: true })).toHaveValue('0');
  await close('cancel');
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect.poll(results).toEqual([
    { id: 'failed', allowed: false },
    { id: 'cancel', allowed: false },
  ]);
  await close('discard');
  await dialog.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
  await expect.poll(results).toEqual([
    { id: 'failed', allowed: false },
    { id: 'cancel', allowed: false },
    { id: 'discard', allowed: true },
  ]);
  await expect(drawer.getByLabel('汇率', { exact: true })).toHaveValue('');
  await drawer.getByLabel('汇率', { exact: true }).fill('7.77');
  await close('changed');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await drawer.getByLabel('汇率', { exact: true }).fill('');
  await close('restored');
  await expect.poll(results).toEqual([
    { id: 'failed', allowed: false },
    { id: 'cancel', allowed: false },
    { id: 'discard', allowed: true },
    { id: 'changed', allowed: false },
    { id: 'restored', allowed: true },
  ]);
  await expect(dialog).not.toBeVisible();
});
