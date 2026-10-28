import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import type { AccountingTemplateInput } from '@caiwu/core';
import reportServer from '../../server';
import { createEnterpriseDraft } from '../../templates/enterprise/mapping';
import { calculateEnterprise } from '../../templates/enterprise/calculate';
import { readEnterpriseSources } from '../../templates/enterprise/statutory.server';
import { enterprisePages, enterprisePrintHtml } from '../../templates/enterprise/output';
import type { EnterpriseResult } from '../../templates/enterprise/model';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
const template: AccountingTemplateInput = {
  schemaVersion: 1,
  id: 'enterprise-first-year-only',
  version: '1',
  name: '首年真实合成账套',
  regime: 'enterprise',
  codeScheme: '4-2-2',
  categories: [
    { id: 'asset', name: '资产', direction: 'debit' },
    { id: 'equity', name: '权益', direction: 'credit' },
    { id: 'income', name: '收入', direction: 'credit', isPnl: true },
  ],
  accounts: [
    { code: '1001', name: '库存现金', category: 'asset', cash: true },
    { code: '4001', name: '实收资本', category: 'equity' },
    { code: '6001', name: '主营业务收入', category: 'income' },
  ],
  voucherTypes: [{ code: '记', name: '记账凭证' }],
};
const evidence = { source: '首年合成期初及实际凭证', version: '1' };
async function setup() {
  const mod = { ...reportServer, templates: [template] };
  app = await createTestApp({
    modules: [mod],
    templateId: template.id,
    startYear: 2026,
    seed: false,
  });
  const cash = (await app.svc.accounts.require('1001')).id;
  await app.svc.opening.upsert({ year: 2026, accountId: cash, balance: 100000 });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('4001')).id,
    balance: -100000,
  });
  const [voucher] = await seedVouchers(app.svc, [
    {
      date: '2026-12-15',
      status: 'posted',
      lines: [
        { account: '1001', debit: 2500 },
        { account: '6001', credit: 2500 },
      ],
    },
  ]);
  const c = createEnterpriseDraft(
    202612,
    'annual',
    {
      entityClass: 'unlisted',
      financial: '2026-01-01',
      revenue: '2026-01-01',
      lease: '2026-01-01',
      cas30_2026: null,
      ...evidence,
    },
    await app.svc.accounts.list(),
  );
  for (const { period } of await app.svc.periods.list())
    for (const basis of ['opening', 'closing'] as const)
      c.cashPolicies.push({ period, basis, accounts: [cash], restrictedAccounts: [], ...evidence });
  c.cashAllocations.push({
    lineId: voucher!.lines.find((l) => l.accountId === cash)!.id,
    parts: [{ line: 'salesReceipts', amount: '2500' }],
    ...evidence,
  });
  for (const from of [202601, 202612])
    c.eps.push({
      from,
      to: 202612,
      applicable: false,
      preference: '0',
      dilutions: [],
      ...evidence,
    });
  return { app, c, api: app.call(mod).statutory, svc: app.svcFor('report-engine') };
}

it('w_bb_proc 真实202601启用且无2025账年：月报和年报本期按实数，比较来源明确不适用', async () => {
  const { app, c, svc } = await setup();
  expect((await app.svc.periods.list()).map((p) => p.period)).toEqual(
    Array.from({ length: 12 }, (_, i) => 202601 + i),
  );
  for (const scope of ['month', 'annual'] as const) {
    const configuration = { ...c, scope };
    const source = await readEnterpriseSources(svc, configuration);
    expect(source.startPeriod).toBe(202601);
    expect(Object.keys(source.balances).every((p) => Number(p) >= 202601)).toBe(true);
    const result = calculateEnterprise(configuration, source);
    expect(result.comparison).toMatchObject({ balance: 'unavailable', flow: 'unavailable' });
    expect(result.balance.current.cash).toBe('102500');
    expect(result.profit.current.netProfit).toBe('2500');
    expect(result.cashflow.current.cashIncrease).toBe('2500');
    expect(new Set(Object.values(result.balance.previous))).toEqual(new Set(['不适用']));
    expect(new Set(Object.values(result.profit.previous))).toEqual(new Set(['不适用']));
    expect(new Set(Object.values(result.cashflow.previous))).toEqual(new Set(['不适用']));
    expect(
      result.checks.every((check) => check.column === 'current' && check.difference === '0'),
    ).toBe(true);
    if (scope === 'annual') {
      expect(result.equity.current.opening!.total).toBe('100000');
      expect(result.equity.current.closing!.total).toBe('102500');
      expect(new Set(Object.values(result.equity.current.previousClosing!))).toEqual(
        new Set(['不适用']),
      );
      expect(new Set(Object.values(result.equity.previous).flatMap(Object.values))).toEqual(
        new Set(['不适用']),
      );
    }
    const html = enterprisePrintHtml(result);
    expect(html).toContain('比较来源未提供');
    expect(html).toContain('不适用');
    expect(html).toContain('1025.00');
    const pages = enterprisePages(result);
    expect(pages.filter((p) => p.title.startsWith('资产负债表'))[0]!.headers[2]).toBe(
      '上年年末余额（无来源）',
    );
  }
});

