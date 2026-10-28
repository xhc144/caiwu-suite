import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Account, Voucher, VoucherHeader } from '@caiwu/core';
import type { ImportBatch } from '../shared';

async function choose(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  const index = ['按工作表名识别', '科目', '辅助档案', '期初', '凭证'].indexOf(value);
  expect(index).toBeGreaterThanOrEqual(0);
  await input.click();
  for (let i = 0; i < index; i++) await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
}
async function pasteVouchers(page: Page, data: string) {
  await page.getByText('直接粘贴表格或文本', { exact: true }).click();
  await page.getByLabel('粘贴迁移数据', { exact: true }).fill(data);
  await page.getByRole('button', { name: '加入待导入文件', exact: true }).click();
}
const voucherHead = '凭证日期,凭证字,凭证号,摘要,科目编码,借方金额,贷方金额,部门编码';

test('w_bb_saveas/w_pz_get：四类原账数据上传及粘贴→预检不留账务写入→确认导入→刷新恢复对照', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { token } = await loginWithNewBook(page, request);
  await page.goto('/m/workbench/');
  await page.getByRole('menuitem', { name: '原账迁移', exact: true }).click();
  await expect(page.getByRole('heading', { name: '原账迁移', exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 Excel 模板', exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toMatch(/\.xlsx$/);
  await page.getByLabel('本批名称', { exact: true }).fill('合成原账完整迁移');
  const files = [
    {
      name: '科目.csv',
      text: '科目编码,科目名称,科目类别,余额方向,部门核算\n9999,迁移测试资产,资产,借,是',
      kind: '科目',
    },
    {
      name: '部门.csv',
      text: '辅助类型,档案编码,档案名称\n部门,D99,迁移测试部门',
      kind: '辅助档案',
    },
    {
      name: '期初.csv',
      text: '年度,科目编码,部门编码,期初余额,累计借方,累计贷方\n2026,9999,D99,123.45,0,0\n2026,4001,,-123.45,0,0',
      kind: '期初',
    },
  ];
  await page.getByLabel('选择迁移文件', { exact: true }).setInputFiles(
    files.map((file) => ({
      name: file.name,
      mimeType: 'text/csv',
      buffer: Buffer.from(file.text),
    })),
  );
  for (const file of files) await choose(page, `${file.name}数据类型`, file.kind);
  await pasteVouchers(
    page,
    `${voucherHead}\n2026-01-15,记,1,迁移合成凭证,9999,50.00,0,D99\n2026-01-15,记,1,迁移合成凭证,4001,0,50.00,`,
  );
  await page.getByRole('button', { name: '保存迁移文件', exact: true }).click();
  await expect(page.getByText('待预检', { exact: true }).first()).toBeVisible();
  const originalDownloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '取回原文件：科目.csv', exact: true }).click();
  const originalDownload = await originalDownloadEvent;
  expect(originalDownload.suggestedFilename()).toBe('科目.csv');
  const originalPath = await originalDownload.path();
  expect(originalPath).toBeTruthy();
  expect(await readFile(originalPath!)).toEqual(Buffer.from(files[0]!.text));
  await page.getByRole('button', { name: '重新预检', exact: true }).click();
  await expect(page.getByText('预检通过，尚未写入账务数据', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: '审核状态' })
      .getByRole('cell', { name: '—', exact: true }),
  ).toBeVisible();
  const before = await callApi<Account[]>(request, 'core.accounts.list', undefined, { token });
  expect(before.some((a) => a.code === '9999')).toBe(false);
  const beforeVouchers = await callApi<{ items: VoucherHeader[]; total: number }>(
    request,
    'core.vouchers.list',
    {},
    { token },
  );
  expect(beforeVouchers.total).toBe(0);
  await page.getByRole('button', { name: '正式导入', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认导入原账数据', exact: true });
  await expect(confirmation.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  await confirmation.getByLabel('我已核对数量、提醒及原账对应关系').check();
  await confirmation.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByText('本批已完整导入', { exact: true })).toBeVisible();
  const sourceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载迁移来源', exact: true }).click();
  expect((await sourceDownload).suggestedFilename()).toMatch(/\.xlsx$/);
  const after = await callApi<Account[]>(request, 'core.accounts.list', undefined, { token });
  expect(after.find((a) => a.code === '9999')?.name).toBe('迁移测试资产');
  const result = await callApi<{ items: VoucherHeader[]; total: number }>(
    request,
    'core.vouchers.list',
    {},
    { token },
  );
  expect(result.total).toBe(1);
  const voucher = await callApi<Voucher>(
    request,
    'core.vouchers.get',
    { id: result.items[0]!.id },
    { token },
  );
  expect(voucher.status).toBe('pending');
  expect(voucher.lines.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
    ['9999', 5000, 0],
    ['4001', 0, 5000],
  ]);
  expect(voucher.lines[0]!.dimensions.department).toBeTruthy();
  await page.reload();
  await expect(page.getByText('本批已完整导入', { exact: true })).toBeVisible();
  await expect(page.getByText('记-0001', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '正式导入', exact: true })).toHaveCount(0);
  await page.getByText('本批已完整导入', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/caiwu-legacy-import-completed-1366x768.png' });
});

