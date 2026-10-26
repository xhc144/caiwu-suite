import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  createTestApp,
  seedVouchers,
  voucherInputFromSpec,
  type TestApp,
  type VoucherSpec,
} from '@caiwu/testkit';
import type { BusinessError } from '@caiwu/core';
import type { TRPCError } from '@trpc/server';
import analysis from '../server';
import { BucketBoundsSchema } from '../shared';
import { analysisService, assertCompleteEntries } from '../server/service';

const { Workbook } = ExcelJS;
let app: TestApp;
const call = (a: TestApp, token?: string) => a.call(analysis, token);
let api: ReturnType<typeof call>;
beforeEach(async () => {
  app = await createTestApp({ modules: [analysis] });
  api = call(app);
});
afterEach(async () => app.close());
const filter = { accountCode: '1122', cutoff: '2026-04-15', bounds: [30, 60, 90], hideZero: false };
async function code(p: Promise<unknown>) {
  const error = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as TRPCError;
  expect(error).not.toBeNull();
  return (error.cause as BusinessError).data.code;
}
function charge(
  date: string,
  amount: number,
  account = '1122',
  partner = 'C001',
  status: VoucherSpec['status'] = 'posted',
): VoucherSpec {
  return {
    date,
    status,
    lines:
      amount > 0
        ? [
            { account, debit: amount, dims: { partner } },
            { account: '6001', credit: amount },
          ]
        : [
            { account, credit: -amount, dims: { partner } },
            { account: '6001', debit: -amount },
          ],
  };
}
async function withBizDate(spec: VoucherSpec, bizDate: string, closingKind?: string) {
  const input = await voucherInputFromSpec(app.svc, spec);
  const v = await app.svc.vouchers.create({
    ...input,
    closingKind,
    lines: input.lines.map((l, i) => ({ ...l, bizDate: i === 0 ? bizDate : null })),
  });
  await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
  return v;
}
async function opening(balance: number, account = '1122', partner = 'C001', currency?: string) {
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require(account)).id,
    dimensions: { partner: (await app.svc.dimensions.getByCode('partner', partner))!.id },
    balance,
    currency,
  });
}

