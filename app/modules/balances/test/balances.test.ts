import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BusinessError, type BalanceRow } from '@caiwu/core';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import balancesServer from '../server';
import { balancesService, sumLeaves } from '../server/service';
import {
  balanceDisplay,
  detailUrl,
  outputRows,
  parseDimensions,
  visibleRows,
  locateRows,
} from '../shared';
import { reportHtml } from '../web/output';
import { seedBalanceCases, seedForeignZeroBaseCase, seedForeignRedActivityCase } from './fixtures';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [balancesServer] });
});
afterEach(async () => app.close());
const query = () => app.call(balancesServer);
const range = { periodFrom: 202602, periodTo: 202602 };
async function errorCode(p: Promise<unknown>) {
  try {
    await p;
    throw new Error('应当阻止');
  } catch (error) {
    return (error as { cause: BusinessError }).cause.data;
  }
}

describe('w_zw_ye 汇总余额表', () => {
  it('非零期初、跨月、红字、借贷正常与逆向余额、末级一次合计及本年累计', async () => {
    await seedBalanceCases(app.svc);
    const report = await query().query(range);
    const group = report.groups[0]!;
    const bank = group.rows.find((r) => r.accountCode === '100201')!;
    expect(bank).toMatchObject({
      opening: 110_000,
      debit: 25_000,
      credit: 20_000,
      closing: 115_000,
      ytdDebit: 125_000,
      ytdCredit: 20_000,
      level: 2,
    });
    expect(group.totals).toMatchObject({
      openingDebit: 201_000,
      openingCredit: 201_000,
      debit: 73_834,
      credit: 73_834,
      closingDebit: 249_834,
      closingCredit: 249_834,
    });
    const qty = group.rows.find((r) => r.accountCode === '1403')!;
    expect(qty).toMatchObject({
      qtyOpening: '2.000001',
      qtyDebit: '1.500001',
      qtyCredit: '0.500001',
      qtyClosing: '3.000001',
      closing: 30_000,
    });
    const cash = group.rows.find((r) => r.accountCode === '1001')!;
    expect(balanceDisplay(cash.closing, cash)).toEqual({
      side: '贷',
      amount: 1_734,
      reverse: true,
    });
    expect(balanceDisplay(0, cash)).toEqual({ side: '平', amount: 0, reverse: false });
    const income = group.rows.find((r) => r.accountCode === '6001')!;
    expect(balanceDisplay(income.closing, income).side).toBe('贷');
    for (const row of group.rows) expect(row.closing).toBe(row.opening + row.debit - row.credit);
    // 固定手算合计会捕捉将 1002 父行再加一次的错误。
    expect(group.rows.reduce((sum, r) => sum + r.debit, 0)).toBeGreaterThan(group.totals.debit);
    const expanded = group.rows.map((r) => r.accountId);
    for (const level of [1, 2, 0, -1])
      expect(outputRows(group, level, expanded).at(-1)?.debit).toBe(73_834);
  });

  it('含未过账精确加入 pending/audited，草稿和作废始终排除；只发生额不改变合计', async () => {
    await seedBalanceCases(app.svc);
    const posted = (await query().query(range)).groups[0]!;
    const all = (await query().query({ ...range, includeUnposted: true })).groups[0]!;
    expect(all.totals.debit).toBe(91_834);
    expect(all.totals.credit).toBe(91_834);
    expect(all.totals.debit - posted.totals.debit).toBe(18_000);
    const activity = (await query().query({ ...range, onlyActivity: true })).groups[0]!;
    expect(activity.totals).toEqual(posted.totals);
    expect(activity.rows.every((r) => r.debit !== 0 || r.credit !== 0)).toBe(true);
    expect(activity.rows.some((r) => r.accountCode === '4001')).toBe(false);
    expect(posted.rows.some((r) => r.accountCode === '4001')).toBe(true);
    await seedVouchers(app.svc, [
      {
        date: '2026-03-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: 5_000 },
          { account: '6001', credit: 5_000 },
        ],
      },
      {
        date: '2026-03-02',
        status: 'posted',
        lines: [
          { account: '6603', debit: 5_000 },
          { account: '1001', credit: 5_000 },
        ],
      },
    ]);
    const zeroClosingActivity = await query().query({
      periodFrom: 202603,
      periodTo: 202603,
      codeFrom: '1001',
      codeTo: '1001',
      onlyActivity: true,
    });
    expect(zeroClosingActivity.groups[0]!.rows[0]).toMatchObject({ debit: 5_000, credit: 5_000 });
  });

  it('w_zw_ye_1 跨年：上年期末自然接续，下年累计仅本年', async () => {
    await seedBalanceCases(app.svc);
    await app.svc.periods.ensureYear(2027);
    await seedVouchers(app.svc, [
      {
        date: '2026-12-30',
        status: 'posted',
        lines: [
          { account: '100201', debit: 12_300 },
          { account: '6001', credit: 12_300 },
        ],
      },
      {
        date: '2027-01-02',
        status: 'posted',
        lines: [
          { account: '100201', debit: 4_500 },
          { account: '6001', credit: 4_500 },
        ],
      },
    ]);
    const cross = await query().query({
      periodFrom: 202612,
      periodTo: 202701,
      codeFrom: '100201',
      codeTo: '100201',
    });
    expect(cross.groups[0]!.rows[0]).toMatchObject({
      opening: 115_000,
      debit: 16_800,
      closing: 131_800,
      ytdDebit: 4_500,
    });
    const jan = await query().query({
      periodFrom: 202701,
      periodTo: 202701,
      codeFrom: '100201',
      codeTo: '100201',
    });
    expect(jan.groups[0]!.rows[0]?.opening).toBe(127_300);
  });

  it('空条件取当前期间和全部科目；父级范围含实际子树，截断范围不显示带入外部数据的父行', async () => {
    await seedBalanceCases(app.svc);
    expect(await query().query({})).toMatchObject({ periodFrom: 202601, periodTo: 202601 });
    const subtree = (await query().query({ ...range, codeFrom: '1002', codeTo: '1002' }))
      .groups[0]!;
    expect(subtree.rows.map((r) => r.accountCode)).toEqual(['1002', '100201', '100202']);
    expect(subtree.totals.debit).toBe(32_100);
    const cut = (await query().query({ ...range, codeFrom: '100201', codeTo: '100201' }))
      .groups[0]!;
    expect(cut.rows.map((r) => r.accountCode)).toEqual(['100201']);
    expect(cut.totals.debit).toBe(25_000);
    expect(visibleRows(cut.rows, 1, []).map((r) => r.accountCode)).toEqual(['100201']);
  });

  it('w_zw_ye/w_zw_wbye 不存在科目、倒置范围与无效 URL 维度给纠正建议', async () => {
    for (const mode of ['summary', 'foreign'] as const) {
      const err = await errorCode(query().query({ ...range, mode, codeFrom: '9999' }));
      expect(err.code).toBe('BALANCES_ACCOUNT_NOT_FOUND');
      expect(err.hint).toMatch(/清空范围/);
    }
    expect((await errorCode(query().query({ periodFrom: 202603, periodTo: 202602 }))).code).toBe(
      'BALANCES_PERIOD_RANGE',
    );
    expect(
      (await errorCode(query().query({ ...range, codeFrom: '6001', codeTo: '1001' }))).code,
    ).toBe('BALANCES_ACCOUNT_RANGE');
    for (const dims of [
      'not-json',
      '[]',
      '{"department":"01"}',
      '{"random":1}',
      '{"department":0}',
    ])
      expect((await errorCode(query().query({ ...range, dims }))).code).toBe(
        'BALANCES_DIMENSIONS_INVALID',
      );
    expect((await errorCode(query().query({ ...range, dims: '{"department":99999}' }))).code).toBe(
      'BALANCES_DIMENSION_NOT_FOUND',
    );
    expect(() => parseDimensions('{"person":1.5}')).toThrow(BusinessError);
    await expect(query().query({ periodFrom: 202613 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(query().query({ periodFrom: 202501 })).rejects.toThrow(/启用期间/);
  });

  it('树按 parentId/level 而非编码长度建立，折叠/末级筛选不改业务值', () => {
    const base = {
      accountName: '测试',
      direction: 'debit',
      dimensions: {},
      opening: 0,
      closing: 0,
      debit: 0,
      credit: 0,
      ytdDebit: 0,
      ytdCredit: 0,
      fcOpening: 0,
      fcDebit: 0,
      fcCredit: 0,
      fcClosing: 0,
      qtyOpening: '0',
      qtyDebit: '0',
      qtyCredit: '0',
      qtyClosing: '0',
    } as const;
    const rows = [
      { ...base, accountId: 1, accountCode: 'abc', parentId: null, level: 1, isLeaf: false },
      {
        ...base,
        accountId: 2,
        accountCode: 'unrelated-code',
        parentId: 1,
        level: 2,
        isLeaf: false,
      },
      { ...base, accountId: 3, accountCode: 'x', parentId: 2, level: 3, isLeaf: true },
    ];
    expect(visibleRows(rows, 0, []).map((r) => r.accountId)).toEqual([1]);
    expect(visibleRows(rows, 0, [1, 2]).map((r) => r.accountId)).toEqual([1, 2, 3]);
    expect(visibleRows(rows, 2, [1, 2]).map((r) => r.accountId)).toEqual([1, 2]);
    expect(visibleRows(rows, -1, []).map((r) => r.accountId)).toEqual([3]);
  });

  it('安全整数溢出被阻止，不输出已失真的金额', () => {
    expect(() =>
      sumLeaves([
        {
          isLeaf: true,
          opening: Number.MAX_SAFE_INTEGER,
          closing: Number.MAX_SAFE_INTEGER,
          debit: 0,
          credit: 0,
          ytdDebit: 0,
          ytdCredit: 0,
          fcOpening: 0,
          fcDebit: 0,
          fcCredit: 0,
          fcClosing: 0,
        },
        {
          isLeaf: true,
          opening: 1,
          closing: 1,
          debit: 0,
          credit: 0,
          ytdDebit: 0,
          ytdCredit: 0,
          fcOpening: 0,
          fcDebit: 0,
          fcCredit: 0,
          fcClosing: 0,
        },
      ] as BalanceRow[]),
    ).toThrow(/安全整数/);
  });
});

describe('w_zw_wbye 外币余额表', () => {
  it('w_zw_ye/w_zw_wbye 共享修复后本位币代码包含未标币种行，逐币原币字段不混加', async () => {
    await seedBalanceCases(app.svc);
    const base = (await query().query({ ...range, currency: 'CNY' })).groups[0]!;
    expect(base.rows.find((r) => r.accountCode === '100201')).toMatchObject({
      opening: 110_000,
      debit: 25_000,
      credit: 20_000,
      closing: 115_000,
    });
    expect(base.rows.find((r) => r.accountCode === '100202')).toMatchObject({
      opening: 0,
      debit: 0,
      credit: 0,
      closing: 0,
    });
    expect(base.totals).toMatchObject({
      debit: 66_734,
      credit: 73_834,
      fcOpening: 0,
      fcDebit: 0,
      fcCredit: 0,
      fcClosing: 0,
    });
    const usd = (await query().query({ ...range, mode: 'foreign', currency: 'USD' })).groups[0]!;
    expect(usd.totals).toMatchObject({
      debit: 7_100,
      credit: 0,
      fcOpening: 10_000,
      fcDebit: 1_000,
      fcCredit: 0,
      fcClosing: 11_000,
    });
    const all = (await query().query(range)).groups[0]!;
    expect(all.totals).toMatchObject({
      debit: 73_834,
      credit: 73_834,
      fcOpening: 0,
      fcDebit: 0,
      fcCredit: 0,
      fcClosing: 0,
    });
  });

  it.each([
    { side: 'debit' as const, label: '借方', fcDebit: -10_000, fcCredit: 0, fcClosing: 0 },
    { side: 'credit' as const, label: '贷方', fcDebit: 0, fcCredit: -10_000, fcClosing: 20_000 },
  ])(
    'w_zw_wbye_1 $label 红字抵消本位币但原币仍有发生额时，只发生额不能删明细',
    async ({ side, fcDebit, fcCredit, fcClosing }) => {
      await seedForeignRedActivityCase(app.svc, side);
      const expected = {
        opening: 71_000,
        debit: 0,
        credit: 0,
        closing: 71_000,
        fcOpening: 10_000,
        fcDebit,
        fcCredit,
        fcClosing,
      };
      const core = await app.svc.ledger.balances({
        ...range,
        currency: 'USD',
        rollup: false,
        includeZero: true,
      });
      expect(core.find((r) => r.accountCode === '100202')).toMatchObject(expected);
      for (const includeUnposted of [false, true]) {
        for (const currency of ['', 'USD']) {
          const input = { ...range, mode: 'foreign' as const, includeUnposted, currency };
          const all = (await query().query(input)).groups[0]!;
          const activity = (await query().query({ ...input, onlyActivity: true })).groups[0]!;
          expect(activity.rows.find((r) => r.accountCode === '100202')).toMatchObject(expected);
          expect(activity.totals).toEqual(all.totals);
          expect(activity.totals).toMatchObject({
            debit: 0,
            credit: 0,
            fcDebit,
            fcCredit,
            fcClosing,
          });
          const exported = (await query().export({ ...input, onlyActivity: true })).groups[0]!;
          expect(outputRows(exported, -1, []).map((r) => [r.code, r.fcDebit, r.fcCredit])).toEqual([
            ['100202', fcDebit, fcCredit],
            ['合计', fcDebit, fcCredit],
          ]);
        }
      }
      const summary = await query().query({ ...range, mode: 'summary', onlyActivity: true });
      expect(summary.groups[0]!.rows.some((r) => r.accountCode === '100202')).toBe(false);
    },
  );

  it('w_zw_wbye_1 跨年本位币为零而原币贷方余额非零时，行、合计及导出数据均保留原币余额', async () => {
    await seedForeignZeroBaseCase(app.svc);
    const input = { mode: 'foreign' as const, periodFrom: 202701, periodTo: 202701 };
    const core = await app.svc.ledger.balances({
      periodFrom: 202701,
      periodTo: 202701,
      currency: 'USD',
      includeZero: false,
      rollup: false,
    });
    expect(core.find((r) => r.accountCode === '100202')).toMatchObject({
      opening: 0,
      closing: 0,
      fcOpening: -10_000,
      fcClosing: -10_000,
    });
    for (const currency of ['', 'USD']) {
      for (const includeUnposted of [false, true]) {
        const report = await query().query({ ...input, currency, includeUnposted });
        const usd = report.groups.find((g) => g.currency === 'USD')!;
        expect(usd.rows.map((r) => r.accountCode)).toEqual(['1002', '100202']);
        expect(usd.rows.find((r) => r.accountCode === '100202')).toMatchObject({
          opening: 0,
          debit: 0,
          credit: 0,
          closing: 0,
          ytdDebit: 0,
          ytdCredit: 0,
          fcOpening: -10_000,
          fcDebit: 0,
          fcCredit: 0,
          fcClosing: -10_000,
        });
        expect(usd.totals).toMatchObject({
          openingDebit: 0,
          openingCredit: 0,
          debit: 0,
          credit: 0,
          fcOpening: -10_000,
          fcClosing: -10_000,
        });
        expect(outputRows(usd, -1, []).map((r) => [r.code, r.fcOpening, r.fcClosing])).toEqual([
          ['100202', -10_000, -10_000],
          ['合计', -10_000, -10_000],
        ]);
      }
    }
    const exported = await query().export({ ...input, currency: 'USD' });
    expect(exported.groups[0]!.totals.fcClosing).toBe(-10_000);
    const activity = await query().query({ ...input, onlyActivity: true });
    expect(activity.groups[0]!.rows).toEqual([]);
    expect(activity.groups[0]!.totals.fcClosing).toBe(-10_000);
    await app.svc.db
      .insertInto('currency')
      .values({ code: 'EUR', name: '欧元', symbol: '€', is_base: 0, disabled: 0, sort: 2 })
      .execute();
    const empty = await query().query({ ...input, currency: 'EUR' });
    expect(empty.groups[0]!.rows).toEqual([]);
    expect(empty.groups[0]!.totals.fcClosing).toBe(0);
  });

  it('逐币种 core 查询，外币及本位币按固定手算一致；维度过滤完整钻取', async () => {
    await seedBalanceCases(app.svc);
    await app.svc.db
      .insertInto('currency')
      .values({ code: 'EUR', name: '欧元', symbol: '€', is_base: 0, disabled: 0, sort: 2 })
      .execute();
    await app.svc.accounts.create({ code: '100203', name: '欧元户', currency: 'EUR' }, [4, 2, 2]);
    await seedVouchers(app.svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '100203', debit: 8_000, currency: 'EUR', rate: '8', fcAmount: 1_000 },
          { account: '6001', credit: 8_000 },
        ],
      },
    ]);
    const report = await query().query({ ...range, mode: 'foreign' });
    expect(report.groups.map((g) => g.currency).sort()).toEqual(['EUR', 'USD']);
    expect(report.groups.find((g) => g.currency === 'USD')?.totals).toMatchObject({
      fcOpening: 10_000,
      fcDebit: 1_000,
      fcCredit: 0,
      fcClosing: 11_000,
      debit: 7_100,
    });
    expect(report.groups.find((g) => g.currency === 'EUR')?.totals).toMatchObject({
      fcOpening: 0,
      fcDebit: 1_000,
      fcClosing: 1_000,
      debit: 8_000,
    });
    expect(
      (await query().query({ ...range, mode: 'foreign', currency: 'USD' })).groups,
    ).toHaveLength(1);
    expect(
      (await errorCode(query().query({ ...range, mode: 'foreign', currency: 'ZZZ' }))).code,
    ).toBe('BALANCES_CURRENCY_INVALID');
    const dept = (await app.svc.dimensions.getByCode('department', '01'))!.id;
    const filtered = await query().query({
      ...range,
      dims: JSON.stringify({ department: dept }),
      includeUnposted: true,
    });
    expect(filtered.groups[0]!.totals.debit).toBe(1_234);
    const row = filtered.groups[0]!.rows.find((r) => r.accountCode === '6602')!;
    const url = new URL(detailUrl(filtered, row, 'USD'), 'http://localhost');
    expect(url.pathname).toBe('/m/ledgers/detail');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      account: '6602',
      from: '202602',
      to: '202602',
      dims: JSON.stringify({ department: dept }),
      includeUnposted: '1',
      currency: 'USD',
    });
  });
});

