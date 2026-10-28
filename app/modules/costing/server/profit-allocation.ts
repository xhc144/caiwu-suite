import {
  Decimal,
  DIMENSION_TYPE_IDS,
  periodEndDate,
  sumCents,
  type VoucherLineInput,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import {
  ProfitConfigSchema,
  ProfitTransferSchema,
  ProfitTransferDeleteSchema,
} from '../production-shared';
import { accountBalances, requireCostAccount } from './cost-accounts';
import { digest } from './inventory-read';
import { fail } from './math';
import type { CostingTables } from './migrations';
import { requireCostingOwner } from './owner';

export async function profitConfig(svc: CoreServices, period: number) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.view');
  return (
    (await svc.db
      .withTables<CostingTables>()
      .selectFrom('costing_profit_config')
      .selectAll()
      .where('period', '=', period)
      .executeTakeFirst()) ?? null
  );
}
export async function saveProfitConfig(svc: CoreServices, raw: z.input<typeof ProfitConfigSchema>) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.voucher');
  const input = ProfitConfigSchema.parse(raw);
  return svc.tx(async (t) => {
    await t.periods.assertWritable({ period: input.period, action: '设置销售费用及税金归集' });
    if (
      new Set([input.expenseAccountId, input.surchargeAccountId, input.profitAccountId]).size !== 3
    )
      fail('ACCOUNT', '销售费用、税金及本年利润必须分别选择不同科目');
    const categories = await t.accounts.categories();
    for (const id of [input.expenseAccountId, input.surchargeAccountId]) {
      const account = await requireCostAccount(t, id, '费用税金');
      if (
        !categories.find((c) => c.id === account.categoryId)?.isPnl ||
        account.direction !== 'debit'
      )
        fail('ACCOUNT', '销售费用和税金归集必须选择损益类科目，不能使用销项税科目');
    }
    const target = await requireCostAccount(t, input.profitAccountId, '本年利润');
    if (target.categoryId !== 'equity') fail('ACCOUNT', '利润结转目标必须是权益类明细科目');
    const db = t.db.withTables<CostingTables>();
    const old = await db
      .selectFrom('costing_profit_config')
      .selectAll()
      .where('period', '=', input.period)
      .executeTakeFirst();
    if ((old?.revision ?? 0) !== input.revision)
      fail('REVISION', '归集设置版本已变化，请刷新后再保存');
    if (old?.voucher_id) fail('VOUCHER_LOCK', '本月已生成利润结转凭证，请先取消结转再修改设置');
    const value = {
      period: input.period,
      expense_account_id: input.expenseAccountId,
      surcharge_account_id: input.surchargeAccountId,
      profit_account_id: input.profitAccountId,
      revision: input.revision + 1,
      voucher_id: null,
    };
    await db
      .insertInto('costing_profit_config')
      .values(value)
      .onConflict((oc) => oc.column('period').doUpdateSet(value))
      .execute();
    await t.log.write({
      action: 'costing.profit.configure',
      summary: `设置 ${input.period} 销售费用及税金归集`,
    });
    return value;
  });
}

/** 费用、附加税取当期净发生；已生成的损益结转不改变经营分析金额。 */
export async function salesExpenses(svc: CoreServices, period: number) {
  const config = await profitConfig(svc, period);
  if (!config) return null;
  const rows = await accountBalances(
    svc,
    [config.expense_account_id, config.surcharge_account_id],
    period,
    true,
  );
  const amount = (id: number) =>
    sumCents(rows.filter((r) => r.accountId === id).flatMap((r) => [r.debit, -r.credit]));
  return {
    expenseCents: amount(config.expense_account_id),
    surchargeCents: amount(config.surcharge_account_id),
  };
}

