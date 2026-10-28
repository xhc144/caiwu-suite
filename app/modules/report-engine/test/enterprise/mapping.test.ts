import { expect, it } from 'vitest';
import { calculateBalance } from '../../templates/enterprise/calculate';
import { suggestEnterpriseRules } from '../../templates/enterprise/mapping';
import { balanceBucket } from '../../templates/enterprise/model';
import { account, balance, fixture, provenance } from './fixture';

it.each([
  ['其他应付款', 'credit', 'payable'],
  ['应付利息', 'credit', 'payable'],
  ['应付股利', 'credit', 'payable'],
  ['其他应收款', 'debit', 'receivable'],
  ['应收利息', 'debit', 'receivable'],
  ['应收股利', 'debit', 'receivable'],
] as const)('w_bb_proc %s默认建议按往来明细重分类，不能跨对象抵销', (name, direction, kind) => {
  const { c, d } = fixture();
  const a = account(20, name, direction === 'credit' ? 'liability' : 'asset', direction);
  const rule = suggestEnterpriseRules([a]).suggestions[0]!;
  expect(rule.kind).toBe(kind);
  d.accounts.push(a);
  c.rules.push(rule);
  const debit = balance(a, 4000, 4000, { partner: 101 });
  const credit = balance(a, -9000, -9000, { partner: 102 });
  d.balances[202512]!.push(debit, credit);
  for (const row of [debit, credit])
    c.facts.push({
      period: 202512,
      basis: 'closing',
      bucket: balanceBucket(row),
      current: true,
      ...provenance,
    });
  const result = calculateBalance(c, d, 202512);
  expect(result.otherReceivables).toBe('4000');
  expect(result.otherPayables).toBe('9000');
  c.facts = [];
  expect(() => calculateBalance(c, d, 202512)).toThrow('分类依据');
});
