import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTestApp } from '@caiwu/testkit';
import type { AccountingTemplateInput } from '@caiwu/core';
import reportServer from '../server';
import type {
  NonprofitPublicConfiguration,
  NonprofitPublicSource,
} from '../server/statutory-nonprofit';
import type { NonprofitGeneration } from '../templates/nonprofit/statutory.server';

it('w_bb_get/proc 公共保存后编辑器重读启用前逐笔来源，生成和授权输出沿同一历史绑定', async () => {
  const template: AccountingTemplateInput = {
    schemaVersion: 1,
    id: 'nonprofit-2026-public-history',
    version: '1',
    name: '民非年中公共合成账套',
    regime: 'nonprofit',
    codeScheme: '4-2-2',
    categories: [
      { id: 'asset', name: '资产', direction: 'debit' },
      { id: 'net-assets', name: '净资产', direction: 'credit' },
    ],
    accounts: [
      { code: '1001', name: '现金', category: 'asset', cash: true },
      { code: '1002', name: '银行存款', category: 'asset', bank: true },
      { code: '3101', name: '非限定性净资产', category: 'net-assets' },
    ],
    voucherTypes: [{ code: '记', name: '记账凭证' }],
  };
  const mod = { ...reportServer, templates: [template] };
  const app = await createTestApp({
    modules: [mod],
    templateId: template.id,
    product: 'minfei',
    startYear: 2026,
    startMonth: 7,
    seed: false,
  });
  try {
    for (const [code, balance] of [
      ['1001', 90000],
      ['1002', 10000],
      ['3101', -100000],
    ] as const)
      await app.svc.opening.upsert({
        year: 2026,
        accountId: (await app.svc.accounts.require(code)).id,
        balance,
      });
    const api = app.call(mod).statutory;
    const identity = { definitionId: 'nonprofit-2026', definitionRevision: 1, reportKey: '401' };
    const selection = { ...identity, period: 202612, scope: 'annual' as const };
    const initial = await api.editor(selection);
    expect((initial.source as NonprofitPublicSource).current.historyMissing).toBe(true);
    const c = initial.configuration as NonprofitPublicConfiguration;
    c.current.transitionOpeningReference = '合成年中逐科目承接资料';
    c.current.cashPolicy = '合成现金及银行可随时支付政策';
    c.current.resources = [
      {
        id: 'U',
        name: '合成非限定资源',
        classification: 'unrestricted',
        sourceReference: '合成提供者文件',
        acquisitionReference: '合成取得凭据',
        openingBalance: 100000,
        openingReference: '真实年度年初净资产',
        unrestrictedBasis: '提供者未设置用途或时间限制',
      },
    ];
    c.current.cashScope = ['1001', '1002'].map((account) => ({
      account,
      included: true,
      basis: '可随时用于支付',
      agency: false,
      restricted: false,
      equivalent: false,
    }));
    c.current.preStartHistory = {
      basis: '合成完整一至六月原账及逐笔承接',
      postedConfirmed: true,
      from: 202601,
      to: 202606,
      periods: [202601, 202602, 202603, 202604, 202605, 202606],
      opening: [
        ['1001', 100000],
        ['1002', 0],
        ['3101', -100000],
      ].map(([account, balance]) => ({
        account: String(account),
        balance: Number(balance),
        sourceReference: '合成真实年度年初清单',
      })),
      entries: [
        {
          voucher: '原账内部划转A',
          line: 1,
          revision: 1,
          date: '2026-02-03',
          account: '1001',
          debit: 0,
          credit: 10000,
          closingKind: null,
          sourceReference: '合成原始划转凭据',
        },
        {
          voucher: '原账内部划转A',
          line: 2,
          revision: 1,
          date: '2026-02-03',
          account: '1002',
          debit: 10000,
          credit: 0,
          closingKind: null,
          sourceReference: '合成原始划转凭据',
        },
      ],
    };
    const profile = await api.save({
      ...identity,
      code: '401',
      name: '年中承接资产负债表',
      configuration: c,
    });
    const editor = await api.editor({ ...selection, id: profile.id });
    const current = (editor.source as NonprofitPublicSource).current;
    expect(current.from).toBe(202601);
    expect(current.entries).toHaveLength(2);
    expect(current.entries.every((entry) => entry.date === '2026-02-03' && entry.lineId < 0)).toBe(
      true,
    );
    const generated = await api.generate({
      id: profile.id,
      expectedRevision: profile.revision,
      period: 202612,
      requestId: randomUUID(),
    });
    if (generated.kind !== 'generated') throw new Error('意外确认');
    expect((generated.snapshot.result as NonprofitGeneration).statement.code).toBe('401');
    const output = {
      id: profile.id,
      expectedRevision: profile.revision,
      snapshotId: generated.snapshot.id,
      period: 202612,
    };
    expect((await api.output({ ...output, format: 'xlsx' })).snapshotId).toBe(
      generated.snapshot.id,
    );
    expect((await api.output({ ...output, format: 'print' })).printJob?.pageSize).toBe('A4');
    await app.svc.periods.ensureYear(2027);
    const activityIdentity = { ...identity, reportKey: '402' };
    const comparisonSelection = { ...activityIdentity, period: 202712, scope: 'annual' as const };
    const comparisonDraft = await api.editor(comparisonSelection);
    const comparative = comparisonDraft.configuration as NonprofitPublicConfiguration;
    comparative.current.transitionOpeningReference = '合成次年真实承接凭据';
    comparative.current.cashPolicy = c.current.cashPolicy;
    comparative.current.cashScope = c.current.cashScope;
    comparative.current.resources = c.current.resources;
    comparative.current.comparison = { basis: '合成上年逐笔资料及完整可比口径', restatements: [] };
    comparative.previous = c.current;
    const comparisonProfile = await api.save({
      ...activityIdentity,
      code: '402',
      name: '含年中启用比较来源的业务活动表',
      configuration: comparative,
    });
    const comparisonEditor = await api.editor({ ...comparisonSelection, id: comparisonProfile.id });
    const priorSource = (comparisonEditor.source as NonprofitPublicSource).previous!;
    expect(priorSource.from).toBe(202601);
    expect(priorSource.entries.map((entry) => entry.lineId)).toEqual(
      current.entries.map((entry) => entry.lineId),
    );
    const comparisonResult = await api.generate({
      id: comparisonProfile.id,
      expectedRevision: comparisonProfile.revision,
      period: 202712,
      requestId: randomUUID(),
    });
    if (comparisonResult.kind !== 'generated') throw new Error('意外确认');
    expect((comparisonResult.snapshot.result as NonprofitGeneration).binding.previous).toBeTruthy();
    expect(
      (
        await api.output({
          id: comparisonProfile.id,
          expectedRevision: comparisonProfile.revision,
          snapshotId: comparisonResult.snapshot.id,
          period: 202712,
          format: 'xlsx',
        })
      ).snapshotId,
    ).toBe(comparisonResult.snapshot.id);
  } finally {
    await app.close();
  }
});
