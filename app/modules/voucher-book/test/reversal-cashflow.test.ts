import { afterEach, beforeEach, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import type { Voucher } from '@caiwu/core';
import type { VoucherBookTables } from '../server/migrations';
import server from '../server';

let app: TestApp;
let inflow: number;
let outflow: number;
let internal: number;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
  for (const [code, direction] of [
    ['CF01', 'inflow'],
    ['CF02', 'outflow'],
  ] as const) {
    const item = (await app.svc.dimensions.getByCode('cashflow', code))!;
    await app.svc.db
      .updateTable('dimension_item')
      .set({ attrs: JSON.stringify({ cashflowDirection: direction }) })
      .where('id', '=', item.id)
      .execute();
    if (direction === 'inflow') inflow = item.id;
    else outflow = item.id;
  }
  internal = (
    await app.svc.dimensions.create({
      type: 'cashflow',
      code: 'CFI',
      name: '内部转移',
      attrs: { cashflowDirection: 'internal' },
    })
  ).id;
});
afterEach(async () => app.close());
const api = () => app.call(server);
async function original() {
  return app.svc.vouchers.create(
    await voucherInputFromSpec(app.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1001', credit: 12345, dims: { cashflow: 'CF02' } },
        { account: '6603', debit: 12345 },
      ],
    }),
  );
}
async function preview(v: Voucher) {
  return api().preview.reverse({
    action: 'reverse',
    selection: { ids: [v.id] },
    date: '2026-02-01',
    voucherTypeId: v.voucherTypeId,
  });
}
const mapping = () => [{ lineNo: 1, itemId: inflow }];
async function snapshot() {
  return {
    vouchers: await app.svc.db.selectFrom('voucher').selectAll().orderBy('id').execute(),
    lines: await app.svc.db.selectFrom('voucher_line').selectAll().orderBy('id').execute(),
    logs: await app.svc.db.selectFrom('operation_log').selectAll().orderBy('id').execute(),
    results: await app.svc.db
      .withTables<VoucherBookTables>()
      .selectFrom('voucher_book_plan')
      .select(['token', 'result'])
      .orderBy('token')
      .execute(),
  };
}

it('w_pzedit_fc 取消预览不写业务数据，多个合法项目不自动映射；明确选择后制审分离且来源锁保留', async () => {
  const alternative = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'CF03',
    name: '其他业务流入',
    attrs: { cashflowDirection: 'inflow' },
  });
  const v = await original();
  const before = await snapshot();
  const p = await preview(v);
  expect(p.reversalCashflow).toEqual([
    expect.objectContaining({
      lineNo: 1,
      direction: 'inflow',
      debit: 0,
      credit: -12345,
      options: expect.arrayContaining([
        expect.objectContaining({ id: inflow }),
        expect.objectContaining({ id: alternative.id }),
      ]),
    }),
  ]);
  const after = await snapshot();
  expect({ ...after, results: before.results }).toEqual(before);
  await expect(api().commit({ token: p.token, confirmed: true })).rejects.toThrow(/尚未选择/);
  const r = await api().commit({
    token: p.token,
    confirmed: true,
    cashflowMappings: [{ lineNo: 1, itemId: alternative.id }],
  });
  const created = (await app.svc.vouchers.get(r.createdIds[0]!))!;
  expect(created.lines[0]).toMatchObject({
    debit: 0,
    credit: -12345,
    dimensions: { cashflow: alternative.id },
  });
  expect(created).toMatchObject({
    reversalOfId: v.id,
    status: 'pending',
    source: { module: 'voucher-book', type: 'reversal', id: String(v.id) },
  });
  expect(await app.svc.vouchers.get(v.id)).toEqual(v);
  const mine = await api().preview.audit({ action: 'audit', selection: { ids: [created.id] } });
  expect(mine.rows[0]!.reasons.join()).toContain('制单人与审核人相同');
  await expect(
    app.svcFor('voucher-entry').vouchers.update(
      created.id,
      {
        ...(await voucherInputFromSpec(app.svc, {
          date: created.date,
          lines: [
            { account: '1001', credit: -12345, dims: { cashflow: 'CF01' } },
            { account: '6603', debit: -12345 },
          ],
        })),
      },
      { expectedRevision: created.revision },
    ),
  ).rejects.toThrow(/生成/);
  const reviewer = app.call(
    server,
    await app.addUser('review', { permissions: ['voucher-book.view', 'voucher-book.audit'] }),
  );
  const audit = await reviewer.preview.audit({ action: 'audit', selection: { ids: [created.id] } });
  expect(audit.rows[0]!.warnings).toEqual([]);
  await reviewer.commit({ token: audit.token, confirmed: true });
  expect((await app.svc.vouchers.get(created.id))!.auditedBy!.name).toBe('review');
  expect(
    await api().commit({
      token: p.token,
      confirmed: true,
      cashflowMappings: [{ lineNo: 1, itemId: alternative.id }],
    }),
  ).toEqual(r);
  expect((await app.svc.vouchers.list({})).total).toBe(2);
});

