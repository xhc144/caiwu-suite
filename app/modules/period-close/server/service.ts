import { z } from 'zod';
import {
  formatMoney,
  formatPeriod,
  nextPeriod,
  periodYear,
  VOUCHER_STATUS_LABELS,
  type VoucherHeader,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { CloseSchema } from '../shared';
import { openingCheck, requireOpening } from './preconditions';
import { digest } from './buckets';
import { closingBuckets } from './buckets';
import {
  allVouchers,
  fail,
  noLaterRun,
  rules,
  runs,
  tables,
  transferPreview,
  verifyPostedRuns,
} from './transfers';

export async function validateRange(svc: CoreServices, from: number, to: number, open: boolean) {
  if (from > to) fail('RANGE', '起始期间不能晚于结束期间', '填写合法的起止范围');
  const list = await svc.periods.list();
  const range: number[] = [];
  for (let p = from; ; p = nextPeriod(p)) {
    range.push(p);
    if (p === to) break;
  }
  const missing = range.filter((p) => !list.some((r) => r.period === p));
  if (missing.length)
    fail(
      'PERIOD_MISSING',
      `期间 ${missing.join('、')} 尚未建立`,
      '先完成上年年结，建立下一年度期间',
    );
  const closed = list.filter((p) => p.period >= from && p.period <= to && p.status === 'closed');
  if (open && closed.length)
    fail(
      'CLOSED',
      `${closed.map((p) => formatPeriod(p.period)).join('、')} 已结账`,
      '先按从后到前的顺序反结账',
      from,
      { periods: closed.map((p) => p.period) },
    );
  return range;
}
export function numberGaps(vouchers: VoucherHeader[]) {
  const groups = new Map<string, VoucherHeader[]>();
  for (const v of vouchers) {
    if (v.status === 'draft' || v.number == null) continue;
    const key = `${v.period}:${v.voucherTypeId}`;
    const group = groups.get(key) ?? [];
    group.push(v);
    groups.set(key, group);
  }
  const gaps: { period: number; type: string; from: number; to: number }[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.number! - b.number!);
    let wanted = 1;
    for (const v of group) {
      if (v.number! > wanted)
        gaps.push({ period: v.period, type: v.voucherTypeCode, from: wanted, to: v.number! - 1 });
      wanted = v.number! + 1;
    }
  }
  return gaps;
}
export async function pnlBalances(svc: CoreServices, period: number) {
  const pnl = new Set((await svc.accounts.categories()).filter((c) => c.isPnl).map((c) => c.id));
  const accounts = await svc.accounts.list();
  return [...(await closingBuckets(svc, period, [], false)).values()]
    .filter(
      (b) =>
        accounts.some((a) => a.id === b.accountId && a.isLeaf && pnl.has(a.categoryId)) &&
        (b.amount || b.fc || b.qty),
    )
    .map((b) => ({ ...b, code: accounts.find((a) => a.id === b.accountId)!.code }));
}
export async function checkPeriod(svc: CoreServices, period: number) {
  const p = await svc.periods.require(period);
  const vouchers = await allVouchers(svc, period, period);
  const opening = await openingCheck(svc, p.year);
  const trial = await svc.ledger.trialBalance(period, period);
  const pnl = await pnlBalances(svc, period);
  const unposted = vouchers.filter(
    (v) => !v.voided && v.status !== 'draft' && v.status !== 'posted',
  );
  const drafts = vouchers.filter((v) => !v.voided && v.status === 'draft');
  const gaps = numberGaps(vouchers);
  const activeRuns = (await runs(svc)).filter((r) => r.period === period);
  const allPeriods = await svc.periods.list();
  const earliest = allPeriods.find((p) => p.status === 'open')?.period;
  const items = [
    {
      id: 'period',
      title: '期间状态',
      pass: p.status === 'open',
      detail: p.status === 'open' ? '开放，可检查办理期末业务' : '已结账，修改前须反结账',
      to: `/m/period-close?period=${period}`,
    },
    {
      id: 'year',
      title: '上年度年结',
      pass: opening.yearReady,
      detail: opening.yearReady ? '首年或上年度年结已完成' : `${p.year - 1} 年年结未完成`,
      to: '/m/period-close',
    },
    {
      id: 'opening',
      title: '期初是否录入',
      pass: opening.rows.length > 0,
      detail: `实际已保存 ${opening.rows.length} 行；允许明确保存全零期初`,
      to: `/m/opening?year=${p.year}`,
    },
    {
      id: 'openingBalance',
      title: '年初借贷试算',
      pass: opening.balanceDifference === 0,
      detail: `差额 ${formatMoney(opening.balanceDifference)}`,
      to: `/m/opening?year=${p.year}`,
    },
    {
      id: 'openingYtd',
      title: '启用前累计借贷试算',
      pass: opening.ytdDifference === 0,
      detail: `差额 ${formatMoney(opening.ytdDifference)}`,
      to: `/m/opening?year=${p.year}`,
    },
    {
      id: 'trial',
      title: '正式账试算',
      pass: trial.balanced,
      detail: `本期借 ${formatMoney(trial.debit)} / 贷 ${formatMoney(trial.credit)}；期末借 ${formatMoney(trial.closingDebit)} / 贷 ${formatMoney(trial.closingCredit)}`,
      to: `/m/opening?year=${p.year}`,
    },
    {
      id: 'unposted',
      title: '待审核 / 未过账',
      pass: unposted.length === 0,
      detail: unposted.length
        ? unposted.map((v) => `${v.displayNo}（${VOUCHER_STATUS_LABELS[v.status]}）`).join('、')
        : '所有有效正式凭证已过账',
      to: `/m/voucher-book?period=${period}&status=pending`,
    },
    {
      id: 'gaps',
      title: '凭证断号',
      pass: gaps.length === 0,
      detail: gaps.length
        ? gaps
            .map((g) => `${g.type} 缺 ${g.from}${g.to === g.from ? '' : `—${g.to}`} 号`)
            .join('、')
        : '编号连续（作废号仍占用，草稿无号）',
      to: `/m/voucher-book?period=${period}`,
    },
    {
      id: 'pnl',
      title: '损益余额 / 结转状态',
      pass: pnl.length === 0,
      detail: pnl.length
        ? pnl.map((b) => `${b.code} ${formatMoney(b.amount)}`).join('、')
        : '损益逐桶余额为零；无需生成或已完成结转',
      to: `/m/period-close?period=${period}`,
    },
    {
      id: 'sequence',
      title: '结账顺序',
      pass: earliest === period,
      detail: earliest ? `最早可结期间 ${formatPeriod(earliest)}` : '所有期间已结账',
      to: `/m/period-close?period=${earliest ?? period}`,
    },
  ];
  return {
    period: p,
    items,
    allPassed: items.every((i) => i.pass),
    vouchers: unposted.map((v) => ({ id: v.id, displayNo: v.displayNo, status: v.status })),
    drafts: drafts.map((v) => ({ id: v.id, displayNo: v.displayNo })),
    gaps,
    pnl,
    generated: activeRuns.map((r) => ({
      ruleId: r.rule_id,
      voucherId: r.voucher_id,
      voucher: vouchers.find((v) => v.id === r.voucher_id),
    })),
    yearEnd: {
      year: p.year,
      closed: allPeriods.filter((r) => r.year === p.year && r.status === 'closed').length,
      total: allPeriods.filter((r) => r.year === p.year).length,
      completed:
        (await tables(svc)
          .selectFrom('period_close_year')
          .selectAll()
          .where('source_year', '=', p.year)
          .executeTakeFirst()) != null,
    },
    periods: allPeriods,
  };
}
export async function post(svc: CoreServices, from: number, to: number) {
  return svc.tx(async (t) => {
    const range = await validateRange(t, from, to, true);
    for (const y of new Set(range.map(periodYear))) await requireOpening(t, y);
    const vouchers = await allVouchers(t, from, to);
    for (const v of vouchers)
      if (![v.debitTotal, v.creditTotal].every(Number.isSafeInteger))
        fail(
          'UNSAFE_MONEY',
          `凭证 ${v.displayNo} 金额合计超出安全整数分范围`,
          '先修正凭证金额合计，再过账',
          v.period,
          { voucherId: v.id },
        );
    const candidates = vouchers.filter((v) => v.status === 'audited' && !v.voided);
    if (candidates.length) await noLaterRun(t, candidates[0]!.period);
    for (const p of range)
      if (!(await t.ledger.trialBalance(p, p, { includeUnposted: true })).balanced)
        fail('TRIAL', `${p} 试算不平，不能过账`, '修正期初或正式凭证后再过账', p);
    let count = 0;
    for (let i = 0; i < candidates.length; i += 1000)
      count += await t.vouchers.changeStatus({
        ids: candidates.slice(i, i + 1000).map((v) => v.id),
        to: 'posted',
      });
    if (count) await verifyPostedRuns(t, from, to);
    const candidateIds = new Set(candidates.map((v) => v.id));
    const skipped = vouchers
      .filter((v) => !candidateIds.has(v.id))
      .map((v) => ({
        id: v.id,
        displayNo: v.displayNo,
        reason: v.voided
          ? '已作废'
          : v.status === 'draft'
            ? '草稿不进入正式账'
            : v.status === 'pending'
              ? '待审核，请其他操作员审核'
              : '已经过账',
      }));
    return { count, skipped, message: count ? `已过账 ${count} 张凭证` : '没有需要过账的凭证' };
  });
}
export async function unpost(
  svc: CoreServices,
  input: { from: number; to: number; confirmed: boolean },
) {
  if (!input.confirmed) fail('CONFIRM', '请确认反过账范围', '取消不会修改账套');
  return svc.tx(async (t) => {
    await validateRange(t, input.from, input.to, true);
    await noLaterRun(t, input.from);
    const list = (await allVouchers(t, input.from, input.to)).filter(
      (v) => v.status === 'posted' && !v.voided,
    );
    let count = 0;
    for (let i = 0; i < list.length; i += 1000)
      count += await t.vouchers.changeStatus({
        ids: list.slice(i, i + 1000).map((v) => v.id),
        to: 'audited',
      });
    await t.log.write({
      action: 'period-close.unpost',
      summary: `反过账 ${input.from}—${input.to} 共 ${count} 张`,
      detail: { ids: list.map((v) => v.id) },
    });
    return { count, message: `已反过账 ${count} 张；审核信息保留，过账信息按核心规则清理` };
  });
}
export async function closePeriod(
  svc: CoreServices,
  raw: {
    period: number;
    confirmed: boolean;
    allowUntransferredPnl?: boolean;
    acknowledgeDrafts?: boolean;
  },
) {
  const input = CloseSchema.parse(raw);
  if (!input.confirmed) fail('CONFIRM', '请确认结账', '结账后本期间凭证不能再保存，修改前须反结账');
  return svc.tx(async (t) => {
    await requireOpening(t, periodYear(input.period));
    const check = await checkPeriod(t, input.period);
    const blocking = check.items.filter((i) => !i.pass && i.id !== 'pnl');
    if (blocking.length)
      fail(
        'CHECK_FAILED',
        blocking.map((i) => `${i.title}：${i.detail}`).join('；'),
        '逐项使用检查页的“去处理”入口',
        input.period,
        { checks: blocking, vouchers: check.vouchers, gaps: check.gaps },
      );
    if (check.drafts.length && !input.acknowledgeDrafts)
      fail(
        'DRAFT_CONFIRM',
        `本月有 ${check.drafts.length} 张草稿，结账会使其无法保存为正式凭证`,
        '先处理草稿，或明确确认保留为草稿且不计正式账',
        input.period,
        { drafts: check.drafts },
      );
    if (check.pnl.length && !input.allowUntransferredPnl)
      fail(
        'PNL_CONFIRM',
        '损益尚未结转，检查未通过',
        '先结转，或明确确认带着损益余额结账（会记录日志）',
        input.period,
      );
    if (check.generated.length) await verifyPostedRuns(t, input.period, input.period);
    await t.periods.setStatus(input.period, 'closed');
    await t.log.write({
      action: 'period-close.close',
      summary: `结账 ${input.period}${check.pnl.length ? '（明确确认损益未结转）' : ''}`,
      detail: {
        allowUntransferredPnl: input.allowUntransferredPnl,
        acknowledgeDrafts: input.acknowledgeDrafts,
      },
    });
    return { message: `${formatPeriod(input.period)} 已结账` };
  });
}
export async function reopen(
  svc: CoreServices,
  input: { from: number; to: number; confirmed: boolean },
) {
  if (!input.confirmed) fail('CONFIRM', '请确认反结账范围', '取消不会修改账套');
  return svc.tx(async (t) => {
    await validateRange(t, input.from, input.to, false);
    const book = await t.book.info();
    if (input.from < book.startPeriod)
      fail('BEFORE_START', '已到开账日期，不能再向前反结账', `账套启用期间为 ${book.startPeriod}`);
    if (periodYear(input.from) !== periodYear(input.to))
      fail(
        'CROSS_YEAR_DISABLED',
        '跨年反结账尚未开放',
        '先逐月撤销后年度结账，再在本页备份并撤销最近年结，最后逐月反结账',
      );
    const snapshots = (
      await tables(t).selectFrom('period_close_year').selectAll().execute()
    ).filter((r) => r.source_year >= periodYear(input.from));
    if (snapshots.length)
      fail(
        'YEAR_SNAPSHOT',
        '涉及年结生成的后年度派生期初，当前禁止回退',
        '先在本页预览、在线备份并确认撤销最近年结；后年度业务须先合法撤销',
        input.from,
        {
          years: snapshots.map((r) => ({
            year: r.target_year,
            rows: (JSON.parse(r.snapshot) as unknown[]).length,
          })),
        },
      );
    const list = await t.periods.list();
    const latest = list.filter((p) => p.status === 'closed').at(-1);
    if (latest?.period !== input.to)
      fail(
        'REOPEN_ORDER',
        `只能从最近已结期间 ${latest?.period ?? '（无）'} 开始反结账`,
        '不能跳过后面的已结月份',
      );
    const selected = list.filter((p) => p.period >= input.from && p.period <= input.to);
    if (selected.some((p) => p.status !== 'closed'))
      fail('REOPEN_ORDER', '范围中存在尚未结账的期间', '只选择连续的已结期间');
    for (const p of selected.toReversed()) await t.periods.setStatus(p.period, 'open');
    await t.log.write({
      action: 'period-close.reopen',
      summary: `逐月反结账 ${input.to} → ${input.from}；保留当年手工期初`,
      detail: { periods: selected.map((p) => p.period) },
    });
    return { message: `已反结账 ${selected.length} 个月，余额及当年期初保持不变` };
  });
}

