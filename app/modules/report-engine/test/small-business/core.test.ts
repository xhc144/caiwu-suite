import { afterEach, expect, it } from 'vitest';
import { seedVouchers, type TestApp } from '@caiwu/testkit';
import {
  prepareSmallBusiness,
  loadConfiguration,
  saveConfiguration,
  assertSmallBusinessOutput,
  assertSameSource,
} from '../../templates/small-business/statutory.server';
import { completeCoreBook, closePnl } from './core-fixture';
import { smallBusinessApp } from './fixture';
let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
const monthly = [
  50001, 20001, 28, 1, 2, 3, 4, 5, 6, 7, 2402, 1101, 1301, 4803, 1501, 1601, 1701, 1700, 1700, 2001,
  23068, 2301, 2301, 13505, 2501, 2601, 2701, 2801, 2901, 11864, 1001, 10863,
];
const annual = [
  600012, 240012, 336, 12, 24, 36, 48, 60, 72, 84, 28824, 13212, 15612, 57636, 18012, 19212, 20412,
  20400, 20400, 24012, 276816, 27612, 27612, 162060, 30012, 31212, 32412, 33612, 34812, 142368,
  12012, 130356,
];
it('w_bb_proc 真实core连续24月，三表全部行列独立手算、配置持久保存及上年全年', async () => {
  const result = await completeCoreBook();
  app = result.app;
  const { svc } = result;
  expect((await loadConfiguration(svc)).revision).toBe(2);
  const p = await svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' }));
  assertSmallBusinessOutput(p);
  for (const r of p.statements[1].rows)
    for (const c of [0, 1])
      expect(r.amounts[c]?.value, `利润行${r.line}列${c}`).toBe(annual[r.line - 1]);
  const current = [
      360712, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 360712, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 360712, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100000, 0, 0, 260712, 360712,
      360712,
    ],
    opening = [
      230356, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 230356, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 230356, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100000, 0, 0, 130356, 230356,
      230356,
    ];
  for (const r of p.statements[0].rows) {
    expect(r.amounts[0].value, `期末行${r.line}`).toBe(current[r.line - 1]);
    expect(r.amounts[1]?.value, `年初行${r.line}`).toBe(opening[r.line - 1]);
  }
  const cash = [
      600012, 27612, 240012, 0, 12348, 248520, 126744, 0, 24012, 0, 0, 0, 24012, 0, 0, 0, 20400, 0,
      -20400, 130356, 230356, 360712,
    ],
    previous = [
      600012, 27612, 240012, 0, 12348, 248520, 126744, 0, 24012, 0, 0, 0, 24012, 0, 0, 0, 20400, 0,
      -20400, 130356, 100000, 230356,
    ];
  for (const r of p.statements[2].rows) {
    expect(r.amounts[0].value, `本年现金行${r.line}`).toBe(cash[r.line - 1]);
    expect(r.amounts[1]?.value, `上年现金行${r.line}`).toBe(previous[r.line - 1]);
  }
  for (let m = 1; m <= 12; m++) {
    const v = await svc.tx((t) => prepareSmallBusiness(t, { period: 202600 + m, mode: 'monthly' }));
    assertSmallBusinessOutput(v);
    for (const r of v.statements[1].rows) {
      expect(r.amounts[0].value).toBe(monthly[r.line - 1]! * m);
      expect(r.amounts[1]?.value).toBe(monthly[r.line - 1]);
    }
  }
}, 20000);
it('w_bb_proc 损益结转前后权益与利润不变量，年结承接前后一致', async () => {
  const r = await completeCoreBook();
  app = r.app;
  const { svc } = r;
  const before = await svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' }));
  await closePnl(svc, 2026);
  const after = await svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' }));
  assertSmallBusinessOutput(after);
  expect(after.statements.map((s) => s.rows.map((r) => r.amounts.map((a) => a?.value)))).toEqual(
    before.statements.map((s) => s.rows.map((r) => r.amounts.map((a) => a?.value))),
  );
  await svc.periods.ensureYear(2027);
  const pre = await svc.ledger.balances({ periodFrom: 202701, periodTo: 202701, rollup: false }),
    closing = await svc.ledger.balances({ periodFrom: 202612, periodTo: 202612, rollup: false });
  await svc.opening.replaceYear(
    2027,
    closing.map((r) => ({ accountId: r.accountId, balance: r.closing, dimensions: r.dimensions })),
  );
  const post = await svc.ledger.balances({ periodFrom: 202701, periodTo: 202701, rollup: false });
  expect(post.map((r) => [r.accountCode, r.opening])).toEqual(
    pre.map((r) => [r.accountCode, r.opening]),
  );
}, 20000);
it('w_bb_proc 年报12月策略、配置revision、未过账确认、来源改变和输出审核门禁', async () => {
  const r = await completeCoreBook();
  app = r.app;
  const { svc, config } = r;
  await expect(
    svc.tx((t) => prepareSmallBusiness(t, { period: 202602, mode: 'annual' })),
  ).rejects.toThrow(/12月/);
  await expect(svc.tx((t) => saveConfiguration(t, config, 1))).rejects.toThrow(/刷新/);
  const before = await svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' }));
  await seedVouchers(svc, [
    {
      date: '2026-12-06',
      status: 'pending',
      lines: [
        { account: '1001', debit: 100 },
        { account: '5001', credit: 100 },
      ],
    },
  ]);
  await expect(
    svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' })),
  ).rejects.toThrow(/未过账/);
  const fresh = await svc.tx((t) =>
    prepareSmallBusiness(t, { period: 202612, mode: 'annual', confirmUnposted: true }),
  );
  expect(fresh.unpostedCount).toBe(1);
  await svc.periods.setStatus(202612, 'closed');
  const changed = await svc.tx((t) =>
    prepareSmallBusiness(t, { period: 202612, mode: 'annual', confirmUnposted: true }),
  );
  expect(() => assertSameSource(before, changed)).toThrow(/已改变/);
  const bad = structuredClone(fresh);
  bad.statements[0].checks[0]!.difference = 1;
  expect(() => assertSmallBusinessOutput(bad)).toThrow(/行53.*差额/);
}, 20000);
it('w_bb_proc 首年无上年和上年比较数据缺失区分', async () => {
  app = await smallBusinessApp();
  const svc = app.svcFor('report-engine');
  await expect(
    svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' })),
  ).rejects.toThrow(/上年全年比较数据缺失/);
  const c = await loadConfiguration(svc);
  c.firstYear = { year: 2026, reason: '2026年1月设立的合成企业' };
  await svc.tx((t) => saveConfiguration(t, c, 1));
  const p = await svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' }));
  expect(p.comparisonNote).toContain('首个会计年度');
  expect(p.statements[1].rows.every((r) => r.amounts[1] === null)).toBe(true);
});
it('w_bb_proc 月报累计必须确认此前月份全部未过账；本月已过账不掩盖前月草稿、待审核及已审核', async () => {
  const result = await completeCoreBook();
  app = result.app;
  const { svc } = result;
  const before = await svc.tx((t) => prepareSmallBusiness(t, { period: 202602, mode: 'monthly' }));
  assertSmallBusinessOutput(before);
  for (const status of ['draft', 'pending', 'audited'] as const)
    await seedVouchers(svc, [
      {
        date: '2026-01-10',
        status,
        lines: [
          { account: '1001', debit: 100 },
          { account: '5001', credit: 100 },
        ],
      },
    ]);
  let failure: unknown;
  try {
    await svc.tx((t) => prepareSmallBusiness(t, { period: 202602, mode: 'monthly' }));
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({
    data: { code: 'SMALL_REPORT_UNPOSTED', details: { count: 3, from: 202601, to: 202602 } },
  });
  const actions = (failure as { data: { actions: { to: string }[] } }).data.actions;
  expect(actions).toHaveLength(3);
  const statuses = actions.map((action) => {
    const url = new URL(action.to, 'http://127.0.0.1');
    expect(url.pathname).toBe('/m/voucher-book');
    expect(url.searchParams.get('period')).toBe('202601');
    expect(url.searchParams.get('periodTo')).toBe('202602');
    return url.searchParams.get('status');
  });
  expect(statuses).toEqual(['draft', 'pending', 'audited']);
  const confirmed = await svc.tx((t) =>
    prepareSmallBusiness(t, { period: 202602, mode: 'monthly', confirmUnposted: true }),
  );
  assertSmallBusinessOutput(confirmed);
  expect(confirmed.unpostedCount).toBe(3);
  expect(
    confirmed.statements.map((s) => s.rows.map((r) => r.amounts.map((a) => a?.value))),
  ).toEqual(before.statements.map((s) => s.rows.map((r) => r.amounts.map((a) => a?.value))));
  expect(confirmed.sourceBinding).not.toBe(before.sourceBinding);
  expect(() => assertSameSource(before, confirmed)).toThrow(/已改变/);
}, 20000);
