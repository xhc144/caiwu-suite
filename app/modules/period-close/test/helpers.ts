import { expect } from 'vitest';
import type { TRPCError } from '@trpc/server';
import type { BusinessError } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { seedVouchers, type TestApp } from '@caiwu/testkit';
import type { RuleInput } from '../shared';
import periodCloseServer from '../server';

export const call = (app: TestApp, token?: string) => app.call(periodCloseServer, token);
export async function zeroOpening(app: TestApp) {
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('1001')).id,
    balance: 0,
  });
}
export async function rule(app: TestApp, extra: Partial<RuleInput> = {}) {
  return {
    code: 'PNL',
    name: '损益结转',
    kind: 'pnl',
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
    summary: '结转本期损益',
    order: 1,
    enabled: true,
    targetAccountId: (await app.svc.accounts.require('4103')).id,
    sources: [],
    ...extra,
  } satisfies RuleInput;
}
export async function audited(app: TestApp, period = 202601, amount = 10000) {
  await app.addUser('maker', { password: 'maker' });
  await app.addUser('reviewer', { password: 'reviewer' });
  const db = app.runtime.bookStore.open(app.book.id).db;
  const user = await db
    .selectFrom('app_user')
    .select('id')
    .where('code', '=', 'maker')
    .executeTakeFirstOrThrow();
  const reviewer = await db
    .selectFrom('app_user')
    .select('id')
    .where('code', '=', 'reviewer')
    .executeTakeFirstOrThrow();
  const make = (id: number) =>
    loadServiceUser(db, id).then((user) => createCoreServices({ ...app.svc.ctx, user: user! }));
  const makerSvc = await make(user.id);
  const reviewerSvc = await make(reviewer.id);
  const date = `${Math.trunc(period / 100)}-${String(period % 100).padStart(2, '0')}-05`;
  const [v] = await seedVouchers(makerSvc, [
    {
      date,
      lines: [
        { account: '1001', debit: amount },
        { account: '6001', credit: amount },
      ],
    },
  ]);
  await reviewerSvc.vouchers.changeStatus({ ids: [v!.id], to: 'audited' });
  return { voucher: v!, reviewerSvc, makerSvc };
}
export async function errorData(promise: Promise<unknown>) {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as TRPCError | null;
  expect(error).not.toBeNull();
  return (error!.cause as BusinessError).data;
}
export function snapshot(app: TestApp) {
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  const names = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return JSON.stringify(
    names.map(({ name }) => [
      name,
      raw.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all(),
    ]),
  );
}
export async function generateAll(app: TestApp, period = 202601) {
  const api = call(app);
  const ruleIds = (await api.rules()).filter((r) => r.enabled).map((r) => r.id);
  const preview = await api.preview({ period, ruleIds });
  const input = { period, ruleIds, previewToken: preview.previewToken, confirmed: true };
  return { result: await api.generate(input), input, preview };
}

/** 测试夹具按 M03 的真实持久化字段设置已知方向；生产不补写历史项目。 */
export async function seedCashflowDirections(app: TestApp) {
  for (const [code, direction] of [
    ['CF01', 'inflow'],
    ['CF02', 'outflow'],
  ] as const) {
    const item = (await app.svc.dimensions.getByCode('cashflow', code))!;
    await app.svc.db
      .updateTable('dimension_item')
      .set({ attrs: JSON.stringify({ ...item.attrs, cashflowDirection: direction }) })
      .where('id', '=', item.id)
      .execute();
  }
}
