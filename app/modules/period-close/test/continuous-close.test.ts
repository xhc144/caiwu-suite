import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { call, errorData, snapshot, zeroOpening } from './helpers';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
});
afterEach(async () => app.close());

it('w_zw_fz 连续结账：只读逐月预览、取消不变、顺序关闭及反结恢复期初余额', async () => {
  const api = call(app);
  const before = snapshot(app);
  const range = { from: 202601, to: 202603 };
  const preview = await api.closeRangePreview(range);
  expect(preview.items).toEqual(
    [202601, 202602, 202603].map((period) => ({
      period,
      ready: true,
      problems: [],
    })),
  );
  expect(preview.allPassed).toBe(true);
  expect(snapshot(app)).toBe(before);
  const input = { ...range, previewToken: preview.previewToken, confirmed: true };
  expect((await errorData(api.closeRange({ ...input, confirmed: false }))).code).toBe(
    'PERIOD_CLOSE_CONFIRM',
  );
  expect(snapshot(app)).toBe(before);
  const opening = await app.svc.opening.list(2026);
  const balances = await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202603 });
  await api.closeRange(input);
  expect(
    (await app.svc.periods.list()).filter((p) => p.status === 'closed').map((p) => p.period),
  ).toEqual([202601, 202602, 202603]);
  const closed = snapshot(app);
  await expect(
    app.svc.vouchers.create({
      date: '2026-02-05',
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      lines: [
        { accountId: (await app.svc.accounts.require('4001')).id, summary: '不应保存', debit: 100 },
        {
          accountId: (await app.svc.accounts.require('4103')).id,
          summary: '不应保存',
          credit: 100,
        },
      ],
    }),
  ).rejects.toMatchObject({ data: { code: 'PERIOD_CLOSED' } });
  expect(snapshot(app)).toBe(closed);
  await api.reopen({ ...range, confirmed: true });
  expect(await app.svc.opening.list(2026)).toEqual(opening);
  expect(await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202603 })).toEqual(balances);
  expect((await app.svc.periods.list()).every((p) => p.status === 'open')).toBe(true);
});

it('w_zw_fz 连续结账：后月未过账/断号/草稿/损益逐月定位，不能先关前月', async () => {
  const vouchers = await seedVouchers(app.svc, [
    {
      date: '2026-02-05',
      lines: [
        { account: '4001', debit: 100 },
        { account: '4103', credit: 100 },
      ],
    },
    { date: '2026-03-05', status: 'draft', lines: [] },
    {
      date: '2026-04-05',
      status: 'posted',
      lines: [
        { account: '4001', debit: 100 },
        { account: '6001', credit: 100 },
      ],
    },
  ]);
  {
    const numberPlan = await app.svc.vouchers.previewNumbers([{ id: vouchers[0]!.id, number: 2 }]);
    await app.svc.vouchers.setNumbers(numberPlan.updates, { plan: numberPlan, confirmed: true });
  }
  const api = call(app);
  const before = snapshot(app);
  const range = { from: 202601, to: 202604 };
  const preview = await api.closeRangePreview(range);
  expect(preview.allPassed).toBe(false);
  expect(preview.items.map((i) => i.ready)).toEqual([true, false, false, false]);
  expect(preview.items[1]!.problems.join('；')).toContain('待审核 / 未过账');
  expect(preview.items[1]!.problems.join('；')).toContain('凭证断号');
  expect(preview.items[2]!.problems.join('；')).toContain('草稿');
  expect(preview.items[3]!.problems.join('；')).toContain('损益余额');
  expect(
    (
      await errorData(
        api.closeRange({
          ...range,
          confirmed: true,
          previewToken: preview.previewToken,
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_CLOSE_RANGE_BLOCKED');
  expect(snapshot(app)).toBe(before);
});

it('w_zw_fz 连续结账：预览后数据变化、倒置/跳月/跨年范围均阻止且不写', async () => {
  const api = call(app);
  const range = { from: 202601, to: 202603 };
  const preview = await api.closeRangePreview(range);
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('4001')).id,
    balance: 100,
  });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('4103')).id,
    balance: -100,
  });
  const before = snapshot(app);
  expect(
    (
      await errorData(
        api.closeRange({
          ...range,
          confirmed: true,
          previewToken: preview.previewToken,
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_PREVIEW_CHANGED');
  for (const [input, code] of [
    [{ from: 202603, to: 202601 }, 'PERIOD_CLOSE_RANGE'],
    [{ from: 202602, to: 202603 }, 'PERIOD_CLOSE_CLOSE_ORDER'],
    [{ from: 202612, to: 202701 }, 'PERIOD_CLOSE_CROSS_YEAR_CLOSE'],
  ] as const)
    expect((await errorData(api.closeRangePreview(input))).code).toBe(code);
  expect(snapshot(app)).toBe(before);
});

it('w_zw_fz 连续结账：第二个月真实数据库失败，前月期间及操作日志一同回滚', async () => {
  const api = call(app);
  const range = { from: 202601, to: 202603 };
  const preview = await api.closeRangePreview(range);
  app.runtime.bookStore
    .open(app.book.id)
    .raw.exec(
      "CREATE TRIGGER period_close_test_range_fail BEFORE UPDATE ON period WHEN NEW.period=202602 AND NEW.status='closed' BEGIN SELECT RAISE(ABORT,'测试连续结账后半失败'); END",
    );
  const before = snapshot(app);
  await expect(
    api.closeRange({
      ...range,
      confirmed: true,
      previewToken: preview.previewToken,
    }),
  ).rejects.toThrow('测试连续结账后半失败');
  expect(snapshot(app)).toBe(before);
});
