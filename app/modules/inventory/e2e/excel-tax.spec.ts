import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { formatMoney } from '@caiwu/core';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
const headers = ['产品编号', '数量', '单价（元）', '含税口径（是/否）', '说明'];
async function openReceipt(page: Page, number: string) {
  await page.goto('/m/inventory/receipts');
  await page.getByRole('button', { name: '新增入库单', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增入库单', exact: true });
  await drawer.getByLabel('单号', { exact: true }).fill(number);
  await drawer.getByLabel('税率（%）', { exact: true }).fill('13');
  await drawer.getByLabel('付款科目', { exact: true }).fill('1001');
  await page.keyboard.press('Enter');
  // The untouched blank editor line must not prevent importing replacement file rows.
  await drawer.getByRole('button', { name: 'Excel 导入预览', exact: true }).click();
  return {
    drawer,
    modal: page.getByRole('dialog', { name: 'Excel 导入：先预览再确认保存', exact: true }),
  };
}
async function setup(page: Page, request: APIRequestContext) {
  const book = await loginWithNewBook(page, request, { product: 'chengben' });
  await callApi(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '含税测试仓' },
    { token: book.token },
  );
  await callApi(
    request,
    'm.inventory.saveProduct',
    { code: 'P1', name: '含税测试产品' },
    { token: book.token },
  );
  return book;
}
async function file(headers: string[], basis: string | null) {
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet('明细');
  ws.addRow(headers);
  ws.addRow(['P1', '1', '113', basis, '文件税额回归']);
  return {
    name: '税额.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  };
}
type Saved = {
  id: number;
  lines: {
    net_cents: number;
    tax_cents: number;
    gross_cents: number;
    unitPrice: string;
    priceIncludesTax: boolean;
  }[];
};
async function holdImportRequest(page: Page, procedure: 'importPreview' | 'importSave') {
  let release!: () => void,
    received!: () => void,
    calls = 0;
  const pending = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (received = resolve));
  await page.route(`**/trpc/m.inventory.${procedure}?**`, async (route) => {
    calls++;
    received();
    await pending;
    // Only delay delivery: the unmodified request still reaches the real local API.
    await route.continue();
  });
  return { started, release, calls: () => calls };
}
for (const [basis, inclusive, net, tax, gross] of [
  ['是', true, 10000, 1300, 11300],
  ['否', false, 11300, 1469, 12769],
] as const) {
  test(`w_ck_rk1/f_rkd_get：真实模板 XLSX 含税口径=${basis} → 预览 → 入库 → 回读金额`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const { token } = await setup(page, request);
    const number = `TAX-${basis}`;
    const { drawer, modal } = await openReceipt(page, number);
    const templateDownload = page.waitForEvent('download');
    await modal.getByRole('button', { name: '下载导入模板', exact: true }).click();
    const template = await templateDownload;
    expect(template.suggestedFilename()).toBe('单据明细导入模板.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(await readFile((await template.path())!)).buffer);
    const ws = wb.worksheets[0]!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(headers);
    ws.addRow(['P1', '1', '113', basis, '正式模板导入']);
    await modal.getByLabel('导入Excel文件').setInputFiles({
      name: '正式模板.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    });
    await modal.getByRole('button', { name: '预览校验', exact: true }).click();
    await expect(modal.getByText('预览 1 行，0 个错误', { exact: true })).toBeVisible();
    await expect(
      modal.getByText(
        `不含税金额 ${formatMoney(net)}，税额 ${formatMoney(tax)}，价税合计 ${formatMoney(gross)}`,
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await callApi<unknown[]>(
        request,
        'm.inventory.documents',
        { keyword: number },
        { token, method: 'GET' },
      ),
    ).toEqual([]);
    page.once('dialog', (d) => d.accept());
    await modal.getByRole('button', { name: '确认保存导入', exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(drawer).not.toBeVisible();
    const docs = await callApi<{ id: number }[]>(
      request,
      'm.inventory.documents',
      { keyword: number },
      { token, method: 'GET' },
    );
    expect(docs).toHaveLength(1);
    const saved = await callApi<Saved>(
      request,
      'm.inventory.document',
      { id: docs[0]!.id },
      { token, method: 'GET' },
    );
    expect(saved.lines[0]).toMatchObject({
      net_cents: net,
      tax_cents: tax,
      gross_cents: gross,
      unitPrice: '113',
      priceIncludesTax: inclusive,
    });
    // The supported round-trip export preserves the selected price basis and exact input price.
    await page.goto(`/m/inventory/receipts?id=${saved.id}`);
    const roundtripDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出可回导明细', exact: true }).click();
    const exported = await roundtripDownload;
    const exportedBuffer = await readFile((await exported.path())!);
    const report = new ExcelJS.Workbook();
    await report.xlsx.load(new Uint8Array(exportedBuffer).buffer);
    expect((report.worksheets[0]!.getRow(1).values as unknown[]).slice(1)).toEqual(headers);
    expect(report.worksheets[0]!.getRow(2).getCell(3).value).toBe('113');
    expect(report.worksheets[0]!.getRow(2).getCell(4).value).toBe(basis);
    const copy = await openReceipt(page, `COPY-${basis}`);
    await copy.modal.getByLabel('导入Excel文件').setInputFiles({
      name: '回导.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: exportedBuffer,
    });
    await copy.modal.getByRole('button', { name: '预览校验', exact: true }).click();
    await expect(copy.modal.getByText('预览 1 行，0 个错误', { exact: true })).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await copy.modal.getByRole('button', { name: '确认保存导入', exact: true }).click();
    await expect(copy.modal).not.toBeVisible();
    const copies = await callApi<{ id: number }[]>(
      request,
      'm.inventory.documents',
      { keyword: `COPY-${basis}` },
      { token, method: 'GET' },
    );
    const copied = await callApi<Saved>(
      request,
      'm.inventory.document',
      { id: copies[0]!.id },
      { token, method: 'GET' },
    );
    expect(copied.lines[0]).toMatchObject({
      net_cents: net,
      tax_cents: tax,
      gross_cents: gross,
      priceIncludesTax: inclusive,
    });
  });
}
test('w_ck_rk1/f_rkd_get：空、错值、未知列不能提交，选择坏文件后旧预览失效', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { token } = await setup(page, request);
  const { modal } = await openReceipt(page, 'INVALID-TAX');
  await modal.getByLabel('导入Excel文件').setInputFiles(await file(headers, '是'));
  await modal.getByRole('button', { name: '预览校验', exact: true }).click();
  await expect(modal.getByRole('button', { name: '确认保存导入', exact: true })).toBeEnabled();
  for (const value of [null, '错误']) {
    await modal.getByLabel('导入Excel文件').setInputFiles(await file(headers, value));
    await expect(modal.getByRole('cell', { name: /含税口径必须明确/ })).toBeVisible();
    await expect(modal.getByRole('button', { name: '预览校验', exact: true })).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await expect(modal.getByRole('button', { name: '预览校验', exact: true })).toBeDisabled();
    await expect(modal.getByRole('button', { name: '确认保存导入', exact: true })).toBeDisabled();
  }
  await modal
    .getByLabel('导入Excel文件')
    .setInputFiles(await file(['产品编号', '数量', '单价', '含税口径拼错', '说明'], '是'));
  await expect(modal.getByRole('cell', { name: /第 4 列.*无法识别/ })).toBeVisible();
  await expect(modal.getByRole('button', { name: '确认保存导入', exact: true })).toBeDisabled();
  expect(
    await callApi<unknown[]>(request, 'm.inventory.documents', {}, { token, method: 'GET' }),
  ).toEqual([]);
});

test('w_ck_rk1/f_rkd_get：真实预览与保存请求未完成时名称稳定、显示忙碌且不能重复提交', async ({
  page,
  request,
}) => {
  const { token } = await setup(page, request);
  const number = 'PENDING-TAX';
  const { drawer, modal } = await openReceipt(page, number);
  const preview = modal.getByRole('button', { name: '预览校验', exact: true });
  const save = modal.getByRole('button', { name: '确认保存导入', exact: true });
  const input = modal.getByLabel('导入Excel文件');
  const documents = () =>
    callApi<{ id: number }[]>(
      request,
      'm.inventory.documents',
      { keyword: number },
      { token, method: 'GET' },
    );
  await input.setInputFiles(await file(headers, '是'));
  await expect(preview).toBeEnabled();
  const delayedPreview = await holdImportRequest(page, 'importPreview');
  await preview.click();
  await delayedPreview.started;
  const previewResponse = page.waitForResponse((response) =>
    response.url().includes('/trpc/m.inventory.importPreview?'),
  );
  try {
    await expect(preview).toHaveAttribute('aria-busy', 'true');
    await expect(preview).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(input).toBeDisabled();
    // Native activation of the disabled control must not send another request.
    await preview.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    expect(await documents()).toEqual([]);
    expect(delayedPreview.calls()).toBe(1);
  } finally {
    delayedPreview.release();
    await previewResponse;
  }
  const checked = await previewResponse;
  expect(checked.ok()).toBe(true);
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).toBeEnabled();
  await expect(input).toBeEnabled();
  await expect(save).toBeEnabled();
  expect(await checked.json()).toMatchObject([
    {
      result: {
        data: {
          errors: [],
          amounts: { netCents: 10000, taxCents: 1300, grossCents: 11300 },
          saved: false,
        },
      },
    },
  ]);
  const delayedSave = await holdImportRequest(page, 'importSave');
  page.once('dialog', (dialog) => dialog.accept());
  await save.click();
  await delayedSave.started;
  const saveResponse = page.waitForResponse((response) =>
    response.url().includes('/trpc/m.inventory.importSave?'),
  );
  try {
    await expect(save).toHaveAttribute('aria-busy', 'true');
    await expect(save).toBeDisabled();
    await expect(preview).toBeDisabled();
    await expect(input).toBeDisabled();
    await save.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    expect(await documents()).toEqual([]);
    expect(delayedSave.calls()).toBe(1);
  } finally {
    delayedSave.release();
    await saveResponse;
  }
  const committed = await saveResponse;
  expect(committed.ok()).toBe(true);
  expect(await committed.json()).toMatchObject([{ result: { data: { saved: true, errors: [] } } }]);
  await expect(modal).not.toBeVisible();
  await expect(drawer).not.toBeVisible();
  const docs = await documents();
  expect(docs).toHaveLength(1);
  const saved = await callApi<Saved>(
    request,
    'm.inventory.document',
    { id: docs[0]!.id },
    { token, method: 'GET' },
  );
  expect(saved.lines[0]).toMatchObject({
    net_cents: 10000,
    tax_cents: 1300,
    gross_cents: 11300,
    unitPrice: '113',
    priceIncludesTax: true,
  });
  expect(delayedPreview.calls()).toBe(1);
  expect(delayedSave.calls()).toBe(1);
});
