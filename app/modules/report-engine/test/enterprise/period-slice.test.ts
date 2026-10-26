import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import reportServer from '../../server';
import { workbookBase64 } from '../../server/export';
import type { ReportTemplate, ReportSnapshot } from '../../shared';
import {
  balanceSheetSlots,
  cashflowSlots,
  profitSlots,
  buildBalanceSheetSlice,
} from '../../templates/enterprise';
import {
  addReceivableReclassification,
  buildBalanceSheetComparatives,
  buildCashflowComparatives,
  buildProfitSlice,
} from '../../templates/enterprise/period-slice';
import { balanceBindings, cashBindings } from './fixture';
import {
  periodProfit,
  profitBindings,
  seedReceivableReclassification,
  setupPeriodFixture,
} from './period-fixture';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer], startYear: 2025 });
  await setupPeriodFixture(app.svc);
});
afterEach(async () => {
  await app.close();
});
const value = (s: ReportSnapshot, address: string) => s.cells.find((c) => c.address === address)!;
async function generated(template: ReportTemplate, period = 202601) {
  const api = app.call(reportServer);
  const r = await api.importTemplate(template);
  const out = await api.generate({
    id: r.id,
    expectedRevision: r.revision,
    period,
    requestId: randomUUID(),
  });
  if (out.kind !== 'generated') throw new Error('意外的未过账确认');
  return { r, snapshot: out.snapshot };
}

it('联合202：损益结转后收入14000、净利润10195；比较数为上年同月1000/800，真实导出分转元', async () => {
  const { r, snapshot: s } = await generated(await periodProfit(app.svc));
  expect(value(s, profitSlots.revenue!.current).value).toBe('14000');
  expect(value(s, profitSlots.assetImpairment!.current).value).toBe('-1000');
  for (const key of ['operatingProfit', 'profitTotal', 'netProfit'])
    expect(value(s, profitSlots[key]!.current).value).toBe('10195');
  expect(value(s, profitSlots.revenue!.comparative).value).toBe('1000');
  expect(value(s, profitSlots.netProfit!.comparative).value).toBe('800');
  expect(value(s, profitSlots.continuingProfit!.current).unit).toBe('text');
  expect(value(s, profitSlots.basicEps!.current).unit).toBe('text');
  await expect(app.call(reportServer).exportResult({ id: r.id, period: 202601 })).rejects.toThrow(/审核/);
  const result = { base64: await workbookBase64(s) };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(result!.base64, 'base64')).buffer);
  expect(wb.worksheets[0]!.getCell(profitSlots.netProfit!.current).value).toBe(101.95);
  expect(wb.worksheets[0]!.getCell(profitSlots.netProfit!.comparative).value).toBe(8);
});

it('联合202：自定义非pnl转账保留；本月与累计不混用，缺基本项目则合计继续待配置', async () => {
  const input = await voucherInputFromSpec(app.svc, {
    date: '2026-02-02',
    lines: [
      { account: '1001', debit: 501, dims: { cashflow: 'CF01' } },
      { account: '6001', credit: 501 },
    ],
  });
  const custom = await app.svc.vouchers.create({ ...input, closingKind: 'period-close:custom' });
  await app.svc.vouchers.changeStatus({ ids: [custom.id], to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids: [custom.id], to: 'posted' });
  const month = (await generated(await periodProfit(app.svc), 202602)).snapshot;
  expect(value(month, profitSlots.revenue!.current).value).toBe('501');
  expect(value(month, profitSlots.netProfit!.current).value).toBe('501');
  const ytdTemplate = await periodProfit(app.svc, 'yearToDate');
  ytdTemplate.code = '212';
  const ytd = (await generated(ytdTemplate, 202602)).snapshot;
  expect(value(ytd, profitSlots.revenue!.current).value).toBe('14501');
  expect(value(ytd, profitSlots.netProfit!.current).value).toBe('10696');
  expect(value(ytd, profitSlots.netProfit!.comparative).value).toBe('800');
  const catalog = await app.svc.accounts.list();
  const partial = buildProfitSlice({ revenue: profitBindings.revenue! }, catalog, ['pnl']);
  partial.code = '213';
  expect(
    value((await generated(partial)).snapshot, profitSlots.operatingProfit!.current).unit,
  ).toBe('text');
  expect(() =>
    buildProfitSlice({ revenue: { state: 'mapped', accounts: ['1001'] } }, catalog, ['pnl']),
  ).toThrow(/非损益/);
  expect(() =>
    buildProfitSlice(
      {
        administration: { state: 'mapped', accounts: ['6602'] },
        research: { state: 'mapped', accounts: ['6602'] },
      },
      catalog,
      ['pnl'],
    ),
  ).toThrow(/重复计入/);
});

