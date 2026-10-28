import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { CONTRACT_ARCHIVE_HEADERS } from '../contract-transfer';
import { test, expect, type Isolated } from './fixture';
import type { Page } from '@playwright/test';

async function setup(page: Page, isolated: Isolated) {
  const login = await loginWithNewBook(page, isolated.request);
  let accountId = 0,
    partnerId = 0;
  await isolated.seed(login.bookId, async (svc) => {
    accountId = (
      await svc.accounts.create(
        {
          code: '100203',
          name: '合同银行',
          isBank: true,
          dimensions: [{ type: 'partner', required: true }],
        },
        [4, 2, 2],
      )
    ).id;
    partnerId = (await svc.dimensions.getByCode('partner', 'C001'))!.id;
  });
  const input = {
    expectedRevision: 0,
    code: 'HT001',
    name: '原始合成合同',
    accountId,
    partnerId,
    signedDate: '2026-01-02',
    kind: 'receipt',
    amount: 12345,
    opening: 678,
    description: '合成说明',
    remark: '备注甲',
    remark2: '备注乙',
  };
  const contract = await callApi<{ id: number; revision: number }>(
    isolated.request,
    'm.analysis.contracts.save',
    input,
    { token: login.token },
  );
  await page.goto(`${isolated.origin}/m/analysis/contracts`);
  return { ...login, input, contract };
}

