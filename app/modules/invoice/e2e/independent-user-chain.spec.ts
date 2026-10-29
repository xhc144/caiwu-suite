import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Voucher } from '@caiwu/core';
import type { Invoice } from '../shared';
import { test, expect } from './isolated';

test('独立用户链：页面审核原票→页面出库→页面唯一收入→页面成本，票面尾差和库存一致', async ({
  page,
  isolated,
}, testInfo) => {
  const book = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(isolated.request, name, input, { token: book.token, method: 'GET' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(isolated.request, name, input, { token: book.token });
  const accounts = await get<{ id: number; code: string }[]>('core.accounts.list');
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  const customers = await get<{ id: number; code: string }[]>('core.dimensions.items', {
    type: 'partner',
  });
  await post('m.invoice.saveSettings', {
    direction: 'output',
    expectedRevision: 0,
    taxpayerBasis: 'other',
    inputTaxTreatment: 'separate',
    settlementMode: 'unified',
    business: { accountId: id('6001'), dimensions: {} },
    tax: { accountId: id('22210102'), dimensions: {} },
    settlement: {
      accountId: id('1122'),
      dimensions: { partner: customers.find((p) => p.code === 'C001')!.id },
    },
    nonDeductible: { accountId: id('6401'), dimensions: {} },
  });
  const warehouseId = await post<number>('m.inventory.saveWarehouse', {
    code: 'UI-CHECK',
    name: '独立用户验收仓',
  });
  await post('m.inventory.saveProduct', {
    code: 'UI-CHECK-P',
    name: '独立用户验收商品',
    unit: '件',
    inventoryAccountId: id('1405'),
    salesAccountId: id('6001'),
  });
  await post('m.inventory.saveOpening', {
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'UI-CHECK-P', quantity: '10', unitPrice: '3' }],
  });
  const invoiceId = await post<number>('m.invoice.save', {
    data: {
      direction: 'output',
      number: 'INDEPENDENT-UI-INVOICE',
      date: '2026-01-05',
      sellerName: '独立验收销方',
      sellerTaxId: 'UI-INDEPENDENT',
      buyerName: '独立验收客户',
      kind: '测试票',
      amount: 10001,
      tax: 1300,
      total: 11301,
      lines: [
        {
          name: '独立用户验收商品',
          unit: '件',
          quantity: '2',
          unitPrice: '50.005',
          taxRate: '0.13',
          taxMark: 'rate',
          amount: 10001,
          tax: 1300,
          total: 11301,
        },
      ],
    },
  });
  const current = async () => (await get<Invoice[]>('m.invoice.list', { id: invoiceId }))[0]!;

  await test.step('页面审核真实原票', async () => {
    await page.goto(`${isolated.origin}/m/invoice/output?period=202601`);
    const row = page.getByRole('row').filter({ hasText: 'INDEPENDENT-UI-INVOICE' });
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: '审核所选', exact: true }).click();
    await expect(row).toContainText('已审核');
    expect(await current()).toMatchObject({ state: 'audited', revision: 2 });
  });
  await test.step('页面按原票出库，未生成收入凭证', async () => {
    await page.goto(`${isolated.origin}/m/invoice/issue?period=202601`);
    await page
      .getByRole('row')
      .filter({ hasText: 'INDEPENDENT-UI-INVOICE' })
      .getByRole('radio')
      .check();
    await page.getByLabel('出库日期', { exact: true }).fill('2026-01-05');
    await page.getByLabel('出库单号', { exact: true }).fill('INDEPENDENT-UI-OUT');
    await page.getByLabel('销售成本科目', { exact: true }).fill('6401');
    await page.getByLabel('销售成本科目', { exact: true }).press('Enter');
    await page.getByRole('button', { name: '预览出库单', exact: true }).click();
    await expect(page.getByText('出库单预览（尚未保存）', { exact: true })).toBeVisible();
    const response = page.waitForResponse((r) => r.url().includes('m.invoice.saveIssue'));
    await page.getByRole('button', { name: '确认转出库', exact: true }).click();
    await page.getByRole('button', { name: '确定', exact: true }).click();
    expect((await response).ok()).toBe(true);
    expect(await current()).toMatchObject({ state: 'issued', voucherId: null });
    expect((await get<{ total: number }>('core.vouchers.list', {})).total).toBe(0);
    expect(
      (await get<{ balance: string }[]>('m.inventory.stock', { warehouseId }))[0]?.balance,
    ).toBe('8');
  });
  await test.step('页面生成唯一收入，阻止成本模块重复收入', async () => {
    await page.goto(`${isolated.origin}/m/invoice/process?direction=output&period=202601`);
    const row = page.getByRole('row').filter({ hasText: 'INDEPENDENT-UI-INVOICE' });
    await row.getByRole('checkbox').check();
    await page.getByLabel('凭证日期', { exact: true }).fill('2026-01-05');
    await page.getByLabel('凭证字', { exact: true }).click();
    await page.getByText('记账凭证', { exact: true }).click();
    await page.getByRole('button', { name: '预览分录', exact: true }).click();
    await expect(page.getByText('凭证预览（尚未保存）', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认生成凭证', exact: true }).click();
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await expect(row).toContainText('已转出库、已制证');
    const invoice = await current();
    const revenue = await get<Voucher>('core.vouchers.get', { id: invoice.voucherId });
    expect(revenue.lines.map((l) => [l.debit, l.credit])).toEqual([
      [11301, 0],
      [0, 10001],
      [0, 1300],
    ]);
    await expect(
      get('m.costing.previewVoucher', {
        documentId: invoice.inventoryDocumentId,
        purpose: 'revenue',
      }),
    ).rejects.toThrow(/发票/);
  });
  await test.step('正式核算后在成本页面真实生成成本凭证', async () => {
    const plan = await get<{ fingerprint: string }>('m.costing.preview', { period: 202601 });
    await post('m.costing.commit', {
      period: 202601,
      fingerprint: plan.fingerprint,
      requestKey: crypto.randomUUID(),
      confirmed: true,
    });
    const invoice = await current();
    await page.goto(
      `${isolated.origin}/m/costing/vouchers?documentId=${invoice.inventoryDocumentId}&purpose=cost`,
    );
    await page.getByRole('button', { name: '预览凭证', exact: true }).click();
    await expect(page.getByText('预览借方 6.00；贷方 6.00', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '生成凭证', exact: true }).click();
    await page.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(page.getByRole('button', { name: '生成凭证', exact: true })).toBeDisabled();
    const vouchers = await get<{ total: number; items: Voucher[] }>('core.vouchers.list', {});
    expect(vouchers.total).toBe(2);
    const cost = await get<Voucher>('core.vouchers.get', {
      id: vouchers.items.find((v) => v.id !== invoice.voucherId)!.id,
    });
    expect(cost.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [id('6401'), 600, 0],
      [id('1405'), 0, 600],
    ]);
    expect(
      (await get<{ balance: string }[]>('m.inventory.stock', { warehouseId }))[0]?.balance,
    ).toBe('8');
    await page.screenshot({
      path: testInfo.outputPath('independent-invoice-income-cost.png'),
      animations: 'disabled',
    });
  });
});
