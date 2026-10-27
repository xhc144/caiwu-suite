import Decimal from 'decimal.js';
import { makePeriod, periodYear, periodRange, periodStartDate, periodEndDate } from '@caiwu/core';
import { ASSETS, LIABILITIES_EQUITY, PROFIT, CASHFLOW, type Line } from './lines';
import { EQUITY, EQUITY_LABELS } from './equity-lines';
import {
  parseEnterpriseConfiguration,
  FORMAT,
  EQUITY_COLUMNS,
  balanceBucket,
  type EnterpriseConfig,
  type SourceData,
  type Values,
  type Matrix,
  type Check,
  type Range,
  type ClassificationFact,
} from './model';
const Exact = Decimal.clone({ precision: 40 });
const D = (n: Decimal.Value) => new Exact(n);
function fail(s: string): never {
  throw new Error(s);
}
const add = (v: Values, k: string, n: Decimal.Value) => {
  v[k] = D(v[k] ?? 0)
    .plus(n)
    .toFixed();
};
const empty = (lines: Line[]): Values =>
  Object.fromEntries(lines.filter((l) => !l.section).map((l) => [l.key, '0']));
function totals(v: Values, lines: Line[]) {
  const done = new Set<string>();
  const visit = (k: string): string => {
    if (done.has(k)) return v[k]!;
    const l = lines.find((l) => l.key === k);
    if (l?.total)
      v[k] = l.total.reduce((s, t) => s.plus(D(visit(t.key)).times(t.sign)), D(0)).toFixed();
    done.add(k);
    return v[k] ?? fail(`缺少合计组成项目${k}`);
  };
  lines.filter((l) => !l.section).forEach((l) => visit(l.key));
}
export function enterpriseRanges(c: EnterpriseConfig): {
  current: Range;
  previous: Range;
  balancePrevious: number;
} {
  const y = periodYear(c.period),
    m = c.period % 100;
  if (c.scope === 'annual' && m !== 12) fail('年度报表必须选择12月并覆盖1至12月，请调整报告期间');
  return {
    current: {
      from: makePeriod(y, c.scope === 'month' ? m : 1),
      to: c.period,
      label: c.scope === 'month' ? '本月金额' : c.scope === 'annual' ? '本年金额' : '本年累计金额',
    },
    previous: {
      from: makePeriod(y - 1, c.scope === 'month' ? m : 1),
      to: makePeriod(y - 1, m),
      label:
        c.scope === 'month'
          ? '上年同月金额'
          : c.scope === 'annual'
            ? '上年金额'
            : '上年同期累计金额',
    },
    balancePrevious: makePeriod(y - 1, 12),
  };
}
const costLines = new Set([
  'cost',
  'taxes',
  'selling',
  'administration',
  'research',
  'finance',
  'interestExpense',
  'nonoperatingExpense',
  'incomeTax',
]);
const balanceLines = [...ASSETS, ...LIABILITIES_EQUITY];
const creditLines = new Set(
  LIABILITIES_EQUITY.filter((l) => !l.section && !l.total && l.key !== 'treasuryStock').map(
    (l) => l.key,
  ),
);
const ociLines = [
  'remeasurement',
  'equityNonreclass',
  'otherEquityFairValue',
  'ownCreditRisk',
  'otherNonreclass',
  'equityReclass',
  'debtFairValue',
  'financialReclassification',
  'debtImpairment',
  'cashflowHedge',
  'translation',
  'otherReclass',
];
const longAsset = new Set([
  'debtInvestments',
  'otherDebtInvestments',
  'longTermReceivables',
  'otherNoncurrentAssets',
]);
const longLiability = new Set([
  'longTermLoans',
  'bondsPayable',
  'leaseLiabilities',
  'longTermPayables',
  'otherNoncurrentLiabilities',
]);
const roleLabels: Record<string, string> = {
  allowance: '减值备抵',
  depreciation: '累计折旧或折耗',
  amortization: '累计摊销',
  clearing: '清理余额',
  financing: '未确认融资费用',
  special: '专项应付款',
};
const rowLabel = (key: string) =>
  balanceLines.find((l) => l.key === key)?.label ??
  (
    { contractAcquisition: '合同取得成本', contractFulfilment: '合同履约成本' } as Record<
      string,
      string
    >
  )[key] ??
  '列报项目';
