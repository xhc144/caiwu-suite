import { sumMoney as sumCents } from './amounts';
import {
  BusinessError,
  Decimal,
  assertCents,
  DIMENSION_TYPES,
  periodEndDate,
  periodYear,
  qtyFromE6,
  VOUCHER_STATUS_LABELS,
  type Account,
  type VoucherHeader,
  type VoucherLineInput,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { requireOpening } from './preconditions';
import {
  RuleSchema,
  requiresCashflow,
  type TransferRule,
  type RuleInput,
  type Cashflows,
} from '../shared';
import { validateCashflows, cashflowForLine, validateGeneratedCashflows } from './cashflows';
import type { PeriodCloseTables } from './migrations';
import { applyLines, canonicalBuckets, closingBuckets, digest, type Bucket } from './buckets';

export const tables = (svc: CoreServices) => svc.db.withTables<PeriodCloseTables>();
export function fail(
  code: string,
  message: string,
  hint = '处理后刷新期间检查，再重试',
  period?: number,
  details?: Record<string, unknown>,
): never {
  throw new BusinessError({
    code: `PERIOD_CLOSE_${code}`,
    message,
    hint,
    actions: [
      { label: '去处理', to: period ? `/m/voucher-book?period=${period}` : '/m/period-close' },
    ],
    details,
  });
}
export async function allVouchers(svc: CoreServices, from?: number, to?: number) {
  const out: VoucherHeader[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await svc.vouchers.list({
      periodFrom: from,
      periodTo: to,
      includeVoided: true,
      limit: 1000,
      offset,
    });
    out.push(...page.items);
    if (out.length >= page.total) return out;
    if (!page.items.length) throw new Error('凭证分页读取中断');
  }
}
export async function rules(svc: CoreServices): Promise<TransferRule[]> {
  return (await tables(svc).selectFrom('period_close_rule').selectAll().execute())
    .map((r) => ({ ...RuleSchema.parse(JSON.parse(r.definition)), id: r.id, revision: r.revision }))
    .sort((a, b) => a.order - b.order || a.id - b.id);
}
export const runs = (svc: CoreServices) =>
  tables(svc).selectFrom('period_close_run').selectAll().orderBy('period').execute();
export async function noLaterRun(svc: CoreServices, period: number) {
  const later = (await runs(svc)).filter((r) => r.period > period);
  if (later.length)
    fail(
      'LATER_TRANSFER',
      `后期 ${[...new Set(later.map((r) => r.period))].join('、')} 已有结转，不能改变 ${period} 的结转基数`,
      '按从后到前的顺序反过账、取消审核并删除后期结转凭证，再处理本期',
      period,
      { voucherIds: later.map((r) => r.voucher_id) },
    );
  const yearEnd = await tables(svc)
    .selectFrom('period_close_year')
    .selectAll()
    .where('source_year', '>=', periodYear(period))
    .execute();
  if (yearEnd.length)
    fail(
      'YEAR_SNAPSHOT',
      '该年度已年结，后年度期初依赖当前余额',
      '先在本页预览、在线备份并确认撤销最近年结，勿直接删除派生期初',
      period,
      { years: yearEnd.map((r) => r.target_year) },
    );
}
export async function validateRule(svc: CoreServices, raw: RuleInput) {
  const r = RuleSchema.parse(raw);
  const type = (await svc.reference.voucherTypes()).find(
    (t) => t.id === r.voucherTypeId && !t.disabled,
  );
  if (!type) fail('TYPE_REQUIRED', '凭证类型不得为空或停用', '选择当前账套可用的凭证类型');
  const target = await svc.accounts.require(r.targetAccountId);
  if (!target.isLeaf || target.disabled)
    fail('TARGET_LEAF', '转入必须且只能是一个启用的末级科目', '重新选择转入科目');
  const conversion = r.targetConversion;
  if (conversion) {
    if (
      (conversion.currency != null || conversion.exchangeRate != null) &&
      (!target.currency || conversion.currency !== target.currency || !conversion.exchangeRate)
    )
      fail(
        'TARGET_CONVERSION',
        '转入汇率与当前科目币种不匹配',
        '重新选择转入科目并填写对应币种汇率',
      );
    if (
      (conversion.quantityUnit != null || conversion.unitPrice != null) &&
      (!target.quantityUnit ||
        conversion.quantityUnit !== target.quantityUnit ||
        !conversion.unitPrice)
    )
      fail(
        'TARGET_CONVERSION',
        '转入单价与当前科目计量单位不匹配',
        '重新选择转入科目并填写本币单价',
      );
    for (const [label, value] of [
      ['汇率', conversion.exchangeRate],
      ['本币单价', conversion.unitPrice],
    ] as const)
      if (value != null && !new Decimal(value).gt(0))
        fail('TARGET_CONVERSION', `转入${label}必须大于零`, '填写正的十进制数，重新预览后确认');
  }
  const accounts = await svc.accounts.list();
  const pnl = new Set((await svc.accounts.categories()).filter((c) => c.isPnl).map((c) => c.id));
  if (r.kind === 'pnl' && pnl.has(target.categoryId))
    fail('TARGET_PNL', '损益转入科目不能仍属损益类', '按当前制度显式选择利润或结余末级科目');
  const sourceIds: number[] = [];
  const sourceRatios = new Map<number, string>();
  if (r.kind === 'pnl') {
    for (const a of accounts.filter((a) => a.isLeaf && pnl.has(a.categoryId))) {
      sourceIds.push(a.id);
      sourceRatios.set(a.id, '100');
    }
  } else {
    for (const source of r.sources) {
      const parent = await svc.accounts.require(source.accountId);
      if (parent.disabled)
        fail('SOURCE_DISABLED', `转出科目 ${parent.code} 已停用`, '选择启用科目');
      const leaves = accounts.filter(
        (a) => a.isLeaf && (a.id === parent.id || a.code.startsWith(parent.code)),
      );
      for (const a of leaves) {
        sourceIds.push(a.id);
        sourceRatios.set(a.id, source.ratio);
      }
    }
  }
  if (!sourceIds.length)
    fail('SOURCE_REQUIRED', '转出科目至少需要一个', '增加转出科目，或核对当前制度的损益类别');
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.includes(target.id))
    fail(
      'DUPLICATE_ACCOUNT',
      '转出重复、父子转出范围重叠，或转入与转出科目重合',
      '每个末级科目只能属于一个转出范围，并排除转入科目',
    );
  for (const s of r.sources)
    if (new Decimal(s.ratio).lt(0) || new Decimal(s.ratio).gt(100))
      fail('RATIO', '转出比例应在 0 到 100 之间', '用十进制字符串填写百分比');
  await validateCashflows(svc, target, r.targetCashflows, '转入');
  if (r.targetDimensions.cashflow != null && !r.targetCashflows)
    fail(
      'CASHFLOW_DIRECTION',
      '转入现金流量项目尚未明确流入/流出方向',
      '请在转入流入/流出现金流量字段选择项目，不自动猜测旧辅助字段方向',
    );
  const sourceCashflows = new Map<number, Cashflows | undefined>();
  for (const accountId of sourceIds) {
    const account = accounts.find((a) => a.id === accountId)!;
    const matches = r.sources.filter((s) => {
      const parent = accounts.find((a) => a.id === s.accountId);
      return parent && (account.id === parent.id || account.code.startsWith(parent.code));
    });
    if (matches.length > 1)
      fail('DUPLICATE_ACCOUNT', '转出现金流设置范围重叠', '每个末级科目只设置一组现金流项目');
    const choice = matches[0]?.cashflows;
    await validateCashflows(svc, account, choice, '转出');
    sourceCashflows.set(accountId, choice);
  }
  for (const d of DIMENSION_TYPES) {
    const config = target.dimensions.find((c) => c.type === d.id);
    const id = r.targetDimensions[d.id] ?? config?.defaultItemId;
    if (d.id !== 'cashflow' && config?.required && id == null)
      fail('TARGET_DIMENSION', `转入科目需要填写${d.name}`, '在结转设置填写转入辅助项');
    if (id != null) {
      const item = await svc.dimensions.get(id);
      if (
        !item ||
        item.typeId !== d.id ||
        !item.isLeaf ||
        item.disabled ||
        (d.id !== 'cashflow' && !config)
      )
        fail('TARGET_DIMENSION', `转入${d.name}无效`, '重新选择转入辅助项');
    }
  }
  return { rule: r, sourceIds, sourceRatios, sourceCashflows, accounts, target };
}
export async function saveRule(svc: CoreServices, raw: RuleInput, id?: number, revision?: number) {
  return svc.tx(async (t) => {
    const { rule } = await validateRule(t, raw);
    const list = await rules(t);
    if (id && !list.some((r) => r.id === id && r.revision === revision))
      fail('STALE', '结转设置已变化', '刷新后重新编辑');
    if (
      list.some(
        (r) => r.id !== id && (r.code === rule.code || (r.kind === 'pnl' && rule.kind === 'pnl')),
      )
    )
      fail('RULE_EXISTS', '结转代码或损益类型重复', '每个账套只保留一个损益结转定义');
    if (list.some((r) => r.id !== id && r.order === rule.order))
      fail('ORDER_EXISTS', '执行顺序重复', '为每个结转类型指定不同的执行顺序');
    if (id && (await runs(t)).some((r) => r.rule_id === id))
      fail(
        'RULE_USED',
        '该类型已生成凭证，不能修改或停用',
        '先按从后到前的顺序合法撤销并删除该类型生成的凭证',
      );
    if (id)
      await tables(t)
        .updateTable('period_close_rule')
        .set({ code: rule.code, definition: JSON.stringify(rule), revision: (revision ?? 0) + 1 })
        .where('id', '=', id)
        .execute();
    else
      await tables(t)
        .insertInto('period_close_rule')
        .values({ code: rule.code, definition: JSON.stringify(rule), revision: 1 })
        .execute();
    await t.log.write({ action: 'period-close.rule.save', summary: `保存结转类型 ${rule.code}` });
  });
}
export async function removeRule(svc: CoreServices, id: number) {
  return svc.tx(async (t) => {
    if ((await runs(t)).some((r) => r.rule_id === id))
      fail('RULE_USED', '该类型已生成凭证，不能删除', '先合法撤销并删除来源凭证');
    await tables(t).deleteFrom('period_close_rule').where('id', '=', id).execute();
    await t.log.write({ action: 'period-close.rule.remove', summary: `删除结转类型 ${id}` });
  });
}
function makeLines(
  buckets: Map<string, Bucket>,
  rule: TransferRule,
  sourceIds: number[],
  target: Account,
  sourceRatios: Map<number, string>,
  accounts: Account[],
  rates: Map<string, string | null>,
  sourceCashflows: Map<number, Cashflows | undefined>,
) {
  const lines: VoucherLineInput[] = [];
  let targetAmount = 0;
  for (const b of buckets.values()) {
    if (!sourceIds.includes(b.accountId)) continue;
    const ratio = sourceRatios.get(b.accountId)!;
    const portion = (n: number) =>
      assertCents(new Decimal(n).mul(ratio).div(100).toDecimalPlaces(0).toNumber());
    const amount = portion(b.amount);
    const fc = portion(b.fc);
    const qty = portion(b.qty);
    if (!amount) {
      if (fc || qty)
        fail(
          'ZERO_AUXILIARY',
          '转出本币金额为零但外币或数量非零，不能生成零金额分录',
          '先处理该科目的外币/数量差额',
        );
      continue;
    }
    const account = accounts.find((a) => a.id === b.accountId)!;
    if (account.disabled)
      fail(
        'SOURCE_DISABLED',
        `转出科目 ${account.code} 有余额但已停用`,
        '先核对并启用该科目后再结转',
      );
    if (account.currency !== b.currency)
      fail(
        'SOURCE_CURRENCY',
        `转出科目 ${account.code} 的余额币种与科目设置不一致`,
        '核对该科目的期初币种，不会自动合并或改写币种',
      );
    for (const config of account.dimensions)
      if (config.type !== 'cashflow' && config.required && b.dimensions[config.type] == null)
        fail(
          'SOURCE_DIMENSION',
          `转出科目 ${account.code} 的余额缺少必填辅助项`,
          '先修正期初辅助桶，不会用默认项覆盖未知的余额桶',
        );
    const side = amount < 0 ? 1 : -1;
    lines.push({
      summary: rule.summary,
      accountId: b.accountId,
      dimensions: {
        ...b.dimensions,
        cashflow: cashflowForLine(account, sourceCashflows.get(b.accountId), -amount, '转出'),
      },
      debit: amount < 0 ? -amount : 0,
      credit: amount > 0 ? amount : 0,
      currency: b.currency,
      exchangeRate: b.currency
        ? fc
          ? new Decimal(Math.abs(amount)).div(Math.abs(fc)).toFixed(12)
          : (rates.get(b.currency) ??
            fail(
              'FX_RATE_REQUIRED',
              `科目 ${account.code} 有本币余额但外币为零，且未设置汇率`,
              '先设置该币种本期适用汇率，再重新预览',
            ))
        : undefined,
      fcAmount: b.currency ? assertCents(-fc * side) : undefined,
      quantity: qtyFromE6(-qty * side),
    });
    targetAmount = sumCents([targetAmount, amount]);
  }
  if (targetAmount) {
    const conversion = rule.targetConversion;
    if (
      (target.currency && !conversion?.exchangeRate) ||
      (target.quantityUnit && !conversion?.unitPrice)
    )
      fail(
        'TARGET_SEMANTICS',
        '转入科目启用了外币或数量，但尚未填写显式换算设置',
        '编辑结转类型，填写转入币种汇率及本币单价，重新预览；不会沿用转出科目的外币或数量',
      );
    const magnitude = new Decimal(targetAmount).abs();
    const scaledInteger = (value: Decimal, label: string) => {
      const integer = value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
      if (!Number.isSafeInteger(integer))
        fail('TARGET_RANGE', `转入${label}超出安全整数范围`, '核对转入汇率和本币单价后重新预览');
      return integer;
    };
    const fcAmount = target.currency
      ? scaledInteger(magnitude.div(conversion!.exchangeRate!), '外币金额')
      : undefined;
    const quantity = target.quantityUnit
      ? qtyFromE6(scaledInteger(magnitude.mul(10000).div(conversion!.unitPrice!), '数量'))
      : undefined;
    const dimensions = { ...rule.targetDimensions };
    for (const d of target.dimensions)
      if (d.type !== 'cashflow') dimensions[d.type] ??= d.defaultItemId;
    if (requiresCashflow(target) || rule.targetCashflows)
      dimensions.cashflow = cashflowForLine(target, rule.targetCashflows, targetAmount, '转入');
    lines.push({
      summary: rule.summary,
      accountId: target.id,
      dimensions,
      debit: targetAmount > 0 ? targetAmount : 0,
      credit: targetAmount < 0 ? -targetAmount : 0,
      currency: target.currency,
      exchangeRate: target.currency ? conversion!.exchangeRate : undefined,
      fcAmount,
      quantity,
      unitPrice: target.quantityUnit ? conversion!.unitPrice : undefined,
    });
  }
  return lines;
}
export async function transferPreview(
  svc: CoreServices,
  period: number,
  ruleIds: number[],
  allowPendingExisting = true,
) {
  return calculateTransferPreview(svc, period, ruleIds, allowPendingExisting, 'prepare-generation');
}

