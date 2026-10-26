import { callApi } from '@caiwu/testkit/e2e';
import type { Page, Response } from '@playwright/test';
import type { inferRouterOutputs } from '@trpc/server';
import type { InvoiceRouter } from '../server/router';
import { bookWithInvoices } from './data';
import { test, expect, type Isolated } from './isolated';

type VatRows = inferRouterOutputs<InvoiceRouter>['vat'];
const input = (includeUnposted: boolean) => ({ year: 2026, groupBy: 'month', includeUnposted });
const february = (rows: VatRows) => rows.find((r) => r.key === 'input-202602');
const row = (page: Page) =>
  page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '进项', exact: true }) })
    .filter({ has: page.getByRole('cell', { name: '202602', exact: true }) });

function vatResponse(includeUnposted: boolean) {
  return (response: Response) => {
    const url = new URL(response.url());
    const index = url.pathname.split('/trpc/')[1]?.split(',').indexOf('m.invoice.vat') ?? -1;
    if (index < 0 || response.status() !== 200) return false;
    const batch = JSON.parse(url.searchParams.get('input') ?? '{}') as Record<string, unknown>;
    return JSON.stringify(batch[String(index)]) === JSON.stringify(input(includeUnposted));
  };
}

async function expectResponse(response: Response, token: string, book: number) {
  expect(response.request().headers()['authorization']).toBe(`Bearer ${token}`);
  const index = new URL(response.url()).pathname
    .split('/trpc/')[1]!
    .split(',')
    .indexOf('m.invoice.vat');
  const body = (await response.json()) as { result: { data: VatRows } }[];
  expect(february(body[index]!.result.data)).toMatchObject({
    count: 5,
    face: 10000,
    book,
    difference: book - 10000,
  });
}

async function postAndRead(isolated: Isolated, bookId: string, token: string, voucherId: number) {
  await test.step('同账套 core 过账并回读；精确 VAT 请求验证已过账口径', async () => {
    await isolated.inBook(bookId, async (svc) => {
      expect((await svc.book.info()).id).toBe(bookId);
      expect((await svc.vouchers.get(voucherId))?.status).toBe('pending');
      await svc.vouchers.changeStatus({ ids: [voucherId], to: 'audited' });
      await svc.vouchers.changeStatus({ ids: [voucherId], to: 'posted' });
      expect((await svc.vouchers.get(voucherId))?.status).toBe('posted');
      expect((await svc.vouchers.list({ sourceModule: 'invoice' })).total).toBe(1);
    });
    const me = await callApi<{ book: { id: string } }>(
      isolated.request,
      'core.auth.me',
      {},
      {
        token,
        method: 'GET',
      },
    );
    expect(me.book.id).toBe(bookId);
    const rows = await callApi<VatRows>(isolated.request, 'm.invoice.vat', input(false), {
      token,
      method: 'GET',
    });
    expect(february(rows)).toMatchObject({ count: 5, face: 10000, book: 10000, difference: 0 });
  });
}

test('w_fp_zzs_hz：缓存口径切回后显式刷新真实读取最新过账', async ({ page, isolated }) => {
  const { bookId, token, docs } = await bookWithInvoices(page, isolated, 'pending');
  const initial = page.waitForResponse(vatResponse(false));
  await page.goto(`${isolated.origin}/m/invoice/vat?year=2026&groupBy=month&includeUnposted=0`);
  await expectResponse(await initial, token, 0);
  await expect(row(page)).toContainText('-100.00');
  await page.getByLabel('含未过账').check();
  const unposted = page.waitForResponse(vatResponse(true));
  await page.getByRole('button', { name: /^(?:search )?查询$/ }).click();
  await expectResponse(await unposted, token, 10000);
  await expect(row(page).getByRole('cell', { name: '100.00', exact: true })).toHaveCount(2);
  await postAndRead(isolated, bookId, token, docs[0]!.voucherId!);
  await page.getByLabel('含未过账').uncheck();
  const changed = page.waitForResponse(vatResponse(false), { timeout: 5_000 });
  await page.getByRole('button', { name: /^(?:search )?查询$/ }).click();
  await expectResponse(await changed, token, 10000);
  await expect(row(page).getByRole('cell', { name: '100.00', exact: true })).toHaveCount(2);
  const refreshed = page.waitForResponse(vatResponse(false));
  await page.getByRole('button', { name: '刷新比对', exact: true }).click();
  await expectResponse(await refreshed, token, 10000);
  await expect(row(page).getByRole('cell', { name: '100.00', exact: true })).toHaveCount(2);
  await expect(row(page).getByRole('cell', { name: '0.00', exact: true })).toHaveCount(1);
});

