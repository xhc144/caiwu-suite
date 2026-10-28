import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import ExcelJS from 'exceljs';
import reportServer from '../server';
import { balanceFormula, emptyTemplate } from '../shared';
import { workbookBase64 } from '../server/export';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer] });
});
afterEach(async () => {
  await app.close();
});

it('w_bb_proc 跟踪每次取数的单元格、累计范围和辅助条件；缓存和跨表引用不漏调用，旧快照保持原数', async () => {
  await seedVouchers(app.svc, [
    {
      date: '2026-02-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 10000, dims: { cashflow: 'CF01' } },
        { account: '6001', credit: 10000 },
      ],
    },
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1122', debit: 5000, dims: { partner: 'C001' } },
        { account: '6001', credit: 5000 },
      ],
    },
  ]);
  const cash = balanceFormula({
    account: '1001',
    metric: 'debit',
    unit: 'cents',
    currency: 'CNY',
    direction: 'signed',
    dimension: 'cashflow',
    item: 'CF01',
  });
  const partner = balanceFormula({
    account: '1122',
    metric: 'ytdDebit',
    unit: 'cents',
    currency: 'CNY',
    direction: 'signed',
    dimension: 'partner',
    item: 'C001',
  });
  const api = app.call(reportServer);
  const dependency = emptyTemplate({ code: '102', name: '合成辅助来源', rows: 2, cols: 2 });
  dependency.cells = [
    { address: 'A1', kind: 'formula', source: partner, unit: 'cents', currency: 'CNY' },
  ];
  await api.importTemplate(dependency);
  const template = emptyTemplate({ code: '101', name: '合成逐项来源', rows: 2, cols: 2 });
  template.cells = [
    { address: 'A1', kind: 'formula', source: cash, unit: 'cents', currency: 'CNY' },
    { address: 'A2', kind: 'formula', source: `${cash}*2`, unit: 'cents', currency: 'CNY' },
    { address: 'B1', kind: 'formula', source: 'REF("102","A1")', unit: 'cents', currency: 'CNY' },
  ];
  template.checks = [{ name: '合成来源审核', left: cash, right: 'A1', tolerance: '0' }];
  const report = await api.importTemplate(template);
  const generated = await api.generate({
    id: report.id,
    expectedRevision: report.revision,
    period: 202602,
    requestId: randomUUID(),
  });
  if (generated.kind !== 'generated') throw new Error('意外确认');
  const snapshot = generated.snapshot;
  expect(snapshot.cells.map((cell) => cell.value)).toEqual(['10000', '20000', '5000']);
  const cashId = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  const partnerId = (await app.svc.dimensions.getByCode('partner', 'C001'))!.id;
  expect(
    snapshot.sources?.map((source) => [
      source.reportCode,
      source.address,
      source.value,
      source.periodFrom,
      source.periodTo,
      source.dimensions,
    ]),
  ).toEqual([
    ['101', 'A1', '10000', 202602, 202602, { cashflow: cashId }],
    ['101', 'A2', '10000', 202602, 202602, { cashflow: cashId }],
    ['102', 'A1', '5000', 202601, 202602, { partner: partnerId }],
    ['101', '审核表达式', '10000', 202602, 202602, { cashflow: cashId }],
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Uint8Array.from(Buffer.from(await workbookBase64(snapshot), 'base64')).buffer,
  );
  const meta = workbook.getWorksheet('口径与审核')!;
  expect(
    meta
      .getSheetValues()
      .flat()
      .filter((value) => value === 'CF01'),
  ).toHaveLength(3);
  await seedVouchers(app.svc, [
    {
      date: '2026-02-06',
      status: 'posted',
      lines: [
        { account: '1001', debit: 2000, dims: { cashflow: 'CF01' } },
        { account: '6001', credit: 2000 },
      ],
    },
  ]);
  expect((await api.snapshot({ id: report.id, period: 202602 }))?.sources).toEqual(
    snapshot.sources,
  );
  const next = await api.generate({
    id: report.id,
    expectedRevision: report.revision,
    period: 202602,
    requestId: randomUUID(),
  });
  if (next.kind !== 'generated') throw new Error('意外确认');
  expect(next.snapshot.sources?.[0]?.value).toBe('12000');
  expect(snapshot.sources?.[0]?.value).toBe('10000');
});
