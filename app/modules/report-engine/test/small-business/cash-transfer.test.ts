import { expect, it } from 'vitest';
import { cashflowStatement } from '../../templates/small-business/statements';
import { domain, entry, balanceRow, classify } from './domain-fixture';

function transfer() {
  const data = domain();
  data.scopes[1] = null;
  data.roles.set('1001', 'money');
  data.roles.set('1002', 'money');
  data.roles.set('5603', 'finance');
  data.config.cashScope = ['1001', '1002'].map((account) => ({
    account,
    from: '2026-01-01',
    to: '2026-12-31',
    available: true,
    reason: '企业可随时支付的账户',
  }));
  const incoming = entry('1001', 10000, 1),
    outgoing = entry('1002', -10100, 2),
    fee = entry('5603', 100, 3);
  outgoing.voucherId = fee.voucherId = incoming.voucherId;
  data.current = [incoming, outgoing, fee];
  classify(data, incoming, [{ line: 0, amount: 10000 }]);
  classify(data, outgoing, [
    { line: 0, amount: -10000 },
    { line: 6, amount: -100 },
  ]);
  const balances = {
    opening: [balanceRow('1001', 10000), balanceRow('1002', 20000)],
    closing: [balanceRow('1001', 20000), balanceRow('1002', 9900)],
  };
  return { data, balances, incoming, outgoing };
}

it('w_bb_proc 同一凭证的银行转存与手续费分开列示，内部收付抵销而手续费保留', () => {
  const { data, balances } = transfer();
  const result = cashflowStatement(data, [balances, null]);
  expect(result.rows.map((r) => r.amounts[0].value)).toEqual([
    0, 0, 0, 0, 0, 100, -100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -100, 30000, 29900,
  ]);
  expect(result.checks.map((c) => c.difference)).toEqual([0]);
  expect(result.rows[5]!.amounts[0].sources).toMatchObject([{ account: '1002', amount: -100 }]);
});

it('w_bb_proc 复合转账内部收付必须在同一凭证抵销', () => {
  const { data, balances } = transfer();
  data.config.cashAllocations['2']!.parts = [
    { line: 0, amount: -9900 },
    { line: 6, amount: -200 },
  ];
  expect(() => cashflowStatement(data, [balances, null])).toThrow(/内部划转未抵销/);
});

it('w_bb_proc 内部划转不得反向或超过该行真实收付后用其他项目凑平', () => {
  for (const parts of [
    [
      { line: 0, amount: -10000 },
      { line: 0, amount: 10000 },
      { line: 1, amount: 10000 },
    ],
    [
      { line: 0, amount: 10100 },
      { line: 6, amount: -100 },
    ],
  ]) {
    const { data, balances } = transfer();
    data.config.cashAllocations['1']!.parts = parts;
    expect(() => cashflowStatement(data, [balances, null])).toThrow(/内部划转.*真实收付/);
  }
});

it('w_bb_proc 纯现金账户转存不能分到经营和投资项目虚增分类流量', () => {
  const { data, balances, incoming, outgoing } = transfer();
  outgoing.credit = 10000;
  data.current = [incoming, outgoing];
  classify(data, incoming, [{ line: 1, amount: 10000 }]);
  classify(data, outgoing, [{ line: 11, amount: -10000 }]);
  expect(() => cashflowStatement(data, [balances, null])).toThrow(/请全部归入内部转存/);
  classify(data, incoming, [{ line: 0, amount: 10000 }]);
  classify(data, outgoing, [{ line: 0, amount: -10000 }]);
  balances.closing[1] = balanceRow('1002', 10000);
  const statement = cashflowStatement(data, [balances, null]);
  expect(statement.rows.slice(0, 20).map((row) => row.amounts[0].value)).toEqual(
    Array<number>(20).fill(0),
  );
  expect(statement.checks.map((check) => check.difference)).toEqual([0]);
});