async function calculateTransferPreview(
  svc: CoreServices,
  period: number,
  ruleIds: number[],
  allowPendingExisting: boolean,
  purpose: 'prepare-generation' | 'verify-existing',
) {
  if (!ruleIds.length) fail('NO_SELECTION', '请选择需要结转的内容', '在结转列表勾选后重新预览');
  if (new Set(ruleIds).size !== ruleIds.length) fail('NO_SELECTION', '结转类型不能重复选择');
  await svc.periods.assertOpen(period, '月度结转');
  await requireOpening(svc, periodYear(period));
  // 生成/重算会影响后月基数；只读核验已有快照不会改变基数。
  if (purpose === 'prepare-generation') await noLaterRun(svc, period);
  const allRules = await rules(svc);
  const selected = allRules.filter((r) => ruleIds.includes(r.id));
  if (selected.length !== ruleIds.length || selected.some((r) => !r.enabled))
    fail('RULE_DISABLED', '所选类型不存在或已停用', '重新选择启用的类型');
  const existing = (await runs(svc)).filter((r) => r.period === period);
  const vouchers = await allVouchers(svc, period, period);
  const unposted = vouchers.filter(
    (v) => !v.voided && v.status !== 'draft' && v.status !== 'posted',
  );
  const selectedExisting = existing.filter((r) => ruleIds.includes(r.rule_id));
  if (purpose === 'verify-existing' && selectedExisting.length !== selected.length)
    fail('SOURCE_MISMATCH', '只读核验缺少对应的已生成结转快照', '保留数据并检查来源关联', period);
  if (
    unposted.some(
      (v) => !allowPendingExisting || !selectedExisting.some((r) => r.voucher_id === v.id),
    ) ||
    (unposted.length && selectedExisting.length !== selected.length)
  )
    fail(
      'UNPOSTED',
      `本月还有 ${unposted.length} 张有效正式凭证未过账，不能自动结转`,
      '先由其他操作员审核并过账；草稿仅警示，不会自动转正式',
      period,
      { vouchers: unposted.map((v) => ({ id: v.id, displayNo: v.displayNo, status: v.status })) },
    );
  const buckets = await closingBuckets(
    svc,
    period,
    existing.map((r) => r.voucher_id),
    false,
  );
  const rates = new Map<string, string | null>();
  for (const currency of new Set(
    [...buckets.values()].map((b) => b.currency).filter((c): c is string => c != null),
  ))
    rates.set(currency, await svc.reference.exchangeRate(currency, period));
  const output = [];
  for (const rule of allRules.filter(
    (r) => selected.some((s) => s.id === r.id) || existing.some((e) => e.rule_id === r.id),
  )) {
    const validated = await validateRule(svc, rule);
    const lines = makeLines(
      buckets,
      rule,
      validated.sourceIds,
      validated.target,
      validated.sourceRatios,
      validated.accounts,
      rates,
      validated.sourceCashflows,
    );
    const cashflowChecks = await validateGeneratedCashflows(svc, lines, validated.accounts);
    const basisData: unknown[] = [
      canonicalBuckets(buckets),
      RuleSchema.parse(rule),
      [...rates].sort(),
    ];
    if (cashflowChecks.length) basisData.push(cashflowChecks);
    const basis = digest(basisData);
    const prior = existing.find((r) => r.rule_id === rule.id);
    if (
      prior &&
      (prior.basis !== basis || prior.definition !== JSON.stringify(RuleSchema.parse(rule)))
    )
      fail(
        'STALE_TRANSFER',
        `结转 ${rule.code} 的基数或设置已经变化`,
        '先反过账、取消审核并删除受影响结转，再重新预览生成',
        period,
      );
    if (selected.some((r) => r.id === rule.id))
      output.push({
        ruleId: rule.id,
        code: rule.code,
        name: rule.name,
        order: rule.order,
        basis,
        lines,
        cashflowChecks,
        existingVoucherId: prior?.voucher_id ?? null,
        zero: !lines.length,
        debit: sumCents(lines.map((l) => l.debit)),
        credit: sumCents(lines.map((l) => l.credit)),
      });
    applyLines(buckets, lines, false);
  }
  return {
    period,
    items: output,
    previewToken: digest(output),
    drafts: vouchers
      .filter((v) => v.status === 'draft' && !v.voided)
      .map((v) => ({ id: v.id, displayNo: v.displayNo })),
    message: '按显示顺序依次更新基数；生成凭证为待审核，必须由其他操作员审核。',
  };
}
export async function verifyPostedRuns(svc: CoreServices, from: number, to: number) {
  for (const period of [
    ...new Set(
      (await runs(svc)).filter((r) => r.period >= from && r.period <= to).map((r) => r.period),
    ),
  ]) {
    const periodRuns = (await runs(svc)).filter((r) => r.period === period);
    const definitions = await rules(svc);
    const vouchers = await allVouchers(svc, period, period);
    let waiting = false;
    for (const row of periodRuns.toSorted(
      (a, b) =>
        definitions.find((r) => r.id === a.rule_id)!.order -
        definitions.find((r) => r.id === b.rule_id)!.order,
    )) {
      const voucher = vouchers.find((v) => v.id === row.voucher_id);
      if (
        !voucher ||
        voucher.voided ||
        voucher.source?.module !== 'period-close' ||
        voucher.source.type !== 'closing' ||
        voucher.source.id !== `${period}:${row.rule_id}`
      )
        fail('SOURCE_MISMATCH', '结转凭证来源关联无法核实', '保留数据并检查来源关联', period);
      if (voucher.status !== 'posted') waiting = true;
      else if (waiting)
        fail(
          'DEPENDENT_UNPOSTED',
          `结转 ${voucher.displayNo} 的前序结转尚未审核过账`,
          '先由其他操作员按执行顺序审核前序结转，再过账',
          period,
        );
    }
    const ids = periodRuns.map((r) => r.rule_id);
    // 只读重建并比较已有快照：保留来源、顺序和基数校验，允许后月已有结转。
    await calculateTransferPreview(svc, period, ids, true, 'verify-existing');
  }
}
export async function generate(
  svc: CoreServices,
  input: { period: number; ruleIds: number[]; confirmed: boolean; previewToken: string },
) {
  if (!input.confirmed) fail('CONFIRM', '请先确认结转顺序和分录预览', '取消不会修改账套');
  return svc.tx(async (t) => {
    const preview = await transferPreview(t, input.period, input.ruleIds);
    if (
      preview.items.every((i) => i.existingVoucherId != null || i.zero) &&
      preview.items.some((i) => i.existingVoucherId != null)
    )
      return {
        generated: preview.items
          .filter((i) => i.existingVoucherId != null)
          .map((i) => ({ id: i.existingVoucherId!, existing: true })),
        message: '已生成结转凭证，本次未重复生成；请其他操作员审核后继续',
      };
    if (preview.previewToken !== input.previewToken)
      fail('PREVIEW_CHANGED', '预览已变化，请重新预览', '确认最新金额和顺序后再生成');
    const list = await rules(t);
    const generated = [];
    for (const item of preview.items) {
      if (item.existingVoucherId) {
        generated.push({ id: item.existingVoucherId, existing: true });
        continue;
      }
      if (item.zero) continue;
      const rule = list.find((r) => r.id === item.ruleId)!;
      const v = await t.vouchers.create({
        voucherTypeId: rule.voucherTypeId,
        date: periodEndDate(input.period),
        lines: item.lines,
        closingKind: rule.kind === 'pnl' ? 'pnl' : `period-close:${rule.code}`,
        source: { type: 'closing', id: `${input.period}:${rule.id}` },
      });
      await tables(t)
        .insertInto('period_close_run')
        .values({
          period: input.period,
          rule_id: rule.id,
          voucher_id: v.id,
          basis: item.basis,
          definition: JSON.stringify(RuleSchema.parse(rule)),
          created_at: t.ctx.now().toISOString(),
        })
        .execute();
      generated.push({ id: v.id, existing: false });
    }
    await t.log.write({
      action: 'period-close.transfer.generate',
      summary: `${input.period} 结转生成 ${generated.filter((v) => !v.existing).length} 张待审核凭证`,
      detail: { order: preview.items.map((i) => i.code), generated },
    });
    return {
      generated,
      message: generated.length
        ? '请其他操作员审核结转凭证后，再过账并结账'
        : '结转转出金额为零，没有生成空凭证',
    };
  });
}
export async function deleteGenerated(
  svc: CoreServices,
  input: { period: number; ruleId: number; confirmed: boolean },
) {
  if (!input.confirmed) fail('CONFIRM', '请确认删除结转凭证', '取消不会修改账套');
  return svc.tx(async (t) => {
    await noLaterRun(t, input.period);
    const all = await runs(t);
    const row = all.find((r) => r.period === input.period && r.rule_id === input.ruleId);
    if (!row) return;
    const list = await rules(t);
    const rank = list.find((r) => r.id === input.ruleId)!.order;
    if (
      all.some(
        (r) =>
          r.period === input.period &&
          r.rule_id !== input.ruleId &&
          list.find((s) => s.id === r.rule_id)!.order >= rank,
      )
    )
      fail('DEPENDENT_TRANSFER', '同月后续结转依赖本凭证', '先删除后续结转，再删除本凭证');
    const v = await t.vouchers.get(row.voucher_id);
    if (
      !v ||
      v.source?.module !== 'period-close' ||
      v.source.type !== 'closing' ||
      v.source.id !== `${row.period}:${row.rule_id}`
    )
      fail('SOURCE_MISMATCH', '来源关联无法核实，不能删除', '保留数据并检查来源关联');
    if (v.status !== 'draft' && v.status !== 'pending')
      fail(
        'TRANSFER_LOCKED',
        `${VOUCHER_STATUS_LABELS[v.status]}的结转凭证不能删除`,
        '先反过账并由凭证管理取消审核',
        input.period,
      );
    await tables(t)
      .deleteFrom('period_close_run')
      .where('period', '=', input.period)
      .where('rule_id', '=', input.ruleId)
      .execute();
    await t.vouchers.delete(v.id);
    await t.log.write({
      action: 'period-close.transfer.delete',
      summary: `删除 ${input.period} 结转 ${v.displayNo}`,
    });
  });
}
