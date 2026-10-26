import { describe, expect, it } from 'vitest';
import { balanceFormula } from '../../shared';
import { balanceDrilldown } from '../../web/drilldown';

const input = {
  account: '1001',
  metric: 'closing' as const,
  unit: 'cents' as const,
  currency: 'CNY',
  direction: 'signed' as const,
  dimension: 'none' as const,
  item: '',
};
describe('w_bb_proc 同口径明细入口', () => {
  it('直接七参数期末保持原期间入口，累计从当年启用月份开始且携带含未过账', () => {
    expect(balanceDrilldown(`=${balanceFormula(input)}`, 202609, 202607, false)).toMatchObject({
      kind: 'link',
      href: '/m/ledgers/detail?account=1001&from=202609&to=202609',
    });
    expect(
      balanceDrilldown(balanceFormula({ ...input, metric: 'ytdDebit' }), 202609, 202607, true),
    ).toMatchObject({
      kind: 'link',
      href: '/m/ledgers/detail?account=1001&from=202607&to=202609&includeUnposted=1',
    });
    expect(
      balanceDrilldown(balanceFormula({ ...input, metric: 'ytdCredit' }), 202702, 202607, false),
    ).toMatchObject({ kind: 'link', from: 202701, to: 202702 });
  });
  it('统一第八参数合同的跨期/排除结转/分向/分组不降格成当前期间链接', () => {
    const sources = [
      balanceFormula({
        ...input,
        options: {
          from: 'previousYearStart',
          to: 'previousYear',
          side: 'debit',
          groupBy: ['project'],
        },
      }),
      balanceFormula({ ...input, metric: 'debit', options: { closing: 'excludePnl' } }),
    ];
    for (const source of sources)
      expect(balanceDrilldown(source, 202609, 202501, false)).toMatchObject({
        kind: 'blocked',
        reason: expect.stringContaining('扩展 options'),
      });
  });
  it('组合式和多个取数调用不只取第一个科目；非取数公式无需穿透提示', () => {
    const source = `${balanceFormula(input)}+${balanceFormula({ ...input, account: '100201' })}`;
    expect(balanceDrilldown(source, 202601, 202601, false).kind).toBe('blocked');
    expect(balanceDrilldown(`SUM(${balanceFormula(input)})`, 202601, 202601, false).kind).toBe(
      'blocked',
    );
    expect(balanceDrilldown('SUM(A1:A2)', 202601, 202601, false)).toEqual({ kind: 'none' });
  });
  it('辅助/外币/数量或非法期间明确阻止，不能丢失取数维度', () => {
    for (const patch of [
      { dimension: 'department' as const, item: '01' },
      { unit: 'foreignCents' as const, currency: 'USD' },
      { unit: 'quantity' as const },
    ])
      expect(
        balanceDrilldown(balanceFormula({ ...input, ...patch }), 202601, 202601, false).kind,
      ).toBe('blocked');
    expect(balanceDrilldown(balanceFormula(input), 202613, 202601, false).kind).toBe('blocked');
    expect(balanceDrilldown(balanceFormula(input), 202601, 202607, false).kind).toBe('blocked');
  });
});