test('w_fp_zzs_hz：标签切回重新读取过账状态，保留其他标签输入', async ({ page, isolated }) => {
  const { bookId, token, docs } = await bookWithInvoices(page, isolated, 'pending');
  const initial = page.waitForResponse(vatResponse(false));
  await page.goto(`${isolated.origin}/m/invoice/vat?year=2026&groupBy=month&includeUnposted=0`);
  await expectResponse(await initial, token, 0);
  await expect(row(page)).toContainText('-100.00');
  await page.getByRole('menuitem', { name: '进项发票', exact: true }).click();
  await page.getByLabel('单位', { exact: true }).fill('保留未提交的筛选');
  await postAndRead(isolated, bookId, token, docs[0]!.voucherId!);
  const reactivated = page.waitForResponse(vatResponse(false));
  await page.getByRole('tab', { name: '增值税比对', exact: true }).click();
  await expectResponse(await reactivated, token, 10000);
  await expect(row(page).getByRole('cell', { name: '100.00', exact: true })).toHaveCount(2);
  await expect(row(page).getByRole('cell', { name: '0.00', exact: true })).toHaveCount(1);
  await expect(page.getByRole('status')).toContainText('最近读取时间：');
  await page.getByRole('tab', { name: '进项发票', exact: true }).click();
  await expect(page.getByLabel('单位', { exact: true })).toHaveValue('保留未提交的筛选');
});

test('w_fp_zzs_hz：刷新中的旧真实响应晚到，不覆盖再次刷新的已过账结果', async ({
  page,
  isolated,
}) => {
  const { bookId, token, docs } = await bookWithInvoices(page, isolated, 'pending');
  const initial = page.waitForResponse(vatResponse(false));
  await page.goto(`${isolated.origin}/m/invoice/vat?year=2026&groupBy=month&includeUnposted=0`);
  await expectResponse(await initial, token, 0);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: (rows: VatRows) => void;
  const oldRows = new Promise<VatRows>((resolve) => {
    captured = resolve;
  });
  let delivered!: () => void;
  const delivery = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let holdNext = true;
  await page.route('**/trpc/**', async (route) => {
    if (!holdNext || !route.request().url().includes('m.invoice.vat')) {
      await route.continue();
      return;
    }
    holdNext = false;
    const response = await route.fetch();
    const body = (await response.json()) as { result: { data: VatRows } }[];
    captured(body[0]!.result.data);
    await gate;
    await route.fulfill({ response });
    delivered();
  });
  try {
    await page.getByRole('button', { name: '刷新比对', exact: true }).click();
    expect(february(await oldRows)).toMatchObject({
      count: 5,
      face: 10000,
      book: 0,
      difference: -10000,
    });
    await expect(page.getByRole('status')).toHaveText('正在读取最新比对数据…');
    await postAndRead(isolated, bookId, token, docs[0]!.voucherId!);
    const refreshed = page.waitForResponse(vatResponse(false));
    await page.getByRole('button', { name: '刷新比对', exact: true }).click();
    await expectResponse(await refreshed, token, 10000);
    await expect(row(page).getByRole('cell', { name: '100.00', exact: true })).toHaveCount(2);
    release();
    await delivery;
    await expect(row(page).getByRole('cell', { name: '100.00', exact: true })).toHaveCount(2);
    await expect(row(page).getByRole('cell', { name: '0.00', exact: true })).toHaveCount(1);
    await expect(page.getByRole('status')).toContainText('最近读取时间：');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