it.each([
  'wrong-direction',
  'unknown',
  'disabled',
  'nonleaf',
  'no-direction',
  'wrong-type',
  'duplicate',
  'noncash-line',
  'internal-reclassification',
] as const)('w_pzedit_fc 非法映射 %s 全部拒绝且不留结果或日志', async (kind) => {
  let itemId = outflow;
  if (kind === 'unknown') itemId = 999999;
  if (['disabled', 'nonleaf', 'no-direction'].includes(kind)) {
    itemId = (
      await app.svc.dimensions.create({
        type: 'cashflow',
        code: 'CFBAD',
        name: '不可选项目',
        attrs: kind === 'no-direction' ? {} : { cashflowDirection: 'inflow' },
      })
    ).id;
    if (kind !== 'no-direction')
      await app.svc.db
        .updateTable('dimension_item')
        .set(kind === 'disabled' ? { disabled: 1 } : { is_leaf: 0 })
        .where('id', '=', itemId)
        .execute();
  }
  if (kind === 'wrong-type') itemId = (await app.svc.dimensions.getByCode('project', 'XM01'))!.id;
  if (kind === 'internal-reclassification') itemId = internal;
  const p = await preview(await original());
  const before = await snapshot();
  const mappings =
    kind === 'duplicate'
      ? [...mapping(), ...mapping()]
      : kind === 'noncash-line'
        ? [{ lineNo: 2, itemId: inflow }]
        : [{ lineNo: 1, itemId }];
  await expect(
    api().commit({
      token: p.token,
      confirmed: true,
      cashflowMappings: mappings,
      cashflowConfirmed: true,
    }),
  ).rejects.toThrow(/映射重复|不允许修改|项目无效|方向冲突/);
  expect(await snapshot()).toEqual(before);
});

it('w_pzedit_fc 多行映射缺一行也不能部分生成', async () => {
  const v = await app.svc.vouchers.create(
    await voucherInputFromSpec(app.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1001', credit: 1, dims: { cashflow: 'CF02' } },
        { account: '100201', credit: 2, dims: { cashflow: 'CF02' } },
        { account: '6603', debit: 3 },
      ],
    }),
  );
  const p = await preview(v);
  const before = await snapshot();
  await expect(
    api().commit({ token: p.token, confirmed: true, cashflowMappings: mapping() }),
  ).rejects.toThrow(/第2行尚未选择/);
  expect(await snapshot()).toEqual(before);
});

it.each(['expired', 'metadata', 'source-content', 'source-status', 'target-closed'] as const)(
  'w_pzedit_fc 事务重读拒绝过期预览和并发变化 %s',
  async (kind) => {
    const v = await original();
    const p = await preview(v);
    if (kind === 'expired')
      await app.svc.db
        .withTables<VoucherBookTables>()
        .updateTable('voucher_book_plan')
        .set({ created_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() })
        .where('token', '=', p.token)
        .execute();
    if (kind === 'metadata')
      await app.svc.db
        .updateTable('dimension_item')
        .set({ disabled: 1 })
        .where('id', '=', inflow)
        .execute();
    if (kind === 'source-status') await app.svc.vouchers.setVoided(v.id, true);
    if (kind === 'source-content') {
      const data = await voucherInputFromSpec(app.svc, {
        date: v.date,
        lines: [
          { account: '1001', credit: 2, dims: { cashflow: 'CF02' } },
          { account: '6603', debit: 2 },
        ],
      });
      await app.svc.vouchers.update(v.id, data, { expectedRevision: v.revision });
    }
    if (kind === 'target-closed') await app.svc.periods.setStatus(202602, 'closed');
    const before = await snapshot();
    await expect(
      api().commit({ token: p.token, confirmed: true, cashflowMappings: mapping() }),
    ).rejects.toThrow(/超过15分钟|已变更|结账/);
    expect(await snapshot()).toEqual(before);
  },
);

it('w_pzedit_fc 预览所属人和执行权限均重校验，撤回权限后不能生成', async () => {
  const token = await app.addUser('maker', {
    permissions: ['voucher-book.view', 'voucher-book.reverse'],
  });
  const maker = app.call(server, token);
  const v = await original();
  const p = await maker.preview.reverse({
    action: 'reverse',
    selection: { ids: [v.id] },
    date: '2026-02-01',
    voucherTypeId: v.voucherTypeId,
  });
  await expect(
    api().commit({ token: p.token, confirmed: true, cashflowMappings: mapping() }),
  ).rejects.toThrow(/其它操作员/);
  const user = (await app.svc.users.list()).find((u) => u.code === 'maker')!;
  await app.svc.db
    .deleteFrom('user_permission')
    .where('user_id', '=', user.id)
    .where('permission', '=', 'voucher-book.reverse')
    .execute();
  const before = await snapshot();
  await expect(
    maker.commit({ token: p.token, confirmed: true, cashflowMappings: mapping() }),
  ).rejects.toThrow(/权限/);
  expect(await snapshot()).toEqual(before);
});