describe('w_zw_ye_1/w_zw_wbye_1 展示设置与权限', () => {
  it('隔离 settings 持久化，过期保存失败保留原值，事务失败回滚', async () => {
    const api = query();
    const old = (await api.metadata()).settings;
    const saved = await api.saveSettings({
      revision: old.revision,
      display: { level: -1, onlyActivity: true },
    });
    expect((await api.metadata()).settings).toEqual(saved);
    expect(await app.svc.settings.get('display', null)).toBeNull();
    expect(
      (
        await errorCode(
          api.saveSettings({ revision: 0, display: { level: 2, onlyActivity: false } }),
        )
      ).code,
    ).toBe('BALANCES_SETTINGS_STALE');
    expect((await api.metadata()).settings).toEqual(saved);
    await expect(
      app.svcFor('balances').tx(async (tsvc) => {
        await tsvc.settings.set('display', { revision: 99 });
        throw new Error('保存失败');
      }),
    ).rejects.toThrow('保存失败');
    expect((await api.metadata()).settings).toEqual(saved);
  });
  it('只读用户可查但不能保存/导出，无权用户不能敏感读取，导出另核查看权限', async () => {
    const viewer = app.call(
      balancesServer,
      await app.addUser('viewer', { permissions: ['balances.view'] }),
    );
    await expect(viewer.query({})).resolves.toBeDefined();
    expect(
      (
        await errorCode(
          viewer.saveSettings({ revision: 0, display: { level: 1, onlyActivity: true } }),
        )
      ).code,
    ).toBe('FORBIDDEN');
    expect((await errorCode(viewer.export({}))).code).toBe('FORBIDDEN');
    const none = app.call(balancesServer, await app.addUser('none'));
    expect((await errorCode(none.metadata())).code).toBe('FORBIDDEN');
    expect((await errorCode(none.query({}))).code).toBe('FORBIDDEN');
    const exporter = app.call(
      balancesServer,
      await app.addUser('exporter', { permissions: ['balances.export'] }),
    );
    expect((await errorCode(exporter.export({}))).code).toBe('FORBIDDEN');
    expect((await query().export(range)).groups[0]?.totals.debit).toBe(0);
  });
});

