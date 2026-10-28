import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';
import { bankBook, documents, recordThree } from './scenarios';

const feedback = { timeout: 5000 };
test('w_bb_def_cn0_bak CSV格式映射→逐行预览→确认导入→生成真实来源凭证', async ({ cashier }) => {
  const book = await bankBook(cashier);
  const { page, request, withServices } = cashier;
  await page.goto('/m/cashier/documents');
  await page.getByRole('button', { name: '导入文件', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '导入出纳收付单', exact: true });
  const csv =
    '日期,摘要,出纳账户,币种,收款金额,付款金额,对方科目编码,现金流量项目\r\n2026-01-10,合成CSV收款,闭环银行,CNY,12.34,,6603,CF01\r\n2026-01-11,合成CSV付款,闭环银行,CNY,,2.01,6603,CF01\r\n';
  await drawer
    .getByLabel('选择导入文件', { exact: true })
    .setInputFiles({ name: '合成收付.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(
    drawer.getByText('合成收付.csv：2 行。请核对字段对应列；格式会按当前账套和列标题记住。'),
  ).toBeVisible();
  await test.step(
    '五秒内显示逐行导入检查，预览不写库',
    async () => {
      await drawer.getByRole('button', { name: '检查并预览导入' }).click();
      await expect(drawer.getByText('可导入 2 行，错误 0 行，空行 0 行')).toBeVisible();
      await expect(drawer.getByRole('row', { name: /合成CSV收款/ })).toContainText('12.34');
      expect(await documents(cashier, book)).toEqual([]);
    },
    feedback,
  );
  await expect(drawer.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  await drawer.getByLabel('已核对导入明细', { exact: true }).check();
  await test.step(
    '确认导入五秒内持久化反馈',
    async () => {
      await drawer.getByRole('button', { name: '确认导入', exact: true }).click();
      await expect(drawer.getByText('已导入 2 张出纳单')).toBeVisible();
    },
    feedback,
  );
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  const saved = await documents(cashier, book);
  expect(saved.map((d) => [d.summary, d.amount, d.direction])).toEqual([
    ['合成CSV收款', 1234, 'receipt'],
    ['合成CSV付款', 201, 'payment'],
  ]);
  const batch = await callApi<{ batchId: number }>(
    request,
    'm.cashier.generate',
    {
      documents: saved.map((d) => ({ id: d.id, revision: d.revision })),
      mode: 'summary',
      date: '2026-01-31',
      voucherTypeId: book.voucherTypeId,
      requestKey: randomUUID(),
    },
    { token: book.token },
  );
  expect(batch.batchId).toBeGreaterThan(0);
  const generated = await documents(cashier, book);
  expect(new Set(generated.map((d) => d.voucherId)).size).toBe(1);
  await withServices(book.bookId, async (svc) => {
    const voucher = await svc.vouchers.get(generated[0]!.voucherId!);
    expect(voucher).toMatchObject({
      debitTotal: 1435,
      creditTotal: 1435,
      status: 'pending',
      source: { module: 'cashier', type: 'batch', id: String(batch.batchId) },
    });
  });
});

test('w_cn_lr_del 日期范围预览→两次强确认→删除与保护跳过明细', async ({ cashier }) => {
  const book = await bankBook(cashier);
  const rows = await recordThree(cashier, book);
  await callApi(
    cashier.request,
    'm.cashier.generate',
    {
      documents: [{ id: rows[0]!.id, revision: rows[0]!.revision }],
      mode: 'individual',
      date: '2026-01-10',
      voucherTypeId: book.voucherTypeId,
      requestKey: randomUUID(),
    },
    { token: book.token },
  );
  const { page } = cashier;
  await page.goto('/m/cashier/documents');
  await page.getByRole('button', { name: '批量删除', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '批量删除出纳单据', exact: true });
  await drawer.getByLabel('删除日期从', { exact: true }).fill('2026-01-01');
  await drawer.getByLabel('删除日期到', { exact: true }).fill('2026-01-31');
  await test.step(
    '五秒内显示范围预览与保护原因',
    async () => {
      await drawer.getByRole('button', { name: '预览删除范围' }).click();
      await expect(
        drawer.getByText('范围内 3 张：可删除 2 张，跳过 1 张。预览后新增的单据不会加入本次删除。'),
      ).toBeVisible();
      await expect(drawer.getByRole('row', { name: /客户到账/ })).toContainText('已生成凭证');
    },
    feedback,
  );
  await drawer.getByRole('button', { name: '核对并批量删除', exact: true }).click();
  const first = page.getByRole('dialog', { name: '第一次确认：核对删除范围' });
  await expect(first.getByRole('button', { name: '确定' })).toBeDisabled();
  await first.getByLabel('确认文字', { exact: true }).fill('已核对范围');
  await first.getByRole('button', { name: '确定' }).click();
  const second = page.getByRole('dialog', { name: '第二次确认：执行删除' });
  await expect(second.getByRole('button', { name: '确定' })).toBeDisabled();
  await second.getByLabel('确认文字', { exact: true }).fill('删除');
  await test.step(
    '五秒内完成删除与结果报告',
    async () => {
      await second.getByRole('button', { name: '确定' }).click();
      await expect(drawer.getByText('本次删除 2 张，跳过 1 张')).toBeVisible();
      await expect(drawer.getByRole('row', { name: /客户到账/ })).toContainText('已生成凭证');
    },
    feedback,
  );
  const after = await documents(cashier, book);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ id: rows[0]!.id, summary: '客户到账' });
  expect(after[0]?.voucherId).not.toBeNull();
});