test('w_pz_get：错误原始行列可见、预检后保留源数据并修复另存', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request);
  await page.goto('/m/legacy-import/');
  await page.getByLabel('本批名称', { exact: true }).fill('含未知科目的合成凭证');
  await pasteVouchers(
    page,
    `${voucherHead}\n2026-01-16,记,1,合成错误凭证,8888,1.00,0,\n2026-01-16,记,1,合成错误凭证,4001,0,1.00,`,
  );
  await page.getByRole('button', { name: '保存迁移文件', exact: true }).click();
  await page.getByRole('button', { name: '重新预检', exact: true }).click();
  await expect(page.getByText('本批未导入，请处理问题后重新预检', { exact: true })).toBeVisible();
  const issue = page
    .getByRole('row')
    .filter({ hasText: '8888' })
    .filter({ hasText: '科目' })
    .first();
  await expect(issue).toBeVisible();
  await expect(issue.getByRole('cell', { name: '2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '正式导入', exact: true })).toHaveCount(0);
  const result = await callApi<{ total: number }>(request, 'core.vouchers.list', {}, { token });
  expect(result.total).toBe(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载问题清单', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByLabel('本批名称', { exact: true }).fill('修复后的合成凭证');
  await page
    .getByLabel('粘贴迁移数据', { exact: true })
    .fill(
      `${voucherHead}\n2026-01-16,3,1,合成修复凭证,2001,1.00,0,\n2026-01-16,3,1,合成修复凭证,4001,0,1.00,`,
    );
  await page.getByRole('button', { name: '加入待导入文件', exact: true }).click();
  await page.getByText('列名对应（表头与模板不同时填写）', { exact: true }).click();
  await page.getByLabel('粘贴-凭证-1.txt数值对应', { exact: true }).fill('凭证字:3=记');
  await page.getByRole('button', { name: '保存迁移文件', exact: true }).click();
  await page.getByRole('button', { name: '重新预检', exact: true }).click();
  await expect(page.getByText('预检通过，尚未写入账务数据', { exact: true })).toBeVisible();
  await expect(page.getByText('错误 0 处，提醒', { exact: false })).toBeVisible();
});

test('w_pz_get：批次切换后旧确认失效，重新确认A仅导入A', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request);
  const checkedBatch = async (name: string, amount: string, number: number) => {
    const csv = `${voucherHead}\n2026-01-20,记,${number},${name},2001,${amount},0,\n2026-01-20,记,${number},${name},4001,0,${amount},`;
    const prepared = await callApi<ImportBatch>(
      request,
      'm.legacy-import.prepare',
      {
        name,
        files: [
          {
            name: `${name}.csv`,
            kind: 'vouchers',
            contentBase64: Buffer.from(csv).toString('base64'),
          },
        ],
      },
      { token },
    );
    const checked = await callApi<ImportBatch>(
      request,
      'm.legacy-import.preflight',
      { id: prepared.id },
      { token },
    );
    expect(checked.status).toBe('checked');
    return checked;
  };
  const a = await checkedBatch('确认批次A', '11.11', 1);
  const b = await checkedBatch('确认批次B', '22.22', 2);
  const commitRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('m.legacy-import.commit')) commitRequests.push(req.postData() ?? '');
  });
  const changeAddress = async (id: string) => {
    await page.evaluate((value) => {
      const url = new URL(window.location.href);
      url.searchParams.set('id', value);
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, id);
    await expect(
      page.getByText(`2. 核对批次：${id === a.id ? a.name : b.name}`, { exact: true }),
    ).toBeVisible();
  };
  await page.goto(`/m/legacy-import/?id=${a.id}`);
  await expect(page.getByText(`2. 核对批次：${a.name}`, { exact: true })).toBeVisible();
  await changeAddress(b.id);
  await page.getByRole('button', { name: '正式导入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认导入原账数据', exact: true });
  await dialog.getByLabel('我已核对数量、提醒及原账对应关系').check();
  await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toBeEnabled();
  await changeAddress(a.id);
  await expect(dialog).not.toBeVisible();
  expect(commitRequests).toHaveLength(0);
  expect(
    (await callApi<{ total: number }>(request, 'core.vouchers.list', {}, { token })).total,
  ).toBe(0);
  await changeAddress(b.id);
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '正式导入', exact: true }).click();
  await expect(dialog.getByLabel('我已核对数量、提醒及原账对应关系')).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '返回核对', exact: true }).click();
  await changeAddress(a.id);
  await page.getByRole('button', { name: '正式导入', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  await dialog.getByLabel('我已核对数量、提醒及原账对应关系').check();
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByText('本批已完整导入', { exact: true })).toBeVisible();
  expect(commitRequests).toHaveLength(1);
  expect(commitRequests[0]).toContain(a.id);
  expect(commitRequests[0]).not.toContain(b.id);
  const vouchers = await callApi<{ items: VoucherHeader[]; total: number }>(
    request,
    'core.vouchers.list',
    {},
    { token },
  );
  expect(vouchers.total).toBe(1);
  expect(vouchers.items[0]!.debitTotal).toBe(1111);
  expect(vouchers.items[0]!.summary).toBe(a.name);
  const untouched = await callApi<ImportBatch>(
    request,
    'm.legacy-import.get',
    { id: b.id },
    { token, method: 'GET' },
  );
  expect(untouched.status).toBe('checked');
  expect(untouched.receipt).toBeNull();
});
