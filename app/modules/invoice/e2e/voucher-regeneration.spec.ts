import type { Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Voucher } from '@caiwu/core';
import type { Invoice } from '../shared';
import { single } from '../test/fixtures';
import { createInvoiceAccounts, bookWithInvoices } from './data';
import { test, expect, type Isolated } from './isolated';

async function chooseVoucher(page: Page) {
  await page.getByLabel('凭证日期', { exact: true }).fill('2026-02-28');
  await page.getByLabel('凭证字', { exact: true }).click();
  await page.getByText('记账凭证', { exact: true }).click();
}
async function foreignBook(page: Page, isolated: Isolated) {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const cfg = await isolated.inBook(bookId, async (svc) => {
    const cfg = await createInvoiceAccounts(svc);
    const scheme = (await svc.book.info()).codeScheme;
    const business = await svc.accounts.create(
      {
        code: '9801',
        name: '合成外币数量收入',
        categoryId: 'pnl',
        currency: 'USD',
        quantityUnit: '件',
      },
      scheme,
    );
    const settlement = await svc.accounts.create(
      { code: '9802', name: '合成外币往来', categoryId: 'asset', currency: 'USD' },
      scheme,
    );
    return {
      ...cfg,
      business: { accountId: business.id, dimensions: {} },
      settlement: { accountId: settlement.id, dimensions: {} },
    };
  });
  await callApi(isolated.request, 'm.invoice.saveSettings', cfg, { token });
  await callApi(
    isolated.request,
    'm.invoice.save',
    {
      data: single({
        number: 'FX-E2E',
        date: '2026-02-05',
        confirmDate: '2026-02-05',
        amount: 7100,
        tax: 710,
        total: 7810,
        lines: [
          {
            name: '合成商品',
            unit: '件',
            quantity: '2',
            unitPrice: '35.5',
            taxRate: '0.1',
            taxMark: 'rate',
            amount: 7100,
            tax: 710,
            total: 7810,
          },
        ],
      }),
    },
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
  return { bookId, token };
}

test('w_fp_pz：外币数量输入可保存、重新载入后恢复并生成真实凭证', async ({ page, isolated }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const { token } = await foreignBook(page, isolated);
  await page.goto(`${isolated.origin}/m/invoice/process?direction=input&period=202602`);
  await page.getByRole('columnheader').getByRole('checkbox').check();
  await chooseVoucher(page);
  await page.getByLabel('发票 FX-E2E 9801原币金额', { exact: true }).fill('10');
  await page.getByLabel('发票 FX-E2E 9801汇率', { exact: true }).fill('7.1');
  await page.getByLabel('发票 FX-E2E 9802原币金额', { exact: true }).fill('11');
  await page.getByLabel('发票 FX-E2E 9802汇率', { exact: true }).fill('7.1');
  await expect(page.getByLabel('发票 FX-E2E 9801数量', { exact: true })).toHaveValue('2');
  const saveUrl = (url: URL) => url.pathname.includes('m.invoice.saveProcessDraft');
  await page.route(saveUrl, (route) => route.abort('failed'));
  const failed = page.waitForEvent('requestfailed', (request) =>
    request.url().includes('m.invoice.saveProcessDraft'),
  );
  await page.getByRole('button', { name: '保存制证输入', exact: true }).click();
  await failed;
  await expect(page.getByRole('button', { name: '保存制证输入', exact: true })).toBeEnabled();
  await expect(page.getByLabel('发票 FX-E2E 9801原币金额', { exact: true })).toHaveValue('10.00');
  expect(pageErrors).toEqual([]);
  await page.unroute(saveUrl);
  const saved = page.waitForResponse(
    (r) => r.url().includes('m.invoice.saveProcessDraft') && r.status() === 200,
  );
  await page.getByRole('button', { name: '保存制证输入', exact: true }).click();
  await saved;
  await expect(page.getByRole('button', { name: '保存制证输入', exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: '恢复制证输入', exact: true }).click();
  await expect(page.getByLabel('发票 FX-E2E 9801原币金额', { exact: true })).toHaveValue('10.00');
  await expect(page.getByLabel('发票 FX-E2E 9802汇率', { exact: true })).toHaveValue('7.1');
  await page.getByRole('button', { name: '预览分录', exact: true }).click();
  await expect(page.getByText('凭证预览（尚未保存）', { exact: true })).toBeVisible();
  const generated = page.waitForResponse(
    (r) => r.url().includes('m.invoice.generate') && r.status() === 200,
  );
  await page.getByRole('button', { name: '确认生成凭证', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await generated;
  const docs = await callApi<Invoice[]>(
    isolated.request,
    'm.invoice.list',
    {},
    { token, method: 'GET' },
  );
  const voucher = await callApi<Voucher>(
    isolated.request,
    'core.vouchers.get',
    { id: docs[0]!.voucherId },
    { token, method: 'GET' },
  );
  expect(voucher.lines.find((l) => l.accountCode === '9801')).toMatchObject({
    currency: 'USD',
    fcAmount: 1000,
    exchangeRate: '7.1',
    quantity: '2',
    unitPrice: '35.5',
    debit: 7100,
  });
  expect(voucher.debitTotal).toBe(7810);
  expect(voucher.creditTotal).toBe(7810);
  expect(
    await callApi(isolated.request, 'm.invoice.processDraft', undefined, { token, method: 'GET' }),
  ).toBeNull();
});

test('w_fp_pz：已制证整组选择、明确确认后一次撤销和重新生成', async ({ page, isolated }) => {
  const { token, docs } = await bookWithInvoices(page, isolated, 'pending');
  const originalGroup = docs[0]!.groupId;
  await page.goto(`${isolated.origin}/m/invoice/process?direction=input&period=202602`);
  await page.getByRole('checkbox', { name: '全部重新生成（包含已制证发票）', exact: true }).check();
  await page.getByRole('columnheader').getByRole('checkbox').check();
  await chooseVoucher(page);
  await page.getByRole('button', { name: '预览分录', exact: true }).click();
  await expect(page.getByText('将整体撤销并重新生成', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认生成凭证', exact: true })).toBeDisabled();
  await page
    .getByRole('checkbox', { name: '已核对原凭证与编号影响，确认撤销并重新生成', exact: true })
    .check();
  const saved = page.waitForResponse(
    (r) => r.url().includes('m.invoice.generate') && r.status() === 200,
  );
  await page.getByRole('button', { name: '确认生成凭证', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await saved;
  const current = await callApi<Invoice[]>(
    isolated.request,
    'm.invoice.list',
    {},
    { token, method: 'GET' },
  );
  expect(current).toHaveLength(5);
  expect(current.every((d) => d.state === 'generated' && d.groupId !== originalGroup)).toBe(true);
  const groups = await callApi<{ id: number; revoked: number; voucher_id: number | null }[]>(
    isolated.request,
    'm.invoice.groups',
    {},
    { token, method: 'GET' },
  );
  expect(groups.find((g) => g.id === originalGroup)).toMatchObject({
    revoked: 1,
    voucher_id: null,
  });
});

test('w_fp_pz：生成请求失败后保留原凭证与全部输入，可直接重试', async ({ page, isolated }) => {
  const { token, docs } = await bookWithInvoices(page, isolated, 'pending');
  await page.goto(`${isolated.origin}/m/invoice/process?direction=input&period=202602`);
  await page.getByRole('checkbox', { name: '全部重新生成（包含已制证发票）', exact: true }).check();
  await page.getByRole('columnheader').getByRole('checkbox').check();
  await chooseVoucher(page);
  await page.getByRole('button', { name: '预览分录', exact: true }).click();
  await page
    .getByRole('checkbox', { name: '已核对原凭证与编号影响，确认撤销并重新生成', exact: true })
    .check();
  let failOnce = true;
  await page.route(
    (url) => url.pathname.includes('m.invoice.generate'),
    async (route) => {
      if (failOnce) {
        failOnce = false;
        await route.abort('failed');
      } else await route.continue();
    },
  );
  await page.getByRole('button', { name: '确认生成凭证', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认生成凭证', exact: true })).toBeEnabled();
  expect(
    await callApi<Invoice[]>(isolated.request, 'm.invoice.list', {}, { token, method: 'GET' }),
  ).toEqual(docs);
  await expect(page.getByText('将整体撤销并重新生成', { exact: true })).toBeVisible();
  const generated = page.waitForResponse(
    (r) => r.url().includes('m.invoice.generate') && r.status() === 200,
  );
  await page.getByRole('button', { name: '确认生成凭证', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await generated;
  const current = await callApi<Invoice[]>(
    isolated.request,
    'm.invoice.list',
    {},
    { token, method: 'GET' },
  );
  expect(current.every((d) => d.groupId !== docs[0]!.groupId)).toBe(true);
});
