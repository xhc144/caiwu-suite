import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { ReferenceRow } from '../shared';

const { Workbook } = ExcelJS;
const endpoint = 'm.masterdata.reference.list';

test('w_xt_zy：实际下载摘要Excel → 坏行预览 → 取消 → 确认导入 → 重载及拼音/快捷词检索', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  const list = () =>
    callApi<ReferenceRow[]>(request, endpoint, { kind: 'summaries' }, { token: book.token });
  await page.goto('/m/masterdata/reference?kind=summaries');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('摘要.xlsx');
  const wb = new Workbook();
  await wb.xlsx.load(
    (await readFile((await download.path())!)) as unknown as Parameters<typeof wb.xlsx.load>[0],
  );
  const ws = wb.worksheets[0]!;
  expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([
    '编码',
    '摘要短语',
    '类别',
    '快捷检索词',
    '排序',
  ]);
  ws.addRow(['03', '收到货款', '收款', 'SKTEST', 5]);
  const good = Buffer.from(await wb.xlsx.writeBuffer());
  ws.addRow(['03', '重复编码', '', '', 0]);
  await page.locator('input[type=file]').setInputFiles({
    name: '摘要.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  const preview = page.getByRole('dialog', { name: 'Excel 导入预览', exact: true });
  await expect(preview).toContainText('文件内编号 03 重复');
  await expect(preview.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  expect((await list()).some((r) => r.code === '03')).toBe(false);
  await page.locator('input[type=file]').setInputFiles({
    name: '摘要.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: good,
  });
  await expect(preview.getByRole('row').filter({ hasText: '收到货款' })).toContainText('新增');
  expect((await list()).some((r) => r.code === '03')).toBe(false);
  await preview.getByRole('button', { name: '确认导入', exact: true }).click();
  const confirmation = page.getByRole('dialog').filter({ hasText: '确认按预览顺序导入全部档案' });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  expect((await list()).some((r) => r.code === '03')).toBe(false);
  await preview.getByRole('button', { name: '确认导入', exact: true }).click();
  await confirmation.getByRole('button', { name: '确认', exact: true }).click();
  await expect(preview).not.toBeVisible();
  const saved = (await list()).find((r) => r.code === '03')!;
  expect(saved).toMatchObject({
    name: '收到货款',
    category: '收款',
    shortcut: 'SKTEST',
    useCount: 0,
  });
  await page.reload();
  await page.getByLabel('查找', { exact: true }).fill(' SDHK ');
  await page.getByRole('button', { name: 'search 查询', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '收到货款' })).toContainText('SKTEST');
  await page.getByLabel('查找', { exact: true }).fill('sktest');
  await page.getByRole('button', { name: 'search 查询', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '收到货款' })).toBeVisible();
  expect((await list()).find((r) => r.code === '03')?.id).toBe(saved.id);
});

test('w_xt_pzlx：Excel新增凭证类型 → 简称/拼音检索 → 编辑停用 → 原样回导保留ID与状态', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  const list = () =>
    callApi<ReferenceRow[]>(request, endpoint, { kind: 'voucherTypes' }, { token: book.token });
  await page.goto('/m/masterdata/reference');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('凭证类型.xlsx');
  const wb = new Workbook();
  await wb.xlsx.load(
    (await readFile((await download.path())!)) as unknown as Parameters<typeof wb.xlsx.load>[0],
  );
  wb.worksheets[0]!.addRow(['09', '收', '收款凭证', 0, 5]);
  await page.locator('input[type=file]').setInputFiles({
    name: '凭证类型.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  const preview = page.getByRole('dialog', { name: 'Excel 导入预览', exact: true });
  await expect(preview.getByRole('row').filter({ hasText: '收款凭证' })).toContainText('新增');
  await preview.getByRole('button', { name: '确认导入', exact: true }).click();
  await page
    .getByRole('dialog')
    .filter({ hasText: '确认按预览顺序导入全部档案' })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(preview).not.toBeVisible();
  const saved = (await list()).find((r) => r.code === '09')!;
  await page.getByLabel('查找', { exact: true }).fill('skpz');
  await page.getByRole('button', { name: 'search 查询', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: '收款凭证' });
  await expect(row).toContainText('收');
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '编辑凭证类型', exact: true });
  await drawer.getByLabel('停用', { exact: true }).check();
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.reload();
  await expect(row).toContainText('停用');
  const exportAgain = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles((await (await exportAgain).path())!);
  await expect(preview.getByRole('row').filter({ hasText: '收款凭证' })).toContainText('更新/保持');
  await preview.getByRole('button', { name: '确认导入', exact: true }).click();
  await page
    .getByRole('dialog')
    .filter({ hasText: '确认按预览顺序导入全部档案' })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(preview).not.toBeVisible();
  expect((await list()).find((r) => r.code === '09')).toMatchObject({
    id: saved.id,
    shortName: '收',
    disabled: true,
  });
});

test('w_xt_zy：A预览新增 → B创建同码 → A确认被拒且不覆盖 → 重新预览后明确确认才更新', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  await page.goto('/m/masterdata/reference?kind=summaries');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloadPromise;
  const source = new Workbook();
  await source.xlsx.load(
    (await readFile((await download.path())!)) as unknown as Parameters<typeof source.xlsx.load>[0],
  );
  source.worksheets[0]!.addRow(['03', 'A导入名称', 'A分类', 'A快捷词', 0]);
  const upload = {
    name: '摘要.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await source.xlsx.writeBuffer()),
  };
  await page.locator('input[type=file]').setInputFiles(upload);
  const preview = page.getByRole('dialog', { name: 'Excel 导入预览', exact: true });
  await expect(preview.getByRole('row').filter({ hasText: 'A导入名称' })).toContainText('新增');
  await callApi(
    request,
    'm.masterdata.reference.save',
    { kind: 'summaries', code: '03', name: 'B并发名称', category: 'B分类', shortcut: 'B快捷词' },
    { token: book.token },
  );
  const before = await callApi<ReferenceRow[]>(
    request,
    endpoint,
    { kind: 'summaries' },
    { token: book.token },
  );
  await preview.getByRole('button', { name: '确认导入', exact: true }).click();
  await page
    .getByRole('dialog')
    .filter({ hasText: '确认按预览顺序导入全部档案' })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(page.getByText('导入预览已失效，请重新预览', { exact: true })).toBeVisible();
  await expect(preview).not.toBeVisible();
  expect(
    await callApi<ReferenceRow[]>(request, endpoint, { kind: 'summaries' }, { token: book.token }),
  ).toEqual(before);
  await page.locator('input[type=file]').setInputFiles(upload);
  await expect(preview.getByRole('row').filter({ hasText: 'A导入名称' })).toContainText(
    '更新/保持',
  );
  expect(
    await callApi<ReferenceRow[]>(request, endpoint, { kind: 'summaries' }, { token: book.token }),
  ).toEqual(before);
  await preview.getByRole('button', { name: '确认导入', exact: true }).click();
  await page
    .getByRole('dialog')
    .filter({ hasText: '确认按预览顺序导入全部档案' })
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(preview).not.toBeVisible();
  const after = await callApi<ReferenceRow[]>(
    request,
    endpoint,
    { kind: 'summaries' },
    { token: book.token },
  );
  expect(after.find((r) => r.code === '03')).toMatchObject({
    id: before.find((r) => r.code === '03')!.id,
    name: 'A导入名称',
    category: 'A分类',
    shortcut: 'A快捷词',
  });
});
