import { loginWithNewBook, callApi } from '@caiwu/testkit/e2e';
import type { Page } from '@playwright/test';
import type { Invoice } from '../shared';
import { sampleFile } from '../test/fixtures';
import { test, expect } from './isolated';
import { bookWithInvoices, createInvoiceAccounts, saveInvoiceAgain } from './data';

async function select(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).fill(text);
  await page.keyboard.press('Enter');
}

test('w_fp_lr_2 → w_fp_sz_2 → w_fp_pz → w_fp_zzs_hz：5票真实导入、配置、来源凭证与pending/posted比对', async ({
  page,
  isolated,
}) => {
  const { origin, request, inBook } = isolated;
  const { bookId, token } = await loginWithNewBook(page, request, { product: 'chengben' });
  await inBook(bookId, createInvoiceAccounts);
  await page.goto(`${origin}/m/invoice/input`);
  await page.getByRole('button', { name: '导入 Excel', exact: true }).click();
  const file = await sampleFile();
  await page.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles({
    name: file.fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(file.base64, 'base64'),
  });
  const dialog = page.getByRole('dialog', { name: 'Excel 发票导入预览' });
  await expect(
    dialog.getByRole('heading', { name: '预览 5 张发票 / 错误 0 行 / 重复或冲突 0 张' }),
  ).toBeVisible();
  await expect(dialog.getByRole('row', { name: /00000000000000000001/ })).toContainText('150.00');
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole('row', { name: /00000000000000000001/ })).toContainText('202602');
  await page.getByRole('columnheader').getByRole('checkbox').check();
  await page.getByRole('button', { name: '审核所选', exact: true }).click();
  await expect(page.getByRole('row', { name: /00000000000000000001/ })).toContainText('已审核');

  await page.goto(`${origin}/m/invoice/settings?direction=input`);
  await page.getByLabel('纳税人口径（由使用者明确配置）').click();
  await page.getByText('其他口径（用户声明）', { exact: true }).click();
  await page.getByLabel('进项税额处理口径').click();
  await page.getByText('税额单列进项税科目（使用者自行核实资格）', { exact: true }).click();
  await select(page, '材料/费用科目', '7901');
  await select(page, '材料/费用部门', '发票测试部门');
  await select(page, '进项税科目', '7902');
  await select(page, '应付/结算科目', '7903');
  await select(page, '应付/结算客户/供应商', '发票测试供应商');
  await select(page, '非抵扣税额成本/费用科目', '7904');
  const saved = page.waitForResponse(
    (r) => r.url().includes('m.invoice.saveSettings') && r.status() === 200,
  );
  await page.getByRole('button', { name: '保存映射', exact: true }).click();
  await saved;
  await page.goto(`${origin}/m/invoice/process?direction=input&period=202602`);
  await page.getByRole('columnheader').getByRole('checkbox').check();
  await page.getByLabel('凭证日期', { exact: true }).fill('2026-02-28');
  await page.getByLabel('凭证字', { exact: true }).click();
  await page.getByText('记账凭证', { exact: true }).click();
  await page.getByRole('button', { name: '预览分录', exact: true }).click();
  await expect(page.getByText('凭证预览（尚未保存）', { exact: true })).toBeVisible();
  await expect(page.getByText('-5.00', { exact: true }).last()).toBeVisible();
  const generation = page.waitForRequest(
    (r) => r.url().includes('m.invoice.generate') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: '确认生成凭证', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByText('凭证预览（尚未保存）', { exact: true })).toBeHidden();
  const docs = await callApi<Invoice[]>(
    request,
    'm.invoice.list',
    { direction: 'input' },
    { token, method: 'GET' },
  );
  expect(docs).toHaveLength(5);
  expect(new Set(docs.map((d) => d.voucherId)).size).toBe(1);
  const voucherId = docs[0]!.voucherId!;
  await expect(page.getByRole('link', { name: '去凭证处理', exact: true })).toHaveAttribute(
    'href',
    `/m/voucher-book?period=202602&status=pending`,
  );
  await expect(page.getByRole('link', { name: '记-0001', exact: true }).last()).toHaveAttribute(
    'href',
    `/m/voucher-entry/edit?id=${voucherId}`,
  );
  await page.goto(`${origin}/m/invoice/vat`);
  const vatRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '进项', exact: true }) })
    .filter({ has: page.getByRole('cell', { name: '202602', exact: true }) });
  await expect(vatRow).toContainText('100.00');
  await expect(vatRow).toContainText('-100.00');
  await expect(page.getByText('账面口径：仅已过账（默认）', { exact: true })).toBeVisible();
  await page.getByLabel('含未过账').check();
  await page.getByRole('button', { name: /^(?:search )?查询$/ }).click();
  await expect(vatRow).not.toContainText('-100.00');
  await inBook(bookId, async (svc) => {
    await svc.vouchers.changeStatus({ ids: [voucherId], to: 'audited' });
    await svc.vouchers.changeStatus({ ids: [voucherId], to: 'posted' });
  });
  await page.getByLabel('含未过账').uncheck();
  await page.getByRole('button', { name: /^(?:search )?查询$/ }).click();
  await page.getByRole('button', { name: '刷新比对', exact: true }).click();
  await expect(vatRow).not.toContainText('-100.00');
  await expect(vatRow.getByRole('cell', { name: '100.00', exact: true })).toHaveCount(2);
  await expect(vatRow.getByRole('cell', { name: '0.00', exact: true })).toHaveCount(1);
  await expect(vatRow.getByRole('link', { name: '明细账', exact: true })).toHaveAttribute(
    'href',
    '/m/ledgers/detail?account=7902&from=202602&to=202602&dims=',
  );
  const originalInput = (await generation).postDataJSON() as Record<string, unknown>;
  expect(originalInput['0']).toBeDefined();
  await callApi(request, 'm.invoice.generate', originalInput['0'], { token });
  await expect(saveInvoiceAgain(request, token, docs[0]!)).rejects.toThrow(/已审核或已后续处理/);
  await inBook(bookId, async (svc) => {
    expect((await svc.vouchers.list({ sourceModule: 'invoice' })).total).toBe(1);
  });
});

