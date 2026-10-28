import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import reportServer from '../server';
import type { EnterpriseConfig } from '../templates/enterprise/model';
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

function confirmMonthlyEps(c: EnterpriseConfig) {
  for (const period of [202501, 202601])
    c.eps.push({
      from: period,
      to: period,
      applicable: false,
      preference: '0',
      dilutions: [],
      ...statutoryEvidence,
    });
}

it.each([
  ['balance', '201', '资产负债表', 3],
  ['profit', '202', '利润表', 3],
  ['cashflow', '203', '现金流量表', 2],
  ['equity', '204', '所有者权益变动表', 6],
] as const)(
  'w_bb_saveas 公共输出 %s 的Excel与打印仅含选中报表',
  async (reportKey, code, name, pages) => {
    const p = await api().save({
      ...statutoryIdentity,
      reportKey,
      code,
      name,
      configuration: await annualConfiguration(),
    });
    const generated = await api().generate({
      id: p.id,
      expectedRevision: p.revision,
      period: 202612,
      requestId: randomUUID(),
    });
    if (generated.kind !== 'generated') throw new Error('意外确认');
    const selection = {
      id: p.id,
      expectedRevision: p.revision,
      period: 202612,
      snapshotId: generated.snapshot.id,
    };
    const output = await api().output({ ...selection, format: 'xlsx' });
    const print = await api().output({ ...selection, format: 'print' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(output.data, 'base64')).buffer);
    expect(wb.worksheets).toHaveLength(pages);
    expect(wb.worksheets.every((sheet) => sheet.getCell('A1').text.startsWith(`${name} · `))).toBe(
      true,
    );
    expect(print.data.match(/<section class="sheet/g)).toHaveLength(pages);
    expect(output.snapshotId).toBe(print.snapshotId);
    expect(wb.worksheets.every((sheet) => sheet.pageSetup.paperSize === 9)).toBe(true);
  },
);

async function withFutureClassification() {
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
  const c = await annualConfiguration();
  c.cashAllocations = entries
    .filter((e) => e.accountCode === '1001')
    .map((e) => ({
      lineId: e.lineId,
      parts: [{ line: 'capitalReceipts', amount: '10000' }],
      ...statutoryEvidence,
    }));
  c.equityEvents = entries
    .filter((e) => e.accountCode === '4001')
    .map((e) => ({
      lineId: e.lineId,
      row: 'ordinaryContributions',
      liabilityAmount: '0',
      parts: [{ column: 'capital', amount: '10000' }],
      ...statutoryEvidence,
    }));
  const profile = await api().save({
    ...statutoryIdentity,
    code: '201',
    name: '报告日切换测试',
    configuration: c,
  });
  return { voucher: voucher!, profile };
}

it('w_bb_def 202612年报切202601月报时按报告日重建，已知未来分录不会冒充失效来源', async () => {
  const { profile } = await withFutureClassification();
  const editor = await api().editor({
    ...statutoryIdentity,
    id: profile.id,
    period: 202601,
    scope: 'month',
  });
  const c = editor.configuration as EnterpriseConfig;
  expect(c).toMatchObject({
    period: 202601,
    scope: 'month',
    cashAllocations: (profile.configuration as EnterpriseConfig).cashAllocations,
    equityEvents: (profile.configuration as EnterpriseConfig).equityEvents,
  });
  expect(c.cashPolicies).toEqual((profile.configuration as EnterpriseConfig).cashPolicies);
  expect(await api().get({ id: profile.id })).toEqual(profile);
  confirmMonthlyEps(c);
  const saved = await api().save({
    ...statutoryIdentity,
    id: profile.id,
    expectedRevision: profile.revision,
    code: profile.code,
    name: profile.name,
    configuration: c,
  });
  expect(saved.revision).toBe(2);
  expect(saved.configuration).toEqual(c);
  const december = await api().editor({
    ...statutoryIdentity,
    id: saved.id,
    period: 202612,
    scope: 'annual',
  });
  expect(december.configuration).toEqual({ ...c, period: 202612, scope: 'annual' });
  expect(
    (
      await api().generate({
        id: saved.id,
        expectedRevision: saved.revision,
        period: 202601,
        requestId: randomUUID(),
      })
    ).kind,
  ).toBe('generated');
});

it('w_bb_def 切历史报告日不能静默删除已失效分录，重新保存仍拒绝并保留原配置', async () => {
  const { voucher, profile } = await withFutureClassification();
  await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  const editor = await api().editor({
    ...statutoryIdentity,
    id: profile.id,
    period: 202601,
    scope: 'month',
  });
  const c = editor.configuration as EnterpriseConfig;
  expect(c.cashAllocations).toHaveLength(1);
  expect(c.equityEvents).toHaveLength(1);
  confirmMonthlyEps(c);
  await expect(
    api().save({
      ...statutoryIdentity,
      id: profile.id,
      expectedRevision: profile.revision,
      code: profile.code,
      name: profile.name,
      configuration: c,
    }),
  ).rejects.toThrow('配置引用失效分录');
  expect(await api().get({ id: profile.id })).toEqual(profile);
});