describe('w_fx_zl 账龄分析（真实账套及核心服务）', () => {
  it('起龄日期保留原始业务日期与凭证日期替代来源；原始到期日和逾期天数明确未知', async () => {
    await opening(1000);
    await withBizDate(charge('2026-04-01', 2000), '2026-02-01');
    await seedVouchers(app.svc, [charge('2026-04-02', 3000)]);
    const report = await api.aging(filter);
    expect(report.rows[0]!.lots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          voucherId: null,
          originalBizDate: null,
          dateBasis: 'unknown',
          bizDate: null,
        }),
        expect.objectContaining({
          originalBizDate: '2026-02-01',
          dateBasis: 'business',
          bizDate: '2026-02-01',
        }),
        expect.objectContaining({
          originalBizDate: null,
          dateBasis: 'voucher',
          bizDate: '2026-04-02',
        }),
      ]),
    );
    const exported = await api.exportAging(filter);
    const wb = new Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(exported.base64, 'base64')).buffer);
    const sheet = wb.getWorksheet('账龄来源')!;
    expect(sheet.rowCount).toBe(4);
    for (const row of [2, 3, 4]) {
      expect(sheet.getCell(row, 11).value).toBe('未知');
      expect(sheet.getCell(row, 12).value).toBe('未知');
    }
    expect(sheet.getCell('H2').value).toBe('未知');
    expect(sheet.getCell('J2').value).toBe('期初历史日期未知');
    expect(sheet.getCell('H3').value).toBe('2026-02-01');
    expect(sheet.getCell('J3').value).toBe('原始业务日期');
    expect(sheet.getCell('H4').value).toBe('未知');
    expect(sheet.getCell('I4').value).toBe('2026-04-02');
    expect(sheet.getCell('J4').value).toBe('业务日期缺失，取凭证日期');
  });
  it('同客供不同业务日期、两次部分回款，按业务日期 FIFO 精确分桶', async () => {
    await withBizDate(charge('2026-01-20', 10000), '2025-12-01');
    await withBizDate(charge('2026-01-10', 20000), '2026-03-01');
    await withBizDate(charge('2026-04-01', 30000), '2026-04-01');
    await seedVouchers(app.svc, [charge('2026-02-01', -12000), charge('2026-04-15', -3000)]);
    const r = await api.aging(filter);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      buckets: [30000, 15000, 0, 0],
      unaged: 0,
      reverse: 0,
      closing: 45000,
    });
    expect(r.controls[0]).toMatchObject({ allocated: 45000, ledger: 45000, difference: 0 });
    const remaining = r.rows[0]!.lots.filter((l) => l.amount > 0).map((l) => [
      l.bizDate,
      l.remaining,
    ]);
    expect(remaining).toEqual([
      ['2026-03-01', 15000],
      ['2025-12-01', 0],
      ['2026-04-01', 30000],
    ]);
  });
  it('期初缺日期保持未分龄，回款优先核销期初；其余残额不伪造日期', async () => {
    await opening(50000);
    await seedVouchers(app.svc, [charge('2026-01-10', 10000), charge('2026-04-10', -20000)]);
    const r = await api.aging(filter);
    expect(r.rows[0]).toMatchObject({
      unaged: 30000,
      buckets: [0, 0, 0, 10000],
      closing: 40000,
      reverse: 0,
    });
    expect(r.rows[0]!.lots.find((l) => l.voucherId == null)?.bizDate).toBeNull();
    expect(r.totals.ledger).toBe(40000);
  });
  it('期初显式本位币与凭证空币种属于同币种，正确核销未分龄期初', async () => {
    await opening(50000, '1122', 'C001', 'CNY');
    await seedVouchers(app.svc, [charge('2026-04-01', -20000)]);
    const r = await api.aging(filter);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ currency: 'CNY', unaged: 30000, reverse: 0, closing: 30000 });
  });
  it('反向期初和超额回款单列预收，不能抵入某个账龄桶', async () => {
    await opening(-2000);
    await seedVouchers(app.svc, [charge('2026-04-01', 1000), charge('2026-04-02', -4000)]);
    const r = await api.aging(filter);
    expect(r.rows[0]).toMatchObject({
      buckets: [0, 0, 0, 0],
      unaged: 0,
      reverse: -5000,
      closing: -5000,
    });
  });
  it('应付贷方敞口与借方付款使用相反方向，借方余额单列预付', async () => {
    await seedVouchers(app.svc, [
      charge('2026-01-01', -30000, '2202', 'S001'),
      charge('2026-04-01', 10000, '2202', 'S001'),
    ]);
    const r = await api.aging({ ...filter, accountCode: '2202', direction: 'payable' });
    expect(r.rows[0]).toMatchObject({ buckets: [0, 0, 0, -20000], reverse: 0, closing: -20000 });
    await seedVouchers(app.svc, [charge('2026-04-10', 25000, '2202', 'S001')]);
    const over = await api.aging({ ...filter, accountCode: '2202', direction: 'payable' });
    expect(over.rows[0]).toMatchObject({ reverse: 5000, closing: 5000 });
  });
  it('红字借方冲减及红字贷方增加敞口，按真实净额参与核销', async () => {
    await seedVouchers(app.svc, [
      charge('2026-01-01', 10000),
      {
        date: '2026-04-01',
        status: 'posted',
        lines: [
          { account: '1122', debit: -2000, dims: { partner: 'C001' } },
          { account: '6001', credit: -2000 },
        ],
      },
      {
        date: '2026-04-02',
        status: 'posted',
        lines: [
          { account: '1122', credit: -3000, dims: { partner: 'C001' } },
          { account: '6001', debit: -3000 },
        ],
      },
    ]);
    const r = await api.aging(filter);
    expect(r.rows[0]).toMatchObject({ buckets: [3000, 0, 0, 8000], closing: 11000 });
    expect(r.totals.ledger).toBe(11000);
  });
  it('月中截止只按凭证日期纳入：截止日包含，月底未来凭证即使业务日期早也排除', async () => {
    await seedVouchers(app.svc, [charge('2026-04-15', 10000)]);
    await withBizDate(charge('2026-04-16', 50000), '2026-01-01');
    const r = await api.aging(filter);
    expect(r.totals.closing).toBe(10000);
    expect(r.totals.ledger).toBe(10000);
    const monthEnd = await app.svc.ledger.balances({
      periodFrom: 202604,
      periodTo: 202604,
      accountCodes: ['1122'],
      rollup: false,
    });
    expect(monthEnd[0]!.closing).toBe(60000);
  });
  it('0、30、31、60、61、90、91 天边界无重叠；未来业务日期单列', async () => {
    for (const days of [0, 30, 31, 60, 61, 90, 91, -1]) {
      const date = new Date(Date.parse('2026-04-15T00:00:00Z') - days * 86400000)
        .toISOString()
        .slice(0, 10);
      await withBizDate(charge('2026-04-01', 100), date);
    }
    const r = await api.aging(filter);
    expect(r.rows[0]).toMatchObject({ buckets: [200, 200, 200, 100], future: 100, closing: 800 });
    const changed = await api.aging({ ...filter, bounds: [0, 31] });
    expect(changed.rows[0]!.buckets).toEqual([100, 200, 400]);
    expect(changed.totals.closing).toBe(800);
  });
  it('币种分别 FIFO，不把人民币回款用于抵销美元；合并核对本位币总账', async () => {
    await seedVouchers(app.svc, [charge('2026-04-01', -10000)]);
    // 模拟历史币种配置变更；仅改科目元数据，所有凭证仍由 core 创建。
    await app.svc.db
      .updateTable('account')
      .set({ currency_code: 'USD' })
      .where('code', '=', '1122')
      .execute();
    await seedVouchers(app.svc, [
      {
        date: '2026-01-01',
        status: 'posted',
        lines: [
          {
            account: '1122',
            debit: 14200,
            currency: 'USD',
            rate: '7.1',
            fcAmount: 2000,
            dims: { partner: 'C001' },
          },
          { account: '6001', credit: 14200 },
        ],
      },
    ]);
    const r = await api.aging(filter);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.find((r) => r.currency === 'CNY')).toMatchObject({ reverse: -10000 });
    expect(r.rows.find((r) => r.currency === 'USD')).toMatchObject({ buckets: [0, 0, 0, 14200] });
    expect(r.controls[0]).toMatchObject({ allocated: 4200, ledger: 4200, difference: 0 });
  });
  it('不同客供、末级科目间不混核销；上级科目只加末级一次', async () => {
    const account = await app.svc.accounts.create(
      {
        code: '112201',
        name: '应收明细',
        categoryId: 'asset',
        dimensions: [{ type: 'partner', required: true }],
      },
      app.book.codeScheme,
    );
    await seedVouchers(app.svc, [
      charge('2026-01-01', 10000, account.code),
      charge('2026-04-01', -2000, account.code, 'S001'),
    ]);
    const r = await api.aging(filter);
    expect(r.rows).toHaveLength(2);
    expect(r.totals.closing).toBe(8000);
    expect(r.rows.map((r) => r.accountCode)).toEqual(['112201', '112201']);
    expect(r.rows.find((r) => r.reverse !== 0)!.reverse).toBe(-2000);
  });
  it('科目汇总仍按客供分别核销，保留欠款与预收的真实账龄，不按净额重分桶', async () => {
    await seedVouchers(app.svc, [
      charge('2026-01-01', 10000),
      charge('2026-04-01', -2000, '1122', 'S001'),
    ]);
    const r = await api.aging({ ...filter, groupBy: 'none' });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ buckets: [0, 0, 0, 10000], reverse: -2000, closing: 8000 });
    expect(r.totals.ledger).toBe(8000);
  });
  it('项目扩展以客供为主分组：同项目不同客供不混核销，穿透维度同时包含客供和项目', async () => {
    await app.svc.accounts.create(
      { code: '112201', name: '项目应收', dimensions: [{ type: 'partner' }, { type: 'project' }] },
      app.book.codeScheme,
    );
    const a = charge('2026-01-01', 10000, '112201');
    const b = charge('2026-04-01', -2000, '112201', 'S001');
    a.lines[0]!.dims = { partner: 'C001', project: 'XM01' };
    b.lines[0]!.dims = { partner: 'S001', project: 'XM01' };
    await seedVouchers(app.svc, [a, b]);
    const r = await api.aging({ ...filter, groupBy: 'project' });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.dimensions).toHaveProperty('partner');
    expect(r.rows[0]!.dimensions).toHaveProperty('project');
    expect(r.rows.find((row) => row.groupName.includes('C001'))!.buckets).toEqual([0, 0, 0, 10000]);
    expect(r.controls.every((c) => c.difference === 0)).toBe(true);
    expect(r.totals.ledger).toBe(8000);
  });
  it('新年度独立期初丢失历史业务日期时归入未分龄，不继承上一年假日期', async () => {
    await seedVouchers(app.svc, [charge('2026-01-01', 10000)]);
    await app.svc.periods.ensureYear(2027);
    await app.svc.opening.replaceYear(2027, [
      {
        accountId: (await app.svc.accounts.require('1122')).id,
        dimensions: { partner: (await app.svc.dimensions.getByCode('partner', 'C001'))!.id },
        balance: 10000,
      },
    ]);
    const r = await api.aging({ ...filter, cutoff: '2027-01-31' });
    expect(r.basePeriod).toBe(202701);
    expect(r.rows[0]).toMatchObject({ buckets: [0, 0, 0, 0], unaged: 10000, closing: 10000 });
    expect(r.totals.ledger).toBe(10000);
  });
  it('仅已过账默认；包含未过账含 pending/audited，不含草稿和作废', async () => {
    await seedVouchers(app.svc, [
      charge('2026-04-01', 1000),
      charge('2026-04-02', 2000, '1122', 'C001', 'pending'),
      charge('2026-04-03', 3000, '1122', 'C001', 'audited'),
      charge('2026-04-04', 4000, '1122', 'C001', 'draft'),
    ]);
    const [v] = await seedVouchers(app.svc, [
      charge('2026-04-05', 5000, '1122', 'C001', 'pending'),
    ]);
    await app.svc.vouchers.setVoided(v!.id, true);
    expect((await api.aging(filter)).totals.closing).toBe(1000);
    expect((await api.aging({ ...filter, includeUnposted: true })).totals.closing).toBe(6000);
  });
  it('零余额隐藏开关；按辅助项关闭时仍保持总账核对', async () => {
    await seedVouchers(app.svc, [charge('2026-01-01', 100), charge('2026-04-01', -100)]);
    expect((await api.aging({ ...filter, hideZero: true })).rows).toEqual([]);
    expect((await api.aging({ ...filter, groupBy: 'none' })).rows[0]).toMatchObject({
      groupName: '科目汇总',
      closing: 0,
    });
  });
  it('跨区间已分龄合计也须为安全整数，不能由前端不精确加总', async () => {
    for (const partner of ['C002', 'C003', 'C004'])
      await app.svc.dimensions.create({ type: 'partner', code: partner, name: partner });
    const amount = 6_000_000_000_000_000;
    await seedVouchers(app.svc, [
      charge('2026-01-01', amount),
      charge('2026-04-01', -amount, '1122', 'C002'),
      charge('2026-04-01', amount, '1122', 'C003'),
      charge('2026-04-01', -amount, '1122', 'C004'),
    ]);
    expect(await code(api.aging(filter))).toBe('ANALYSIS_AMOUNT_OVERFLOW');
  });
  it('达到分录读取上限时拒绝出报告，不静默截断', () => {
    expect(() => assertCompleteEntries(199999)).not.toThrow();
    expect(() => assertCompleteEntries(200000)).toThrow(/无法保证分析完整/);
    expect(() => assertCompleteEntries(200001)).toThrow(/无法保证分析完整/);
  });
  it('非法区间拒绝；合法自定义默认持久化、并发保护及重复保存幂等', async () => {
    for (const bounds of [[], [30, 30], [60, 30], [-1], [1.5]])
      expect(BucketBoundsSchema.safeParse(bounds).success).toBe(false);
    expect(await api.saveConfig({ bounds: [10, 30], expectedRevision: 0 })).toEqual({
      bounds: [10, 30],
      revision: 1,
    });
    expect(await api.config()).toEqual({ bounds: [10, 30], revision: 1 });
    expect(await api.saveConfig({ bounds: [10, 30], expectedRevision: 0 })).toEqual({
      bounds: [10, 30],
      revision: 1,
    });
    expect(await code(api.saveConfig({ bounds: [20, 40], expectedRevision: 0 }))).toBe(
      'ANALYSIS_CONFLICT',
    );
    expect((await api.config()).bounds).toEqual([10, 30]);
  });
  it('导出真实 XLSX，桶数据与本次报告、总账核对表一致', async () => {
    await seedVouchers(app.svc, [charge('2026-04-01', 12345)]);
    const result = await api.exportAging(filter);
    const wb = new Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(result.base64, 'base64')).buffer);
    expect(wb.getWorksheet('账龄分析')!.getRow(5).getCell(5).value).toBe(123.45);
    expect(wb.getWorksheet('总账核对')!.getRow(2).values).toEqual([
      undefined,
      '1122',
      'C001 华东贸易有限公司',
      123.45,
      123.45,
      0,
    ]);
    expect(result.report.totals.closing).toBe(12345);
  });
});