it('联合201：真实上年12月末152800与当期176995，不以本月期初冒比较数，年结存期初后仍一致', async () => {
  const t = buildBalanceSheetComparatives(
    balanceBindings,
    balanceBindings,
    await app.svc.accounts.list(),
  );
  const { r, snapshot: s } = await generated(t);
  expect(value(s, balanceSheetSlots.cash!.current).value).toBe('176995');
  expect(value(s, balanceSheetSlots.cash!.comparative).value).toBe('152800');
  expect(value(s, balanceSheetSlots.fixedAssets!.current).value).toBe('95000');
  expect(value(s, balanceSheetSlots.fixedAssets!.comparative).value).toBe('94000');
  const previous = await app.svc.ledger.balances({
    periodFrom: 202512,
    periodTo: 202512,
    rollup: false,
  });
  await app.svc.tx((svc) =>
    svc.opening.replaceYear(
      2026,
      previous.map((x) => ({ accountId: x.accountId, balance: x.closing })),
    ),
  );
  const rerun = await app
    .call(reportServer)
    .generate({ id: r.id, expectedRevision: r.revision, period: 202601, requestId: randomUUID() });
  if (rerun.kind !== 'generated') throw new Error('意外的未过账确认');
  expect(value(rerun.snapshot, balanceSheetSlots.cash!.current).value).toBe('176995');
  expect(value(rerun.snapshot, balanceSheetSlots.cash!.comparative).value).toBe('152800');
});

it('联合201：两往来借贷不相抵，应收11000扣专属坏账500为10500；预收5000为正贷方额', async () => {
  await seedReceivableReclassification(app.svc);
  const catalog = await app.svc.accounts.list();
  let t = buildBalanceSheetSlice(balanceBindings, catalog);
  const binding = {
    receivables: ['1122'],
    advances: ['2203'],
    allowance: { state: 'mapped', accounts: ['1231'] },
  } as const;
  t = addReceivableReclassification(
    t,
    {
      ...binding,
      receivables: [...binding.receivables],
      advances: [...binding.advances],
      allowance: { state: 'mapped', accounts: ['1231'] },
    },
    catalog,
  );
  const s = (await generated(t)).snapshot;
  expect(value(s, balanceSheetSlots.accountsReceivable!.current).value).toBe('10500');
  expect(value(s, balanceSheetSlots.advances!.current).value).toBe('5000');
  expect(() =>
    addReceivableReclassification(
      buildBalanceSheetSlice({}, catalog),
      { receivables: ['1122'], advances: ['2203'] } as never,
      catalog,
    ),
  ).toThrow();
});

it('联合203：上年同月销售1000/购货200，本期14000/305；比较列小计仅用比较列，累计按年初起算', async () => {
  const binding = { ...cashBindings, items: { ...cashBindings.items, taxRefunds: 'CF07' } };
  const { snapshot: s } = await generated(
    buildCashflowComparatives(binding, binding, await app.svc.accounts.list()),
  );
  expect(value(s, cashflowSlots.salesReceipts!.current).value).toBe('14000');
  expect(value(s, cashflowSlots.salesReceipts!.comparative).value).toBe('1000');
  expect(value(s, cashflowSlots.purchases!.current).value).toBe('305');
  expect(value(s, cashflowSlots.purchases!.comparative).value).toBe('200');
  expect(value(s, cashflowSlots.operatingReceipts!.current).value).toBe('16500');
  expect(value(s, cashflowSlots.operatingReceipts!.comparative).value).toBe('1000');
  expect(value(s, cashflowSlots.cashClosing!.current).unit).toBe('text');
  await seedVouchers(app.svc, [
    {
      date: '2026-02-02',
      status: 'posted',
      lines: [
        { account: '1001', debit: 501, dims: { cashflow: 'CF01' } },
        { account: '6001', credit: 501 },
      ],
    },
  ]);
  const t = buildCashflowComparatives(
    binding,
    binding,
    await app.svc.accounts.list(),
    'yearToDate',
  );
  t.code = '213';
  const ytd = (await generated(t, 202602)).snapshot;
  expect(value(ytd, cashflowSlots.salesReceipts!.current).value).toBe('14501');
  expect(value(ytd, cashflowSlots.salesReceipts!.comparative).value).toBe('1000');
});

it('联合：删除范围内真实期间或启用前比较未知会拒绝，不能存部分成功快照或用零替代', async () => {
  const api = app.call(reportServer);
  const r = await api.importTemplate(await periodProfit(app.svc, 'yearToDate'));
  await app.svc.db.deleteFrom('period').where('period', '=', 202502).execute();
  await expect(
    api.generate({ id: r.id, expectedRevision: 1, period: 202603, requestId: randomUUID() }),
  ).rejects.toThrow(/尚未建立/);
  expect(await api.snapshot({ id: r.id, period: 202603 })).toBeNull();
  const other = await createTestApp({ modules: [reportServer], startYear: 2026 });
  try {
    const t = buildBalanceSheetComparatives(
      {},
      { cash: balanceBindings.cash },
      await other.svc.accounts.list(),
    );
    const report = await other.call(reportServer).importTemplate(t);
    await expect(
      other
        .call(reportServer)
        .generate({ id: report.id, expectedRevision: 1, period: 202601, requestId: randomUUID() }),
    ).rejects.toThrow(/没有建立|早于|启用/);
    expect(await other.call(reportServer).snapshot({ id: report.id, period: 202601 })).toBeNull();
  } finally {
    await other.close();
  }
});
