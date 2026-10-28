import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import reportServer from '../server';
import type { EnterpriseConfig, SourceData } from '../templates/enterprise/model';
import {
  seedStatutoryBook,
  statutoryEvidence,
  statutoryIdentity,
  statutoryTestConfiguration,
  statutoryTestTemplate,
} from './statutory-fixture';

const mod = { ...reportServer, templates: [statutoryTestTemplate] };
let app: TestApp;
const api = () => app.call(mod).statutory;

beforeEach(async () => {
  app = await createTestApp({
    modules: [mod],
    templateId: statutoryTestTemplate.id,
    startYear: 2023,
    seed: false,
  });
  await seedStatutoryBook(app.svc);
  await app.svc.periods.ensureYear(2026);
  for (const [code, balance] of [
    ['1001', 100000],
    ['4001', -100000],
  ] as const)
    await app.svc.opening.upsert({
      year: 2026,
      accountId: (await app.svc.accounts.require(code)).id,
      balance,
    });
});
afterEach(async () => {
  await app.close();
});

async function annualConfiguration() {
  const c = await statutoryTestConfiguration(app.svc);
  c.period = 202612;
  c.eps.push({
    from: 202601,
    to: 202612,
    applicable: false,
    preference: '0',
    dilutions: [],
    ...statutoryEvidence,
  });
  return c;
}
const options = (configuration: EnterpriseConfig, sourcePeriod = 202612) => ({
  enterpriseDraft: { configuration, sourcePeriod },
});
const target = { ...statutoryIdentity, period: 202601, scope: 'month' as const };

it('w_bb_def 未保存完整草稿换期保留空日期、未完成金额和选择，不先按保存规则解析', async () => {
  const initial = await api().editor({ ...statutoryIdentity, period: 202612, scope: 'annual' });
  const draft = initial.configuration as EnterpriseConfig;
  draft.period = 202601;
  draft.scope = 'month';
  draft.adoption.financial = '';
  draft.adoption.revenue = '2026-';
  draft.adoption.source = '尚未保存的准则采用资料';
  draft.rules[0]!.line = '';
  draft.cashAllocations = [
    { lineId: 0, parts: [{ line: '', amount: '-' }], source: '', version: '' },
  ];
  draft.facts = [{ period: 0, basis: 'closing', bucket: '', source: '', version: '' }];
  draft.shares = [{ from: '', to: '2026-', ordinary: '.', source: '', version: '' }];
  draft.eps = [
    { from: 0, to: 0, applicable: false, preference: '-', dilutions: [], source: '', version: '' },
  ];
  const result = await api().editor({ ...target, options: options(draft) });
  expect(result.configuration).toEqual(draft);
  expect((result.source as SourceData).balances[202601]).toBeDefined();
  await expect(
    api().save({
      ...statutoryIdentity,
      code: '201',
      name: '未完成草稿',
      configuration: result.configuration,
    }),
  ).rejects.toThrow('配置尚未完整或格式无效');
  expect(await api().list()).toEqual([]);
});

async function futureConfiguration() {
  const [voucher] = await seedVouchers(app.svc, [
    {
      date: '2026-06-15',
      status: 'posted',
      lines: [
        { account: '1001', debit: 10000 },
        { account: '4001', credit: 10000 },
      ],
    },
  ]);
  const entries = await app.svc.ledger.entries({ periodFrom: 202606, periodTo: 202606 });
  const cash = entries.find((entry) => entry.accountCode === '1001')!;
  const capital = entries.find((entry) => entry.accountCode === '4001')!;
  const c = await annualConfiguration();
  c.cashAllocations = [
    {
      lineId: cash.lineId,
      parts: [{ line: 'capitalReceipts', amount: '10000' }],
      ...statutoryEvidence,
    },
  ];
  c.equityEvents = [
    {
      lineId: capital.lineId,
      row: 'ordinaryContributions',
      liabilityAmount: '0',
      parts: [{ column: 'capital', amount: '10000' }],
      ...statutoryEvidence,
    },
  ];
  return { voucher: voucher!, cash, capital, c };
}