export const NET_ROLES: Record<string, string[]> = {
  notesReceivable: ['allowance'],
  accountsReceivable: ['allowance'],
  otherReceivables: ['allowance'],
  inventory: ['allowance'],
  heldForSaleAssets: ['allowance'],
  debtInvestments: ['allowance'],
  longTermReceivables: ['allowance'],
  equityInvestments: ['allowance'],
  investmentProperty: ['depreciation', 'allowance'],
  fixedAssets: ['depreciation', 'allowance', 'clearing'],
  construction: ['allowance'],
  biologicalAssets: ['depreciation', 'allowance'],
  oilGasAssets: ['depreciation', 'allowance'],
  rightOfUseAssets: ['depreciation', 'allowance'],
  intangibleAssets: ['amortization', 'allowance'],
  goodwill: ['allowance'],
  contractAssets: ['allowance'],
  contractAcquisition: ['allowance'],
  contractFulfilment: ['allowance'],
  longTermPayables: ['financing', 'special'],
};
function fact(
  c: EnterpriseConfig,
  key: string,
  p: number,
  basis: 'opening' | 'closing' = 'closing',
): ClassificationFact {
  return (
    c.facts.find((f) => f.bucket === key && f.period === p && f.basis === basis) ??
    fail(`${p}明细${key}缺少本报告日分类依据，请确认合同、期限、计量类别并保存`)
  );
}
const inRange = (p: number, r: Range) => p >= r.from && p <= r.to;
function validate(c: EnterpriseConfig, d: SourceData) {
  if (d.regime !== 'enterprise') fail('当前账套不是企业会计准则账套');
  const ranges = enterpriseRanges(c),
    first = periodStartDate(ranges.previous.from);
  if ([c.adoption.financial, c.adoption.revenue, c.adoption.lease].some((date) => date > first))
    fail(
      '比较期间尚未同时执行新金融、新收入及新租赁准则，请提供对应衔接格式；不能用附件2替代未重列的附件1比较数',
    );
  const mandatory =
    c.adoption.entityClass === 'domesticListed'
      ? '2029-01-01'
      : c.adoption.entityClass === 'unlisted'
        ? '2030-01-01'
        : '2027-01-01';
  if (c.adoption.cas30_2026 && c.adoption.cas30_2026 < '2026-07-24')
    fail('2026列报准则提前执行日不能早于正式发布日期');
  if (
    periodEndDate(c.period) >= mandatory ||
    (c.adoption.cas30_2026 && c.adoption.cas30_2026 <= periodEndDate(c.period))
  )
    fail('账套已采用2026列报准则，本格式仅适用2019附件2，请选择匹配版本');
  for (const r of [ranges.current, ranges.previous])
    for (const p of periodRange(r.from, r.to)) {
      if (p < d.startPeriod) fail(`${p}早于账套启用期间，未知累计数不能代替完整比较数`);
      if (!d.periods.includes(p)) fail(`缺少会计期间${p}`);
    }
  const seen = new Set<number>();
  for (const r of c.rules) {
    if (seen.has(r.accountId)) fail(`科目${r.accountId}重复映射，原值和备抵不能重复扣减`);
    seen.add(r.accountId);
    const a = d.accounts.find((a) => a.id === r.accountId);
    if (!a?.isLeaf) fail(`科目${r.accountId}不存在或不是末级`);
    if ((r.kind === 'pnl') !== d.pnlCategoryIds.includes(a.categoryId))
      fail(`科目${a.code}损益类别与用途不一致`);
    if (r.kind === 'currentProfit' && r.line !== 'retainedEarnings')
      fail('本年利润只能并入未分配利润');
    const lines = r.kind === 'pnl' ? PROFIT : balanceLines;
    if (
      !lines.some((l) => l.key === r.line && !l.total && !l.section) &&
      !['contractAcquisition', 'contractFulfilment', 'returnAsset', 'returnLiability'].includes(
        r.line,
      )
    )
      fail(`科目${a.code}的列报项目无效：${r.line}`);
    if (r.parent && !['finance', 'investmentIncome'].includes(r.parent))
      fail(`科目${a.code}其中项的上级无效`);
  }
  for (const a of d.accounts.filter((a) => a.isLeaf))
    if (!seen.has(a.id)) fail(`遗漏科目${a.code} ${a.name}，请确认其列报项目；未映射不能当零`);
  const unique = (items: string[], label: string) => {
    if (new Set(items).size !== items.length) fail(`${label}重复，不能覆盖或重复累计`);
  };
  unique(
    c.facts.map((f) => `${f.period}:${f.basis}:${f.bucket}`),
    '报告日分类',
  );
  unique(
    c.cashAllocations.map((a) => String(a.lineId)),
    '现金分录分配',
  );
  unique(
    c.equityEvents.map((a) => String(a.lineId)),
    '权益分录分类',
  );
  unique(
    c.oci.map((a) => String(a.lineId)),
    '其他综合收益分录',
  );
  unique(
    d.entries.map((e) => String(e.lineId)),
    '账务分录来源',
  );
  unique(
    c.cashPolicies.map((p) => `${p.period}:${p.basis}`),
    '现金范围',
  );
  for (const p of [
    ...new Set([
      c.period,
      ranges.balancePrevious,
      ...(c.scope === 'annual' ? [makePeriod(periodYear(c.period) - 2, 12)] : []),
    ]),
  ]) {
    if (!d.balances[p]) fail(`缺少报告日${p}余额来源`);
    for (const [line, roles] of Object.entries(NET_ROLES)) {
      if (!c.rules.some((r) => r.line === line && r.role === 'gross')) continue;
      for (const role of roles)
        if (
          !c.rules.some((r) => r.line === line && r.role === role) &&
          !c.absentRoles.some((a) => a.period === p && a.line === line && a.role === role)
        )
          fail(
            `${p} ${rowLabel(line)}缺少组成角色“${roleLabels[role] ?? '其他组成'}”，请匹配真实科目或保存不适用依据`,
          );
    }
  }
  unique(
    c.contractNetAllocations.map((x) => `${x.period}:${x.basis}:${x.contractId}`),
    '合同净额期限分配',
  );
  for (const [period, rows] of Object.entries(d.balances))
    unique(rows.map(balanceBucket), `${period}余额明细`);
  for (const rows of Object.values(d.balances))
    for (const row of rows) {
      if (!row.isLeaf) fail(`余额来源含上级科目${row.accountCode}，不能重复汇总`);
      if (!Number.isSafeInteger(row.closing) || !Number.isSafeInteger(row.opening))
        fail(`科目${row.accountCode}余额超出精确范围`);
    }
  for (const e of d.entries) {
    const v = d.vouchers.find((v) => v.id === e.voucherId);
    if (!v || v.status !== 'posted' || v.voided || e.status !== 'posted')
      fail(`分录${e.lineId}缺少有效已过账凭证来源`);
    if (!Number.isSafeInteger(e.debit) || !Number.isSafeInteger(e.credit))
      fail(`分录${e.lineId}金额超出精确范围`);
  }
  for (const items of [c.cashAllocations, c.equityEvents, c.oci, c.discontinued])
    for (const f of items)
      if (!d.entries.some((e) => e.lineId === f.lineId))
        fail(`配置引用失效分录${f.lineId}，请重新确认来源`);
}
function check(
  checks: Check[],
  statement: string,
  row: string,
  column: string,
  period: number,
  a: Decimal.Value,
  b: Decimal.Value,
  hint: string,
  sources: string[] = [],
) {
  checks.push({
    statement,
    row,
    column,
    period,
    difference: D(a).minus(b).toFixed(),
    hint,
    sources,
  });
}
function adjusted(
  c: EnterpriseConfig,
  statement: 'balance' | 'profit' | 'cashflow',
  p: number,
  v: Values,
  lines: Line[],
) {
  for (const a of c.adjustments.filter((a) => a.statement === statement && a.period === p)) {
    if (!lines.some((l) => l.key === a.row && !l.total && !l.section))
      fail(`比较调整必须定位明细项目：${a.row}`);
    add(v, a.row, a.amount);
    if (statement === 'profit') {
      const parent = ['interestExpense', 'interestIncome'].includes(a.row)
        ? 'finance'
        : ['associateIncome', 'derecognitionIncome'].includes(a.row)
          ? 'investmentIncome'
          : undefined;
      if (parent) add(v, parent, a.row === 'interestIncome' ? D(a.amount).neg() : a.amount);
    }
  }
}
function unclosed(
  c: EnterpriseConfig,
  d: SourceData,
  p: number,
  field: 'opening' | 'closing' = 'closing',
) {
  return (d.balances[p] ?? fail(`缺少${p}余额`)).reduce((s, row) => {
    const r = c.rules.find((r) => r.accountId === row.accountId)!;
    return r.kind === 'pnl' ? s.minus(row[field]) : s;
  }, D(0));
}
export function calculateBalance(
  c: EnterpriseConfig,
  d: SourceData,
  p: number,
  field: 'opening' | 'closing' = 'closing',
): Values {
  const v = empty(balanceLines),
    contracts = new Map<
      string,
      {
        gross: Decimal;
        allowance: Decimal;
        currentGross: Decimal;
        noncurrentGross: Decimal;
        currentAllowance: Decimal;
        noncurrentAllowance: Decimal;
        parties: Set<number | null>;
      }
    >();
  const rows = d.balances[p] ?? fail(`缺少${p}余额来源`);
  const classified = rows.flatMap((row) => {
    const f = c.facts.find(
      (x) => x.period === p && x.basis === field && x.bucket === balanceBucket(row),
    );
    if (!f?.segments?.length) return [{ row, f }];
    if (
      new Set(f.segments.map((s) => s.key)).size !== f.segments.length ||
      !f.segments.reduce((n, s) => n.plus(s.amount), D(0)).eq(row[field])
    )
      fail(`${p}明细${row.accountCode}分类分项重复或合计与余额不一致`);
    return f.segments.map((segment) => {
      if (!Number.isSafeInteger(Number(segment.amount))) fail('分类分项金额超出精确范围');
      return { row: { ...row, [field]: Number(segment.amount) }, f: { ...f, ...segment } };
    });
  });
  for (const { row, f: preparedFact } of classified) {
    let effectiveFact = preparedFact;
    const getFact = () => effectiveFact ?? fact(c, balanceBucket(row), p, field);
    const r =
        c.rules.find((r) => r.accountId === row.accountId) ?? fail(`遗漏科目${row.accountCode}`),
      n = D(row[field]);
    if (r.kind === 'pnl') continue;
    if (
      ['allowance', 'financing'].includes(r.role) &&
      ['receivable', 'payable', 'financial', 'maturity', 'contractCost', 'contract'].includes(
        r.kind,
      )
    ) {
      const original = getFact();
      const candidates = classified.filter((x) => {
        const segmentKey = (x.f as (ClassificationFact & { key?: string }) | undefined)?.key;
        const key = balanceBucket(x.row) + (segmentKey ? '#' + segmentKey : '');
        return key === original.allowanceFor;
      });
      if (candidates.length !== 1)
        fail(`${p}备抵或融资费用${row.accountCode}必须唯一绑定对应明细分项`);
      const target = candidates[0]!,
        targetRule = c.rules.find((x) => x.accountId === target.row.accountId)!;
      if (targetRule.line !== r.line || targetRule.role !== 'gross')
        fail('备抵与其对应项目或组成角色不一致');
      const targetFact = target.f ?? fact(c, balanceBucket(target.row), p, field);
      for (const key of [
        'current',
        'duePeriod',
        'category',
        'expectedHoldMonths',
        'originallyLongTerm',
        'initialTermMonths',
        'normalCycleMonths',
        'contractId',
      ] as const)
        if (original[key] !== undefined && original[key] !== targetFact[key])
          fail(`${p}备抵或融资费用的分类与对应资产不一致`);
      effectiveFact = targetFact;
    }
    if (r.kind === 'contract') {
      const f = getFact();
      if (!f.contractId || f.current === undefined)
        fail(`${p}合同${balanceBucket(row)}缺少合同身份或流动性`);
      const key = f.contractId,
        prior = contracts.get(key);
      const item = prior ?? {
        gross: D(0),
        allowance: D(0),
        currentGross: D(0),
        noncurrentGross: D(0),
        currentAllowance: D(0),
        noncurrentAllowance: D(0),
        parties: new Set<number | null>(),
      };
      item.parties.add(row.dimensions.partner ?? null);
      if (item.parties.size > 1) fail(`${p}合同${key}跨往来对象，禁止抵销`);
      if (r.role === 'allowance') {
        item.allowance = item.allowance.plus(n);
        if (f.current) item.currentAllowance = item.currentAllowance.plus(n);
        else item.noncurrentAllowance = item.noncurrentAllowance.plus(n);
      } else {
        item.gross = item.gross.plus(n);
        if (f.current) item.currentGross = item.currentGross.plus(n);
        else item.noncurrentGross = item.noncurrentGross.plus(n);
      }
      contracts.set(key, item);
      continue;
    }
    if (r.kind === 'equityInstrument') {
      const f = getFact(),
        parts = f.parts ?? fail(`${p}金融工具缺少权益/负债分类`);
      if (new Set(parts.map((x) => x.id)).size !== parts.length) fail('同一工具明细重复');
      if (!parts.reduce((s, x) => s.plus(x.amount), D(0)).eq(n))
        fail(`${p}金融工具分项金额与科目${row.accountCode}不一致`);
      for (const part of parts) {
        if (part.instrument === 'ordinary' && part.classification === 'liability')
          fail('普通股工具的负债分类需选择实际合同工具类型');
        const due = part.duePeriod ?? f.duePeriod,
          current = part.current ?? f.current;
        if (
          part.classification === 'liability' &&
          (current === undefined || (due === undefined && !current))
        )
          fail(`${p}负债工具${part.id}缺少到期及流动性依据`);
        const short =
          part.classification === 'liability' &&
          (current || due! <= makePeriod(periodYear(p) + 1, p % 100));
        const line =
          part.classification === 'equity'
            ? part.instrument === 'ordinary'
              ? 'capital'
              : 'otherEquity'
            : short
              ? 'currentNoncurrentLiabilities'
              : 'bondsPayable';
        add(v, line, D(part.amount).neg());
        if (['preferred', 'perpetual'].includes(part.instrument) && !short)
          add(
            v,
            `${part.classification === 'equity' ? 'equity' : 'bond'}${part.instrument === 'preferred' ? 'Preferred' : 'Perpetual'}`,
            D(part.amount).neg(),
          );
        else if (part.classification === 'equity' && part.instrument === 'other')
          add(v, 'equityOther', D(part.amount).neg());
      }
      continue;
    }
    let line = r.kind === 'oci' ? 'otherComprehensive' : r.line;
    if (r.kind === 'receivable' || r.kind === 'payable') {
      const f = getFact();
      if (f.current === undefined) fail(`${p}往来明细缺少流动性依据`);
      if (['accountsReceivable', 'advances'].includes(r.line))
        line = n.gte(0)
          ? f.current
            ? 'accountsReceivable'
            : 'otherNoncurrentAssets'
          : f.current
            ? 'advances'
            : 'otherNoncurrentLiabilities';
      else if (['prepayments', 'accountsPayable'].includes(r.line))
        line = n.gte(0)
          ? f.current
            ? 'prepayments'
            : 'otherNoncurrentAssets'
          : f.current
            ? 'accountsPayable'
            : 'otherNoncurrentLiabilities';
      else if (r.line === 'taxesPayable' && n.gt(0))
        line = f.current ? 'otherCurrentAssets' : 'otherNoncurrentAssets';
      if (['otherReceivables', 'otherPayables'].includes(r.line))
        line = n.gte(0)
          ? f.current
            ? 'otherReceivables'
            : 'otherNoncurrentAssets'
          : f.current
            ? 'otherPayables'
            : 'otherNoncurrentLiabilities';
      // 备抵沿其对应资产的实际报告日分类。
      if (r.role === 'allowance') {
        line = f.current ? r.line : 'otherNoncurrentAssets';
      }
    }
    if (r.kind === 'financial') {
      const f = getFact();
      if (!f.category) fail(`${p}金融资产缺少实际计量类别依据`);
      if (f.category !== 'equity-fvoci' && f.expectedHoldMonths === undefined)
        fail(`${p}金融资产缺少预期持有期限`);
      if (
        ['amortized', 'fvoci'].includes(f.category) &&
        (f.duePeriod === undefined || f.originallyLongTerm === undefined)
      )
        fail(`${p}债务资产缺少到期和初始期限依据`);
      if (f.category === 'fvtpl' && f.duePeriod === undefined && f.contractualMaturity !== 'none')
        fail(`${p}金融资产缺少到期或无合同到期的依据`);
      if (r.role === 'allowance' && f.category === 'fvoci')
        fail('以公允价值计量且变动计入其他综合收益的债务资产，信用损失不得再次抵减其公允价值');
      if (f.category === 'amortized' && (!f.sppi || f.businessModel !== 'collect'))
        fail('摊余成本计量必须保存本金加利息特征及收取现金流量的业务模式依据');
      if (f.category === 'fvoci' && (!f.sppi || f.businessModel !== 'collectAndSell'))
        fail('债务工具计入其他综合收益必须核实本金加利息特征及收取并出售的业务模式');
      if (f.category === 'equity-fvoci' && (!f.nonTrading || !f.irrevocableElection))
        fail('其他权益工具投资必须有非交易性及不可撤销指定依据');
      const short =
        f.duePeriod !== undefined && f.duePeriod <= makePeriod(periodYear(p) + 1, p % 100);
      if (f.category === 'fvtpl')
        line = !short && f.expectedHoldMonths! > 12 ? 'otherFinancialAssets' : 'tradingAssets';
      else if (f.category === 'equity-fvoci') line = 'otherEquityInvestments';
      else if (['notesReceivable', 'accountsReceivable'].includes(r.line))
        line = f.category === 'fvoci' ? 'receivablesFinancing' : r.line;
      else
        line = short
          ? f.originallyLongTerm
            ? 'currentNoncurrentAssets'
            : 'otherCurrentAssets'
          : f.category === 'fvoci'
            ? 'otherDebtInvestments'
            : 'debtInvestments';
    }
    if (r.kind === 'maturity') {
      const f = getFact();
      if (f.current === undefined || (f.duePeriod === undefined && !f.current))
        fail(`${p}期限项目缺少到期日及营业周期依据`);
      const short = f.current || f.duePeriod! <= makePeriod(periodYear(p) + 1, p % 100);
      if (r.line === 'otherCurrentAssets')
        line = short ? 'otherCurrentAssets' : 'otherNoncurrentAssets';
      if (short && longAsset.has(r.line)) line = 'currentNoncurrentAssets';
      if (short && longLiability.has(r.line)) line = 'currentNoncurrentLiabilities';
    }
    if (r.kind === 'contractCost' || r.kind === 'return') {
      const f = getFact();
      if (r.kind === 'contractCost') {
        if (f.initialTermMonths === undefined || f.normalCycleMonths === undefined)
          fail(`${p}合同成本缺少初始摊销期限及正常营业周期`);
        line =
          f.initialTermMonths <= Math.max(12, f.normalCycleMonths)
            ? r.line === 'contractFulfilment'
              ? 'inventory'
              : 'otherCurrentAssets'
            : 'otherNoncurrentAssets';
      } else {
        if (f.current === undefined) fail(`${p}退货项目缺少出售或清偿期限`);
        line =
          r.line === 'returnLiability'
            ? f.current
              ? 'otherCurrentLiabilities'
              : 'provisions'
            : f.current
              ? 'otherCurrentAssets'
              : 'otherNoncurrentAssets';
      }
    }
    if (r.line === 'investmentProperty') {
      const f = getFact();
      if (!f.measurementModel) fail(`${p}投资性房地产缺少计量模式`);
      if (f.measurementModel === 'fairValue' && r.role !== 'gross' && !n.isZero())
        fail('公允价值模式不得重复抵减折旧或减值');
    }
    add(v, line, creditLines.has(line) ? n.neg() : n);
  }
  for (const [id, x] of contracts) {
    const override = c.contractNetAllocations.find(
      (a) => a.period === p && a.basis === field && a.contractId === id,
    );
    const current = override ? D(override.currentAmount) : x.currentGross,
      noncurrent = override ? D(override.noncurrentAmount) : x.noncurrentGross;
    if (
      !current.plus(noncurrent).eq(x.gross) ||
      (!current.isZero() && current.isNegative() !== x.gross.isNegative()) ||
      (!noncurrent.isZero() && noncurrent.isNegative() !== x.gross.isNegative())
    )
      fail(`${p}合同${id}需在同合同净额确认后保存流动及非流动分配，不能同时列资产和负债`);
    if (x.gross.gte(0)) {
      if (current.plus(x.currentAllowance).lt(0) || noncurrent.plus(x.noncurrentAllowance).lt(0))
        fail('合同减值超过对应期限净资产，请重新分配');
      add(v, 'contractAssets', current.plus(x.currentAllowance));
      add(v, 'otherNoncurrentAssets', noncurrent.plus(x.noncurrentAllowance));
    } else {
      if (!x.allowance.isZero()) fail('合同为净负债但仍分配合同资产减值，请核实合同范围');
      add(v, 'contractLiabilities', current.neg());
      add(v, 'otherNoncurrentLiabilities', noncurrent.neg());
    }
  }
  add(v, 'retainedEarnings', unclosed(c, d, p, field));
  if (field === 'closing') adjusted(c, 'balance', p, v, balanceLines);
  v.equityOther = D(v.otherEquity!).minus(v.equityPreferred!).minus(v.equityPerpetual!).toFixed();
  totals(v, balanceLines);
  return v;
}
function isClosing(d: SourceData, e: SourceData['entries'][number]) {
  const v = d.vouchers.find((v) => v.id === e.voucherId);
  return (
    v?.closingKind === 'pnl' &&
    v.source?.module === 'period-close' &&
    v.source.type === 'closing' &&
    v.source.id.startsWith(`${e.period}:`)
  );
}
export function calculateProfit(c: EnterpriseConfig, d: SourceData, r: Range): Values {
  const v = empty(PROFIT);
  let discontinued = D(0);
  for (const e of d.entries.filter((e) => inRange(e.period, r))) {
    const rule = c.rules.find((x) => x.accountId === e.accountId)!;
    if (rule.kind === 'pnl' && !isClosing(d, e)) {
      const n = costLines.has(rule.line) ? D(e.debit).minus(e.credit) : D(e.credit).minus(e.debit);
      add(v, rule.line, n);
      const parent = ['interestExpense', 'interestIncome'].includes(rule.line)
        ? 'finance'
        : ['associateIncome', 'derecognitionIncome'].includes(rule.line)
          ? 'investmentIncome'
          : rule.parent;
      if (parent) add(v, parent, rule.line === 'interestIncome' ? n.neg() : n);
      if (c.discontinued.some((x) => x.lineId === e.lineId))
        discontinued = discontinued.plus(costLines.has(rule.line) ? n.neg() : n);
    }
    if (rule.kind === 'oci') {
      const internal = c.equityEvents.find((x) => x.lineId === e.lineId);
      if (internal) continue;
      const f =
        c.oci.find((x) => x.lineId === e.lineId) ??
        fail(`${e.period}其他综合收益分录${e.lineId}缺少所得税分配及来源`);
      if (!ociLines.includes(f.line)) fail(`其他综合收益分录${e.lineId}项目无效`);
      const net = D(f.gross).minus(f.tax);
      if (!net.eq(D(e.credit).minus(e.debit)))
        fail(`其他综合收益分录${e.lineId}税后净额与账务不一致`);
      add(v, f.line, net);
    }
  }
  adjusted(c, 'profit', r.to, v, PROFIT);
  totals(v, PROFIT);
  v.discontinuedProfit = discontinued.toFixed();
  v.continuingProfit = D(v.netProfit!).minus(discontinued).toFixed();
  const eps =
    c.eps.find((x) => x.from === r.from && x.to === r.to) ??
    fail(`${r.from}至${r.to}缺少每股收益适用依据`);
  if (!eps.applicable) {
    v.basicEps = '不适用';
    v.dilutedEps = '不适用';
    return v;
  }
  const from = periodStartDate(r.from),
    to = periodEndDate(r.to),
    day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86400000;
  let shares = D(0),
    covered = 0,
    last = from;
  for (const s of c.shares
    .filter((s) => s.to >= from && s.from <= to)
    .sort((a, b) => a.from.localeCompare(b.from))) {
    const a = s.from < from ? from : s.from,
      b = s.to > to ? to : s.to;
    if (a !== last) fail('加权普通股资料存在重叠或缺日，不能用期末股本替代');
    const days = day(b) - day(a) + 1;
    shares = shares.plus(D(s.ordinary).times(days));
    covered += days;
    last = new Date((day(b) + 1) * 86400000).toISOString().slice(0, 10);
  }
  const days = day(to) - day(from) + 1;
  if (covered !== days) fail('加权普通股资料未覆盖完整期间');
  shares = shares.div(days);
  if (shares.lte(0)) fail('适用每股收益但加权普通股为零');
  let numerator = D(v.netProfit!).minus(eps.preference).div(100),
    denominator = shares;
  v.basicEps = numerator.div(denominator).toDecimalPlaces(4).toFixed(4);
  for (const x of [...eps.dilutions].sort((a, b) =>
    D(a.numerator)
      .div(D(a.shares).isZero() ? 1 : a.shares)
      .cmp(D(b.numerator).div(D(b.shares).isZero() ? 1 : b.shares)),
  )) {
    if (D(x.shares).lte(0)) fail('稀释工具增量股份必须为正');
    const n = numerator.plus(D(x.numerator).div(100)),
      den = denominator.plus(x.shares);
    if (n.div(den).lt(numerator.div(denominator))) {
      numerator = n;
      denominator = den;
    }
  }
  v.dilutedEps = numerator.div(denominator).toDecimalPlaces(4).toFixed(4);
  return v;
}
const receiptLines = new Set([
  'salesReceipts',
  'taxRefunds',
  'otherOperatingReceipts',
  'investmentRecovery',
  'investmentReturns',
  'assetDisposals',
  'businessDisposals',
  'otherInvestingReceipts',
  'capitalReceipts',
  'loanReceipts',
  'otherFinancingReceipts',
]);
const paymentLines = new Set([
  'purchases',
  'employees',
  'taxPayments',
  'otherOperatingPayments',
  'assetPurchases',
  'investmentPayments',
  'businessPurchases',
  'otherInvestingPayments',
  'debtPayments',
  'dividendInterestPayments',
  'otherFinancingPayments',
]);
function cashPolicy(
  c: EnterpriseConfig,
  d: SourceData,
  p: number,
  basis: 'opening' | 'closing' = 'closing',
) {
  const policy =
    c.cashPolicies.find((x) => x.period === p && x.basis === basis) ??
    fail(`${p}缺少现金和现金等价物范围，请明确受限资金及等价物依据`);
  if (
    new Set(policy.accounts).size !== policy.accounts.length ||
    policy.accounts.some((id) => policy.restrictedAccounts.includes(id))
  )
    fail(`${p}现金与受限资金范围重复`);
  for (const id of [...policy.accounts, ...policy.restrictedAccounts])
    if (!d.accounts.some((a) => a.id === id && a.isLeaf)) fail(`${p}现金范围引用失效科目${id}`);
  for (const a of d.accounts.filter((a) => a.isLeaf && (a.isCash || a.isBank)))
    if (!policy.accounts.includes(a.id) && !policy.restrictedAccounts.includes(a.id))
      fail(`${p}货币资金${a.code}尚未确认现金或受限范围`);
  return policy;
}
export function calculateCashflow(
  c: EnterpriseConfig,
  d: SourceData,
  r: Range,
  checks: Check[],
  column: string,
): Values {
  const v = empty(CASHFLOW),
    start = cashPolicy(c, d, r.from, 'opening'),
    end = cashPolicy(c, d, r.to),
    ids = new Set([
      ...start.accounts,
      ...end.accounts,
      ...start.restrictedAccounts,
      ...end.restrictedAccounts,
    ]);
  const openRows = d.balances[r.from] ?? fail(`缺少${r.from}期初余额`),
    closeRows = d.balances[r.to] ?? fail(`缺少${r.to}期末余额`);
  v.cashOpening = openRows
    .filter((x) => start.accounts.includes(x.accountId))
    .reduce((s, x) => s.plus(x.opening), D(0))
    .toFixed();
  const sourceClosing = closeRows
    .filter((x) => end.accounts.includes(x.accountId))
    .reduce((s, x) => s.plus(x.closing), D(0));
  const entries = d.entries.filter((e) => inRange(e.period, r) && ids.has(e.accountId));
  const changes = c.cashScopeChanges
      .filter((x) => inRange(x.period, r))
      .sort((a, b) => a.date.localeCompare(b.date)),
    membership = new Set(start.accounts);
  const seen = new Set<string>();
  let scopeChange = D(0);
  for (const change of changes) {
    const key = `${change.date}:${change.accountId}`;
    if (seen.has(key)) fail('同日同账户现金范围变化重复');
    seen.add(key);
    if (
      !change.date.startsWith(
        `${Math.floor(change.period / 100)}-${String(change.period % 100).padStart(2, '0')}`,
      )
    )
      fail('现金范围变化日期与期间不一致');
    if (!ids.has(change.accountId)) fail('现金范围变化引用未核实的账户');
    const removed = membership.has(change.accountId),
      n = openRows
        .filter((x) => x.accountId === change.accountId)
        .reduce((s, x) => s.plus(x.opening), D(0))
        .plus(
          entries
            .filter((e) => e.accountId === change.accountId && e.date < change.date)
            .reduce((s, e) => s.plus(e.debit).minus(e.credit), D(0)),
        );
    const expected = removed ? n.neg() : n;
    if (!expected.eq(change.amount))
      fail(
        `${change.date}现金范围变化金额与当日账面来源不一致，差额${D(change.amount).minus(expected)}`,
      );
    if ((change.kind === 'release' && removed) || (change.kind === 'restriction' && !removed))
      fail('现金范围变化类型与实际范围方向不一致');
    if (removed) membership.delete(change.accountId);
    else membership.add(change.accountId);
    scopeChange = scopeChange.plus(expected);
  }
  if ([...membership].sort().join(',') !== [...end.accounts].sort().join(','))
    fail('期末现金范围与逐项范围变化不一致');
  for (const e of entries) {
    const allocation =
      c.cashAllocations.find((a) => a.lineId === e.lineId) ??
      fail(
        `${e.period}凭证${e.displayNo}第${e.lineNo}行（分录${e.lineId}）现金${D(e.debit).minus(e.credit)}未分类`,
      );
    const net = D(e.debit).minus(e.credit),
      sum = allocation.parts.reduce((s, x) => s.plus(x.amount), D(0));
    if (!sum.eq(net)) fail(`${e.period}分录${e.lineId}现金分配差额${net.minus(sum)}，请逐笔核实`);
    let included = start.accounts.includes(e.accountId);
    for (const _change of changes.filter((x) => x.accountId === e.accountId && x.date <= e.date))
      included = !included;
    if (e.cashflowDirection === 'internal' && allocation.parts.some((x) => x.line !== 'internal'))
      fail(`分录${e.lineId}账务标记为内部划转，报表分配不一致`);
    if (
      e.cashflowDirection &&
      e.cashflowDirection !== 'internal' &&
      allocation.parts.some((x) => x.line === 'internal')
    )
      fail(`分录${e.lineId}账务标记为外部收付，不能抵销为内部划转`);
    for (const part of allocation.parts) {
      if (!included) {
        if (part.line !== 'excluded')
          fail(`分录${e.lineId}发生时属于受限或非现金资金，不能列入现金流量`);
        continue;
      }
      if (part.line === 'excluded' && !D(part.amount).isZero())
        fail(`分录${e.lineId}在现金范围内，不能作为非现金排除`);
      if (part.line === 'internal' || part.line === 'excluded') continue;
      if (part.line === 'exchangeEffect') {
        add(v, part.line, part.amount);
        continue;
      }
      if (!receiptLines.has(part.line) && !paymentLines.has(part.line))
        fail(`分录${e.lineId}未知现金项目${part.line}`);
      add(v, part.line, paymentLines.has(part.line) ? D(part.amount).neg() : part.amount);
    }
  }
  for (const voucherId of new Set(entries.map((e) => e.voucherId))) {
    const parts = entries
      .filter((e) => e.voucherId === voucherId)
      .flatMap((e) => c.cashAllocations.find((a) => a.lineId === e.lineId)!.parts)
      .filter((x) => x.line === 'internal');
    if (!parts.reduce((s, x) => s.plus(x.amount), D(0)).isZero())
      fail(`凭证${voucherId}现金内部划转未配对抵销`);
  }
  adjusted(c, 'cashflow', r.to, v, CASHFLOW);
  totals(v, CASHFLOW);
  v.cashScopeChange = scopeChange.toFixed();
  v.actualCashClosing = sourceClosing.toFixed();
  check(
    checks,
    'cashflow',
    '期末现金及现金等价物（含现金范围变化调节）',
    column,
    r.to,
    D(v.cashClosing!).plus(scopeChange),
    sourceClosing,
    '核实逐笔现金分类、受限资金及政策变化',
    entries.map((e) => `分录${e.lineId}`),
  );
  return v;
}
function equityColumn(c: EnterpriseConfig, accountId: number): string | undefined {
  const r = c.rules.find((r) => r.accountId === accountId)!;
  if (r.kind === 'currentProfit') return 'retainedEarnings';
  if (r.kind === 'oci') return 'otherComprehensive';
  return EQUITY_COLUMNS.includes(r.line as (typeof EQUITY_COLUMNS)[number]) ? r.line : undefined;
}
export function calculateEquity(
  c: EnterpriseConfig,
  d: SourceData,
  r: Range,
  profit: Values,
  checks: Check[],
  column: string,
): Matrix {
  const y = periodYear(r.to),
    prior = makePeriod(y - 1, 12),
    opening = calculateBalance(c, d, makePeriod(y, 1), 'opening'),
    closing = calculateBalance(c, d, r.to),
    previous = calculateBalance(c, d, prior),
    m: Matrix = {};
  for (const line of EQUITY)
    m[line.key] = Object.fromEntries([...EQUITY_COLUMNS, 'total'].map((k) => [k, '0']));
  for (const k of EQUITY_COLUMNS) m.previousClosing![k] = previous[k] ?? '0';
  for (const a of c.adjustments.filter(
    (x) => x.statement === 'equity' && x.period === makePeriod(y, 1),
  )) {
    if (!EQUITY_COLUMNS.includes(a.column as (typeof EQUITY_COLUMNS)[number]))
      fail(`权益调整缺少有效权益列${a.column}`);
    add(m[a.kind === 'other' ? 'otherAdjustment' : a.kind]!, a.column!, a.amount);
  }
  m.comprehensive!.retainedEarnings = profit.netProfit!;
  m.comprehensive!.otherComprehensive = profit.oci!;
  for (const e of d.entries.filter((e) => inRange(e.period, r))) {
    const rule = c.rules.find((x) => x.accountId === e.accountId)!,
      col = equityColumn(c, e.accountId);
    if (!col && rule.kind !== 'equityInstrument') continue;
    if (isClosing(d, e)) continue;
    if (rule.kind === 'oci' && c.oci.some((x) => x.lineId === e.lineId)) continue;
    const voucherLines = d.entries.filter((x) => x.voucherId === e.voucherId);
    if (
      voucherLines.every((x) => equityColumn(c, x.accountId) === 'retainedEarnings') &&
      voucherLines.reduce((s, x) => s.plus(x.debit).minus(x.credit), D(0)).isZero()
    )
      continue;
    const event =
      c.equityEvents.find((x) => x.lineId === e.lineId) ??
      fail(`${e.period}权益分录${e.lineId}未分类，不能归入“其他”`);
    if (rule.kind !== 'equityInstrument' && !D(event.liabilityAmount).isZero())
      fail(`权益分录${e.lineId}并非混合金融工具，不得挪入负债分项`);
    const signed = D(e.credit).minus(e.debit);
    if (
      !event.parts
        .reduce(
          (s, x) => s.plus(D(x.amount).times(x.column === 'treasuryStock' ? -1 : 1)),
          D(event.liabilityAmount),
        )
        .eq(signed)
    )
      fail(`权益分录${e.lineId}分项合计与账务不一致`);
    for (const part of event.parts) {
      if (rule.kind === 'equityInstrument') {
        if (!part.instrumentId) fail(`权益分录${e.lineId}必须绑定具体金融工具`);
        const f = c.facts
          .filter((x) => x.period === r.to && x.parts)
          .flatMap((x) => x.parts!)
          .find((x) => x.id === part.instrumentId);
        if (!f || f.classification !== 'equity') fail(`权益分录${e.lineId}工具不存在或分类为负债`);
        const target =
          f.instrument === 'ordinary'
            ? 'capital'
            : f.instrument === 'preferred'
              ? 'equityPreferred'
              : f.instrument === 'perpetual'
                ? 'equityPerpetual'
                : 'equityOther';
        if (part.column !== target) fail(`权益分录${e.lineId}工具列不匹配`);
      } else if (part.column !== col) fail(`权益分录${e.lineId}列与实际科目不一致`);
      add(m[event.row]!, part.column, part.amount);
    }
  }
  const internalRows = [
    'capitalizationReserve',
    'capitalizationSurplus',
    'lossRecovery',
    'benefitTransfer',
    'ociTransfer',
    'otherTransfer',
  ];
  for (const row of internalRows)
    for (const voucherId of new Set(
      c.equityEvents
        .filter((x) => x.row === row)
        .map((x) => d.entries.find((e) => e.lineId === x.lineId)!.voucherId),
    )) {
      const events = c.equityEvents.filter(
        (x) =>
          x.row === row &&
          d.entries.some(
            (e) => e.lineId === x.lineId && e.voucherId === voucherId && inRange(e.period, r),
          ),
      );
      if (
        !events
          .flatMap((x) => x.parts)
          .reduce((s, p) => s.plus(D(p.amount).times(p.column === 'treasuryStock' ? -1 : 1)), D(0))
          .isZero()
      )
        fail(`凭证${voucherId}权益内部结转事项未在本事项内配平`);
    }
  for (const k of EQUITY_COLUMNS) {
    const cells = Object.fromEntries(EQUITY.map((l) => [l.key, m[l.key]![k]!])) as Values;
    totals(cells, EQUITY);
    for (const l of EQUITY) m[l.key]![k] = cells[l.key]!;
  }
  for (const l of EQUITY)
    m[l.key]!.total = EQUITY_COLUMNS.reduce(
      (s, k) => s.plus(D(m[l.key]![k]!).times(k === 'treasuryStock' ? -1 : 1)),
      D(0),
    ).toFixed();
  for (const k of EQUITY_COLUMNS) {
    check(
      checks,
      'equity',
      `本年年初余额·${EQUITY_LABELS[EQUITY_COLUMNS.indexOf(k)]}`,
      column,
      makePeriod(y, 1),
      m.opening![k]!,
      opening[k] ?? 0,
      '核实上年末、政策变更及差错更正来源',
    );
    check(
      checks,
      'equity',
      `本年年末余额·${EQUITY_LABELS[EQUITY_COLUMNS.indexOf(k)]}`,
      column,
      r.to,
      m.closing![k]!,
      closing[k] ?? 0,
      '定位权益事件、结转和金融工具分类',
      c.equityEvents.map((x) => `分录${x.lineId}`),
    );
  }
  check(
    checks,
    'equity',
    '内部结转权益合计',
    column,
    r.to,
    m.transfers!.total!,
    0,
    '内部结转必须保持权益合计不变',
  );
  check(
    checks,
    'equity',
    '权益合计与资产负债表',
    column,
    r.to,
    m.closing!.total!,
    closing.equityTotal!,
    '核实各权益列及库存股减项',
  );
  return m;
}
export function calculateEnterprise(raw: EnterpriseConfig, d: SourceData) {
  const c = parseEnterpriseConfiguration(raw);
  validate(c, d);
  const ranges = enterpriseRanges(c),
    checks: Check[] = [];
  const balance = {
    current: calculateBalance(c, d, c.period),
    previous: calculateBalance(c, d, ranges.balancePrevious),
  };
  const profit = {
    current: calculateProfit(c, d, ranges.current),
    previous: calculateProfit(c, d, ranges.previous),
  };
  const cashflow = {
    current: calculateCashflow(c, d, ranges.current, checks, 'current'),
    previous: calculateCashflow(c, d, ranges.previous, checks, 'previous'),
  };
  for (const column of ['current', 'previous'] as const) {
    const p = column === 'current' ? c.period : ranges.balancePrevious,
      b = balance[column];
    check(
      checks,
      'balance',
      '资产总计＝负债和所有者权益总计',
      column,
      p,
      b.assetsTotal!,
      b.liabilitiesEquityTotal!,
      '核实明细方向、备抵、期限和未结转损益',
      c.rules.map((r) => `科目${r.accountId}`),
    );
    const range = ranges[column];
    const closed = d.entries
      .filter((e) => inRange(e.period, range) && isClosing(d, e))
      .reduce((s, e) => {
        const rule = c.rules.find((x) => x.accountId === e.accountId)!;
        if (rule.kind === 'pnl') return s;
        if (rule.kind !== 'currentProfit' && rule.line !== 'retainedEarnings')
          fail(`损益结转凭证${e.voucherId}含非损益或利润转入项目`);
        return s.plus(e.credit).minus(e.debit);
      }, D(0));
    const adj = empty(PROFIT);
    adjusted(c, 'profit', range.to, adj, PROFIT);
    totals(adj, PROFIT);
    check(
      checks,
      'profit',
      '净利润与真实结转及未结转损益',
      column,
      range.to,
      profit[column].netProfit!,
      closed
        .plus(unclosed(c, d, range.to))
        .minus(unclosed(c, d, range.from, 'opening'))
        .plus(adj.netProfit!),
      '核实损益结转来源、转入利润和未结转余额',
      d.entries
        .filter((e) => inRange(e.period, range) && isClosing(d, e))
        .map((e) => `凭证${e.voucherId}第${e.lineNo}行`),
    );
    check(
      checks,
      'profit',
      '净利润＝持续经营＋终止经营',
      column,
      range.to,
      profit[column].netProfit!,
      D(profit[column].continuingProfit!).plus(profit[column].discontinuedProfit!),
      '核实终止经营税后损益',
    );
  }
  const equity =
    c.scope === 'annual'
      ? {
          current: calculateEquity(c, d, ranges.current, profit.current, checks, 'current'),
          previous: calculateEquity(c, d, ranges.previous, profit.previous, checks, 'previous'),
        }
      : { current: {}, previous: {} };
  return {
    format: FORMAT,
    period: c.period,
    scope: c.scope,
    orgName: d.orgName,
    balance,
    profit,
    cashflow,
    equity,
    ranges,
    checks,
  };
}
