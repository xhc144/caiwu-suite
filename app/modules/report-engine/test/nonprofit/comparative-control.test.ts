import { expect, it } from 'vitest';
import { activityRows } from '../../templates/nonprofit/forms';
import { attachComparative } from '../../templates/nonprofit/comparative';
import { assertNonprofitChecks } from '../../templates/nonprofit/statutory.server';
import type { Configuration, Statement, StatementRequest } from '../../templates/nonprofit/model';

const pr: StatementRequest = {
  code: '402',
  kind: 'month',
  from: 202601,
  to: 202601,
  comparison: false,
  includeUnposted: false,
};
function probe() {
  const previous: Statement = {
    code: '402',
    name: '业务活动表',
    organization: '合成组织',
    period: pr,
    columns: Array.from({ length: 6 }, () => '合成分类列'),
    checks: [],
    notes: [],
    unpostedCount: 0,
    rows: activityRows
      .filter((r) => r.id !== 'activityDetails')
      .map((r) => ({
        ...r,
        values: r.section ? [] : [0, 0, 0, 0, 0, 0],
        sources: ['合成真实上年来源'],
      })),
  };
  for (const id of ['activityCost', 'expenseTotal'])
    previous.rows.find((r) => r.id === id)!.values = [100, 0, 100, 100, 0, 100];
  previous.rows.find((r) => r.id === 'netChange')!.values = [-100, 0, -100, -100, 0, -100];
  previous.rows.push({
    id: 'detail:A',
    label: '其中：教育项目',
    values: [100, 0, 100, 100, 0, 100],
    sources: [],
  });
  const current = structuredClone(previous);
  current.period = { ...pr, from: 202701, to: 202701 };
  const c = {
    comparison: { basis: '合成项目重列底稿', restatements: [] },
  } as unknown as Configuration;
  const change = (row: string, amount: number) =>
    c.comparison!.restatements.push({
      code: '402',
      row,
      amount,
      period: 202601,
      basis: '合成原期间明细依据',
    });
  return { current, previous, c, change };
}

it('w_bb_proc 只有业务组成加100而母项仍100，比较勾稽明确报差额100', () => {
  const { current, previous, c, change } = probe();
  change('detail:A', 100);
  attachComparative(current, previous, c, pr);
  expect(current.rows.find((r) => r.id === 'activityCost')!.values.slice(6)).toEqual([100, 100]);
  expect(current.rows.find((r) => r.id === 'detail:A')!.values.slice(6)).toEqual([200, 200]);
  expect(
    current.checks
      .filter((x) => x.name === '比较重列后业务组成与业务活动成本一致')
      .map((x) => x.difference),
  ).toEqual([100, 100]);
  expect(() => assertNonprofitChecks(current)).toThrow(/业务组成/);
});

it('w_bb_proc 组成间等额重列保持母项和费用不变，其中慈善信托不重复加总', () => {
  const { current, previous, c, change } = probe();
  previous.rows.push({
    id: 'detail:B',
    label: '其中：救助项目',
    values: [0, 0, 0, 0, 0, 0],
    sources: [],
  });
  change('detail:A', -40);
  change('detail:B', 40);
  change('charitableTrust', 30);
  attachComparative(current, previous, c, pr);
  expect(() => assertNonprofitChecks(current)).not.toThrow();
  expect(current.rows.find((r) => r.id === 'expenseTotal')!.values.slice(6)).toEqual([100, 100]);
  expect(current.rows.find((r) => r.id === 'charitableTrust')!.values.slice(6)).toEqual([30, 30]);
});

it.each(['charitableTrust', 'fundraisingCost'])(
  'w_bb_proc %s不能凭一条重列依据超出母项真实发生范围',
  (row) => {
    const { current, previous, c, change } = probe();
    change(row, 200);
    attachComparative(current, previous, c, pr);
    expect(() => assertNonprofitChecks(current)).toThrow(/母项范围/);
  },
);

it('w_bb_proc 有退款时其中项可超过母项净额，仍由真实正负发生约束', () => {
  const { current, previous, c, change } = probe();
  change('charitableTrust', 150);
  attachComparative(current, previous, c, pr, undefined, [
    { row: 'activityCost', kind: 'unrestricted', period: 202601, amount: 200, source: '合成支出' },
    {
      row: 'activityCost',
      kind: 'unrestricted',
      period: 202601,
      amount: -100,
      source: '合成其他项目退款',
    },
  ]);
  expect(() => assertNonprofitChecks(current)).not.toThrow();
  expect(current.rows.find((r) => r.id === 'expenseTotal')!.values.slice(6)).toEqual([100, 100]);
});
