import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import {
  call,
  errorData,
  generateAll,
  rule,
  snapshot,
  zeroOpening,
  seedCashflowDirections,
} from './helpers';
import type { Cashflows } from '../shared';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
  await seedCashflowDirections(app);
});
afterEach(async () => app.close());
const account = async (code: string) => await app.svc.accounts.require(code);
const choices = async () => ({
  in: (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id,
  out: (await app.svc.dimensions.getByCode('cashflow', 'CF02'))!.id,
});
async function targetRule(target = '1001', targetCashflows?: Cashflows) {
  return rule(app, {
    kind: 'custom',
    targetAccountId: (await account(target)).id,
    targetCashflows,
    sources: [{ accountId: (await account('6603')).id, mode: 'balance', ratio: '100' }],
  });
}
it.each(['1001', '100201'])(
  'w_xt_jzwh：转入 %s 的独立现金流标志须录项目和方向，缺失不写库',
  async (code) => {
    const api = call(app);
    const target = await account(code);
    expect(target.cashflowRequired).toBe(true);
    expect(target.dimensions.some((d) => d.type === 'cashflow')).toBe(false);
    const before = snapshot(app);
    const error = await errorData(api.saveRule({ data: await targetRule(code) }));
    expect(error.code).toBe('PERIOD_CLOSE_CASHFLOW_REQUIRED');
    expect(error.message).toContain(code);
    expect(error.actions?.[0]?.to).toBe('/m/period-close');
    expect(snapshot(app)).toBe(before);
    await api.saveRule({ data: await targetRule(code, { in: (await choices()).in }) });
    expect((await api.rules())[0]!.targetCashflows).toEqual({ in: (await choices()).in });
  },
);
it.each([
  [100, 'in'],
  [-100, 'out'],
] as const)(
  'w_zw_ydjz：现金转入真实金额 %s 按 %s 选择项目；含红字方向',
  async (amount, direction) => {
    const api = call(app);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '6603', debit: amount },
          { account: '4001', credit: amount },
        ],
      },
    ]);
    const flows = await choices();
    const wrong = direction === 'in' ? 'out' : 'in';
    await api.saveRule({ data: await targetRule('100201', { [wrong]: flows[wrong] }) });
    const before = snapshot(app);
    const error = await errorData(api.preview({ period: 202601, ruleIds: [1] }));
    expect(error.code).toBe('PERIOD_CLOSE_CASHFLOW_REQUIRED');
    expect(error.message).toContain(direction === 'in' ? '现金流入' : '现金流出');
    expect(snapshot(app)).toBe(before);
    await api.saveRule({ id: 1, revision: 1, data: await targetRule('100201', flows) });
    const { result } = await generateAll(app);
    const v = (await app.svc.vouchers.get(result.generated[0]!.id))!;
    const line = v.lines.find((l) => l.accountCode === '100201')!;
    expect(line.dimensions.cashflow).toBe(flows[direction]);
    expect(line.debit - line.credit).toBe(amount);
    expect(v.status).toBe('pending');
  },
);
it('w_xt_jzwh：现金流项目必须有效末级；已声明方向或未知方向不冒充核验', async () => {
  const api = call(app);
  const department = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  const disabled = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'X_DISABLED',
    name: '停用项目',
    disabled: true,
  });
  const parent = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'X_PARENT',
    name: '父级项目',
  });
  await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'X_CHILD',
    name: '子项目',
    parentId: parent.id,
  });
  for (const itemId of [department, disabled.id, parent.id])
    expect(
      (await errorData(api.saveRule({ data: await targetRule('1001', { in: itemId }) }))).code,
    ).toBe('PERIOD_CLOSE_CASHFLOW_ITEM');
  const declared = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'X_OUT',
    name: '明确流出',
    attrs: { cashflowDirection: 'outflow' },
  });
  expect(
    (await errorData(api.saveRule({ data: await targetRule('1001', { in: declared.id }) }))).code,
  ).toBe('PERIOD_CLOSE_CASHFLOW_DIRECTION');
  const unknown = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'X_UNKNOWN',
    name: '方向未识别',
    attrs: { cashflowDirection: 'legacy-unknown' },
  });
  expect(
    (await errorData(api.saveRule({ data: await targetRule('1001', { out: unknown.id }) }))).code,
  ).toBe('PERIOD_CLOSE_CASHFLOW_UNKNOWN_DIRECTION');
});
it('w_zw_ydjz：现金转出重新明确流出项目，不沿用历史流入；后序使用真实余额而非现金流项目桶', async () => {
  const api = call(app);
  const flows = await choices();
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 100, dims: { cashflow: 'CF01' } },
        { account: '4001', credit: 100 },
      ],
    },
  ]);
  const source = { accountId: (await account('1001')).id, mode: 'balance' as const, ratio: '100' };
  const before = snapshot(app);
  expect(
    (
      await errorData(
        api.saveRule({ data: await rule(app, { kind: 'custom', sources: [source] }) }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_CASHFLOW_REQUIRED');
  expect(snapshot(app)).toBe(before);
  await api.saveRule({
    data: await rule(app, {
      code: 'A',
      kind: 'custom',
      sources: [{ ...source, cashflows: { out: flows.out } }],
    }),
  });
  await api.saveRule({
    data: await rule(app, {
      code: 'B',
      order: 2,
      kind: 'custom',
      targetAccountId: (await account('4104')).id,
      sources: [{ ...source, cashflows: flows }],
    }),
  });
  const { preview, result } = await generateAll(app);
  expect(preview.items[1]!.zero).toBe(true);
  expect(result.generated).toHaveLength(1);
  const v = (await app.svc.vouchers.get(result.generated[0]!.id))!;
  expect(v.lines.find((l) => l.accountCode === '1001')).toMatchObject({
    debit: 0,
    credit: 100,
    dimensions: { cashflow: flows.out },
  });
  await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  await api.post({ from: 202601, to: 202601 });
  expect(
    (await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601, rollup: false })).find(
      (r) => r.accountCode === '1001',
    )!.closing,
  ).toBe(0);
});
it('w_zw_ydjz：生成前重查旧定义及现金流方向，失败整库不变；不改变core/M06缺项目政策', async () => {
  const api = call(app);
  const [manual] = await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'audited',
      lines: [
        { account: '1001', debit: 100 },
        { account: '4001', credit: 100 },
      ],
    },
  ]);
  expect(manual!.lines.find((l) => l.accountCode === '1001')!.dimensions.cashflow).toBeNull();
  expect((await api.post({ from: 202601, to: 202601 })).count).toBe(1);
  const data = await rule(app, {
    kind: 'custom',
    sources: [
      {
        accountId: (await account('1001')).id,
        mode: 'balance',
        ratio: '100',
        cashflows: { out: (await choices()).out },
      },
    ],
  });
  await api.saveRule({ data });
  const preview = await api.preview({ period: 202601, ruleIds: [1] });
  const legacy = {
    ...data,
    sources: data.sources.map(({ cashflows: _cashflows, ...source }) => source),
  };
  const { tables } = await import('../server/transfers');
  await tables(app.svc)
    .updateTable('period_close_rule')
    .set({ definition: JSON.stringify(legacy) })
    .where('id', '=', 1)
    .execute();
  const before = snapshot(app);
  expect(
    (
      await errorData(
        api.generate({
          period: 202601,
          ruleIds: [1],
          previewToken: preview.previewToken,
          confirmed: true,
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_CASHFLOW_REQUIRED');
  expect(snapshot(app)).toBe(before);
});

it.each([
  ['outflow', 'in'],
  ['inflow', 'out'],
] as const)(
  'w_xt_jzwh：M03约定 cashflowDirection:%s 不能用于 %s，旧direction字段不覆盖真实方向',
  async (declared, position) => {
    const api = call(app);
    const item = await app.svc.dimensions.create({
      type: 'cashflow',
      code: 'M03_DIRECTION',
      name: '按M03约定写入',
      attrs: { cashflowDirection: declared, direction: position },
    });
    const before = snapshot(app);
    expect(
      (await errorData(api.saveRule({ data: await targetRule('1001', { [position]: item.id }) })))
        .code,
    ).toBe('PERIOD_CLOSE_CASHFLOW_DIRECTION');
    expect(snapshot(app)).toBe(before);
  },
);
it.each([
  {},
  { direction: 'in' },
  { cashflowDirection: 'legacy-unknown' },
  { cashflowDirection: null },
  { cashflowDirection: 'in' },
])('w_xt_jzwh：M03历史缺失或未知方向 %j 不按规则位置/旧字段猜测', async (attrs) => {
  const api = call(app);
  const item = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'M03_UNKNOWN',
    name: '历史方向未核实',
    attrs,
  });
  const before = snapshot(app);
  expect(
    (await errorData(api.saveRule({ data: await targetRule('1001', { in: item.id }) }))).code,
  ).toBe('PERIOD_CLOSE_CASHFLOW_UNKNOWN_DIRECTION');
  expect(snapshot(app)).toBe(before);
});
it.each([100, -100])(
  'w_zw_ydjz：M03 internal：每张凭证内部现金转移净额为零可生成，金额%s',
  async (amount) => {
    const api = call(app);
    const internal = await app.svc.dimensions.create({
      type: 'cashflow',
      code: 'M03_INTERNAL',
      name: '内部转移',
      attrs: { cashflowDirection: 'internal' },
    });
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: amount },
          { account: '4001', credit: amount },
        ],
      },
    ]);
    const both = { in: internal.id, out: internal.id };
    await api.saveRule({
      data: await rule(app, {
        kind: 'custom',
        targetAccountId: (await account('100201')).id,
        targetCashflows: both,
        sources: [
          { accountId: (await account('1001')).id, mode: 'balance', ratio: '100', cashflows: both },
        ],
      }),
    });
    const { result } = await generateAll(app);
    const voucher = (await app.svc.vouchers.get(result.generated[0]!.id))!;
    expect(voucher.lines).toHaveLength(2);
    expect(voucher.lines.every((l) => l.dimensions.cashflow === internal.id)).toBe(true);
    expect(voucher.lines.reduce((n, l) => n + l.debit - l.credit, 0)).toBe(0);
    expect(voucher.status).toBe('pending');
  },
);
it.each(['4103', '100201'])(
  'w_zw_ydjz：M03 internal：单边内部流出不能靠 %s 的非内部行配平，失败不写库',
  async (code) => {
    const api = call(app);
    const internal = await app.svc.dimensions.create({
      type: 'cashflow',
      code: 'M03_INTERNAL',
      name: '内部转移',
      attrs: { cashflowDirection: 'internal' },
    });
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 100 },
          { account: '4001', credit: 100 },
        ],
      },
    ]);
    await api.saveRule({
      data: await rule(app, {
        kind: 'custom',
        targetAccountId: (await account(code)).id,
        targetCashflows: code === '100201' ? { in: (await choices()).in } : undefined,
        sources: [
          {
            accountId: (await account('1001')).id,
            mode: 'balance',
            ratio: '100',
            cashflows: { out: internal.id },
          },
        ],
      }),
    });
    const before = snapshot(app);
    const err = await errorData(
      api.generate({ period: 202601, ruleIds: [1], previewToken: 'not-used', confirmed: true }),
    );
    expect(err.code).toBe('PERIOD_CLOSE_CASHFLOW_INTERNAL_UNBALANCED');
    expect(err.message).toContain('差额 -100 分');
    expect(snapshot(app)).toBe(before);
  },
);
it('w_zw_ydjz：M03历史未知项目：已有合法预览后方向变未知，当前生成重新核验并整体不变', async () => {
  const api = call(app);
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '6603', debit: 100 },
        { account: '4001', credit: 100 },
      ],
    },
  ]);
  const flows = await choices();
  await api.saveRule({ data: await targetRule('1001', { in: flows.in }) });
  const preview = await api.preview({ period: 202601, ruleIds: [1] });
  await app.svc.db
    .updateTable('dimension_item')
    .set({ attrs: JSON.stringify({ direction: 'in' }) })
    .where('id', '=', flows.in)
    .execute();
  const before = snapshot(app);
  expect(
    (
      await errorData(
        api.generate({
          period: 202601,
          ruleIds: [1],
          previewToken: preview.previewToken,
          confirmed: true,
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_CASHFLOW_UNKNOWN_DIRECTION');
  expect(snapshot(app)).toBe(before);
  expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
});

it('M03档案合法方向变化也须重新预览，不能沿用旧预览确认新的internal语义', async () => {
  const api = call(app);
  const incoming = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'NEW_IN',
    name: '新流入项目',
    attrs: { cashflowDirection: 'inflow' },
  });
  const outgoing = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'NEW_OUT',
    name: '新流出项目',
    attrs: { cashflowDirection: 'outflow' },
  });
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 100 },
        { account: '4001', credit: 100 },
      ],
    },
  ]);
  await api.saveRule({
    data: await rule(app, {
      kind: 'custom',
      targetAccountId: (await account('100201')).id,
      targetCashflows: { in: incoming.id },
      sources: [
        {
          accountId: (await account('1001')).id,
          mode: 'balance',
          ratio: '100',
          cashflows: { out: outgoing.id },
        },
      ],
    }),
  });
  const old = await api.preview({ period: 202601, ruleIds: [1] });
  expect(old.items[0]!.cashflowChecks.map((c) => c.direction)).toEqual(['outflow', 'inflow']);
  // 尚未生成凭证，模拟基础档案把这两个未引用项目明确设为内部转移。
  await app.svc.db
    .updateTable('dimension_item')
    .set({ attrs: JSON.stringify({ cashflowDirection: 'internal' }) })
    .where('id', 'in', [incoming.id, outgoing.id])
    .execute();
  const before = snapshot(app);
  expect(
    (
      await errorData(
        api.generate({
          period: 202601,
          ruleIds: [1],
          previewToken: old.previewToken,
          confirmed: true,
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_PREVIEW_CHANGED');
  expect(snapshot(app)).toBe(before);
  const current = await api.preview({ period: 202601, ruleIds: [1] });
  expect(current.items[0]!.cashflowChecks.map((c) => c.direction)).toEqual([
    'internal',
    'internal',
  ]);
  expect(
    (
      await api.generate({
        period: 202601,
        ruleIds: [1],
        previewToken: current.previewToken,
        confirmed: true,
      })
    ).generated,
  ).toHaveLength(1);
});
