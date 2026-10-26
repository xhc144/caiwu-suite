import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { call, errorData, generateAll, rule, snapshot, zeroOpening } from './helpers';
import type { Cashflows } from '../shared';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
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
    attrs: { direction: 'out' },
  });
  expect(
    (await errorData(api.saveRule({ data: await targetRule('1001', { in: declared.id }) }))).code,
  ).toBe('PERIOD_CLOSE_CASHFLOW_DIRECTION');
  const unknown = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'X_UNKNOWN',
    name: '方向未识别',
    attrs: { direction: 'legacy-unknown' },
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