test('w_ht_htda 拷加、定位、合同Excel预览覆盖确认与逐行错误、精确另存打印', async ({
  page,
  isolated,
}) => {
  await setup(page, isolated);
  await page.getByRole('button', { name: 'HT001', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '合同 HT001', exact: true });
  await detail.getByRole('button', { name: '拷加合同', exact: true }).click();
  const copy = page.getByRole('dialog', { name: '拷加合同 HT001' });
  await expect(copy.getByLabel('合同号', { exact: true })).toHaveValue('');
  await expect(copy.getByLabel('合同名称')).toHaveValue('原始合成合同');
  await expect(copy.getByLabel('备注2')).toHaveValue('备注乙');
  await copy.getByLabel('合同号', { exact: true }).fill('HT-COPY');
  await page.keyboard.press('Control+s');
  await expect(copy).toHaveCount(0);
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('textbox', { name: '合同定位查询' }).fill('HT-COPY');
  await expect(page.getByRole('button', { name: 'HT-COPY', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'HT001', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '合同定位查询' }).fill('');
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet('合同档案');
  sheet.addRow(CONTRACT_ARCHIVE_HEADERS);
  sheet.addRow([
    'HT001',
    '已覆盖合成合同',
    'C001',
    '100203',
    '2026-01-02',
    '收款',
    '90071992547409.91',
    '0.01',
    '导入说明',
    '甲改',
    '乙改',
  ]);
  sheet.addRow([
    'HT-BAD',
    '错误客供',
    '不存在',
    '100203',
    '2026-01-02',
    '收款',
    '1.00',
    '0.00',
    '',
    '',
    '',
  ]);
  await page.getByRole('button', { name: '导入合同档案', exact: true }).click();
  const importer = page.getByRole('dialog', { name: '导入合同档案', exact: true });
  await importer.getByLabel('合同档案Excel文件').setInputFiles({
    name: '合同.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  await importer.getByRole('button', { name: '预览导入', exact: true }).click();
  await expect(importer.getByText('可导入 0 条；错误 2 条')).toBeVisible();
  await expect(importer.getByText(/合同号已存在/)).toBeVisible();
  await importer.getByRole('checkbox', { name: '允许覆盖同合同号的未审核、未使用合同' }).check();
  await importer.getByRole('button', { name: '预览导入', exact: true }).click();
  await expect(importer.getByText('可导入 1 条；错误 1 条')).toBeVisible();
  await expect(importer.getByRole('button', { name: '确认导入合同', exact: true })).toBeDisabled();
  await importer
    .getByRole('checkbox', { name: '已核对新增、覆盖和错误行，确认导入可用行' })
    .check();
  await importer.getByRole('button', { name: '确认导入合同', exact: true }).click();
  await expect(importer.getByText('导入完成：成功 1 条；失败 1 条')).toBeVisible();
  await importer.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('combobox', { name: '定位字段' }).click();
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByText('合同金额', { exact: true })
    .click();
  await page.getByRole('textbox', { name: '定位值' }).fill('90071992547409.91');
  await page.getByRole('button', { name: '应用定位条件', exact: true }).click();
  await expect(page.getByRole('button', { name: 'HT001', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'HT-COPY', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '清除定位条件', exact: true }).click();
  await expect(page.getByRole('button', { name: 'HT-COPY', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出合同档案Excel', exact: true }).click();
  const download = await downloading;
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(Uint8Array.from(await readFile((await download.path())!)).buffer);
  const exportedRow = exported
    .getWorksheet('合同档案')!
    .getRows(2, 2)!
    .find((r) => r.getCell(1).value === 'HT001')!;
  expect(exportedRow.getCell(7).value).toBe('90071992547409.91');
  expect(exportedRow.getCell(11).value).toBe('乙改');
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.contractArchivePrint = html;
      },
      printToPdf: async () => null,
    };
  });
  await page.getByRole('button', { name: '打印合同档案', exact: true }).click();
  await expect
    .poll(() => page.locator('body').getAttribute('data-contract-archive-print'))
    .toContain('已覆盖合成合同');
  expect(await page.locator('body').getAttribute('data-contract-archive-print')).toContain(
    '90,071,992,547,409.91',
  );
});

test('w_ht_htda 保存失败保稿，刷新后恢复草稿并改正合同号保存', async ({ page, isolated }) => {
  await setup(page, isolated);
  await page.getByRole('button', { name: '新增合同', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增合同', exact: true });
  await editor.getByLabel('合同号', { exact: true }).fill('HT001');
  await editor.getByLabel('合同名称').fill('失败后恢复的草稿');
  await editor.getByLabel('客供', { exact: true }).fill('C001');
  await page.keyboard.press('Enter');
  await editor.getByLabel('收付款科目').fill('100203');
  await page.keyboard.press('Enter');
  await editor.getByLabel('合同金额', { exact: true }).fill('0.01');
  await editor.getByRole('button', { name: '保存合同', exact: true }).click();
  await expect(editor.getByText('合同未保存，当前输入仍保留')).toBeVisible();
  await expect(editor.getByLabel('合同名称')).toHaveValue('失败后恢复的草稿');
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.getByRole('button', { name: '新增合同', exact: true }).click();
  await editor.getByRole('button', { name: '恢复合同草稿', exact: true }).click();
  await expect(editor.getByLabel('合同名称')).toHaveValue('失败后恢复的草稿');
  await expect(editor.getByLabel('合同金额', { exact: true })).toHaveValue('0.01');
  await editor.getByLabel('合同号', { exact: true }).fill('HT-DRAFT');
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await page
    .getByRole('dialog', { name: '合同尚未保存', exact: true })
    .getByRole('button', { name: '保存后关闭', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'HT-DRAFT', exact: true })).toBeVisible();
});

test('w_ht_htda 恢复的旧版本草稿不能覆盖刷新后另一窗口的新版本', async ({ page, isolated }) => {
  const { token, input, contract } = await setup(page, isolated);
  await page.getByRole('button', { name: 'HT001', exact: true }).click();
  await page
    .getByRole('dialog', { name: '合同 HT001', exact: true })
    .getByRole('button', { name: '修改合同', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '修改合同 HT001', exact: true });
  await editor.getByLabel('合同名称').fill('旧版本未保存草稿');
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await callApi(
    isolated.request,
    'm.analysis.contracts.save',
    { ...input, id: contract.id, expectedRevision: contract.revision, name: '另一窗口已保存' },
    { token },
  );
  await page
    .getByRole('dialog', { name: '合同 HT001', exact: true })
    .getByRole('button', { name: '修改合同', exact: true })
    .click();
  await editor.getByRole('button', { name: '恢复合同草稿', exact: true }).click();
  await expect(editor.getByLabel('合同名称')).toHaveValue('旧版本未保存草稿');
  await editor.getByRole('button', { name: '保存合同', exact: true }).click();
  await expect(editor.getByText('合同未保存，当前输入仍保留')).toBeVisible();
  await expect(editor.getByLabel('合同名称')).toHaveValue('旧版本未保存草稿');
  const saved = await callApi<{ name: string }>(
    isolated.request,
    'm.analysis.contracts.get',
    { id: contract.id },
    { token, method: 'GET' },
  );
  expect(saved.name).toBe('另一窗口已保存');
});

test('w_ht_htda 保存等待期间禁止恢复旧草稿，成功后保留实际提交内容', async ({ page, isolated }) => {
  const { token } = await setup(page, isolated);
  await page.getByRole('button', { name: '新增合同', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增合同', exact: true });
  await editor.getByLabel('合同号', { exact: true }).fill('HT-OLD-DRAFT');
  await editor.getByLabel('合同名称').fill('此前草稿');
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.getByRole('button', { name: '新增合同', exact: true }).click();
  await expect(editor.getByRole('button', { name: '恢复合同草稿', exact: true })).toBeEnabled();
  await editor.getByLabel('合同号', { exact: true }).fill('HT-FRESH');
  await editor.getByLabel('合同名称').fill('本次实际提交');
  await editor.getByLabel('客供', { exact: true }).fill('C001');
  await page.keyboard.press('Enter');
  await editor.getByLabel('收付款科目').fill('100203');
  await page.keyboard.press('Enter');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/trpc/**', async (route) => {
    if (
      route.request().url().includes('m.analysis.contracts.save') &&
      route.request().method() === 'POST'
    )
      await pending;
    await route.continue();
  });
  const started = page.waitForRequest(
    (request) => request.url().includes('m.analysis.contracts.save') && request.method() === 'POST',
  );
  await editor.getByRole('button', { name: '保存合同', exact: true }).click();
  await started;
  try {
    await expect(editor.getByRole('button', { name: '恢复合同草稿', exact: true })).toBeDisabled();
    await expect(editor.getByRole('button', { name: '放弃旧草稿', exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(editor).toHaveCount(0);
  const saved = await callApi<{ code: string; name: string }[]>(
    isolated.request,
    'm.analysis.contracts.list',
    undefined,
    { token, method: 'GET' },
  );
  expect(saved).toContainEqual(expect.objectContaining({ code: 'HT-FRESH', name: '本次实际提交' }));
  expect(saved.some((r) => r.code === 'HT-OLD-DRAFT')).toBe(false);
});