it('w_bb_def 草稿已先发布目标期间时保留完整未来分类、临时输入及失效引用', async () => {
  const { c, cash, capital } = await futureConfiguration();
  const saved = await api().save({
    ...statutoryIdentity,
    code: '201',
    name: '草稿与已保存配置分开',
    configuration: c,
  });
  const draft = structuredClone(c);
  draft.period = 202601;
  draft.scope = 'month';
  draft.adoption.source = '本次尚未保存的采用依据';
  draft.cashAllocations.push({
    lineId: 999991,
    parts: [{ line: '', amount: '-' }],
    source: '',
    version: '',
  });
  draft.equityEvents.push({
    lineId: 999992,
    row: 'ordinaryContributions',
    liabilityAmount: '-',
    parts: [],
    source: '',
    version: '',
  });
  draft.oci = [cash.lineId, 999993].map((lineId) => ({
    lineId,
    line: '',
    gross: '-',
    tax: '',
    source: '',
    version: '',
  }));
  draft.discontinued = [capital.lineId, 999994].map((lineId) => ({
    lineId,
    source: '',
    version: '',
  }));
  draft.facts = [
    { period: 202612, basis: 'closing', bucket: '未来分类', ...statutoryEvidence },
    { period: 202613, basis: 'closing', bucket: '未写完的期间', source: '', version: '' },
  ];
  draft.shares = [
    { from: '2026-06-01', to: '2026-12-31', ordinary: '100', ...statutoryEvidence },
    { from: '', to: '', ordinary: '', source: '', version: '' },
  ];
  const result = await api().editor({ ...target, id: saved.id, options: options(draft) });
  const next = result.configuration as EnterpriseConfig;
  expect(next.adoption.source).toBe('本次尚未保存的采用依据');
  expect(next).toEqual(draft);
  expect(next.cashAllocations.map((item) => item.lineId)).toEqual([cash.lineId, 999991]);
  expect(next.equityEvents.map((item) => item.lineId)).toEqual([capital.lineId, 999992]);
  expect(next.oci.map((item) => item.lineId)).toEqual([cash.lineId, 999993]);
  expect(next.discontinued.map((item) => item.lineId)).toEqual([capital.lineId, 999994]);
  expect(next.facts.map((item) => item.period)).toEqual([202612, 202613]);
  expect(next.shares).toEqual(draft.shares);
  expect(next.cashPolicies).toEqual(draft.cashPolicies);
  expect((result.source as SourceData).entries).toEqual([]);
  expect(await api().get({ id: saved.id })).toEqual(saved);
  expect(draft.cashAllocations.map((item) => item.lineId)).toEqual([cash.lineId, 999991]);
});

it('w_bb_def 草稿中的反过账失效分录不能在换期时被清除，正式保存仍拒绝', async () => {
  const { voucher, c } = await futureConfiguration();
  const saved = await api().save({
    ...statutoryIdentity,
    code: '201',
    name: '失效来源保留',
    configuration: c,
  });
  await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  const result = await api().editor({
    ...target,
    id: saved.id,
    options: options({ ...c, period: 202601, scope: 'month' }),
  });
  const next = result.configuration as EnterpriseConfig;
  expect(next.cashAllocations).toEqual(c.cashAllocations);
  expect(next.equityEvents).toEqual(c.equityEvents);
  for (const period of [202501, 202601])
    next.eps.push({
      from: period,
      to: period,
      applicable: false,
      preference: '0',
      dilutions: [],
      ...statutoryEvidence,
    });
  await expect(
    api().save({
      ...statutoryIdentity,
      id: saved.id,
      expectedRevision: saved.revision,
      code: saved.code,
      name: saved.name,
      configuration: next,
    }),
  ).rejects.toThrow('配置引用失效分录');
  expect(await api().get({ id: saved.id })).toEqual(saved);
});

it('w_bb_def 来源高水位为六月时仍可切上年年报，只读取实际分录而不套用年报十二月规则', async () => {
  const { c } = await futureConfiguration();
  const draft = { ...c, period: 202512, scope: 'annual' as const };
  const result = await api().editor({
    ...statutoryIdentity,
    period: 202512,
    scope: 'annual',
    options: options(draft, 202606),
  });
  const next = result.configuration as EnterpriseConfig;
  expect(next.cashAllocations).toEqual(c.cashAllocations);
  expect(next.equityEvents).toEqual(c.equityEvents);
  expect(next.adoption).toEqual(c.adoption);
  expect((result.source as SourceData).balances[202512]).toBeDefined();
});

it('w_bb_def 同一来源日期的草稿保留未来日期项及未完成日期内容', async () => {
  const draft = await annualConfiguration();
  draft.period = 202601;
  draft.scope = 'month';
  draft.facts = [
    { period: 202606, basis: 'closing', bucket: '未来分类', ...statutoryEvidence },
    { period: 0, basis: 'closing', bucket: '', source: '', version: '' },
  ];
  const result = await api().editor({ ...target, options: options(draft, 202601) });
  expect((result.configuration as EnterpriseConfig).facts).toEqual(draft.facts);
});

