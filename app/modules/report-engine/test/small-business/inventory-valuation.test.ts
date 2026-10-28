import { expect, it } from 'vitest';
import { balanceSheet } from '../../templates/small-business/statements';
import { rowKey } from '../../templates/small-business/configuration';
import { domain, addBalance } from './domain-fixture';

it('w_bb_proc 材料差异按真实品种分配，原材料与周转材料明细均按成本净额列示', () => {
  const data = domain();
  addBalance(data, 'raw', 1000);
  addBalance(data, 'turnover', 500);
  addBalance(data, 'retained', -1400);
  const variance = addBalance(data, 'materialVariance', -100);
  expect(() => balanceSheet(data)).toThrow(/期限或性质确认缺失/);
  for (const period of [202512, 202612])
    data.config.facts.push({
      period,
      key: rowKey(variance),
      balance: -100,
      reason: '按期末结存原材料与周转材料的成本差异明细',
      allocations: [
        { role: 'raw', amount: -60 },
        { role: 'turnover', amount: -40 },
      ],
    });
  const statement = balanceSheet(data);
  for (const column of [0, 1]) {
    expect(statement.rows[8]!.amounts[column]?.value).toBe(1400);
    expect(statement.rows[9]!.amounts[column]?.value).toBe(940);
    expect(statement.rows[12]!.amounts[column]?.value).toBe(460);
  }
  expect(statement.checks.every((c) => c.difference === 0)).toBe(true);
  expect(statement.rows[9]!.amounts[0].sources).toMatchObject([
    { amount: 1000 },
    { account: variance.accountCode, amount: -60 },
  ]);
  const opening = data.config.facts.find((f) => f.period === 202512)!;
  opening.allocations = [{ role: 'raw', amount: -100 }];
  const changed = balanceSheet(data);
  expect(changed.rows[9]!.amounts.map((a) => a?.value)).toEqual([940, 900]);
  expect(changed.rows[12]!.amounts.map((a) => a?.value)).toEqual([460, 500]);
});

it('w_bb_proc 商品售价扣除进销差价，差价借余保留符号，存货总额不重复抵减', () => {
  for (const difference of [-200, 50]) {
    const data = domain();
    addBalance(data, 'goods', 1000);
    addBalance(data, 'goodsVariance', difference);
    addBalance(data, 'retained', -1000 - difference);
    const statement = balanceSheet(data);
    expect(statement.rows[8]!.amounts.map((a) => a?.value)).toEqual([
      1000 + difference,
      1000 + difference,
    ]);
    expect(statement.rows[11]!.amounts.map((a) => a?.value)).toEqual([
      1000 + difference,
      1000 + difference,
    ]);
    expect(statement.checks.every((c) => c.difference === 0)).toBe(true);
  }
});

it('w_bb_proc 材料差异分配拒绝无关去向、反向金额、合计差额及过期余额', () => {
  const data = domain();
  const variance = addBalance(data, 'materialVariance', -100);
  const fact = {
    period: 202612,
    key: rowKey(variance),
    balance: -100,
    reason: '原材料差异分配',
    allocations: [{ role: 'raw' as const, amount: -100 }],
  };
  data.config.facts.push(fact);
  fact.allocations = [{ role: 'raw', amount: -99 }];
  expect(() => balanceSheet(data)).toThrow(/合计与余额不相等/);
  fact.allocations = [
    { role: 'raw', amount: -101 },
    { role: 'raw', amount: 1 },
  ];
  expect(() => balanceSheet(data)).toThrow(/方向与余额不一致/);
  data.config.facts[0]!.allocations = [{ role: 'fixed', amount: -100 }];
  expect(() => balanceSheet(data)).toThrow(/分类去向不适用/);
  data.config.facts[0]!.allocations = [{ role: 'raw', amount: -100 }];
  fact.balance = -101;
  expect(() => balanceSheet(data)).toThrow(/余额已变化/);
});

it('w_bb_proc 已在原材料或周转材料子科目核算的成本差异不再重复分配', () => {
  const data = domain();
  addBalance(data, 'raw', 1000, null, '140301');
  addBalance(data, 'raw', -100, null, '140302');
  addBalance(data, 'turnover', 500, null, '141101');
  addBalance(data, 'turnover', -50, null, '141102');
  addBalance(data, 'retained', -1350);
  const statement = balanceSheet(data);
  expect(statement.rows[8]!.amounts[0].value).toBe(1350);
  expect(statement.rows[9]!.amounts[0].value).toBe(900);
  expect(statement.rows[12]!.amounts[0].value).toBe(450);
  expect(statement.checks.every((c) => c.difference === 0)).toBe(true);
});

it('w_bb_proc 存货低于其中四项合计时标出第9行差额', () => {
  const data = domain();
  addBalance(data, 'raw', 1000);
  addBalance(data, 'otherInventory', -100);
  addBalance(data, 'retained', -900);
  const statement = balanceSheet(data);
  expect(
    statement.checks.filter((check) => check.line === 53).map((check) => check.difference),
  ).toEqual([0, 0]);
  expect(
    statement.checks.filter((check) => check.line === 9).map((check) => check.difference),
  ).toEqual([100, 100]);
});
