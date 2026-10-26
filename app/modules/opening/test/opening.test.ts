import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import type { BusinessError, BusinessErrorData } from '@caiwu/core';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { openingDimensions, rowVersion, yearStart, type RowInput } from '../shared';
import openingServer from '../server';

let app: TestApp;
const caller = () => app.call(openingServer);
beforeEach(async () => {
  app = await createTestApp({ modules: [openingServer] });
});
afterEach(async () => {
  await app.close();
});
export async function errorData(p: Promise<unknown>): Promise<BusinessErrorData> {
  const e = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(e).not.toBeNull();
  const data = (e as { cause: BusinessError }).cause?.data;
  expect(data).toBeDefined();
  return data;
}
async function input(code = '1001', balance = 0): Promise<RowInput> {
  return { year: 2026, accountId: (await app.svc.accounts.require(code)).id, balance };
}
async function saved() {
  return (await caller().list({ year: 2026 })).rows;
}
async function update(id: number, balance: number) {
  const row = (await saved()).find((r) => r.id === id)!;
  return caller().save({
    year: 2026,
    changes: [{ id, expected: rowVersion(row), data: { ...row, balance } }],
  });
}
async function balanced() {
  await caller().save({
    year: 2026,
    changes: [{ data: await input('1001', 10000) }, { data: await input('4001', -10000) }],
  });
}

