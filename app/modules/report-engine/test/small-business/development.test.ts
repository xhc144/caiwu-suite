import { afterEach, expect, it } from 'vitest';
import { seedVouchers, type TestApp } from '@caiwu/testkit';
import {
  prepareSmallBusiness,
  loadConfiguration,
  saveConfiguration,
  assertSmallBusinessOutput,
  smallBusinessConfigurationData,
} from '../../templates/small-business/statutory.server';
import { rowKey, entrySignature } from '../../templates/small-business/configuration';
import { smallBusinessApp } from './fixture';
let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
it('w_bb_proc 独审研发回归：费用化与资本化按首尾事实统一计入三表，实际转损益后不重复', async () => {
  app = await smallBusinessApp();
  const svc = app.svcFor('report-engine');
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('1001')).id,
    balance: 1000,
  });
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('3001')).id,
    balance: -1000,
  });
  await seedVouchers(svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '4301', debit: 100 },
        { account: '1001', credit: 100 },
      ],
    },
  ]);
  let config = await loadConfiguration(svc);
  config.firstYear = { year: 2026, reason: '本年1月设立的企业' };
  config.details['5602'] = { line: 17, reason: '研究费用转入管理费用' };
  config.cashScope = ['1001', '100201', '1012'].map((account) => ({
    account,
    from: '2026-01-01',
    to: '2027-12-31',
    available: account !== '1012',
    reason: '核实可支付范围',
  }));
  const rows = await svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      rollup: false,
      groupBy: ['partner', 'project', 'department', 'person'],
    }),
    capital = rows.find((r) => r.accountCode === '3001')!,
    development = rows.find((r) => r.accountCode === '4301')!;
  for (const period of [202512, 202601, 202602, 202603, 202612, 202712])
    config.facts.push({
      period,
      key: rowKey(capital),
      balance: -1000,
      reason: '注册资本',
      allocations: [{ role: 'capital', amount: -1000 }],
    });
  config.facts.push({
    period: 202601,
    key: rowKey(development),
    balance: 100,
    reason: '费用化研究支出尚未转入管理费用',
    allocations: [{ role: 'administration', amount: 100 }],
  });
  const entries = await svc.ledger.entries({ periodFrom: 202601, periodTo: 202601 });
  for (const e of entries.filter((e) => e.accountCode === '1001'))
    config.cashAllocations[String(e.lineId)] = {
      signature: entrySignature(e, entries),
      reason: '研究费用现金支出',
      parts: [{ line: 6, amount: -100 }],
    };
  config = await svc.tx((t) => saveConfiguration(t, config, 1));
  let p = await svc.tx((t) => prepareSmallBusiness(t, { period: 202601, mode: 'monthly' }));
  assertSmallBusinessOutput(p);
  expect(p.statements[0].rows[25]!.amounts[0].value).toBe(0);
  expect(p.statements[0].rows[50]!.amounts[0].value).toBe(-100);
  expect(p.statements[1].rows[13]!.amounts.map((a) => a?.value)).toEqual([100, 100]);
  expect(p.statements[1].rows[16]!.amounts.map((a) => a?.value)).toEqual([100, 100]);
  expect(p.statements[1].rows[31]!.amounts.map((a) => a?.value)).toEqual([-100, -100]);
  await seedVouchers(svc, [
    {
      date: '2026-02-05',
      status: 'posted',
      lines: [
        { account: '5602', debit: 100 },
        { account: '4301', credit: 100 },
      ],
    },
  ]);
  p = await svc.tx((t) => prepareSmallBusiness(t, { period: 202602, mode: 'monthly' }));
  assertSmallBusinessOutput(p);
  expect(p.statements[1].rows[16]!.amounts.map((a) => a?.value)).toEqual([100, 0]);
  expect(p.statements[1].rows[31]!.amounts.map((a) => a?.value)).toEqual([-100, 0]);
  const form = await smallBusinessConfigurationData(svc, 202602);
  expect(form.analysisRows.some((r) => r.period === 202601 && r.row.accountCode === '4301')).toBe(
    true,
  );
  const annual = await svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' }));
  assertSmallBusinessOutput(annual);
  expect(annual.statements[1].rows[31]!.amounts[0].value).toBe(-100);
  await svc.periods.ensureYear(2027);
  p = await svc.tx((t) => prepareSmallBusiness(t, { period: 202712, mode: 'annual' }));
  assertSmallBusinessOutput(p);
  expect(p.statements[1].rows[31]!.amounts.map((a) => a?.value)).toEqual([0, -100]);
});