test('w_fp_lr_2：已过账来源锁定、重复导入预览与Excel导出', async ({ page, isolated }) => {
  const { origin, request, inBook } = isolated;
  const { bookId, token, file, docs } = await bookWithInvoices(page, isolated, true);
  const dialog = page.getByRole('dialog', { name: 'Excel 发票导入预览' });
  await page.goto(`${origin}/m/invoice/input`);
  const first = page.getByRole('row', { name: /00000000000000000001/ });
  await expect(first.getByRole('button', { name: '修改', exact: true })).toHaveCount(0);
  await first.getByRole('button', { name: '详情', exact: true }).click();
  await expect(page.getByLabel('发票号码', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('发票查询.xlsx');
  await page.getByRole('button', { name: '导入 Excel', exact: true }).click();
  await page.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles({
    name: file.fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(file.base64, 'base64'),
  });
  await expect(
    dialog.getByRole('heading', { name: '预览 5 张发票 / 错误 0 行 / 重复或冲突 5 张' }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  expect(
    await callApi<Invoice[]>(request, 'm.invoice.list', {}, { token, method: 'GET' }),
  ).toHaveLength(5);
  await inBook(bookId, async (svc) => {
    expect((await svc.vouchers.list({ sourceModule: 'invoice' })).total).toBe(1);
  });
  await expect(saveInvoiceAgain(request, token, docs[0]!)).rejects.toThrow(/已审核或已后续处理/);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
});

test('w_fp_fz/fjz、w_fp_hz：独立发票月锁、反结账与真实五票汇总', async ({ page, isolated }) => {
  const { origin, inBook } = isolated;
  const { bookId } = await bookWithInvoices(page, isolated);
  await page.goto(`${origin}/m/invoice/periods?period=202602`);
  await page.getByRole('button', { name: '结账', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByText(/所选 202602：已结账/)).toBeVisible();
  await page.goto(`${origin}/m/invoice/summary?year=2026&direction=input&groupBy=month`);
  const summary = page.getByRole('row', { name: /202602/ });
  await expect(summary).toContainText('1,000.00');
  await expect(summary.getByRole('cell', { name: '100.00', exact: true })).toBeVisible();
  await expect(summary.getByRole('cell', { name: '1,100.00', exact: true })).toBeVisible();
  await page.goto(`${origin}/m/invoice/periods?period=202602`);
  await page.getByRole('button', { name: '反结账', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByText(/所选 202602：未结账/)).toBeVisible();
  await inBook(bookId, async (svc) => {
    expect((await svc.periods.require(202602)).status).toBe('open');
  });
});

test('w_fp_lr_1 手工录入、未保存确认、查询筛选和批量删除二次确认', async ({ page, isolated }) => {
  const { origin, request } = isolated;
  await loginWithNewBook(page, request, { product: 'chengben' });
  await page.goto(`${origin}/m/invoice/output`);
  await page.getByRole('button', { name: '新增发票', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增发票' });
  await drawer.getByLabel('发票号码', { exact: true }).fill('000-OUT');
  await drawer.getByLabel('开票日期', { exact: true }).fill('2026-03-10');
  await drawer.getByLabel('票种', { exact: true }).fill('合成汇总票');
  await drawer.getByLabel('销售方名称', { exact: true }).fill('合成销售方');
  await drawer.getByLabel('销售方税号', { exact: true }).fill('TEST-OUT');
  await drawer.getByLabel('购买方名称', { exact: true }).fill('合成客户');
  await drawer.getByLabel('不含税金额', { exact: true }).fill('100');
  await drawer.getByLabel('税额', { exact: true }).fill('10');
  await drawer.getByLabel('价税合计', { exact: true }).fill('110');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /有未保存的发票，确认放弃修改/ })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await drawer.getByRole('button', { name: '保存发票', exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.reload();
  await expect(page.getByRole('row', { name: /000-OUT/ })).toContainText('100.00');
  await page.getByLabel('单位', { exact: true }).fill('没有此单位');
  await page.getByRole('button', { name: /^(?:search )?查询$/ }).click();
  await expect(page.getByRole('row', { name: /000-OUT/ })).toHaveCount(0);
  await page.getByLabel('单位', { exact: true }).fill('合成客户');
  await page.getByRole('button', { name: /^(?:search )?查询$/ }).click();
  await expect(page.getByRole('row', { name: /000-OUT/ })).toBeVisible();
  await page.getByRole('button', { name: '批量删除当前查询', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '批量删除当前查询预览' });
  await expect(deletion.getByText('将删除', { exact: true })).toBeVisible();
  await deletion.getByRole('button', { name: '确认以上查询范围', exact: true }).click();
  await deletion.getByRole('button', { name: '二次确认删除', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(deletion.getByText('将删除', { exact: true })).toBeVisible();
  await deletion.getByRole('button', { name: '二次确认删除', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect(page.getByRole('row', { name: /000-OUT/ })).toHaveCount(0);
});
