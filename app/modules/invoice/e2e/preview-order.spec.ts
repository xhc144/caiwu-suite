import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Page, Response } from '@playwright/test';
import type { Invoice } from '../shared';
import { single } from '../test/fixtures';
import { createInvoiceAccounts } from './data';
import { test, expect, type Isolated } from './isolated';

const previewUrl = (url: URL) =>
  url.pathname.split('/trpc/')[1]?.split(',').includes('m.invoice.previewVoucher') ?? false;
function matches(response: Response, origin: string, token: string, date: string) {
  const url = new URL(response.url());
  const index =
    url.pathname.split('/trpc/')[1]?.split(',').indexOf('m.invoice.previewVoucher') ?? -1;
  if (
    url.origin !== origin ||
    index < 0 ||
    response.status() !== 200 ||
    response.request().headers()['authorization'] !== `Bearer ${token}`
  )
    return false;
  const input = JSON.parse(url.searchParams.get('input') ?? '{}') as Record<
    string,
    { date?: string }
  >;
  return input[String(index)]?.date === date;
}
async function setup(page: Page, isolated: Isolated) {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'qingsong' });
  const cfg = await isolated.inBook(bookId, createInvoiceAccounts);
  await callApi(isolated.request, 'm.invoice.saveSettings', cfg, { token });
  await callApi(
    isolated.request,
    'm.invoice.save',
    { data: single({ number: 'PREVIEW-ORDER', date: '2026-02-05', confirmDate: '2026-02-05' }) },
    { token },
  );
  const docs = await callApi<Invoice[]>(
    isolated.request,
    'm.invoice.list',
    {},
    { token, method: 'GET' },
  );
  await callApi(
    isolated.request,
    'm.invoice.audit',
    { selection: docs.map(({ id, revision }) => ({ id, revision })), to: 'audited' },
    { token },
  );
  await page.goto(`${isolated.origin}/m/invoice/process?direction=input&period=202602`);
  await page.getByRole('columnheader').getByRole('checkbox').check();
  await page.getByLabel('凭证日期', { exact: true }).fill('2026-02-28');
  await page.getByLabel('凭证字', { exact: true }).click();
  await page.getByText('记账凭证', { exact: true }).click();
  let release!: () => void;
  let seen!: () => void;
  let count = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route(previewUrl, async (route) => {
    const order = ++count;
    const response = await route.fetch();
    if (order === 1) {
      seen();
      await gate;
    }
    await route.fulfill({ response });
  });
  const oldResponse = page.waitForResponse((r) => matches(r, isolated.origin, token, '2026-02-28'));
  await page.getByRole('button', { name: '预览分录', exact: true }).click();
  await held;
  return { bookId, token, release, oldResponse };
}
async function settle(page: Page, response: Response) {
  await response.finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test('w_fp_pz：旧真实预览晚到不能覆盖新日期和制证方式，确认只使用新输入', async ({
  page,
  isolated,
}) => {
  const { bookId, token, release, oldResponse } = await setup(page, isolated);
  try {
    await page.getByLabel('凭证日期', { exact: true }).fill('2026-02-27');
    await page.getByLabel('制证方式', { exact: true }).click();
    await page.getByText('每票一张凭证', { exact: true }).click();
    const latest = page.waitForResponse((r) => matches(r, isolated.origin, token, '2026-02-27'));
    await page.getByRole('button', { name: '预览分录', exact: true }).click();
    await latest;
    await expect(page.getByText(/凭证日期 2026-02-27，发票月份 202602/)).toBeVisible();
    release();
    await settle(page, await oldResponse);
    await expect(page.getByText(/凭证日期 2026-02-27，发票月份 202602/)).toBeVisible();
    await expect(page.getByText(/凭证日期 2026-02-28，发票月份 202602/)).toHaveCount(0);
    await page.getByRole('button', { name: '确认生成凭证', exact: true }).click();
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await expect(page.getByText('凭证预览（尚未保存）', { exact: true })).toBeHidden();
    const docs = await callApi<Invoice[]>(
      isolated.request,
      'm.invoice.list',
      {},
      { token, method: 'GET' },
    );
    await isolated.inBook(bookId, async (svc) => {
      const voucher = (await svc.vouchers.get(docs[0]!.voucherId!))!;
      expect(voucher.date).toBe('2026-02-27');
      expect((await svc.vouchers.list({ sourceModule: 'invoice' })).total).toBe(1);
    });
  } finally {
    release();
  }
});

test('w_fp_pz：等待预览时清空所选，旧真实响应返回也不能恢复可确认计划', async ({
  page,
  isolated,
}) => {
  const { bookId, token, release, oldResponse } = await setup(page, isolated);
  try {
    await page.getByRole('columnheader').getByRole('checkbox').uncheck();
    release();
    await settle(page, await oldResponse);
    await expect(page.getByText('凭证预览（尚未保存）', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '确认生成凭证', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '预览分录', exact: true })).toBeDisabled();
    await isolated.inBook(bookId, async (svc) => {
      expect((await svc.vouchers.list({ sourceModule: 'invoice' })).total).toBe(0);
    });
    const docs = await callApi<Invoice[]>(
      isolated.request,
      'm.invoice.list',
      {},
      { token, method: 'GET' },
    );
    expect(docs[0]!.state).toBe('audited');
  } finally {
    release();
  }
});