it.each(['outer', 'envelope', 'nested', 'array', 'sourcePeriod'] as const)(
  'w_bb_def 草稿宽松值不允许越过字段结构约束：%s',
  async (kind) => {
    const c = await annualConfiguration();
    const input: Record<string, unknown> = options(c);
    if (kind === 'outer') input.extra = true;
    else if (kind === 'envelope') (input.enterpriseDraft as Record<string, unknown>).extra = true;
    else if (kind === 'nested') (c.adoption as unknown as Record<string, unknown>).extra = true;
    else if (kind === 'array')
      (c as unknown as Record<string, unknown>).cashAllocations = '不应被接受的数组类型';
    else (input.enterpriseDraft as Record<string, unknown>).sourcePeriod = 202613;
    await expect(
      api().editor({
        ...target,
        options: input as Parameters<ReturnType<typeof api>['editor']>[0]['options'],
      }),
    ).rejects.toThrow('草稿格式不正确');
  },
);

it('w_bb_def 目标期投影仅用于保存校验和生成，全部未来数组仍可保存、复制并在返回十二月时重读', async () => {
  const { c, cash, capital } = await futureConfiguration();
  c.period = 202601;
  c.scope = 'month';
  const cashAccount = (await app.svc.accounts.require('1001')).id;
  c.facts = [{ period: 202612, basis: 'closing', bucket: '未来分类', ...statutoryEvidence }];
  c.absentRoles = [
    { period: 202612, line: 'inventories', role: 'allowance', ...statutoryEvidence },
  ];
  c.contractNetAllocations = [
    {
      period: 202612,
      basis: 'closing',
      contractId: '合成未来合同',
      currentAmount: '0',
      noncurrentAmount: '0',
      ...statutoryEvidence,
    },
  ];
  c.cashScopeChanges = [
    {
      period: 202612,
      date: '2026-12-01',
      accountId: cashAccount,
      amount: '0',
      kind: 'restriction',
      ...statutoryEvidence,
    },
  ];
  c.adjustments = [
    {
      period: 202612,
      statement: 'profit',
      row: 'revenue',
      amount: '99999',
      kind: 'other',
      ...statutoryEvidence,
    },
  ];
  c.oci = [{ lineId: cash.lineId, line: 'other', gross: '0', tax: '0', ...statutoryEvidence }];
  c.discontinued = [{ lineId: capital.lineId, ...statutoryEvidence }];
  c.shares = [{ from: '2026-06-01', to: '2026-12-31', ordinary: '100', ...statutoryEvidence }];
  for (const period of [202501, 202601])
    c.eps.push({
      from: period,
      to: period,
      applicable: false,
      preference: '0',
      dilutions: [],
      ...statutoryEvidence,
    });
  const complete = structuredClone(c);
  const saved = await api().save({
    ...statutoryIdentity,
    code: '201',
    name: '只计算一月的完整年度配置',
    configuration: c,
  });
  expect(saved.configuration).toEqual(complete);
  expect(c).toEqual(complete);
  const generated = await api().generate({
    id: saved.id,
    expectedRevision: saved.revision,
    period: 202601,
    requestId: crypto.randomUUID(),
  });
  expect(generated.kind).toBe('generated');
  if (generated.kind !== 'generated') throw new Error('意外确认');
  expect(generated.snapshot.result).toMatchObject({
    period: 202601,
    balance: { current: { cash: '100000' } },
    profit: { current: { revenue: '0' } },
    cashflow: { current: { capitalReceipts: '0' } },
  });
  expect(generated.snapshot.profile.configuration).toEqual(complete);
  const copy = await api().copy({
    id: saved.id,
    expectedRevision: saved.revision,
    code: '202',
    name: '保留完整配置的副本',
  });
  expect(copy.configuration).toEqual(complete);
  const december = await api().editor({
    ...statutoryIdentity,
    id: saved.id,
    period: 202612,
    scope: 'annual',
  });
  expect(december.configuration).toEqual({ ...complete, period: 202612, scope: 'annual' });
  expect((december.source as SourceData).entries.map((item) => item.lineId)).toEqual([
    cash.lineId,
    capital.lineId,
  ]);
  expect(await api().get({ id: saved.id })).toEqual(saved);
});
