import {
  Decimal,
  DIMENSION_TYPES,
  assertCents,
  periodEndDate,
  periodYear,
  type DimensionValues,
  type VoucherLineInput,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { ExchangeSettingsSchema, type ExchangeSettings } from '../shared';
import type { PeriodCloseTables } from './migrations';
import { closingBuckets, canonicalBuckets, digest } from './buckets';
import { sumMoney } from './amounts';
import { requireOpening } from './preconditions';
import { allVouchers, fail, noLaterRun, runs } from './transfers';

const FxDecimal = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
const db = (svc: CoreServices) => svc.db.withTables<PeriodCloseTables>();
const settingKey = (period: number) => `exchange:${period}`;
export const exchangeRuns = (svc: CoreServices) =>
  db(svc).selectFrom('period_close_exchange_run').selectAll().orderBy('period').execute();

async function validate(svc: CoreServices, raw: ExchangeSettings, requiresNumber = true) {
  const settings = ExchangeSettingsSchema.parse(raw);
  const currencies = await svc.reference.currencies();
  const accounts = await svc.accounts.list();
  if (
    requiresNumber &&
    (await svc.voucherPolicy.get()).numbering === 'manual' &&
    settings.number == null
  )
    fail(
      'FX_NUMBER',
      '本账套采用手工编号，请填写汇兑凭证号',
      '填写本期该凭证类型尚未使用的正整数编号',
    );
  if (new Set(settings.accountIds).size !== settings.accountIds.length)
    fail('FX_SELECTION', '汇兑科目不能重复选择', '每个末级科目只选择一次');
  if (new Set(settings.rates.map((r) => r.currency)).size !== settings.rates.length)
    fail('FX_RATE', '同一币种只能填写一组期末汇率', '合并重复币种后重新保存');
  for (const id of settings.accountIds) {
    const account = accounts.find((a) => a.id === id);
    if (!account || !account.isLeaf || account.disabled || !account.currency)
      fail('FX_ACCOUNT', '汇兑范围必须是启用的末级外币科目', '重新选择需要期末折算的货币性科目');
    if (!settings.rates.some((r) => r.currency === account.currency))
      fail(
        'FX_RATE',
        `科目 ${account.code} 缺少 ${account.currency} 期末汇率`,
        '填写该币种本期汇率及汇兑损益科目',
      );
  }
  const pnl = new Set((await svc.accounts.categories()).filter((c) => c.isPnl).map((c) => c.id));
  for (const rate of settings.rates) {
    const currency = currencies.find((c) => c.code === rate.currency);
    if (!currency || currency.disabled || currency.isBase)
      fail('FX_CURRENCY', `币种 ${rate.currency} 无效、已停用或是本位币`, '选择启用的外币币种');
    if (!new Decimal(rate.rate).isFinite() || !new Decimal(rate.rate).gt(0))
      fail('FX_RATE', '期末汇率必须大于零', '按每一外币单位折合的本币金额填写正数');
    if (!accounts.some((a) => settings.accountIds.includes(a.id) && a.currency === rate.currency))
      fail(
        'FX_SELECTION',
        `${rate.currency} 尚未选择需要折算的科目`,
        '选择对应货币性科目，或移除该币种设置',
      );
    const target = accounts.find((a) => a.id === rate.gainLossAccountId);
    if (
      !target ||
      !target.isLeaf ||
      target.disabled ||
      !pnl.has(target.categoryId) ||
      target.currency ||
      target.quantityUnit ||
      target.cashflowRequired
    )
      fail(
        'FX_TARGET',
        '汇兑损益科目必须是启用的本币损益末级科目',
        '选择不核算外币、数量及现金流量的汇兑损益科目',
      );
    for (const dimension of DIMENSION_TYPES.filter((d) => d.id !== 'cashflow')) {
      const config = target.dimensions.find((d) => d.type === dimension.id);
      const id = rate.dimensions[dimension.id] ?? config?.defaultItemId;
      if (config?.required && id == null)
        fail('FX_DIMENSION', `汇兑损益科目需要填写${dimension.name}`, '补齐汇兑损益科目的辅助项');
      if (id != null) {
        const item = await svc.dimensions.get(id);
        if (!config || !item || item.typeId !== dimension.id || !item.isLeaf || item.disabled)
          fail('FX_DIMENSION', `汇兑损益${dimension.name}无效`, '重新选择启用的末级辅助项');
      }
    }
  }
  if (
    !(await svc.reference.voucherTypes()).some(
      (t) => t.id === settings.voucherTypeId && !t.disabled,
    )
  )
    fail('FX_TYPE', '汇兑凭证类型不存在或已停用', '选择可用的凭证类型');
  return { settings, accounts };
}

export async function exchangeSettings(svc: CoreServices, period: number) {
  await svc.periods.require(period);
  const stored = await svc.settings.get<ExchangeSettings | null>(settingKey(period), null);
  const run = (await exchangeRuns(svc)).find((r) => r.period === period);
  const voucher = run ? await svc.vouchers.get(run.voucher_id) : null;
  return {
    settings: stored ? ExchangeSettingsSchema.parse(stored) : null,
    numbering: (await svc.voucherPolicy.get()).numbering,
    currencies: (await svc.reference.currencies()).filter((c) => !c.isBase && !c.disabled),
    existing: voucher
      ? { id: voucher.id, displayNo: voucher.displayNo, status: voucher.status }
      : null,
  };
}
export async function saveExchangeSettings(svc: CoreServices, raw: ExchangeSettings) {
  return svc.tx(async (t) => {
    await t.periods.assertWritable({
      period: raw.period,
      mode: 'business',
      action: '保存汇兑损益设置',
    });
    const { settings } = await validate(t, raw);
    if ((await exchangeRuns(t)).some((r) => r.period === settings.period))
      fail(
        'FX_USED',
        '本期已经生成汇兑凭证，不能修改折算设置',
        '先合法撤销汇兑凭证，再修改汇率和科目',
      );
    await t.settings.set(settingKey(settings.period), settings);
    await t.log.write({
      action: 'period-close.exchange.settings',
      summary: `保存 ${settings.period} 期末汇兑设置`,
    });
    return { message: '期末汇率及汇兑损益设置已保存' };
  });
}

async function calculate(svc: CoreServices, period: number, verify = false) {
  if (verify) await svc.periods.require(period);
  else await svc.periods.assertOpen(period, '汇兑损益预览');
  await requireOpening(svc, periodYear(period));
  const run = (await exchangeRuns(svc)).find((r) => r.period === period);
  const raw = run
    ? (JSON.parse(run.definition) as ExchangeSettings)
    : await svc.settings.get<ExchangeSettings | null>(settingKey(period), null);
  if (!raw)
    fail(
      'FX_SETTINGS',
      '本期尚未保存期末汇率和汇兑损益设置',
      '先选择需折算的货币性科目，填写期末汇率并保存',
    );
  const { settings, accounts } = await validate(svc, raw, !run);
  if (!verify) await noLaterRun(svc, period);
  const monthly = (await runs(svc)).filter((r) => r.period === period);
  if (!run && monthly.length)
    fail(
      'FX_ORDER',
      '本期已生成月度结转，须先处理汇兑损益',
      '先合法撤销本期月度结转，再生成并审核过账汇兑凭证',
    );
  const vouchers = await allVouchers(svc, period, period);
  const unposted = vouchers.filter(
    (v) =>
      !v.voided &&
      v.status !== 'draft' &&
      v.status !== 'posted' &&
      v.id !== run?.voucher_id &&
      !monthly.some((r) => r.voucher_id === v.id),
  );
  if (unposted.length)
    fail(
      'FX_UNPOSTED',
      `本期还有 ${unposted.length} 张正式凭证未过账，不能折算汇兑损益`,
      '先由其他操作员审核并过账后重新预览',
      period,
    );
  if (run) {
    const voucher = vouchers.find((v) => v.id === run.voucher_id);
    if (
      !voucher ||
      voucher.voided ||
      voucher.source?.module !== 'period-close' ||
      voucher.source.type !== 'exchange' ||
      voucher.source.id !== String(period)
    )
      fail('FX_SOURCE', '汇兑凭证来源关联无法核实', '保留数据并核查汇兑凭证来源');
  }
  const allBuckets = await closingBuckets(
    svc,
    period,
    [...monthly.map((r) => r.voucher_id), ...(run ? [run.voucher_id] : [])],
    false,
  );
  const buckets = new Map(
    [...allBuckets].filter(([, b]) => settings.accountIds.includes(b.accountId)),
  );
  const rows = [];
  const lines: VoucherLineInput[] = [];
  const dimensionState = [];
  for (const b of [...buckets.values()].sort(
    (a, b) =>
      a.accountId - b.accountId ||
      JSON.stringify(a.dimensions).localeCompare(JSON.stringify(b.dimensions)),
  )) {
    if (!b.amount && !b.fc) continue;
    const account = accounts.find((a) => a.id === b.accountId)!;
    if (b.currency !== account.currency)
      fail(
        'FX_CURRENCY',
        `科目 ${account.code} 的余额币种与科目设置不一致`,
        '核查该科目期初和外币档案',
      );
    for (const dimension of DIMENSION_TYPES.filter((d) => d.id !== 'cashflow')) {
      const config = account.dimensions.find((d) => d.type === dimension.id);
      const id = b.dimensions[dimension.id];
      if (config?.required && id == null)
        fail(
          'FX_DIMENSION',
          `科目 ${account.code} 的余额缺少${dimension.name}`,
          '先修正原期初或凭证的辅助项，不能用默认项替代未知余额',
        );
      if (id != null) {
        const item = await svc.dimensions.get(id);
        if (!config || !item || item.typeId !== dimension.id || !item.isLeaf || item.disabled)
          fail(
            'FX_DIMENSION',
            `科目 ${account.code} 的${dimension.name}已失效`,
            '先修正或启用对应末级辅助项',
          );
        dimensionState.push([item.id, item.revision, item.disabled, item.isLeaf]);
      }
    }
    const rate = settings.rates.find((r) => r.currency === b.currency)!;
    const rounded = new FxDecimal(b.fc)
      .mul(rate.rate)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
    if (!Number.isSafeInteger(rounded))
      fail('FX_RANGE', `科目 ${account.code} 折算金额超出可处理范围`, '核对外币余额和期末汇率');
    const translated = assertCents(rounded === 0 ? 0 : rounded);
    const difference = sumMoney([translated, -b.amount]);
    rows.push({
      accountId: account.id,
      accountCode: account.code,
      accountName: account.fullName,
      dimensions: b.dimensions,
      currency: b.currency!,
      foreignBalance: b.fc,
      bookBalance: b.amount,
      rate: rate.rate,
      translatedBalance: translated,
      difference,
      gainLossAccountId: rate.gainLossAccountId,
    });
    if (!difference) continue;
    lines.push({
      summary: settings.summary,
      accountId: account.id,
      dimensions: { ...b.dimensions, cashflow: null },
      currency: b.currency,
      exchangeRate: rate.rate,
      fcAmount: 0,
      quantity: account.quantityUnit ? '0' : undefined,
      cashflowDirection: null,
      debit: difference > 0 ? difference : 0,
      credit: difference < 0 ? -difference : 0,
    });
    const target = accounts.find((a) => a.id === rate.gainLossAccountId)!;
    const dimensions: DimensionValues = { ...rate.dimensions };
    for (const config of target.dimensions) dimensions[config.type] ??= config.defaultItemId;
    lines.push({
      summary: settings.summary,
      accountId: target.id,
      dimensions,
      debit: difference < 0 ? -difference : 0,
      credit: difference > 0 ? difference : 0,
    });
  }
  if (lines.length > 999)
    fail('FX_LINES', '汇兑分录超过单张凭证容量', '缩小本期折算科目范围，或先合并不必要的辅助明细');
  const basis = digest([
    canonicalBuckets(buckets),
    settings,
    accounts.filter(
      (a) =>
        settings.accountIds.includes(a.id) ||
        settings.rates.some((r) => r.gainLossAccountId === a.id),
    ),
    dimensionState,
  ]);
  if (run && run.basis !== basis)
    fail(
      'FX_STALE',
      '汇兑凭证的原始余额或科目档案已经变化',
      '先反过账、取消审核并撤销受影响汇兑及后续结转，再重新预览',
    );
  return {
    period,
    rows,
    lines,
    settings,
    basis,
    previewToken: digest([period, basis, lines]),
    existingVoucherId: run?.voucher_id ?? null,
    debit: sumMoney(lines.map((l) => l.debit)),
    credit: sumMoney(lines.map((l) => l.credit)),
    drafts: vouchers.filter((v) => !v.voided && v.status === 'draft').length,
    message:
      '按末级科目、辅助项分别以期末汇率折算，逐项四舍五入；只调整本币余额，外币和数量保持不变。',
  };
}
export const exchangePreview = (svc: CoreServices, period: number) => calculate(svc, period);
export async function verifyExchangeRuns(svc: CoreServices, from: number, to: number) {
  for (const run of (await exchangeRuns(svc)).filter((r) => r.period >= from && r.period <= to))
    await calculate(svc, run.period, true);
}
export async function generateExchange(
  svc: CoreServices,
  input: { period: number; confirmed: boolean; previewToken: string },
) {
  if (!input.confirmed)
    fail('FX_CONFIRM', '请先核对期末汇率和汇兑损益分录', '确认本期汇率和各辅助项差额后再生成');
  return svc.tx(async (t) => {
    await t.periods.assertWritable({
      period: input.period,
      mode: 'business',
      action: '生成汇兑损益凭证',
    });
    const preview = await calculate(t, input.period);
    if (preview.existingVoucherId)
      return {
        id: preview.existingVoucherId,
        existing: true,
        message: '本期汇兑凭证已经生成，本次未重复生成',
      };
    if (preview.previewToken !== input.previewToken)
      fail('FX_PREVIEW_CHANGED', '汇兑预览已经变化', '重新预览并核对最新汇率和差额');
    if (!preview.lines.length)
      return { id: null, existing: false, message: '各辅助项折算差额均为零，没有生成空凭证' };
    const voucher = await t.vouchers.create({
      voucherTypeId: preview.settings.voucherTypeId,
      number:
        (await t.voucherPolicy.get()).numbering === 'manual' ? preview.settings.number : undefined,
      date: periodEndDate(input.period),
      lines: preview.lines,
      source: { type: 'exchange', id: String(input.period) },
      closingKind: 'exchange',
    });
    await db(t)
      .insertInto('period_close_exchange_run')
      .values({
        period: input.period,
        voucher_id: voucher.id,
        basis: preview.basis,
        definition: JSON.stringify(preview.settings),
        created_at: t.ctx.now().toISOString(),
      })
      .execute();
    await t.log.write({
      action: 'period-close.exchange.generate',
      summary: `${input.period} 生成汇兑损益凭证 ${voucher.displayNo}`,
      detail: { voucherId: voucher.id, rates: preview.settings.rates },
    });
    return {
      id: voucher.id,
      existing: false,
      message: '汇兑凭证已生成，请其他操作员审核并过账，再办理月度损益结转',
    };
  });
}

async function deletion(svc: CoreServices, period: number) {
  await svc.periods.assertOpen(period, '撤销汇兑损益');
  await noLaterRun(svc, period);
  if ((await runs(svc)).some((r) => r.period === period))
    fail(
      'FX_DEPENDENT',
      '本期月度结转依赖汇兑结果，不能先撤销汇兑凭证',
      '先按从后到前的顺序撤销月度结转，再撤销汇兑凭证',
    );
  const run = (await exchangeRuns(svc)).find((r) => r.period === period);
  if (!run) fail('FX_MISSING', '本期没有可撤销的汇兑凭证', '刷新本期汇兑信息');
  const voucher = await svc.vouchers.get(run.voucher_id);
  if (
    !voucher ||
    voucher.source?.module !== 'period-close' ||
    voucher.source.type !== 'exchange' ||
    voucher.source.id !== String(period)
  )
    fail('FX_SOURCE', '汇兑凭证来源关联无法核实，不能撤销', '保留数据并核查来源');
  return { run, voucher };
}
export async function deleteExchangePreview(svc: CoreServices, period: number) {
  const { voucher } = await deletion(svc, period);
  const plan = await svc.vouchers.previewDelete([voucher.id]);
  return { period, voucherId: voucher.id, displayNo: voucher.displayNo, plan };
}
export async function deleteExchange(
  svc: CoreServices,
  input: {
    period: number;
    confirmed: boolean;
    plan: { ids: number[]; expiresAt: number; fingerprint: string };
  },
) {
  if (!input.confirmed) fail('FX_CONFIRM', '请先确认撤销汇兑凭证及编号影响', '取消不会修改账套');
  return svc.tx(async (t) => {
    await t.periods.assertWritable({
      period: input.period,
      mode: 'business',
      action: '撤销汇兑损益凭证',
    });
    const { voucher } = await deletion(t, input.period);
    if (input.plan.ids.length !== 1 || input.plan.ids[0] !== voucher.id)
      fail('FX_DELETE_CHANGED', '待撤销的汇兑凭证已变化', '重新预览撤销影响');
    await db(t)
      .deleteFrom('period_close_exchange_run')
      .where('period', '=', input.period)
      .execute();
    await t.vouchers.deleteBatch(input.plan, true);
    await t.log.write({
      action: 'period-close.exchange.delete',
      summary: `撤销 ${input.period} 汇兑凭证 ${voucher.displayNo}`,
    });
    return { message: '汇兑凭证已撤销，可修改期末汇率后重新预览生成' };
  });
}
