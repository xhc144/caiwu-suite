import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

async function stockFixture(page: Page, request: APIRequestContext, withCount = false) {
  const book = await loginWithNewBook(page, request, { product: 'chengben' });
  const { token } = book;
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token, method: 'GET' },
  );
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.inventory.${name}`, input, { token, method: 'POST' });
  const warehouseId = await post<number>('saveWarehouse', { code: '01', name: '核算仓库' });
  await post('saveProduct', {
    code: 'P1',
    name: '核算产品',
    inventoryAccountId: id('1405'),
    salesAccountId: id('6001'),
  });
  await post('saveOpening', {
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '1' }],
  });
  const document = (kind: 'receipt' | 'issue', q: string, price: string) =>
    post<{ id: number }>('saveDocument', {
      requestKey: `e2e-${kind}-costing`,
      kind,
      warehouseId,
      number: kind === 'receipt' ? 'RK01' : 'CK01',
      date: '2026-01-10',
      category: kind === 'receipt' ? '采购' : '销售',
      accountId: id('1001'),
      costAccountId: id('6401'),
      lines: [{ productCode: 'P1', quantity: q, unitPrice: price }],
    });
  const receipt = await document('receipt', '10', '3');
  const sale = await document('issue', '5', '10');
  let countId: number | null = null;
  if (withCount) {
    await post('generateCount', { warehouseId, period: 202601, revision: 0, confirmed: true });
    const count = await callApi<{ id: number; revision: number }>(
      request,
      'm.inventory.count',
      { warehouseId, period: 202601 },
      { token, method: 'GET' },
    );
    countId = count.id;
    await post('saveCount', {
      warehouseId,
      period: 202601,
      revision: count.revision,
      rows: [{ productCode: 'P1', actual: '14' }],
    });
  }
  return { ...book, receipt, sale, countId };
}

async function calculate(page: Page) {
  await page.goto('/m/costing/calculation');
  await expect(page.getByRole('heading', { name: '成本核算', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重新试算', exact: true }).click();
  const cost = page.getByRole('row').filter({ hasText: '核算产品' });
  await expect(cost).toContainText('10.00');
  await expect(cost).toContainText('30.00');
  await page.getByRole('button', { name: '正式核算', exact: true }).click();
  await page.getByRole('button', { name: '确认核算', exact: true }).click();
  await expect(page.getByText('已核算至 202601，下次核算 202602')).toBeVisible();
}

async function generate(page: Page, documentId: number, purpose: 'receipt' | 'revenue' | 'cost') {
  await page.goto(`/m/costing/vouchers?id=${documentId}&purpose=${purpose}`);
  await page.getByRole('button', { name: '预览凭证', exact: true }).click();
  await expect(page.getByText(/预览借方/)).toBeVisible();
  await page.getByRole('button', { name: '生成凭证', exact: true }).click();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成凭证', exact: true })).toBeDisabled();
}

test('w_cb_hz/w_cb_pz/w_cb_fgz 正式核算→收入成本双凭证→重生成→删除→取消最后核算', async ({
  page,
  request,
}) => {
  const { token, receipt, sale } = await stockFixture(page, request);
  await calculate(page);
  await generate(page, receipt.id, 'receipt');
  await generate(page, sale.id, 'revenue');
  await generate(page, sale.id, 'cost');
  await expect(page.getByRole('row').filter({ hasText: '销售收入' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: '出库成本' })).toHaveCount(3);
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('将删除 1 张凭证');
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByText('凭证已重新生成', { exact: true })).toBeVisible();
  const vouchers = await callApi<{ total: number }>(
    request,
    'core.vouchers.list',
    {},
    { token, method: 'GET' },
  );
  expect(vouchers.total).toBe(3);
  await page.getByRole('button', { name: '删除本用途凭证', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('删除后保留其他凭证编号');
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成凭证', exact: true })).toBeEnabled();
  await page.goto('/m/costing/calculation');
  await page.getByRole('button', { name: '取消最后核算', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('将取消 202601');
  await page.getByRole('button', { name: '确认取消核算', exact: true }).click();
  await expect(page.getByText('请先试算并核对结果，再正式核算')).toBeVisible();
  await page.getByRole('button', { name: '重新试算', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '核算产品' })).toContainText('10.00');
});

test('w_cb_hzsj_cblr/w_ck_xsmxz 收入成本利润和销售明细支持真实Excel下载及A4打印', async ({
  page,
  request,
}) => {
  await stockFixture(page, request);
  await calculate(page);
  for (const [route, title] of [
    ['profit', '收入成本利润表'],
    ['sales', '销售明细账'],
  ]) {
    await page.goto(`/m/costing/${route}`);
    await expect(page.getByRole('heading', { name: title!, exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查询销售明细', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: '核算产品' });
    await expect(row).toContainText('50.00');
    await expect(row).toContainText('10.00');
    await expect(row).toContainText('40.00');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`${title}_2026-01-01_2026-01-31.xlsx`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile((await file.path())!);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(1).getCell(1).text).toContain('金额单位：元');
    expect(sheet.getRow(1).getCell(1).text).toContain('E2E 测试单位');
    expect(sheet.getRow(4).values).toContain('合计');
    expect(sheet.getRow(4).values).toContain(40);
    expect(sheet.getRow(3).values).toContain(50);
    expect(sheet.getRow(3).values).toContain(10);
    expect(sheet.getRow(3).values).toContain(40);
    await page.evaluate(() => {
      const target = window as typeof window & { __costingPrinted?: string };
      target.caiwuDesktop = {
        print: async (html) => {
          target.__costingPrinted = html;
        },
        printToPdf: async () => null,
      };
    });
    await page.getByRole('button', { name: '打印', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as typeof window & { __costingPrinted?: string }).__costingPrinted ?? '',
        ),
      )
      .toContain('A4 landscape');
    const printed = await page.evaluate(
      () => (window as typeof window & { __costingPrinted?: string }).__costingPrinted!,
    );
    expect(printed).toContain(title);
    expect(printed).toContain('40.00');
    expect(printed).toContain('金额单位：元');
  }
});

test('w_cb_pdk/w_cb_pz 盘点核算差异可以生成并删除凭证', async ({ page, request }) => {
  const { countId } = await stockFixture(page, request, true);
  await calculate(page);
  await page.goto(`/m/costing/vouchers?countId=${countId}&purpose=count`);
  await page.getByRole('combobox', { name: '待处理财产损溢科目', exact: true }).fill('6401');
  await page.getByRole('combobox', { name: '待处理财产损溢科目', exact: true }).press('Enter');
  await page.getByRole('button', { name: '预览凭证', exact: true }).click();
  await expect(page.getByText('预览借方 2.00；贷方 2.00')).toBeVisible();
  await page.getByRole('button', { name: '生成凭证', exact: true }).click();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成凭证', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '删除本用途凭证', exact: true }).click();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成凭证', exact: true })).toBeEnabled();
});

test('w_cb_pz 收入科目配置失效时仍可查看并独立删除既有凭证', async ({ page, request }) => {
  const { token, sale } = await stockFixture(page, request);
  await generate(page, sale.id, 'revenue');
  const products = await callApi<
    {
      id: number;
      revision: number;
      code: string;
      name: string;
      inventoryAccountId: number | null;
    }[]
  >(request, 'm.inventory.products', {}, { token, method: 'GET' });
  await callApi(
    request,
    'm.inventory.saveProduct',
    { ...products[0]!, salesAccountId: null },
    { token, method: 'POST' },
  );
  await page.goto(`/m/costing/vouchers?documentId=${sale.id}&purpose=revenue`);
  await expect(page.getByRole('link', { name: '记-0001', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览凭证', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /^销售收入科目没有录入$/ })).toBeVisible();
  await page.getByRole('button', { name: '删除本用途凭证', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('将删除 1 张凭证');
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('link', { name: '记-0001', exact: true })).toHaveCount(0);
  const vouchers = await callApi<{ total: number }>(
    request,
    'core.vouchers.list',
    {},
    { token, method: 'GET' },
  );
  expect(vouchers.total).toBe(0);
});
