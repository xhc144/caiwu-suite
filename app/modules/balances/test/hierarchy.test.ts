import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { downloadBlob } from '@caiwu/ui';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import balancesServer from '../server';
import { reportTables } from '../shared';
import { exportReport } from '../web/output';
import { seedHierarchyCases } from './hierarchy-fixtures';

vi.mock('@caiwu/ui', () => ({ downloadBlob: vi.fn() }));
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [balancesServer] });
  vi.mocked(downloadBlob).mockClear();
});
afterEach(async () => app.close());
const range = {
  periodFrom: 202602,
  periodTo: 202602,
  codeFrom: '1403',
  codeTo: '1403',
  dimension: 'department' as const,
  dimensionFrom: 'G',
  dimensionTo: 'G',
  currency: 'USD',
};

it.each(['summary', 'foreign', 'quantity'] as const)(
  'w_zw_fhye/w_zw_fhwbye/w_zw_fhslye %s：父项包含真实下级，按辅助级次合并且不带入同编码范围外的独立部门',
  async (mode) => {
    const ids = await seedHierarchyCases(app.svc);
    const api = app.call(balancesServer);
    const direct = await api.query({ ...range, mode });
    expect(direct.groups.flatMap((g) => g.rows).every((r) => r.opening === 0)).toBe(true);
    const detail = await api.query({ ...range, mode, dimensionChildren: true });
    expect(
      detail.groups
        .filter((g) => g.rows.some((r) => r.opening !== 0))
        .map((g) => g.dimension!.id)
        .sort(),
    ).toEqual([ids.a.id, ids.grand.id].sort());
    const aggregate = await api.query({
      ...range,
      mode,
      dimensionChildren: true,
      dimensionLevel: 1,
    });
    const group = aggregate.groups.find((g) => g.dimension?.id === ids.parent.id)!;
    expect(group.rows.find((r) => r.accountCode === '140301')).toMatchObject({
      opening: 3550,
      closing: 3550,
      fcOpening: 500,
      qtyOpening: '0.5',
    });
    expect(group.totals).toMatchObject({ openingDebit: 3550, openingCredit: 0, fcOpening: 500 });
    expect(
      group.dimension!.members!.map((m) => m.id).filter((id) => id === ids.outside.id),
    ).toEqual([]);
    if (mode === 'quantity') expect(group.quantityTotals!.qtyClosing).toBe('0.5');
    const level2 = await api.query({ ...range, mode, dimensionChildren: true, dimensionLevel: 2 });
    const nonzero = level2.groups.filter(
      (g) => g.totals.openingDebit !== 0 || g.totals.openingCredit !== 0,
    );
    expect(nonzero.map((g) => g.dimension!.id).sort()).toEqual([ids.a.id, ids.b.id].sort());
    expect(
      nonzero
        .find((g) => g.dimension!.id === ids.b.id)!
        .dimension!.members!.some((m) => m.id === ids.grand.id),
    ).toBe(true);
  },
);

it('w_zw_fhye_1 按科目重新排列保留每个辅助项、末级合计及精确 Excel 数值，URL 条件仍取交集', async () => {
  const ids = await seedHierarchyCases(app.svc);
  const api = app.call(balancesServer);
  const report = await api.export({ ...range, dimensionChildren: true, dimensionOrder: 'account' });
  const tables = reportTables(report, -1, []);
  expect(tables).toHaveLength(1);
  const rows = tables[0]!.rows;
  expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  expect(rows.filter((r) => r.source).map((r) => r.auxiliaryCode)).toEqual(
    [...rows.filter((r) => r.source).map((r) => r.auxiliaryCode)].sort(),
  );
  expect(rows.filter((r) => !r.source)).toHaveLength(report.groups.length);
  expect(rows.filter((r) => r.source).reduce((n, r) => n + r.source!.opening, 0)).toBe(3550);
  await exportReport(report, -1, []);
  const blob = vi.mocked(downloadBlob).mock.calls[0]![0];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  const ws = wb.worksheets[0]!;
  expect(ws.getCell('C4').text).toBe('辅助编码');
  const aRow = ws
    .getRows(5, ws.rowCount - 4)!
    .find((r) => r.getCell(1).text === '140301' && r.getCell(3).text === 'A')!;
  expect(aRow.getCell(6).value).toBe(71);
  const exact = await api.query({
    ...range,
    dimensionChildren: true,
    dimensionLevel: 1,
    dims: JSON.stringify({ department: ids.grand.id }),
  });
  expect(
    exact.groups.filter((g) => g.rows.some((r) => r.opening !== 0))[0]!.totals.openingCredit,
  ).toBe(3550);
});

it('w_zw_fhye_1 辅助层级和排列默认设置可保存、重新读取，旧版本保存失败不覆盖新设置', async () => {
  const api = app.call(balancesServer);
  const display = {
    level: -1,
    onlyActivity: true,
    dimensionChildren: true,
    dimensionLevel: 2,
    dimensionOrder: 'account' as const,
  };
  expect(await api.saveSettings({ revision: 0, display })).toEqual({ revision: 1, display });
  expect((await api.metadata()).settings).toEqual({ revision: 1, display });
  await expect(
    api.saveSettings({ revision: 0, display: { ...display, dimensionLevel: 1 } }),
  ).rejects.toThrow(/没有覆盖/);
  expect((await api.metadata()).settings).toEqual({ revision: 1, display });
});