async function transfer(svc: CoreServices, period: number) {
  await svc.periods.assertWritable({ period, action: '结转净利润' });
  const config = await profitConfig(svc, period);
  if (!config) fail('PROFIT_CONFIG', '请先保存本月费用税金及本年利润科目设置');
  if (config.voucher_id) fail('DUPLICATE', '本月已有利润结转凭证，请先查看或取消');
  const target = await requireCostAccount(svc, config.profit_account_id, '本年利润');
  if (target.categoryId !== 'equity') fail('ACCOUNT', '本年利润科目已改变，请重新检查归集设置');
  const pnlCategories = (await svc.accounts.categories()).filter((c) => c.isPnl).map((c) => c.id);
  const accounts = (await svc.accounts.list()).filter(
    (a) =>
      a.isLeaf &&
      pnlCategories.includes(a.categoryId) &&
      (a.closingRule == null || a.closingRule === 'profit'),
  );
  if (!accounts.length) fail('EMPTY', '当前账套没有可结转的损益明细科目');
  const balances = await svc.ledger.balances({
    periodFrom: period,
    periodTo: period,
    accountCodes: accounts.map((a) => a.code),
    groupBy: [...DIMENSION_TYPE_IDS],
    rollup: false,
    includeUnposted: true,
    includeZero: true,
  });
  const sourceIds = new Set(accounts.map((a) => a.id));
  const currencyBalances = new Map<string, (typeof balances)[number]>();
  for (const currency of new Set(accounts.map((a) => a.currency).filter((c): c is string => !!c))) {
    const rows = await svc.ledger.balances({
      periodFrom: period,
      periodTo: period,
      accountCodes: accounts.filter((a) => a.currency === currency).map((a) => a.code),
      currency,
      groupBy: [...DIMENSION_TYPE_IDS],
      rollup: false,
      includeUnposted: true,
      includeZero: true,
    });
    for (const row of rows)
      currencyBalances.set(`${row.accountId}:${JSON.stringify(row.dimensions)}`, row);
  }
  const closing = balances
    .filter((r) => sourceIds.has(r.accountId))
    .map((r) => {
      const account = accounts.find((a) => a.id === r.accountId)!;
      if (!account.currency) return r;
      const foreign = currencyBalances.get(`${r.accountId}:${JSON.stringify(r.dimensions)}`);
      if ((foreign?.closing ?? 0) !== r.closing)
        fail('CURRENCY', '损益科目存在与当前币种不符的余额，请先核对外币来源');
      return { ...r, fcClosing: foreign?.fcClosing ?? 0 };
    })
    .filter((r) => r.closing !== 0 || r.fcClosing !== 0 || !new Decimal(r.qtyClosing).isZero());
  const lines: VoucherLineInput[] = [];
  for (const row of closing) {
    const account = accounts.find((a) => a.id === row.accountId)!;
    if (account.disabled) fail('ACCOUNT', `损益科目 ${account.code} 已停用，请先核对并启用`);
    const sign =
      row.closing !== 0
        ? row.closing > 0
          ? 1
          : -1
        : row.fcClosing !== 0
          ? row.fcClosing > 0
            ? 1
            : -1
          : new Decimal(row.qtyClosing).isPositive()
            ? 1
            : -1;
    const side = sign > 0 ? 'credit' : 'debit';
    let exchangeRate: string | undefined;
    if (account.currency) {
      const rate =
        row.closing && row.fcClosing
          ? new Decimal(row.closing).div(row.fcClosing).abs().toFixed(12)
          : await svc.reference.exchangeRate(account.currency, period);
      if (!rate || !new Decimal(rate).isPositive())
        fail('CURRENCY', `损益科目 ${account.code} 缺少可用汇率`);
      exchangeRate = rate;
    }
    lines.push({
      summary: '结转当期损益',
      accountId: row.accountId,
      dimensions: row.dimensions,
      entrySide: side,
      [side]: Math.abs(row.closing),
      ...(account.currency
        ? { currency: account.currency, exchangeRate, fcAmount: row.fcClosing * sign }
        : {}),
      ...(account.quantityUnit
        ? { quantity: new Decimal(row.qtyClosing).mul(sign).toFixed() }
        : {}),
    });
  }
  const netProfitCents = sumCents(closing.map((r) => -r.closing));
  const dimensions: NonNullable<VoucherLineInput['dimensions']> = {};
  for (const d of target.dimensions) {
    if (d.required && !d.defaultItemId) fail('DIMENSION', '本年利润科目缺少默认辅助核算项');
    if (d.defaultItemId) dimensions[d.type] = d.defaultItemId;
  }
  if (netProfitCents)
    lines.push({
      summary: '结转净利润',
      accountId: target.id,
      dimensions,
      ...(netProfitCents > 0 ? { credit: netProfitCents } : { debit: -netProfitCents }),
    });
  if (!lines.length) fail('EMPTY', '本月没有待结转的损益余额');
  if (lines.length > 999) fail('LINES', '损益辅助项目过多，超过单张凭证容量');
  return {
    period,
    netProfitCents,
    lines,
    fingerprint: digest({ period, config, balances, target, lines }),
  };
}
export async function previewProfitTransfer(svc: CoreServices, period: number) {
  svc.permissions.require('costing.voucher');
  return svc.tx((t) => transfer(t, period));
}
export async function generateProfitTransfer(
  svc: CoreServices,
  raw: z.input<typeof ProfitTransferSchema>,
) {
  svc.permissions.require('costing.voucher');
  const input = ProfitTransferSchema.parse(raw);
  if (!input.confirmed) fail('CONFIRM', '请核对损益结转分录后确认');
  return svc.tx(async (t) => {
    const preview = await transfer(t, input.period);
    if (preview.fingerprint !== input.fingerprint)
      fail('STALE', '损益余额或科目已变化，请重新预览');
    const voucher = await t.vouchers.create({
      voucherTypeId: input.voucherTypeId,
      number: input.number,
      date: periodEndDate(input.period),
      source: { type: 'profit', id: String(input.period) },
      closingKind: 'pnl',
      lines: preview.lines,
    });
    const db = t.db.withTables<CostingTables>();
    await db
      .updateTable('costing_profit_config')
      .set((eb) => ({ voucher_id: voucher.id, revision: eb('revision', '+', 1) }))
      .where('period', '=', input.period)
      .execute();
    await t.log.write({
      action: 'costing.profit.transfer',
      summary: `结转 ${input.period} 损益 ${voucher.displayNo}`,
      targetId: voucher.id,
    });
    return voucher;
  });
}
async function deletionState(svc: CoreServices, period: number) {
  const config = await profitConfig(svc, period);
  if (!config?.voucher_id) fail('NOT_FOUND', '本月没有成本功能生成的利润结转凭证');
  await svc.periods.assertWritable({ period, action: '取消净利润结转' });
  const voucher = await svc.vouchers.get(config.voucher_id);
  if (
    !voucher ||
    voucher.source?.module !== 'costing' ||
    voucher.source.type !== 'profit' ||
    voucher.source.id !== String(period)
  )
    fail('SOURCE', '利润结转来源关联不一致');
  return config;
}
export async function previewDeleteProfitTransfer(svc: CoreServices, period: number) {
  svc.permissions.require('costing.voucher');
  return svc.tx(async (t) => {
    const config = await deletionState(t, period);
    return t.vouchers.previewDelete([config.voucher_id!]);
  });
}
export async function deleteProfitTransfer(
  svc: CoreServices,
  raw: z.input<typeof ProfitTransferDeleteSchema>,
) {
  svc.permissions.require('costing.voucher');
  const input = ProfitTransferDeleteSchema.parse(raw);
  if (!input.confirmed || !input.voucherDeletion?.confirmed)
    fail('CONFIRM', '请先核对取消结转的编号影响');
  return svc.tx(async (t) => {
    const config = await deletionState(t, input.period);
    const deletion = input.voucherDeletion!;
    if (deletion.plan.ids.length !== 1 || deletion.plan.ids[0] !== config.voucher_id)
      fail('STALE', '取消预览与结转凭证不一致');
    await t.db
      .withTables<CostingTables>()
      .updateTable('costing_profit_config')
      .set((eb) => ({ voucher_id: null, revision: eb('revision', '+', 1) }))
      .where('period', '=', input.period)
      .execute();
    await t.vouchers.deleteBatch(deletion.plan, true);
    await t.log.write({
      action: 'costing.profit.cancel',
      summary: `取消 ${input.period} 净利润结转`,
      targetId: config.voucher_id!,
    });
    return { period: input.period };
  });
}
