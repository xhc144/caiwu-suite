import { activityRows } from './forms';
import {
  checkRestrictionTransferEvidence,
  assertOriginalRestrictionsReleased,
} from './restriction-evidence';
import {
  exactSum,
  expenseIds,
  incomeIds,
  lineIdentity,
  lineSource,
  mappedRow,
  sameLine,
  type Configuration,
  type Sources,
  type Statement,
  type StatementRequest,
  type Recognition,
  type Check,
} from './model';

export type ClassifiedAmount = {
  period: number;
  row: string;
  kind: 'unrestricted' | 'restricted';
  amount: number;
  source: string;
};
const value = (rows: ClassifiedAmount[], id: string, kind: string, from: number, to: number) =>
  exactSum(
    rows
      .filter((e) => e.row === id && e.kind === kind && e.period >= from && e.period <= to)
      .map((e) => e.amount),
  );
export function classifyActivity(s: Sources, c: Configuration): ClassifiedAmount[] {
  const resources = new Map(c.resources.map((r) => [r.id, r]));
  if (resources.size !== c.resources.length) throw new Error('资源批次重复，请合并同一批次资料');
  const actual = s.entries
    .filter((e) => !e.closingKind || e.closingKind !== 'pnl')
    .filter((e) =>
      [...incomeIds, ...expenseIds].includes(
        mappedRow(e.accountCode, c.mappings) as (typeof incomeIds)[number],
      ),
    );
  const confirmations = new Map<number, Recognition>();
  for (const r of c.recognitions.filter((r) => r.line.period >= s.from && r.line.period <= s.to)) {
    if (confirmations.has(r.line.lineId)) throw new Error('同一分录重复确认');
    confirmations.set(r.line.lineId, r);
  }
  if (confirmations.size !== actual.length)
    throw new Error('收入费用逐笔确认不完整，请核对新增、前月以及净额为零的分录');
  const out: ClassifiedAmount[] = [];
  for (const e of actual) {
    const r = confirmations.get(e.lineId);
    if (!r || !sameLine(r.line, lineIdentity(e)))
      throw new Error(`凭证${e.displayNo}第${e.lineNo}行来源已变化，请重新逐笔确认`);
    const row = mappedRow(e.accountCode, c.mappings)!;
    if (r.row !== row) throw new Error(`科目${e.accountCode}与所选收入费用项目不一致`);
    if (
      exactSum(r.allocations.map((a) => a.debit)) !== e.debit ||
      exactSum(r.allocations.map((a) => a.credit)) !== e.credit
    )
      throw new Error(`凭证${e.displayNo}第${e.lineNo}行分配借贷金额不守恒`);
    for (const a of r.allocations) {
      const resource = resources.get(a.resourceId);
      if (!resource) throw new Error(`资源批次${a.resourceId}不存在`);
      if (a.acquisitionReference !== resource.acquisitionReference)
        throw new Error(`资源${resource.name}缺少正确取得或使用关联`);
      if (
        (a.debit !== 0 &&
          (e.debit === 0 ||
            Math.sign(a.debit) !== Math.sign(e.debit) ||
            Math.abs(a.debit) > Math.abs(e.debit))) ||
        (a.credit !== 0 &&
          (e.credit === 0 ||
            Math.sign(a.credit) !== Math.sign(e.credit) ||
            Math.abs(a.credit) > Math.abs(e.credit)))
      )
        throw new Error('分配金额方向与实际借贷方向不一致');
      const amount =
        exactSum([a.credit, -a.debit]) * ((expenseIds as readonly string[]).includes(row) ? -1 : 1);
      if (row === 'activityCost' && amount !== 0 && !a.detail)
        throw new Error(`凭证${e.displayNo}业务活动成本尚未确认实际业务组成，请填写项目或服务名称`);
      if (
        a.classification !== resource.classification &&
        !c.events.some(
          (event) =>
            event.resourceId === resource.id &&
            event.date <= e.date &&
            event.kind === (a.classification === 'restricted' ? 'restriction' : 'release'),
        )
      )
        throw new Error(`资源${resource.name}的分类缺少真实设限或解除事件`);
      const base = {
        period: e.period,
        kind: a.classification,
        source: lineSource(e),
      };
      out.push({ ...base, row, amount });
      if (a.detail) {
        if (row !== 'activityCost') throw new Error('业务组成只能分配业务活动成本');
        out.push({ ...base, row: `detail:${a.detail}`, amount });
      }
      if (a.charitableTrust) {
        if (row !== 'activityCost') throw new Error('设立慈善信托支出须属于业务活动成本');
        out.push({ ...base, row: 'charitableTrust', amount });
      }
      if (a.fundraisingCost) {
        if (row !== 'fundraising') throw new Error('募捐成本须属于筹资费用');
        out.push({ ...base, row: 'fundraisingCost', amount });
      }
    }
  }
  // 每个真实损益科目均须有明确行，借贷抵销的发生额也不可遗漏。
  const categories = new Map(s.accounts.map((a) => [a.id, a]));
  for (const e of s.entries) {
    const a = categories.get(e.accountId);
    if (!a) throw new Error('实际科目结构已变化');
    if (
      s.categories.find((c) => c.id === a.categoryId)?.isPnl &&
      ![...incomeIds, ...expenseIds].includes(
        mappedRow(a.code, c.mappings) as (typeof incomeIds)[number],
      )
    )
      throw new Error(`科目${a.code}尚未映射正确的收入费用项目`);
  }
  return out;
}
export function classifyNetAssetEvents(s: Sources, c: Configuration): ClassifiedAmount[] {
  const out: ClassifiedAmount[] = [],
    consumed = new Map<number, { debit: number[]; credit: number[] }>();
  const resources = new Map(c.resources.map((r) => [r.id, r]));
  const eventIds = new Set<string>();
  for (const event of c.events.filter((e) => e.date >= s.openingDate && e.date <= s.closingDate)) {
    if (eventIds.has(event.id)) throw new Error('净资产事件重复');
    eventIds.add(event.id);
    const resource = resources.get(event.resourceId);
    if (!resource) throw new Error('净资产事件缺少资源批次');
    const p = Number(event.date.slice(0, 7).replace('-', ''));
    if (p < s.from || p > s.to) throw new Error('净资产事件时点不在实际取数范围');
    const sums: Record<string, number[]> = {};
    for (const a of event.lines) {
      const e = s.entries.find((e) => e.lineId === a.line.lineId);
      if (
        !e ||
        !sameLine(a.line, lineIdentity(e)) ||
        e.period !== p ||
        e.date !== event.date ||
        e.closingKind === 'pnl'
      )
        throw new Error('净资产事件分录、日期或版本已变化');
      if (
        (a.debit !== 0 &&
          (e.debit === 0 ||
            Math.sign(a.debit) !== Math.sign(e.debit) ||
            Math.abs(a.debit) > Math.abs(e.debit))) ||
        (a.credit !== 0 &&
          (e.credit === 0 ||
            Math.sign(a.credit) !== Math.sign(e.credit) ||
            Math.abs(a.credit) > Math.abs(e.credit)))
      )
        throw new Error('净资产事件拆分方向与真实分录不一致或超过实际金额');
      const old = consumed.get(e.lineId) ?? { debit: [], credit: [] };
      old.debit.push(a.debit);
      old.credit.push(a.credit);
      consumed.set(e.lineId, old);
      const row = mappedRow(e.accountCode, c.mappings)!;
      (sums[row] ??= []).push(exactSum([a.credit, -a.debit]));
    }
    const amount = (row: string) => exactSum(sums[row] ?? []);
    const push = (row: string, kind: 'unrestricted' | 'restricted', n: number) =>
      out.push({ period: p, row, kind, amount: n, source: event.sourceReference });
    if (event.kind === 'release' || event.kind === 'restriction') {
      if (event.amount <= 0 || !event.restriction)
        throw new Error('净资产互转须有正金额及外部限制依据');
      if (new Set(event.lines.map((a) => a.line.voucherId)).size !== 1)
        throw new Error('净资产互转须对应同一实际凭证的两类净资产分录');
      if (event.restriction.resourceReference !== event.resourceId)
        throw new Error('互转限制依据与资源批次不一致');
      checkRestrictionTransferEvidence(
        event.kind === 'release' ? 'release' : 'impose',
        event.restriction,
      );
      if (event.kind === 'release') {
        const original = [
          ...(resource.restriction ? [resource.restriction] : []),
          ...c.events
            .filter(
              (x) =>
                x.resourceId === event.resourceId &&
                x.kind === 'restriction' &&
                (x.date < event.date ||
                  (x.date === event.date &&
                    Math.min(...x.lines.map((l) => l.line.voucherId)) <
                      Math.min(...event.lines.map((l) => l.line.voucherId)))),
            )
            .map((x) => x.restriction!)
            .filter(Boolean),
        ];
        assertOriginalRestrictionsReleased(original, event.releaseEvidence ?? [event.restriction]);
      }
      const u = event.kind === 'release' ? event.amount : -event.amount;
      if (
        amount('unrestricted') !== u ||
        amount('restricted') !== -u ||
        Object.keys(sums).some((k) => !['unrestricted', 'restricted'].includes(k))
      )
        throw new Error('互转必须由真实两类净资产对应分录构成且金额相等');
      push(event.kind, 'unrestricted', u);
      push(event.kind, 'restricted', -u);
    } else if (event.kind === 'priorAdjustment') {
      if (!event.originalPeriod || Math.floor(event.originalPeriod / 100) >= Math.floor(p / 100))
        throw new Error('以前年度调整须填写真实原期间和调整依据');
      if (
        !Object.hasOwn(sums, 'priorAdjustment') ||
        Object.keys(sums).some((k) => k === 'unrestricted' || k === 'restricted')
      )
        throw new Error('以前年度调整须关联3201原调整分录，不重复计入其结转');
      const n = amount('priorAdjustment');
      if (n !== event.amount) throw new Error('以前年度调整金额与3201实际发生不一致');
      push('priorAdjustment', resource.classification, n);
    } else {
      const n = amount(resource.classification);
      if (
        n !== event.amount ||
        Object.keys(sums).some(
          (k) =>
            k === 'priorAdjustment' ||
            k === (resource.classification === 'restricted' ? 'unrestricted' : 'restricted'),
        )
      )
        throw new Error('注册资金须与实际对应净资产分录一致');
      push('directCapital', resource.classification, n);
    }
  }
  for (const [id, a] of consumed) {
    const e = s.entries.find((e) => e.lineId === id)!;
    if (exactSum(a.debit) !== e.debit || exactSum(a.credit) !== e.credit)
      throw new Error('净资产事件逐笔分配金额不守恒');
  }
  // 3201转入净资产的结转不重复列报；其他3101/3102实际业务必须明确事件性质。
  const adjustmentVouchers = new Set(
    s.entries
      .filter((e) => mappedRow(e.accountCode, c.mappings) === 'priorAdjustment')
      .map((e) => e.voucherId),
  );
  for (const e of s.entries) {
    const row = mappedRow(e.accountCode, c.mappings);
    if (
      ['unrestricted', 'restricted', 'priorAdjustment'].includes(row ?? '') &&
      e.closingKind !== 'pnl' &&
      !consumed.has(e.lineId)
    ) {
      if (adjustmentVouchers.has(e.voucherId)) {
        const lines = s.entries.filter((x) => x.voucherId === e.voucherId);
        if (
          lines.every((x) =>
            ['unrestricted', 'restricted', 'priorAdjustment'].includes(
              mappedRow(x.accountCode, c.mappings) ?? '',
            ),
          )
        )
          continue;
      }
      throw new Error(`凭证${e.displayNo}净资产分录尚未确认互转、调整或注册资金性质`);
    }
  }
  return out;
}
export function activityStatement(s: Sources, c: Configuration, r: StatementRequest): Statement {
  const amounts = [...classifyActivity(s, c), ...classifyNetAssetEvents(s, c)];
  const checks: Check[] = [];
  const columns = [
    r.kind === 'month'
      ? '本月数'
      : r.kind === 'quarter'
        ? '本季度数'
        : r.kind === 'half'
          ? '本半年度数'
          : r.kind === 'annual'
            ? '本年数'
            : '本中期数',
    '本年累计数',
  ].flatMap((x) => [`${x}·非限定性`, `${x}·限定性`, `${x}·合计`]);
  const rowList = activityRows.filter((x) => x.id !== 'activityDetails');
  const details = [
    ...new Set(amounts.filter((a) => a.row.startsWith('detail:')).map((a) => a.row)),
  ];
  rowList.splice(
    rowList.findIndex((x) => x.id === 'activityCost') + 1,
    0,
    ...details.map((id) => ({ id, label: `其中：${id.slice(7)}` })),
  );
  const rows = rowList.map((row) => {
    if (row.section) return { ...row, values: [], sources: [] };
    const vals: number[] = [];
    for (const from of [r.from, s.from]) {
      const cls = (id: string, k: string) => value(amounts, id, k, from, r.to);
      for (const k of ['unrestricted', 'restricted']) {
        const sum = (ids: readonly string[]) => exactSum(ids.map((id) => cls(id, k)));
        vals.push(
          row.id === 'incomeTotal'
            ? sum(incomeIds)
            : row.id === 'expenseTotal'
              ? sum(expenseIds)
              : row.id === 'netChange'
                ? exactSum([
                    sum(incomeIds),
                    -sum(expenseIds),
                    cls('release', k),
                    cls('restriction', k),
                    cls('priorAdjustment', k),
                  ])
                : cls(row.id, k),
        );
      }
      vals.push(exactSum(vals.slice(-2)));
      if (['release', 'restriction'].includes(row.id))
        checks.push({
          name: '两类净资产互转合计抵销',
          row: row.label,
          column: from === r.from ? '本期合计' : '累计合计',
          from,
          to: r.to,
          difference: vals.at(-1)!,
          sources: amounts.filter((a) => a.row === row.id).map((a) => a.source),
        });
    }
    return {
      ...row,
      values: vals,
      sources: amounts.filter((a) => a.row === row.id).map((a) => a.source),
    };
  });
  return {
    code: '402',
    name: '业务活动表',
    organization: s.book.orgName,
    unpostedCount: s.unpostedCount,
    period: r,
    columns,
    rows,
    checks,
    notes: [
      ...(Math.floor(r.to / 100) === 2026
        ? ['2026年首次执行：业务活动表上年比较数不要求填列。']
        : []),
      ...(amounts.some((a) => a.row === 'directCapital')
        ? ['注册资金直接计入净资产，见净资产首尾承接核对。']
        : []),
    ],
  };
}