test('w_bb_saveas 文件日期错误逐行提示，修正文件后才能提交', async ({ cashier }) => {
  await bankBook(cashier);
  const { page } = cashier;
  await page.goto('/m/cashier/documents');
  await page.getByRole('button', { name: '导入文件', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '导入出纳收付单', exact: true });
  await drawer.getByLabel('选择导入文件', { exact: true }).setInputFiles({
    name: '非法日期.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      '日期,摘要,出纳账户,收款金额,现金流量项目\n2025-12-31,启用前,闭环银行,12,CF01\n2026-02-30,非法日期,闭环银行,12,CF01\n',
    ),
  });
  await drawer.getByRole('button', { name: '检查并预览导入' }).click();
  await expect(drawer.getByText('可导入 0 行，错误 2 行，空行 0 行')).toBeVisible();
  await expect(drawer.getByRole('row', { name: /启用前/ })).toContainText('启用期间');
  await expect(drawer.getByRole('row', { name: /非法日期/ })).toContainText('日期格式');
  await expect(drawer.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0);
});

test('w_bb_def_cn0_bak Excel实际工作簿日期/金额读取并确认导入', async ({ cashier }) => {
  const book = await bankBook(cashier);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('收付单');
  sheet.addRow(['日期', '摘要', '出纳账户', '收款金额', '现金流量项目']);
  sheet.addRow([new Date('2026-01-10T00:00:00Z'), '合成Excel收款', '闭环银行', 98.76, 'CF01']);
  sheet.getCell('A2').numFmt = 'yyyy-mm-dd';
  const bytes = await wb.xlsx.writeBuffer();
  const { page } = cashier;
  await page.goto('/m/cashier/documents');
  await page.getByRole('button', { name: '导入文件', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '导入出纳收付单', exact: true });
  await drawer.getByLabel('选择导入文件', { exact: true }).setInputFiles({
    name: '合成Excel.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(bytes),
  });
  await drawer.getByRole('button', { name: '检查并预览导入' }).click();
  await expect(drawer.getByText('可导入 1 行，错误 0 行，空行 0 行')).toBeVisible();
  await expect(drawer.getByRole('row', { name: /合成Excel收款/ })).toContainText('98.76');
  await drawer.getByLabel('已核对导入明细', { exact: true }).check();
  await drawer.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(drawer.getByText('已导入 1 张出纳单')).toBeVisible();
  expect((await documents(cashier, book))[0]).toMatchObject({
    summary: '合成Excel收款',
    date: '2026-01-10',
    amount: 9876,
  });
});
