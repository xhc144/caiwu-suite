import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import type { AccountingTemplateInput } from '@caiwu/core';
import reportServer from '../server';
import type { ReportTables } from '../server/migrations';
import type { SmallPublicConfiguration } from '../server/statutory-small-business';
import type { NonprofitPublicConfiguration } from '../server/statutory-nonprofit';
import type { Amount } from '../templates/small-business/statements';
import type { PreparedSmallBusiness } from '../templates/small-business/statutory.server';
import type { NonprofitGeneration } from '../templates/nonprofit/statutory.server';
import { rowKey } from '../templates/small-business/configuration';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
const small: AccountingTemplateInput = {
  schemaVersion: 1,
  id: 'small-public-test',
  version: '1',
  name: '小企公共合成账套',
  regime: 'small-business',
  codeScheme: '4-2-2',
  categories: [
    { id: 'asset', name: '资产', direction: 'debit' },
    { id: 'equity', name: '权益', direction: 'credit' },
  ],
  accounts: [
    { code: '1001', name: '库存现金', category: 'asset', cash: true },
    { code: '3001', name: '实收资本', category: 'equity' },
    { code: '300101', name: '实收资本明细', category: 'equity' },
    { code: '300102', name: '已归还投资', category: 'equity', direction: 'debit' },
  ],
  voucherTypes: [{ code: '记', name: '记账凭证' }],
};
const nonprofit: AccountingTemplateInput = {
  ...small,
  id: 'nonprofit-2026-public-test',
  name: '民非公共合成账套',
  regime: 'nonprofit',
  categories: [
    { id: 'asset', name: '资产', direction: 'debit' },
    { id: 'net-assets', name: '净资产', direction: 'credit' },
  ],
  accounts: [
    { code: '1001', name: '现金', category: 'asset', cash: true },
    { code: '3101', name: '非限定性净资产', category: 'net-assets' },
  ],
};
async function setup(
  template: AccountingTemplateInput,
  year: number,
  product: 'minfei' | 'chengben' = 'chengben',
) {
  const mod = { ...reportServer, templates: [template] };
  app = await createTestApp({
    modules: [mod],
    templateId: template.id,
    startYear: year,
    product,
    seed: false,
  });
  return { app, api: app.call(mod).statutory };
}
it('w_bb_main/proc/saveas 小企真实公共接入只存唯一profile，减已归还投资保留Amount.sources', async () => {
  const { app, api } = await setup(small, 2025);
  await app.svc.periods.ensureYear(2026);
  for (const year of [2025, 2026])
    for (const [code, balance] of [
      ['1001', 80000],
      ['300101', -100000],
      ['300102', 20000],
    ] as const)
      await app.svc.opening.upsert({
        year,
        accountId: (await app.svc.accounts.require(code)).id,
        balance,
      });
  const identity = { definitionId: 'small-business', definitionRevision: 1, reportKey: '301' };
  expect((await api.catalog()).map((d) => d.definitionId)).toEqual(['small-business']);
  const editor = await api.editor({ ...identity, period: 202612, scope: 'annual' });
  const configuration = editor.configuration as SmallPublicConfiguration;
  configuration.value.cashScope = [
    {
      account: '1001',
      from: '2025-01-01',
      to: '2027-12-31',
      available: true,
      reason: '真实合成现金政策',
    },
  ];
  const source = editor.source as {
    analysisRows: { period: number; row: Parameters<typeof rowKey>[0]; balance: number }[];
  };
  configuration.value.facts = source.analysisRows.map((a) => ({
    period: a.period,
    key: rowKey(a.row),
    balance: a.balance,
    allocations: [
      { role: a.row.accountCode === '300102' ? 'returnedCapital' : 'capital', amount: a.balance },
    ],
    reason: '真实合成资本及归还投资明细',
  }));
  const p = await api.save({ ...identity, code: '301', name: '小企真实公共报表', configuration });
  expect(
    await app.svcFor('report-engine').settings.get('statutory.small-business.configuration', null),
  ).toBeNull();
  const input = { id: p.id, expectedRevision: p.revision, period: 202612, requestId: randomUUID() };
  const generated = await api.generate(input);
  expect(generated.kind).toBe('generated');
  if (generated.kind !== 'generated') throw new Error('意外确认');
  const result = generated.snapshot.result as PreparedSmallBusiness;
  expect(result.statements[0].rows[47]!.amounts[0].value).toBe(100000);
  expect(result.statements[0].rows[51]!.amounts[0].value).toBe(80000);
  expect(result.statements[0].returnedInvestment).toEqual([20000, 20000]);
  const amounts = (
    result.statements[0] as (typeof result.statements)[0] & {
      returnedInvestmentAmounts: [Amount, Amount];
    }
  ).returnedInvestmentAmounts;
  expect(amounts.map((a) => a.value)).toEqual([20000, 20000]);
  expect(amounts[0].sources).toMatchObject([
    { account: '300102', amount: 20000, from: 202612, to: 202612 },
  ]);
  expect(amounts[0].sources[0]!.toRoute).toContain('/m/ledgers/detail?');
  expect(await api.generate(input)).toEqual(generated);
  const output = await api.output({ id: p.id, period: 202612, format: 'print' });
  expect(output.data).toContain('已归还投资');
  expect(output.data).toContain('200.00');
  expect((await api.output({ id: p.id, period: 202612, format: 'xlsx' })).snapshotId).toBe(
    output.snapshotId,
  );
  await app.svc.periods.ensureYear(2027);
  await expect(api.generate(input)).rejects.toThrow('来源已变化');
  expect(
    await app.svc.db
      .withTables<ReportTables>()
      .selectFrom('report_engine_statutory_snapshot')
      .select('id')
      .execute(),
  ).toHaveLength(1);
});
it('w_bb_main/proc/saveas 民非2026三表真实公共接入、403年报限制及绑定复核', async () => {
  const { app, api } = await setup(nonprofit, 2026, 'minfei');
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('1001')).id,
    balance: 100000,
  });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('3101')).id,
    balance: -100000,
  });
  expect((await api.catalog())[0]!.descriptors.map((d) => [d.key, d.annualOnly])).toEqual([
    ['401', false],
    ['402', false],
    ['403', true],
  ]);
  for (const key of ['401', '402', '403']) {
    const identity = { definitionId: 'nonprofit-2026', definitionRevision: 1, reportKey: key };
    const editor = await api.editor({ ...identity, period: 202612, scope: 'annual' });
    const configuration = editor.configuration as NonprofitPublicConfiguration;
    configuration.current.transitionOpeningReference = '合成年初新旧衔接来源';
    configuration.current.cashPolicy = '合成现金范围及支付政策';
    configuration.current.resources = [
      {
        id: 'U',
        name: '合成非限定性资源',
        classification: 'unrestricted',
        sourceReference: '合成提供者文件',
        acquisitionReference: '合成资源取得记录',
        openingBalance: 100000,
        openingReference: '真实年初非限定性净资产',
        unrestrictedBasis: '提供者文件未设时间或用途限制',
      },
    ];
    configuration.current.cashScope = [
      {
        account: '1001',
        included: true,
        basis: '现金可随时支付',
        agency: false,
        restricted: false,
        equivalent: false,
      },
    ];
    const p = await api.save({ ...identity, code: key, name: `民非法定${key}`, configuration });
    const input = {
      id: p.id,
      expectedRevision: p.revision,
      period: 202612,
      requestId: randomUUID(),
    };
    const generated = await api.generate(input);
    expect(generated.kind).toBe('generated');
    if (generated.kind !== 'generated') throw new Error('意外确认');
    expect((generated.snapshot.result as NonprofitGeneration).statement.code).toBe(key);
    expect(await api.generate(input)).toEqual(generated);
    const print = await api.output({ id: p.id, period: 202612, format: 'print' });
    expect(print.printJob?.css).toContain('A4');
    expect((await api.output({ id: p.id, period: 202612, format: 'xlsx' })).snapshotId).toBe(
      print.snapshotId,
    );
  }
  await expect(
    api.editor({
      definitionId: 'nonprofit-2026',
      definitionRevision: 1,
      reportKey: '403',
      period: 202611,
      scope: 'month',
    }),
  ).rejects.toThrow('年度');
  expect(
    await app.svc.db
      .withTables<ReportTables>()
      .selectFrom('report_engine_statutory_profile')
      .select('id')
      .execute(),
  ).toHaveLength(3);
  expect(
    await app.svc.db
      .withTables<ReportTables>()
      .selectFrom('report_engine_statutory_snapshot')
      .select('id')
      .execute(),
  ).toHaveLength(3);
});
