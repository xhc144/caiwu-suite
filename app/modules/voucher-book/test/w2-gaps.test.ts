import { afterEach, beforeEach, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { sql } from '@caiwu/db';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import { assertSafePrintContent } from '@caiwu/print';
import server from '../server';
import { reportTotals, reportExcelAmount, type Transfer } from '../shared';
import type { VoucherBookTables } from '../server/migrations';
import { tAccountHtml, summaryHtml, reportCaption } from '../web/report-print';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  await app.close();
});
const spec = (amount = 1, date = '2026-01-05') => ({
  date,
  lines: [
    { account: '6603', debit: amount },
    { account: '1001', credit: amount },
  ],
});

it('w_pz_tjsh 批次完成保留每张成功状态、本人跳过原因，重放返回执行时快照', async () => {
  const [mine] = await seedVouchers(app.svc, [spec()]);
  await app.addUser('other', { permissions: ['voucher-book.view'] });
  const { createCoreServices, loadServiceUser } = await import('@caiwu/core/server');
  const userId = (await app.svc.users.list()).find((u) => u.code === 'other')!.id;
  const user = (await loadServiceUser(app.svc.db, userId))!;
  const otherSvc = createCoreServices({ ...app.svc.ctx, user });
  const [other] = await seedVouchers(otherSvc, [spec()]);
  const api = app.call(server);
  const preview = await api.preview.audit({
    action: 'audit',
    selection: { ids: [mine!.id, other!.id] },
  });
  const result = await api.commit({
    token: preview.token,
    confirmed: true,
    cashflowConfirmed: true,
  });
  expect(result.rows).toEqual([
    expect.objectContaining({
      key: String(mine!.id),
      outcome: 'skipped',
      status: '待审核',
      reasons: ['制单人与审核人相同，请更换用户后审核'],
    }),
    expect.objectContaining({
      key: String(other!.id),
      outcome: 'success',
      voucherId: other!.id,
      status: '已审核',
      reasons: [],
    }),
  ]);
  const back = await api.preview.unaudit({ action: 'unaudit', selection: { ids: [other!.id] } });
  expect((await api.commit({ token: back.token, confirmed: true })).rows?.[0]?.status).toBe(
    '待审核',
  );
  expect(await api.commit({ token: preview.token, confirmed: true })).toEqual(result);
  expect((await app.svc.vouchers.get(other!.id))!.status).toBe('pending');
});

it('w_pz_tjsh 执行中故障不留下成功清单，凭证、日志和结果同事务回滚', async () => {
  const vs = await seedVouchers(app.svc, [spec(), spec()]);
  const api = app.call(
    server,
    await app.addUser('auditor', { permissions: ['voucher-book.view', 'voucher-book.audit'] }),
  );
  const preview = await api.preview.audit({
    action: 'audit',
    selection: { ids: vs.map((v) => v.id) },
  });
  await sql`CREATE TRIGGER voucher_book_w2_failure BEFORE UPDATE OF status ON voucher WHEN NEW.id = ${sql.lit(vs[1]!.id)} BEGIN SELECT RAISE(ABORT, '清单事务故障'); END`.execute(
    app.svc.db,
  );
  const before = await app.svc.db.selectFrom('operation_log').selectAll().execute();
  await expect(
    api.commit({ token: preview.token, confirmed: true, cashflowConfirmed: true }),
  ).rejects.toThrow();
  expect(
    (
      await app.svc.db
        .withTables<VoucherBookTables>()
        .selectFrom('voucher_book_plan')
        .select('result')
        .where('token', '=', preview.token)
        .executeTakeFirstOrThrow()
    ).result,
  ).toBeNull();
  expect(await app.svc.db.selectFrom('operation_log').selectAll().execute()).toEqual(before);
  for (const v of vs) expect((await app.svc.vouchers.get(v.id))!.status).toBe('pending');
});

it('w_pz_get 仅合法集合完成后保留错误项、目标新编号和待审核状态，重放不重复导入', async () => {
  const [v] = await seedVouchers(app.svc, [spec()]);
  const api = app.call(server);
  const data = JSON.parse((await api.export({ filter: {}, format: 'json' })).file) as Transfer;
  data.vouchers.push({ ...data.vouchers[0]!, key: 'bad', date: '2026-02-30' });
  const preview = await api.importPreview({
    file: JSON.stringify(data),
    format: 'json',
    onlyValid: true,
  });
  const result = await api.importCommit({ token: preview.token, confirmed: true });
  expect(result.rows).toEqual([
    expect.objectContaining({
      key: String(v!.id),
      outcome: 'success',
      voucherId: result.createdIds[0],
      voucherLabel: '2026-01-05 记-0002',
      status: '待审核',
    }),
    expect.objectContaining({
      key: 'bad',
      outcome: 'skipped',
      status: '未导入',
      voucherId: null,
      reasons: expect.arrayContaining([expect.stringMatching(/日期/)]),
    }),
  ]);
  expect(await api.importCommit({ token: preview.token, confirmed: true })).toEqual(result);
  expect((await app.svc.vouchers.list({})).total).toBe(2);
});