it('w_zw_ye fast-check：真实随机平衡凭证，默认/含未过账合计分别等于独立手算，父子不重复', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          cents: fc.integer({ min: 1, max: 1_000_000 }),
          status: fc.constantFrom('posted', 'audited', 'pending', 'draft'),
        }),
        { minLength: 1, maxLength: 8 },
      ),
      async (specs) => {
        const t = await createTestApp({ modules: [balancesServer] });
        try {
          await seedVouchers(
            t.svc,
            specs.map((s) => ({
              date: '2026-01-05',
              status: s.status,
              lines: [
                { account: '100201', debit: s.cents },
                { account: '6001', credit: s.cents },
              ],
            })),
          );
          for (const includeUnposted of [false, true]) {
            const expected = specs
              .filter((s) => (includeUnposted ? s.status !== 'draft' : s.status === 'posted'))
              .reduce((sum, s) => sum + s.cents, 0);
            const report = await balancesService(t.svcFor('balances')).query({ includeUnposted });
            const totals = report.groups[0]!.totals;
            expect(totals.debit).toBe(expected);
            expect(totals.credit).toBe(expected);
            expect(totals.closingDebit).toBe(expected);
            expect(totals.closingCredit).toBe(expected);
          }
        } finally {
          await t.close();
        }
      },
    ),
    { numRuns: 15 },
  );
});

it('w_zw_ye_kmxz 指定打印仅保留显示科目，不把原范围合计冒充选中合计；定位可命中折叠下级', async () => {
  await seedBalanceCases(app.svc);
  const report = await app.call(balancesServer).query(range);
  const group = report.groups[0]!;
  const bank = group.rows.find((r) => r.accountCode === '100201')!;
  const html = reportHtml(
    report,
    0,
    group.rows.map((r) => r.accountId),
    [bank.accountId],
  );
  expect(html).toContain('<td>100201</td>');
  expect(html).not.toContain('<td>1002</td>');
  expect(html).not.toContain('<td>合计</td>');
  expect(html).toContain('不另列选中科目合计');
  const located = locateRows(group, 1, [], '100201');
  expect(located.map((r) => r.code)).toEqual(['100201', '合计']);
  expect(located.at(-1)!.debit).toBe(group.totals.debit);
});