it('w_pzedit_fc 内部转移精确配平并保留原项目，外部项目不能代替内部差额', async () => {
  for (const amount of [1, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
    const v = await app.svc.vouchers.create(
      await voucherInputFromSpec(app.svc, {
        date: '2026-01-05',
        lines: [
          { account: '1001', debit: amount, dims: { cashflow: 'CFI' } },
          { account: '100201', credit: amount, dims: { cashflow: 'CFI' } },
        ],
      }),
    );
    const p = await preview(v);
    expect(p.reversalCashflow!.map((r) => r.direction)).toEqual(['internal', 'internal']);
    const before = await snapshot();
    await expect(
      api().commit({
        token: p.token,
        confirmed: true,
        cashflowMappings: [{ lineNo: 1, itemId: inflow }],
      }),
    ).rejects.toThrow(/不允许修改/);
    expect(await snapshot()).toEqual(before);
    const r = await api().commit({ token: p.token, confirmed: true });
    const reverse = (await app.svc.vouchers.get(r.createdIds[0]!))!;
    expect(reverse.lines.map((l) => l.dimensions.cashflow)).toEqual([internal, internal]);
    expect(reverse.debitTotal).toBe(-amount);
    expect(await app.svc.vouchers.get(v.id)).toEqual(v);
  }
  const bad = await app.svc.vouchers.create(
    await voucherInputFromSpec(app.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: 100, dims: { cashflow: 'CFI' } },
        { account: '100201', credit: 99, dims: { cashflow: 'CFI' } },
        { account: '1001', credit: 1, dims: { cashflow: 'CF02' } },
      ],
    }),
  );
  const before = await snapshot();
  await expect(preview(bad)).rejects.toThrow(/内部现金流入流出未配平/);
  expect(await snapshot()).toEqual(before);
});

it('w_pzedit_fc 并发确认和生成故障保持幂等及事务回滚', async () => {
  const v = await original();
  const p = await preview(v);
  await sql`CREATE TRIGGER voucher_book_reverse_failure BEFORE INSERT ON voucher_line WHEN NEW.period = 202602 BEGIN SELECT RAISE(ABORT, '红冲故障'); END`.execute(
    app.svc.db,
  );
  const before = await snapshot();
  await expect(
    api().commit({ token: p.token, confirmed: true, cashflowMappings: mapping() }),
  ).rejects.toThrow(/红冲故障/);
  expect(await snapshot()).toEqual(before);
  await sql`DROP TRIGGER voucher_book_reverse_failure`.execute(app.svc.db);
  const results = await Promise.all([
    api().commit({ token: p.token, confirmed: true, cashflowMappings: mapping() }),
    api().commit({ token: p.token, confirmed: true, cashflowMappings: mapping() }),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect((await app.svc.vouchers.list({})).total).toBe(2);
});

it('w_pzedit_fc 没有合法反向项目时保留预览和明确提示，不能默认选择或确认绕过', async () => {
  await app.svc.db
    .updateTable('dimension_item')
    .set({ disabled: 1 })
    .where('id', '=', inflow)
    .execute();
  const v = await original();
  const p = await preview(v);
  expect(p.reversalCashflow![0]!.options).toEqual([]);
  const before = await snapshot();
  await expect(
    api().commit({ token: p.token, confirmed: true, cashflowConfirmed: true }),
  ).rejects.toThrow(/尚未选择/);
  await expect(
    api().commit({ token: p.token, confirmed: true, cashflowMappings: mapping() }),
  ).rejects.toThrow(/项目无效|方向冲突/);
  expect(await snapshot()).toEqual(before);
});

it('w_pzedit_fc 两个有效映射预览并发提交只生成一次，重预览后可显式再次冲销', async () => {
  const v = await original();
  const first = await preview(v);
  const second = await preview(v);
  const results = await Promise.allSettled(
    [first, second].map((p) =>
      api().commit({ token: p.token, confirmed: true, cashflowMappings: mapping() }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected');
  expect(rejected?.status === 'rejected' ? String(rejected.reason) : '').toMatch(/冲销关系已变更/);
  expect((await app.svc.vouchers.list({})).total).toBe(2);
  const next = await preview(v);
  expect(next.warnings.join()).toContain('再次冲销');
  await api().commit({ token: next.token, confirmed: true, cashflowMappings: mapping() });
  expect((await app.svc.vouchers.list({})).total).toBe(3);
  expect(await app.svc.vouchers.get(v.id)).toEqual(v);
});

it('w_pzedit_fc 内部配平也不绕过凭证合计超界保护', async () => {
  const amount = Number.MAX_SAFE_INTEGER;
  const v = await app.svc.vouchers.create(
    await voucherInputFromSpec(app.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: amount, dims: { cashflow: 'CFI' } },
        { account: '1001', debit: 2, dims: { cashflow: 'CFI' } },
        { account: '1001', debit: -2, dims: { cashflow: 'CFI' } },
        { account: '100201', credit: amount, dims: { cashflow: 'CFI' } },
      ],
    }),
  );
  const before = await snapshot();
  await expect(preview(v)).rejects.toThrow(/超过安全整数分范围/);
  expect(await snapshot()).toEqual(before);
});