it('w_pz_get 重复中英文表头、重复映射和重复分组均阻止，明确选择唯一列后能正常导入', async () => {
  await seedVouchers(app.svc, [spec()]);
  const api = app.call(server);
  const exported = await api.export({ filter: {}, format: 'xlsx' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(exported.file, 'base64')).buffer);
  const sheet = wb.getWorksheet('凭证')!;
  const lastColumn = sheet.columnCount + 1;
  sheet.getRow(1).getCell(lastColumn).value = 'account';
  sheet.getRow(2).getCell(lastColumn).value = '不存在';
  const input = {
    file: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
    format: 'xlsx' as const,
  };
  await expect(api.importPreview(input)).rejects.toThrow(/多个表头/);
  const p = await api.importPreview({ ...input, mapping: { account: '科目编码' } });
  expect(p.errorCount).toBe(0);
  await api.importCommit({ token: p.token, confirmed: true });
  await expect(
    api.importPreview({ ...input, mapping: { account: '科目编码', summary: '科目编码' } }),
  ).rejects.toThrow(/同一列/);
  sheet.getRow(1).getCell(lastColumn).value = '科目编码';
  await expect(
    api.importPreview({
      ...input,
      file: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      mapping: { account: '科目编码' },
    }),
  ).rejects.toThrow(/多个表头/);
  const data = JSON.parse((await api.export({ filter: {}, format: 'json' })).file) as Transfer;
  data.vouchers[1]!.key = data.vouchers[0]!.key;
  await expect(api.importPreview({ format: 'json', file: JSON.stringify(data) })).rejects.toThrow(
    /分组.*重复/,
  );
  expect((await app.svc.vouchers.list({})).total).toBe(2);
});

it('w_pz_ttsee 借贷红字合计精确到分且按日期字号稳定排序，作废草稿和期初不参与', async () => {
  const vs = await seedVouchers(app.svc, [spec(-1, '2026-01-20'), spec(2, '2026-01-01'), spec(99)]);
  await app.svc.vouchers.setVoided(vs[2]!.id, true);
  await app.svc.vouchers.create({
    ...(await voucherInputFromSpec(app.svc, spec(88))),
    draft: true,
  });
  const api = app.call(server);
  const rows = await api.tAccount({ accountCode: '6603' });
  expect(rows.map((r) => r.voucherId)).toEqual([vs[1]!.id, vs[0]!.id]);
  expect(reportTotals(rows)).toEqual({ debit: 1, credit: 0 });
  expect(await api.tAccountExport({ accountCode: '6603' })).toEqual(rows);
  expect(await api.tAccountPrint({ accountCode: '6603' })).toEqual(rows);
  await expect(api.tAccountPrint({})).rejects.toThrow(/选择科目/);
  expect(await api.tAccountPrint({ accountCode: '6001' })).toEqual([]);
});

it('w_pz_ttsee 超出安全整数的合计在查询、导出和打印接口一致阻止，红字抵消不丢一分', async () => {
  expect(reportExcelAmount(1)).toBe(1);
  expect(reportExcelAmount(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
  expect(reportExcelAmount(-Number.MAX_SAFE_INTEGER)).toBe('-90071992547409.91');
  expect(() => reportExcelAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  expect(
    reportTotals([
      { debit: Number.MAX_SAFE_INTEGER, credit: 0 },
      { debit: 2, credit: 0 },
      { debit: -Number.MAX_SAFE_INTEGER, credit: 0 },
    ]).debit,
  ).toBe(2);
  await seedVouchers(app.svc, [spec(Number.MAX_SAFE_INTEGER), spec(1)]);
  const api = app.call(server);
  for (const run of [api.tAccount, api.tAccountExport, api.tAccountPrint])
    await expect(run({ accountCode: '6603' })).rejects.toThrow(/安全整数/);
});

it('w_pz_kmhz / w_pz_ttsee 打印独立权限由服务器拒绝，查看与导出不能替代打印权限', async () => {
  await seedVouchers(app.svc, [spec()]);
  const viewer = app.call(
    server,
    await app.addUser('viewer', { permissions: ['voucher-book.view', 'voucher-book.export'] }),
  );
  await expect(viewer.tAccountPrint({ accountCode: '6603' })).rejects.toThrow(/权限/);
  await expect(viewer.summaryPrint({ filter: {} })).rejects.toThrow(/权限/);
  const printer = app.call(
    server,
    await app.addUser('printer', { permissions: ['voucher-book.print'] }),
  );
  expect(await printer.tAccountPrint({ accountCode: '6603' })).toHaveLength(1);
  expect(await printer.summaryPrint({ filter: {} })).toHaveLength(2);
});

it('w_pz_kmhz / w_pz_ttsee 打印保留红字与范围，文本转义且空范围不产生打印内容', () => {
  const caption = reportCaption(
    {
      periodFrom: 202601,
      periodTo: 202602,
      accountCode: '6603',
      voucherTypeId: 1,
      numberFrom: 2,
      numberTo: 3,
      amountFrom: 1,
      createdBy: 2,
      conditions: [{ field: 'summary', operator: 'contains', value: '<范围>' }],
    },
    '记',
  );
  expect(caption).toContain('凭证类型 记');
  expect(caption).toContain('金额 0.01');
  expect(caption).toContain('摘要含有“<范围>”');
  expect(caption).not.toContain('periodFrom');
  const row = {
    date: '2026-01-05',
    displayNo: '记-0001',
    accountCode: '6603',
    accountName: '<科目>',
    summary: '<img src=x onerror=alert(1)>',
    debit: -1,
    credit: 0,
  };
  const html = tAccountHtml([row], '<范围>');
  expect(html).toContain('借方 合计 -0.01');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).toContain('&lt;范围&gt;');
  expect(() => assertSafePrintContent(html)).not.toThrow();
  const summary = summaryHtml(
    [
      {
        code: '6603',
        name: '<科目>',
        currency: 'USD',
        debit: 71,
        credit: 0,
        fcDebit: 10,
        fcCredit: 0,
      },
    ],
    '<范围>',
    true,
  );
  expect(summary).toContain('原币借方');
  expect(summary).toContain('0.10');
  expect(() => assertSafePrintContent(summary)).not.toThrow();
  expect(() => tAccountHtml([], '')).toThrow(/没有单据/);
  expect(() => summaryHtml([], '', false)).toThrow(/没有凭证/);
});