it('w_xt_ye_nf：开账前年度拒绝，不存在年度提供去期末处理，不自动建立', async () => {
  expect((await errorData(caller().list({ year: 2025 }))).code).toBe('OPENING_BEFORE_START');
  const e = await errorData(caller().list({ year: 2027 }));
  expect(e.code).toBe('OPENING_YEAR_MISSING');
  expect(e.actions?.[0]?.to).toBe('/m/period-close');
  expect(await app.svc.periods.years()).toHaveLength(1);
  await app.svc.periods.ensureYear(2027);
  expect(
    (
      await errorData(
        caller().save({ year: 2027, changes: [{ data: { ...(await input()), year: 2027 } }] }),
      )
    ).code,
  ).toBe('OPENING_SOURCE_MISSING');
});
it('w_xt_ye：空白没有期初；opening_stored 不代表完成；显式全零真实落行并允许平衡', async () => {
  expect((await app.svc.periods.years())[0]!.opening_stored).toBe(1);
  expect((await caller().trial({ year: 2026 })).established).toBe(false);
  expect((await errorData(caller().setLock({ year: 2026, locked: true }))).code).toBe(
    'OPENING_UNBALANCED',
  );
  await expect(
    caller().save({
      year: 2026,
      changes: [{ data: { ...(await input()), balance: undefined as unknown as number } }],
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(await saved()).toEqual([]);
  await caller().save({ year: 2026, changes: [{ data: await input() }] });
  expect(await saved()).toMatchObject([{ balance: 0 }]);
  expect((await caller().trial({ year: 2026 })).balanced).toBe(true);
});
it('w_xt_ye：非末级禁止录入，父级没有实际存储行', async () => {
  expect(
    (await errorData(caller().save({ year: 2026, changes: [{ data: await input('1002', 10) }] })))
      .code,
  ).toBe('OPENING_NOT_LEAF');
  expect(await saved()).toEqual([]);
});
it('w_xt_ye：不平可保存，准确显示一分差额和当前科目，不允许锁定', async () => {
  await balanced();
  expect((await caller().trial({ year: 2026 })).balanced).toBe(true);
  const row = (await saved())[0]!;
  await update(row.id, 10001);
  const trial = await caller().trial({ year: 2026 });
  expect(trial).toMatchObject({
    balanced: false,
    difference: 1,
    yearDifference: 1,
    ytdDifference: 0,
  });
  expect(trial.accounts.map((a) => a.code)).toEqual(['1001', '4001']);
  expect((await errorData(caller().setLock({ year: 2026, locked: true }))).code).toBe(
    'OPENING_UNBALANCED',
  );
  expect((await saved())[0]!.balance).toBe(10001);
});
it('w_xt_ye：1月不能伪造启用前累计；现金流量不进入期初', async () => {
  for (const field of ['ytdDebit', 'ytdCredit']) {
    for (const amount of [1, -1]) {
      expect(
        (
          await errorData(
            caller().save({
              year: 2026,
              changes: [{ data: { ...(await input()), [field]: amount } }],
            }),
          )
        ).code,
      ).toBe('OPENING_JANUARY_YTD');
    }
  }
  await expect(
    caller().save({
      year: 2026,
      changes: [{ data: { ...(await input()), dimensions: { cashflow: 1 } as never } }],
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(await saved()).toEqual([]);
});
it('w_xt_ye：只允许明确修改原键，防并发覆盖且失败保留数据库内容', async () => {
  await caller().save({ year: 2026, changes: [{ data: await input('1001', 1) }] });
  const row = (await saved())[0]!;
  await update(row.id, 2);
  expect(
    (
      await errorData(
        caller().save({
          year: 2026,
          changes: [{ id: row.id, expected: rowVersion(row), data: { ...row, balance: 3 } }],
        }),
      )
    ).code,
  ).toBe('OPENING_STALE');
  expect((await saved())[0]!.balance).toBe(2);
  const latest = (await saved())[0]!;
  expect(
    (
      await errorData(
        caller().save({
          year: 2026,
          changes: [
            {
              id: row.id,
              expected: rowVersion(latest),
              data: { ...latest, accountId: (await input('4001')).accountId },
            },
          ],
        }),
      )
    ).code,
  ).toBe('OPENING_KEY_CHANGE');
});
it('w_xt_ye：权限直调 edit/import/lock 全部 FORBIDDEN 且库不变', async () => {
  await balanced();
  const viewer = app.call(
    openingServer,
    await app.addUser('viewer', { permissions: ['opening.view'] }),
  );
  const rows = await saved();
  const exported = await caller().export({ year: 2026 });
  const p = await caller().preview({ year: 2026, file: exported.file, mode: 'overwrite' });
  const cleanup = await caller().cleanupPreview({ year: 2026 });
  const actions = [
    () => viewer.save({ year: 2026, changes: [{ data: { ...rows[0]!, balance: 3 } }] }),
    () =>
      viewer.remove({
        year: 2026,
        id: rows[0]!.id,
        expected: rowVersion(rows[0]!),
        confirmed: true,
      }),
    () => viewer.preview({ year: 2026, file: exported.file, mode: 'overwrite' }),
    () =>
      viewer.import({
        year: 2026,
        file: exported.file,
        mode: 'overwrite',
        confirmed: true,
        expected: p.expected,
      }),
    () =>
      viewer.cleanup({ year: 2026, expected: cleanup.expected, confirmation: '清理损益年初数' }),
    () => viewer.setLock({ year: 2026, locked: true }),
    () => viewer.setLock({ year: 2026, locked: false }),
  ];
  for (const action of actions) expect((await errorData(action())).code).toBe('FORBIDDEN');
  expect(await saved()).toEqual(rows);
});
it('w_xt_ye：同一手工锁保护新增、修改、删除、导入、批量清理，解锁记录操作日志', async () => {
  await balanced();
  const rows = await saved(),
    r = rows[0]!;
  const exported = await caller().export({ year: 2026 });
  const p = await caller().preview({ year: 2026, file: exported.file, mode: 'overwrite' });
  const cleanup = await caller().cleanupPreview({ year: 2026 });
  await caller().setLock({ year: 2026, locked: true });
  const actions = [
    () => caller().save({ year: 2026, changes: [{ data: { ...r, accountId: 999 } }] }),
    () =>
      caller().save({
        year: 2026,
        changes: [{ id: r.id, expected: rowVersion(r), data: { ...r, balance: 2 } }],
      }),
    () => caller().remove({ year: 2026, id: r.id, expected: rowVersion(r), confirmed: true }),
    () =>
      caller().import({
        year: 2026,
        file: exported.file,
        mode: 'overwrite',
        confirmed: true,
        expected: p.expected,
      }),
    () =>
      caller().cleanup({ year: 2026, expected: cleanup.expected, confirmation: '清理损益年初数' }),
  ];
  for (const action of actions) expect((await errorData(action())).code).toBe('OPENING_LOCKED');
  expect(await saved()).toEqual(rows);
  await caller().setLock({ year: 2026, locked: false });
  expect(
    (await app.svc.log.list()).some((l) => l.action === 'opening.unlock' && l.module === 'opening'),
  ).toBe(true);
  await update(r.id, 10000);
});
it('w_xt_ye：真实写入中途故障与非法后行均整批回滚', async () => {
  const cash = await input('1001', 1),
    equity = await input('4001', -1);
  await sql
    .raw(
      `CREATE TRIGGER opening_test_fail BEFORE INSERT ON opening_balance WHEN NEW.account_id = ${equity.accountId} BEGIN SELECT RAISE(ABORT, '测试写入故障'); END`,
    )
    .execute(app.svc.db);
  await expect(
    caller().save({ year: 2026, changes: [{ data: cash }, { data: equity }] }),
  ).rejects.toThrow('测试写入故障');
  expect(await saved()).toEqual([]);
  await expect(
    caller().save({ year: 2026, changes: [{ data: cash }, { data: await input('1002', 1) }] }),
  ).rejects.toThrow();
  expect(await saved()).toEqual([]);
  expect((await app.svc.log.list()).filter((l) => l.module === 'opening')).toEqual([]);
});

const windows = [
  { id: 'project' as const, window: 'w_xt_xmnc', account: '5001', code: 'XM01' },
  { id: 'partner' as const, window: 'w_xt_dwnc', account: '1122', code: 'C001' },
  { id: 'department' as const, window: 'w_xt_bmnc', account: '6602', code: '01' },
  { id: 'person' as const, window: 'w_xt_grnc', account: '1221', code: 'P01' },
];
describe.each(windows)('$window', (w) => {
  async function row(): Promise<RowInput> {
    return {
      ...(await input(w.account, 100)),
      dimensions: { [w.id]: (await app.svc.dimensions.getByCode(w.id, w.code))!.id },
    };
  }
  it(`${w.window}：先选择档案、先选择科目；不能以全部为ID`, async () => {
    expect(
      (
        await errorData(
          caller().save({
            year: 2026,
            changes: [{ data: { ...(await row()), dimensions: {} }, view: w.id }],
          }),
        )
      ).code,
    ).toBe('OPENING_SELECT_ITEM');
    await expect(
      caller().save({
        year: 2026,
        changes: [{ data: { ...(await row()), accountId: 0 }, view: w.id }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller().save({
        year: 2026,
        changes: [
          { data: { ...(await row()), dimensions: { [w.id]: '全部' } as never }, view: w.id },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await saved()).toEqual([]);
  });
  it(`${w.window}：已有此项目必须报重复；明确修改才覆盖`, async () => {
    const data = await row();
    await caller().save({ year: 2026, changes: [{ data, view: w.id }] });
    expect(
      (await errorData(caller().save({ year: 2026, changes: [{ data, view: w.id }] }))).code,
    ).toBe('OPENING_DUPLICATE');
    const old = (await saved())[0]!;
    await update(old.id, 102);
    expect(await saved()).toHaveLength(1);
    expect((await saved())[0]!.balance).toBe(102);
  });
  it(`${w.window}：四维类型错误、档案不存在、停用、科目配置不符均拒绝`, async () => {
    const data = await row(),
      other = openingDimensions.find((d) => d.id !== w.id)!;
    const badId = (await app.svc.dimensions.items(other.id))[0]!.id;
    for (const id of [badId, 999999])
      expect(
        (
          await errorData(
            caller().save({
              year: 2026,
              changes: [{ data: { ...data, dimensions: { [w.id]: id } }, view: w.id }],
            }),
          )
        ).code,
      ).toBe('OPENING_DIMENSION_INVALID');
    const item = (await app.svc.dimensions.getByCode(w.id, w.code))!;
    await app.svc.db
      .updateTable('dimension_item')
      .set({ disabled: 1 })
      .where('id', '=', item.id)
      .execute();
    expect(
      (await errorData(caller().save({ year: 2026, changes: [{ data, view: w.id }] }))).code,
    ).toBe('OPENING_DIMENSION_INVALID');
    expect(
      (
        await errorData(
          caller().save({
            year: 2026,
            changes: [{ data: { ...data, accountId: (await input()).accountId }, view: w.id }],
          }),
        )
      ).code,
    ).toBe('OPENING_DIMENSION_CONFIG');
    expect(await saved()).toEqual([]);
  });
  it(`${w.window}：此科目非数量、非复币时禁止录入`, async () => {
    const data = await row();
    expect(
      (
        await errorData(
          caller().save({
            year: 2026,
            changes: [{ data: { ...data, quantity: '1.2' }, view: w.id }],
          }),
        )
      ).code,
    ).toBe('OPENING_QUANTITY');
    expect(
      (
        await errorData(
          caller().save({
            year: 2026,
            changes: [{ data: { ...data, currency: 'USD', fcBalance: 100 }, view: w.id }],
          }),
        )
      ).code,
    ).toBe('OPENING_CURRENCY');
    expect(await saved()).toEqual([]);
  });
  it(`${w.window}：本年已经过账，禁止增加、修改与删除`, async () => {
    const data = await row();
    await caller().save({ year: 2026, changes: [{ data, view: w.id }] });
    const old = (await saved())[0]!;
    const [v] = await seedVouchers(app.svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: 1 },
          { account: '4001', credit: 1 },
        ],
      },
    ]);
    expect(
      (
        await errorData(
          caller().save({ year: 2026, changes: [{ data: { ...data, balance: 10 }, view: w.id }] }),
        )
      ).code,
    ).toBe('OPENING_POSTED');
    expect(await errorData(update(old.id, 10))).toMatchObject({
      code: 'OPENING_POSTED',
      hint: expect.stringContaining('反过账'),
    });
    expect(
      (
        await errorData(
          caller().remove({ year: 2026, id: old.id, expected: rowVersion(old), confirmed: true }),
        )
      ).code,
    ).toBe('OPENING_POSTED');
    expect(await saved()).toEqual([old]);
    await app.svc.vouchers.changeStatus({ ids: [v!.id], to: 'audited' });
    await update(old.id, 10);
  });
  it(`${w.window}：删除具体项须确认；不属于请求年度的ID不允许删除`, async () => {
    await caller().save({ year: 2026, changes: [{ data: await row(), view: w.id }] });
    const old = (await saved())[0]!;
    expect(
      (
        await errorData(
          caller().remove({ year: 2026, id: old.id, expected: rowVersion(old), confirmed: false }),
        )
      ).code,
    ).toBe('OPENING_CONFIRM_DELETE');
    expect(
      (
        await errorData(
          caller().remove({
            year: 2026,
            id: old.id + 100,
            expected: rowVersion(old),
            confirmed: true,
          }),
        )
      ).code,
    ).toBe('OPENING_ROW_MISSING');
    await app.svc.periods.ensureYear(2027, { openingStored: true });
    expect(
      (
        await errorData(
          caller().remove({ year: 2027, id: old.id, expected: rowVersion(old), confirmed: true }),
        )
      ).code,
    ).toBe('OPENING_ROW_MISSING');
    expect(await saved()).toEqual([old]);
    await caller().remove({ year: 2026, id: old.id, expected: rowVersion(old), confirmed: true });
    expect(await saved()).toEqual([]);
  });
  it(`${w.window}：清理损益先列科目金额，取消与文字未确认时数据不变`, async () => {
    await caller().save({
      year: 2026,
      changes: [{ data: await row(), view: w.id }, { data: await input('6001', -99) }],
    });
    const old = await saved(),
      preview = await caller().cleanupPreview({ year: 2026 });
    expect(preview.rows.map((r) => r.accountCode)).toContain('6001');
    expect(
      (
        await errorData(
          caller().cleanup({ year: 2026, expected: preview.expected, confirmation: '' }),
        )
      ).code,
    ).toBe('OPENING_CONFIRM_CLEANUP');
    expect(await saved()).toEqual(old);
    await caller().cleanup({
      year: 2026,
      expected: preview.expected,
      confirmation: '清理损益年初数',
    });
    const cleaned = await saved();
    expect(
      cleaned
        .filter((r) => preview.rows.some((p) => p.id === r.id))
        .every((r) => yearStart(r) === 0),
    ).toBe(true);
  });
});
it('w_xt_ye：同科目多维组合真实存储，必填不能漏，无辅助汇总不得与明细双计', async () => {
  const a = await app.svc.accounts.create(
    {
      code: '5002',
      name: '多维期初',
      categoryId: 'cost',
      dimensions: openingDimensions.map((d) => ({ type: d.id })),
    },
    app.book.codeScheme,
  );
  const items = await app.svc.dimensions.items();
  const dims = Object.fromEntries(
    openingDimensions.map((d) => [d.id, items.find((i) => i.typeId === d.id)!.id]),
  );
  const data = { year: 2026, accountId: a.id, balance: 10, dimensions: dims };
  await caller().save({ year: 2026, changes: [{ data }] });
  const dept2 = items.find((i) => i.typeId === 'department' && i.code === '02')!;
  await caller().save({
    year: 2026,
    changes: [{ data: { ...data, dimensions: { ...dims, department: dept2.id } } }],
  });
  expect(await saved()).toHaveLength(2);
  expect(
    (
      await errorData(
        caller().save({ year: 2026, changes: [{ data: { ...data, dimensions: {} } }] }),
      )
    ).code,
  ).toBe('OPENING_DIMENSION_REQUIRED');
  const optional = await input('6601', 12),
    dept = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  await caller().save({ year: 2026, changes: [{ data: optional }] });
  expect(
    (
      await errorData(
        caller().save({
          year: 2026,
          changes: [{ data: { ...optional, dimensions: { department: dept } } }],
        }),
      )
    ).code,
  ).toBe('OPENING_SUMMARY_DUPLICATE');
});
it('w_xt_ye：有效外币与数量独立精确保存；错误币种、停用币种与浮点金额拒绝', async () => {
  await caller().save({
    year: 2026,
    changes: [
      { data: { ...(await input('100202', 711)), currency: 'USD', fcBalance: 101 } },
      { data: { ...(await input('1403', 123)), quantity: '1.234567' } },
    ],
  });
  const r = await saved();
  expect(r).toMatchObject([
    { balance: 711, fcBalance: 101 },
    { balance: 123, quantity: '1.234567' },
  ]);
  expect((await caller().list({ year: 2026 })).rates).toContainEqual({ code: 'USD', rate: '7.1' });
  expect(
    (
      await app.svc.db
        .selectFrom('opening_balance')
        .select('quantity_e6')
        .where('id', '=', r[1]!.id)
        .executeTakeFirst()
    )?.quantity_e6,
  ).toBe(1234567);
  expect(
    (
      await errorData(
        caller().save({
          year: 2026,
          changes: [{ data: { ...(await input('100202')), currency: 'BAD' } }],
        }),
      )
    ).code,
  ).toBe('OPENING_CURRENCY');
  await app.svc.db.updateTable('currency').set({ disabled: 1 }).where('code', '=', 'USD').execute();
  expect(await errorData(update(r[0]!.id, 711))).toMatchObject({ code: 'OPENING_CURRENCY' });
  await expect(
    caller().save({ year: 2026, changes: [{ data: await input('1001', 0.1) }] }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});
it('w_xt_ye：已结账及停用科目均禁止修改，读取失败不会改变已保存行', async () => {
  await balanced();
  const before = await saved();
  await app.svc.periods.setStatus(202601, 'closed');
  expect((await errorData(update(before[0]!.id, 1))).code).toBe('OPENING_CLOSED');
  await app.svc.periods.setStatus(202601, 'open');
  await app.svc.db
    .updateTable('account')
    .set({ disabled: 1 })
    .where('id', '=', before[0]!.accountId)
    .execute();
  expect((await errorData(update(before[0]!.id, 1))).code).toBe('OPENING_ACCOUNT_DISABLED');
  expect((await caller().trial({ year: 2026 })).balanced).toBe(false);
  expect(await saved()).toEqual(before);
});

it('w_xt_ye：年度金额/数量累计不超安全整数，失败不污染已保存期初', async () => {
  const cash = await input('1001', Number.MAX_SAFE_INTEGER);
  await caller().save({ year: 2026, changes: [{ data: cash }] });
  const before = await saved();
  expect(
    (await errorData(caller().save({ year: 2026, changes: [{ data: await input('4001', -1) }] })))
      .code,
  ).toBe('OPENING_RANGE');
  expect(await saved()).toEqual(before);
});
it('w_xt_ye：历史无辅助汇总和辅助明细双计时试算不准许锁定', async () => {
  const a = (await app.svc.accounts.require('6601')).id,
    dept = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  // 模拟从核心年结/旧数据中已有的异常组合；本模块没有写入后门。
  await app.svc.opening.upsert({ year: 2026, accountId: a, balance: 0 });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: a,
    balance: 0,
    dimensions: { department: dept },
  });
  const trial = await caller().trial({ year: 2026 });
  expect(trial.balanced).toBe(false);
  expect(trial.validationErrors.join(' ')).toMatch(/无辅助汇总行/);
  await expect(caller().setLock({ year: 2026, locked: true })).rejects.toThrow('不能锁定');
});

it('w_xt_ye：损益批量清理也校验当前科目与辅助资格，坏后行全部不变', async () => {
  const dept = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  await caller().save({
    year: 2026,
    changes: [
      { data: await input('6001', 100) },
      { data: { ...(await input('6602', 200)), dimensions: { department: dept } } },
    ],
  });
  const before = await saved(),
    preview = await caller().cleanupPreview({ year: 2026 });
  await app.svc.db
    .updateTable('dimension_item')
    .set({ disabled: 1 })
    .where('id', '=', dept)
    .execute();
  expect(
    (
      await errorData(
        caller().cleanup({
          year: 2026,
          expected: preview.expected,
          confirmation: '清理损益年初数',
        }),
      )
    ).code,
  ).toBe('OPENING_DIMENSION_INVALID');
  expect(await saved()).toEqual(before);
});
