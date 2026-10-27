import { afterEach, expect, it } from 'vitest';
import type { TestApp } from '@caiwu/testkit';
import {
  prepareSmallBusiness,
  loadConfiguration,
  saveConfiguration,
  assertSmallBusinessOutput,
  smallBusinessConfigurationData,
} from '../../templates/small-business/statutory.server';
import { rowKey } from '../../templates/small-business/configuration';
import { smallBusinessApp } from './fixture';
let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function setup() {
  app = await smallBusinessApp(3);
  const svc = app.svcFor('report-engine');
  for (const [code, balance, ytdDebit, ytdCredit] of [
    ['1001', 1100, 300, 200],
    ['3001', -1000, 0, 0],
    ['5001', 0, 300, 300],
    ['5401', 0, 200, 200],
    ['3103', -100, 0, 100],
  ] as const)
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require(code)).id,
      balance,
      ytdDebit,
      ytdCredit,
    });
  const raw = await smallBusinessConfigurationData(svc, 202603),
    config = await loadConfiguration(svc);
  config.firstYear = { year: 2026, reason: '本年首次设立' };
  const key = (code: string) => raw.openingRows.find((r) => r.label.startsWith(code + ' '))!.key;
  config.cashScope = ['1001', '100201', '1012'].map((account) => ({
    account,
    from: '2026-01-01',
    to: '2027-12-31',
    available: account !== '1012',
    reason: account === '1012' ? '冻结保证金' : '可随时支付',
  }));
  for (const period of [202512, 202603, 202612, 202712])
    config.facts.push({
      period,
      key: key('3001'),
      balance: -1000,
      reason: '注册资本实缴明细',
      allocations: [{ role: 'capital', amount: -1000 }],
    });
  config.openingEvidence = [
    {
      year: 2026,
      startPeriod: 202603,
      reason: '2026年1—2月总账、明细及损益结转凭证逐笔核对',
      pnlClosing: [
        { key: key('5001'), debit: 300, credit: 0, reason: '收入结转借方300' },
        { key: key('5401'), debit: 0, credit: 200, reason: '成本结转贷方200' },
      ],
      cashHistory: [
        {
          key: key('1001'),
          date: '2026-02-28',
          line: 1,
          inflow: 300,
          outflow: 0,
          reason: '销售收款',
        },
        {
          key: key('1001'),
          date: '2026-02-28',
          line: 3,
          inflow: 0,
          outflow: 200,
          reason: '采购付款',
        },
      ],
    },
  ];
  return { svc, config, key };
}
it('w_bb_proc 年中启用：真实明细年初与累计、启用前真实损益结转和现金分类闭合', async () => {
  const { svc, config } = await setup();
  await svc.tx((t) => saveConfiguration(t, config, 1));
  const p = await svc.tx((t) => prepareSmallBusiness(t, { period: 202603, mode: 'monthly' }));
  assertSmallBusinessOutput(p);
  expect(p.statements[0].rows[0]!.amounts.map((a) => a?.value)).toEqual([1100, 1000]);
  expect(p.statements[0].rows[50]!.amounts.map((a) => a?.value)).toEqual([100, 0]);
  expect(p.statements[1].rows[31]!.amounts.map((a) => a?.value)).toEqual([100, 0]);
  expect(p.statements[2].rows[19]!.amounts.map((a) => a?.value)).toEqual([100, 0]);
  expect(p.statements[2].rows[20]!.amounts.map((a) => a?.value)).toEqual([1000, 1100]);
  expect(p.statements[2].rows[21]!.amounts.map((a) => a?.value)).toEqual([1100, 1100]);
  expect(p.statements[1].rows[0]!.amounts[0].sources[0]!.toRoute).toContain(
    'target=openingEvidence',
  );
});
it('w_bb_proc 年中启用资料缺失、漏现金分类、未知损益结转都拒绝补零', async () => {
  const { svc, config } = await setup();
  await expect(
    svc.tx((t) => prepareSmallBusiness(t, { period: 202603, mode: 'monthly' })),
  ).rejects.toThrow(/请确认完整期初/);
  config.openingEvidence[0]!.cashHistory[0]!.inflow = 299;
  await svc.tx((t) => saveConfiguration(t, config, 1));
  await expect(
    svc.tx((t) => prepareSmallBusiness(t, { period: 202603, mode: 'monthly' })),
  ).rejects.toThrow(/流入、流出分别/);
  const next = await loadConfiguration(svc);
  next.openingEvidence[0]!.cashHistory[0]!.inflow = 300;
  next.openingEvidence[0]!.pnlClosing = [];
  await svc.tx((t) => saveConfiguration(t, next, next.revision));
  await expect(
    svc.tx((t) => prepareSmallBusiness(t, { period: 202603, mode: 'monthly' })),
  ).rejects.toThrow(/结转借贷额尚未确认/);
});
it('w_bb_proc 次年年报的上年全年包含启用前真实来源；不替换成启用后月份', async () => {
  const { svc, config } = await setup();
  await svc.tx((t) => saveConfiguration(t, config, 1));
  await svc.periods.ensureYear(2027);
  const p = await svc.tx((t) => prepareSmallBusiness(t, { period: 202712, mode: 'annual' }));
  assertSmallBusinessOutput(p);
  expect(p.statements[1].rows[31]!.amounts.map((a) => a?.value)).toEqual([0, 100]);
  expect(p.statements[2].rows[19]!.amounts.map((a) => a?.value)).toEqual([0, 100]);
  expect(p.statements[2].rows[20]!.amounts.map((a) => a?.value)).toEqual([1100, 1000]);
});
it('w_bb_proc 未提供事务时拒绝生成和配置写入', async () => {
  const { svc, config } = await setup();
  await expect(saveConfiguration(svc, config, 1)).rejects.toThrow(/同一账套事务/);
  await expect(prepareSmallBusiness(svc, { period: 202603, mode: 'monthly' })).rejects.toThrow(
    /同一账套事务/,
  );
  expect(rowKey({ accountCode: '1122', dimensions: { partner: 1 } })).not.toBe(
    rowKey({ accountCode: '1122', dimensions: { partner: 2 } }),
  );
});