describe('w_fx_km / w_fx_nd / w_fx_yd / w_fx_demo', () => {
  it('不存在科目与启用前期间有明确业务错误', async () => {
    expect(await code(api.trend({ accountCode: '9999', period: 202601 }))).toBe(
      'ANALYSIS_ACCOUNT_NOT_FOUND',
    );
    expect(await code(api.aging({ ...filter, cutoff: '2025-12-31' }))).toBe(
      'ANALYSIS_BEFORE_START',
    );
    expect(await code(api.trend({ accountCode: '1122', period: 202512 }))).toBe(
      'ANALYSIS_BEFORE_START',
    );
  });
  it('w_fx_demo 基数为零显示无法计算，不返回 NaN、Infinity 或伪造 0%', async () => {
    const r = await api.trend({ accountCode: '1122', period: 202601 });
    expect(r.denominator).toBe(0);
    expect(r.rows[0]!.ratio).toBeNull();
    expect(r.rows[0]!.months).toEqual(Array(12).fill(0));
  });
  it('年度12月、月度指定月份、年累计和月均由实际发生额生成', async () => {
    await seedVouchers(app.svc, [charge('2026-01-01', 12000), charge('2026-02-01', 24000)]);
    const year = await api.trend({ accountCode: '1122', period: 202601 });
    expect(year.rows[0]).toMatchObject({
      months: [12000, 24000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ytd: 36000,
      average: 3000,
      ratio: '100.00',
    });
    const month = await api.trend({ accountCode: '1122', period: 202602, mode: 'monthly' });
    expect(month.rows[0]).toMatchObject({ current: 24000, ytd: 36000, average: 18000 });
    const balance = await api.trend({
      accountCode: '1122',
      period: 202602,
      mode: 'monthly',
      metric: 'balance',
    });
    expect(balance.rows[0]).toMatchObject({ current: 36000, ytd: 36000, average: 24000 });
  });
  it("w_fx_km 只排除 closingKind='pnl'，不猜摘要、不排除其它期末结转", async () => {
    await seedVouchers(app.svc, [charge('2026-01-01', 10000)]);
    await withBizDate(
      { ...charge('2026-01-31', -10000), summary: '不含结转文字' },
      '2026-01-31',
      'pnl',
    );
    await withBizDate({ ...charge('2026-01-31', 1000), summary: '损益结转' }, '2026-01-31', 'fx');
    const operating = await api.trend({
      accountCode: '1122',
      period: 202601,
      mode: 'monthly',
      metric: 'balance',
    });
    expect(operating.rows[0]).toMatchObject({
      current: 11000,
      ledgerCurrent: 1000,
      pnlAdjustment: -10000,
    });
    const ledger = await api.trend({
      accountCode: '1122',
      period: 202601,
      mode: 'monthly',
      metric: 'balance',
      scope: 'ledger',
    });
    expect(ledger.rows[0]).toMatchObject({ current: 1000, pnlAdjustment: 0 });
    expect((await api.aging({ ...filter, cutoff: '2026-01-31' })).totals.closing).toBe(1000);
  });
  it('w_fx_nd 年中启用的早期月份为空且有说明，年累计保留真实期初本年累计', async () => {
    const mid = await createTestApp({ modules: [analysis], startMonth: 3 });
    try {
      await mid.svc.opening.upsert({
        year: 2026,
        accountId: (await mid.svc.accounts.require('1122')).id,
        dimensions: { partner: (await mid.svc.dimensions.getByCode('partner', 'C001'))!.id },
        balance: 5000,
        ytdDebit: 12000,
      });
      await seedVouchers(mid.svc, [charge('2026-03-01', 6000)]);
      const r = await mid
        .call(analysis)
        .trend({ accountCode: '1122', period: 202603, mode: 'monthly' });
      expect(r.startPeriod).toBe(202603);
      expect(r.rows[0]).toMatchObject({
        months: [null, null, 6000, null, null, null, null, null, null, null, null, null],
        ytd: 18000,
        average: 6000,
      });
    } finally {
      await mid.close();
    }
  });
  it('w_fx_km 跨年余额承接原始年初，上年已结转损益不重新带入本年经营余额', async () => {
    await seedVouchers(app.svc, [charge('2026-01-01', 10000)]);
    await withBizDate(charge('2026-12-31', -10000), '2026-12-31', 'pnl');
    await app.svc.periods.ensureYear(2027);
    await seedVouchers(app.svc, [charge('2027-01-01', 5000)]);
    const r = await api.trend({
      accountCode: '1122',
      period: 202701,
      mode: 'monthly',
      metric: 'balance',
    });
    expect(r.rows[0]).toMatchObject({ current: 5000, ledgerCurrent: 5000, pnlAdjustment: 0 });
  });
  it('w_main1 便捷入口可持久化科目，无硬编码并保护并发覆盖', async () => {
    await api.saveShortcut({ kind: 'finance', accountCode: '1122', expectedRevision: 0 });
    expect((await api.shortcuts())[0]).toMatchObject({
      kind: 'finance',
      account_code: '1122',
      revision: 1,
    });
    expect(
      await code(api.saveShortcut({ kind: 'finance', accountCode: '2202', expectedRevision: 0 })),
    ).toBe('ANALYSIS_CONFLICT');
  });
  it('权限：查看、账龄、配置、导出和打印均在服务端拒绝越权', async () => {
    const viewer = call(app, await app.addUser('viewer', { permissions: ['analysis.aging.view'] }));
    expect((await viewer.aging(filter)).rows).toEqual([]);
    for (const request of [
      viewer.saveConfig({ bounds: [10], expectedRevision: 0 }),
      viewer.saveShortcut({ kind: 'finance', accountCode: '1122', expectedRevision: 0 }),
      viewer.exportAging(filter),
      viewer.trend({ accountCode: '1122', period: 202601 }),
      viewer.printAllowed('aging'),
    ])
      expect(await code(request)).toBe('FORBIDDEN');
    const exporter = call(app, await app.addUser('exporter', { permissions: ['analysis.export'] }));
    expect(await code(exporter.exportAging(filter))).toBe('FORBIDDEN');
    expect(await code(exporter.exportTrend({ accountCode: '1122', period: 202601 }))).toBe(
      'FORBIDDEN',
    );
  });
  it('单报告使用事务快照：不会误用事务外服务', async () => {
    const result = await app.svcFor('analysis').tx((tsvc) => analysisService(tsvc).aging(filter));
    expect(result.totals.difference).toBe(0);
  });
});
