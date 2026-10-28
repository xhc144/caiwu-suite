import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { downloadBlob } from '@caiwu/ui';
import balancesServer from '../server';
import { outputRows } from '../shared';
import { exportReport, reportHtml } from '../web/output';
import { seedAuxiliaryQuantityCases } from './fixtures';

vi.mock('@caiwu/ui', () => ({ downloadBlob: vi.fn() }));
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [balancesServer] });
  vi.mocked(downloadBlob).mockClear();
});
afterEach(async () => app.close());

it('w_zw_wbye/w_zw_fhwbye 原币累计含前月、红字与辅助交集，逐币种末级合计一次，真实 XLSX 累计列精确', async () => {
  const ids = await seedAuxiliaryQuantityCases(app.svc);
  await seedVouchers(app.svc, [
    {
      date: '2026-01-10',
      status: 'posted',
      lines: [
        {
          account: '140301',
          debit: 14200,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 2000,
          quantity: '4.123456',
          dims: { project: 'XM01', department: '01' },
        },
        { account: '4001', credit: 14200 },
      ],
    },
  ]);
  const api = app.call(balancesServer);
  const report = await api.export({
    periodFrom: 202602,
    periodTo: 202602,
    mode: 'foreign',
    dimension: 'project',
    dimensionFrom: 'XM01',
    dimensionTo: 'XM01',
  });
  expect(report.groups[0]!.totals).toMatchObject({
    fcDebit: -1000,
    fcYtdDebit: 1000,
    fcYtdCredit: 0,
  });
  const row = report.groups[0]!.rows.find((r) => r.isLeaf)!;
  expect(row).toMatchObject({
    fcYtdDebit: 1000,
    qtyYtdDebit: '4.123458',
    dimensions: { project: ids.project },
  });
  await exportReport(report, -1, []);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await vi.mocked(downloadBlob).mock.calls[0]![0].arrayBuffer());
  expect(wb.worksheets[0]!.getCell('O4').text).toBe('原币本年累计借方');
  expect(wb.worksheets[0]!.lastRow!.getCell(15).value).toBe(10);
});
it('w_zw_slye/w_zw_fhslye 数量累计按单位及辅助项汇总，结余单价用精确十进制；零数量不除零', async () => {
  await seedAuxiliaryQuantityCases(app.svc);
  await seedVouchers(app.svc, [
    {
      date: '2026-01-10',
      status: 'posted',
      lines: [
        { account: '140303', debit: 2000, quantity: '0.5', dims: { project: 'XM01' } },
        { account: '4001', credit: 2000 },
      ],
    },
  ]);
  const report = await app
    .call(balancesServer)
    .query({ periodFrom: 202602, periodTo: 202602, mode: 'quantity', dimension: 'project' });
  const kg = report.groups.find((g) => g.unit === '千克')!;
  expect(kg.quantityTotals).toMatchObject({ qtyYtdDebit: '0.500002', qtyYtdCredit: '0.5' });
  const rows = outputRows(kg, -1, []);
  expect(rows.find((r) => r.code === '140303')).toMatchObject({
    qtyYtdDebit: '0.5',
    qtyYtdCredit: '0.5',
    closingUnitPrice: '20.000000',
  });
  expect(reportHtml(report, -1, [])).toContain('本年累计借方数量');
  const account = await app.svc.accounts.require('1405');
  await app.svc.opening.upsert({ year: 2026, accountId: account.id, balance: 1000, quantity: '0' });
  const zero = await app.call(balancesServer).query({
    periodFrom: 202602,
    periodTo: 202602,
    mode: 'quantity',
    codeFrom: '1405',
    codeTo: '1405',
  });
  expect(outputRows(zero.groups[0]!, -1, [])[0]!.closingUnitPrice).toBe('—');
});
it('w_zw_slye/w_zw_wbye 年中启用的累计来源缺失显示空值和原因，不伪装成零', async () => {
  await app.close();
  app = await createTestApp({ modules: [balancesServer], startMonth: 7 });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('100202')).id,
    currency: 'USD',
    balance: 710,
    fcBalance: 100,
  });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('1403')).id,
    balance: 1000,
    quantity: '2',
  });
  for (const mode of ['foreign', 'quantity'] as const) {
    const report = await app
      .call(balancesServer)
      .query({ periodFrom: 202607, periodTo: 202607, mode });
    const g = report.groups[0]!;
    const key = mode === 'foreign' ? 'fcYtdDebit' : 'qtyYtdDebit';
    expect(g.rows[0]![key]).toBeNull();
    expect(g.rows[0]!.dimensionYtdMissing).toContain('启用前');
    expect(mode === 'foreign' ? g.totals.fcYtdDebit : g.quantityTotals?.qtyYtdDebit).toBeNull();
    expect(reportHtml(report, -1, [])).toContain('—');
  }
});

it('w_zw_slye 结余单价在安全整数极值及百万分之一数量下保留六位小数', async () => {
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('1403')).id,
    balance: Number.MAX_SAFE_INTEGER,
    quantity: '0.000001',
  });
  const report = await app.call(balancesServer).query({
    periodFrom: 202602,
    periodTo: 202602,
    mode: 'quantity',
    codeFrom: '1403',
    codeTo: '1403',
  });
  expect(outputRows(report.groups[0]!, -1, [])[0]!.closingUnitPrice).toBe(
    '90071992547409910000.000000',
  );
});