it('w_bb_main/proc/saveas 首年四表真实editor、prepare/save、生成和Excel不补建历史账年', async () => {
  const { app, c, api } = await setup();
  for (const [key, code] of [
    ['balance', '201'],
    ['profit', '202'],
    ['cashflow', '203'],
    ['equity', '204'],
  ] as const) {
    const identity = { definitionId: c.format, definitionRevision: 1, reportKey: key };
    const editor = await api.editor({ ...identity, period: 202612, scope: 'annual' });
    expect((editor.source as { startPeriod: number }).startPeriod).toBe(202601);
    const profile = await api.save({ ...identity, code, name: `首年${code}`, configuration: c });
    const generated = await api.generate({
      id: profile.id,
      expectedRevision: profile.revision,
      period: 202612,
      requestId: randomUUID(),
    });
    expect(generated.kind).toBe('generated');
    if (generated.kind !== 'generated') throw new Error('意外的待过账确认');
    const result = generated.snapshot.result as EnterpriseResult;
    expect(result.balance.current.cash).toBe('102500');
    expect(result.balance.previous.cash).toBe('不适用');
    const selection = {
      id: profile.id,
      expectedRevision: profile.revision,
      period: 202612,
      snapshotId: generated.snapshot.id,
    };
    const output = await api.output({ ...selection, format: 'xlsx' });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(output.data, 'base64')).buffer);
    const names = {
      balance: '资产负债表',
      profit: '利润表',
      cashflow: '现金流量表',
      equity: '所有者权益变动表',
    };
    const sheet = workbook.worksheets.find((s) => s.name.includes(names[key]))!;
    expect(sheet.getCell('A2').value).toContain('比较来源未提供');
    if (key === 'balance') {
      expect(sheet.getCell('B5').value).toBe(1025);
      expect(sheet.getCell('C5').value).toBe('不适用');
    } else if (key === 'profit') {
      expect(sheet.getCell('B4').value).toBe(25);
      expect(sheet.getCell('C4').value).toBe('不适用');
    } else if (key === 'cashflow') {
      expect(sheet.getCell('B5').value).toBe(25);
      expect(sheet.getCell('C5').value).toBe('不适用');
    } else {
      const previous = workbook.worksheets.find((s) => s.name.includes('所有者权益变动表 · 上年'))!;
      previous.eachRow((row, number) => {
        if (number >= 4)
          row.eachCell((cell, col) => {
            if (col > 1) expect(cell.value).toBe('不适用');
          });
      });
    }
    expect((await api.output({ ...selection, format: 'print' })).data).toContain('不适用');
  }
  expect(new Set((await app.svc.periods.list()).map((p) => p.year))).toEqual(new Set([2026]));
});

it('w_bb_proc 已启用的本期缺月、比较期缺月和非法报告期间仍明确拒绝', async () => {
  const { c, svc } = await setup();
  const source = await readEnterpriseSources(svc, c);
  source.periods = source.periods.filter((p) => p !== 202606);
  expect(() => calculateEnterprise(c, source)).toThrow('缺少会计期间202606');
  await expect(readEnterpriseSources(svc, { ...c, period: 202712 })).rejects.toThrow();
  expect(() => calculateEnterprise({ ...c, period: 202613 }, source)).toThrow();
  const comparisonSource = { ...source, startPeriod: 202501, periods: [...source.periods, 202606] };
  expect(() =>
    calculateEnterprise(
      {
        ...c,
        adoption: {
          ...c.adoption,
          financial: '2020-01-01',
          revenue: '2020-01-01',
          lease: '2020-01-01',
        },
      },
      comparisonSource,
    ),
  ).toThrow('缺少会计期间202501');
});

it('w_bb_proc 流量比较不可用而上年末余额可用时，仍核实该比较日准则采用口径', async () => {
  const { c, svc } = await setup();
  const source = await readEnterpriseSources(svc, c);
  const earlierBook = {
    ...source,
    startPeriod: 202507,
    periods: [...source.periods, 202512],
    balances: { ...source.balances, 202512: source.balances[202601]! },
  };
  expect(() => calculateEnterprise({ ...c, period: 202601, scope: 'month' }, earlierBook)).toThrow(
    '尚未同时执行新金融',
  );
});