/** 连续结账只办理全部严格通过的同年范围；特殊确认仍回到单月逐项处理。 */
export async function closeRangePreview(svc: CoreServices, from: number, to: number) {
  if (periodYear(from) !== periodYear(to))
    fail('CROSS_YEAR_CLOSE', '连续结账仅支持同一年度', '先完成本年度，再预览年结建立下一年度');
  const range = await validateRange(svc, from, to, true);
  const periods = await svc.periods.list();
  const earliest = periods.find((p) => p.status === 'open')?.period;
  if (earliest !== from)
    fail('CLOSE_ORDER', `连续结账须从最早开放期间 ${earliest ?? '（无）'} 开始`, '调整操作范围');
  const items = [];
  for (const period of range) {
    const check = await checkPeriod(svc, period);
    const problems = check.items
      .filter((i) => i.id !== 'sequence' && !i.pass)
      .map((i) => `${i.title}：${i.detail}`);
    if (check.drafts.length)
      problems.push(`另有 ${check.drafts.length} 张草稿，请回到单月明确确认后办理`);
    items.push({ period, ready: !problems.length, problems });
  }
  if (items.every((i) => i.ready)) await verifyPostedRuns(svc, from, to);
  // 核心凭证 revision 覆盖分录修改；期初、科目、期间和本模块来源快照另行纳入。
  const previewToken = digest([
    from,
    to,
    items,
    await allVouchers(svc, from, to),
    await svc.opening.list(periodYear(from)),
    await svc.accounts.list(),
    periods,
    await runs(svc),
    await rules(svc),
  ]);
  return { from, to, items, allPassed: items.every((i) => i.ready), previewToken };
}

