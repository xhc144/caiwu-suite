import { expect, it } from 'vitest';
import {
  prepareSmallBusiness,
  assertSmallBusinessOutput,
  type PreparedSmallBusiness,
} from '../../templates/small-business/statutory.server';
import {
  fixedYearBook,
  yearOpening,
  yearBalanceMovement,
  yearIncomeUnit,
  yearCashUnit,
} from './year-fixture';

function expectRows(report: PreparedSmallBusiness['statements'][number], columns: number[][]) {
  expect(report.rows).toHaveLength(columns[0]!.length);
  for (const row of report.rows)
    for (const [column, values] of columns.entries()) {
      expect(row.amounts[column]?.value, `${report.name}行${row.line}列${column + 1}`).toBe(
        values[row.line - 1],
      );
      expect(Number.isSafeInteger(row.amounts[column]?.value)).toBe(true);
    }
  expect(report.checks.every((check) => check.difference === 0)).toBe(true);
}
const balanceAt = (units: number) =>
  yearOpening.map((value, row) => value + yearBalanceMovement[row]! * units);
const incomeFor = (units: number) => yearIncomeUnit.map((value) => value * units);
const cashFor = (units: number, previousUnits: number) => [
  ...yearCashUnit.map((value) => value * units),
  2100000 + 8381 * previousUnits,
  2100000 + 8381 * (previousUnits + units),
];

it('w_bb_proc 固定账套两年24个月：三表全部107行每月两列手算对照，含期初、月度结转和不同上年', async () => {
  const { app, svc } = await fixedYearBook();
  try {
    const vouchers = await svc.vouchers.list({
      periodFrom: 202501,
      periodTo: 202612,
      limit: 10000,
    });
    expect(vouchers.items.filter((voucher) => voucher.closingKind === 'pnl')).toHaveLength(24);
    for (const year of [2025, 2026]) {
      const multiplier = year === 2025 ? 2 : 1;
      const priorYear = year === 2025 ? 0 : 156;
      for (let month = 1; month <= 12; month++) {
        const cumulative = (multiplier * month * (month + 1)) / 2;
        const current = multiplier * month;
        const prepared = await svc.tx((t) =>
          prepareSmallBusiness(t, { period: year * 100 + month, mode: 'monthly' }),
        );
        assertSmallBusinessOutput(prepared);
        expectRows(prepared.statements[0], [
          balanceAt(priorYear + cumulative),
          balanceAt(priorYear),
        ]);
        expect(prepared.statements[0].returnedInvestment).toEqual([2000, 2000]);
        expectRows(prepared.statements[1], [incomeFor(cumulative), incomeFor(current)]);
        expectRows(prepared.statements[2], [
          cashFor(cumulative, priorYear),
          cashFor(current, priorYear + cumulative - current),
        ]);
        // 已结转损益在总账归零，但本月收入、费用和利润仍须保留；权益含当年累计利润。
        const balances = await svc.ledger.balances({
          periodFrom: year * 100 + month,
          periodTo: year * 100 + month,
          rollup: false,
        });
        expect(
          balances
            .filter((row) =>
              ['5001', '5051', '5401', '5402', '560204', '560302'].includes(row.accountCode),
            )
            .every((row) => row.closing === 0),
        ).toBe(true);
        expect(
          prepared.statements[0].rows[50]!.amounts[0].value -
            prepared.statements[0].rows[50]!.amounts[1]!.value,
        ).toBe(10520 * cumulative);
        // 资产负债表包括保证金，现金流量表不包括；原材料、商品按成本差异后的净额列示。
        expect(
          prepared.statements[0].rows[0]!.amounts[0].value -
            prepared.statements[2].rows[21]!.amounts[0].value,
        ).toBe(50000);
        const inventory = prepared.statements[0].rows;
        expect(inventory[8]!.amounts[0].value).toBeGreaterThanOrEqual(
          [9, 10, 11, 12].reduce((sum, row) => sum + inventory[row]!.amounts[0].value, 0),
        );
      }
    }
    const annual = await svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' }));
    assertSmallBusinessOutput(annual);
    expectRows(annual.statements[0], [balanceAt(234), balanceAt(156)]);
    expectRows(annual.statements[1], [incomeFor(78), incomeFor(156)]);
    expectRows(annual.statements[2], [cashFor(78, 156), cashFor(156, 0)]);
    expect(annual.statements[1].columns[1]).toBe('上年全年金额');
  } finally {
    await app.close();
  }
}, 60000);