export async function closeRange(
  svc: CoreServices,
  input: { from: number; to: number; confirmed: boolean; previewToken: string },
) {
  if (!input.confirmed) fail('CONFIRM', '请确认连续结账的逐月检查结果', '取消不会修改账套');
  return svc.tx(async (t) => {
    const preview = await closeRangePreview(t, input.from, input.to);
    if (preview.previewToken !== input.previewToken)
      fail('PREVIEW_CHANGED', '连续结账预览已变化', '重新预览并确认逐月检查结果');
    if (!preview.allPassed)
      fail(
        'CLOSE_RANGE_BLOCKED',
        '连续结账范围内仍有未处理事项',
        '按预览中的期间处理后再预览',
        undefined,
        {
          periods: preview.items.filter((i) => !i.ready),
        },
      );
    for (const item of preview.items)
      await closePeriod(t, { period: item.period, confirmed: true });
    return { message: `已连续结账 ${input.from}—${input.to} 共 ${preview.items.length} 个月` };
  });
}
export async function renumberPreview(svc: CoreServices, period: number) {
  await svc.periods.assertOpen(period, '整理编号');
  const all = (await allVouchers(svc, period, period)).filter(
    (v) => v.status !== 'draft' && v.number != null,
  );
  const counters = new Map<number, number>();
  const changes = all.map((v) => {
    const number = (counters.get(v.voucherTypeId) ?? 0) + 1;
    counters.set(v.voucherTypeId, number);
    return {
      id: v.id,
      type: v.voucherTypeCode,
      oldNumber: v.number!,
      number,
      revision: v.revision,
    };
  });
  const numberPlan = changes.some((v) => v.oldNumber !== v.number)
    ? await svc.vouchers.previewNumbers(
        changes
          .filter((v) => v.oldNumber !== v.number)
          .map((v) => ({ id: v.id, number: v.number })),
      )
    : null;
  return {
    changes: changes.filter((v) => v.oldNumber !== v.number),
    previewToken: JSON.stringify({ digest: digest(changes), numberPlan }),
    message: '影响已打印凭证和账册，编号整理后不可直接恢复。整理后须重新检查再结账。',
  };
}
export async function renumber(
  svc: CoreServices,
  input: { period: number; confirmed: boolean; confirmText: string; previewToken: string },
) {
  if (!input.confirmed || input.confirmText !== '影响已打印凭证和账册，编号不可直接恢复')
    fail('CONFIRM', '编号整理需要两次确认', '核对新旧号，确认影响已打印凭证和账册且不可直接恢复');
  return svc.tx(async (t) => {
    const preview = await renumberPreview(t, input.period);
    const tokenSchema = z.object({
      digest: z.string(),
      numberPlan: z
        .object({
          updates: z.array(
            z.object({ id: z.number().int().positive(), number: z.number().int().positive() }),
          ),
          fingerprint: z.string(),
          expiresAt: z.number(),
        })
        .nullable(),
    });
    let submitted;
    try {
      submitted = tokenSchema.parse(JSON.parse(input.previewToken));
    } catch {
      fail('PREVIEW_CHANGED', '编号预览无效，请重新预览');
    }
    const current = tokenSchema.parse(JSON.parse(preview.previewToken));
    if (
      current.digest !== submitted.digest ||
      digest(current.numberPlan?.updates) !== digest(submitted.numberPlan?.updates)
    )
      fail('PREVIEW_CHANGED', '凭证已变化，请重新预览编号');
    if (submitted.numberPlan)
      await t.vouchers.setNumbers(submitted.numberPlan.updates, {
        plan: submitted.numberPlan,
        confirmed: true,
      });
    await t.log.write({
      action: 'period-close.renumber',
      summary: `确认不可直接恢复后整理 ${input.period} 编号`,
      detail: preview.changes,
    });
    return {
      message: preview.changes.length
        ? '编号已整理，请重新检查并结账'
        : '无此类型凭证或编号已连续，不需要重新排号',
      check: await checkPeriod(t, input.period),
    };
  });
}
export async function workflow(
  svc: CoreServices,
  input: { period: number; ruleIds: number[]; confirmed: boolean },
) {
  for (const permission of ['post', 'transfer.generate', 'close'])
    svc.permissions.require(`period-close.${permission}`);
  if (!input.confirmed)
    fail('CONFIRM', '请确认一键期末流程', '将逐阶段办理；新结转凭证会停在等待其他操作员审核');
  if ((await svc.periods.require(input.period)).status === 'closed')
    return {
      stage: '已结账' as const,
      message: '本期已完成结账，本次未重复生成或过账',
      posting: {
        count: 0,
        skipped: [] as { id: number; displayNo: string; reason: string }[],
        message: '本期已结账',
      },
      preview: null,
    };
  const posting = await post(svc, input.period, input.period);
  const check = await checkPeriod(svc, input.period);
  if (check.vouchers.length)
    return {
      stage: '审核检查点' as const,
      message: '请其他操作员审核后继续；待审核凭证不会自动自审',
      posting,
      preview: null,
    };
  const preview = await transferPreview(svc, input.period, input.ruleIds);
  if (preview.items.some((i) => !i.zero && !i.existingVoucherId))
    return {
      stage: '确认结转预览' as const,
      message: '过账已完成，请确认顺序及分录后生成待审核凭证',
      posting,
      preview,
    };
  const closed = await closePeriod(svc, { period: input.period, confirmed: true });
  return { stage: '已结账' as const, message: closed.message, posting, preview: null };
}
