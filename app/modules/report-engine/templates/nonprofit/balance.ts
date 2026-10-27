import { assetRows, liabilityRows } from './forms';
import { activityStatement, classifyNetAssetEvents } from './activity';
import { validateAdjustmentClosings } from './closing-control';
import {
  balanceKey,
  exactSum,
  mappedRow,
  type Configuration,
  type Sources,
  type Statement,
  type StatementRequest,
  type Check,
} from './model';

const assetIds = new Set(assetRows.filter((r) => !r.section).map((r) => r.id));
const liabilityIds = new Set(liabilityRows.filter((r) => !r.section).map((r) => r.id));
const totalIds = new Set([
  'currentAssetsTotal',
  'investmentTotal',
  'fixedNet',
  'fixedTotal',
  'intangibleNet',
  'noncurrentAssetsTotal',
  'assetsTotal',
  'currentLiabilitiesTotal',
  'longLiabilitiesTotal',
  'liabilitiesTotal',
  'netAssetsTotal',
  'liabilitiesNetAssetsTotal',
]);
export const balanceTargets = [...assetIds, ...liabilityIds].filter((id) => !totalIds.has(id));
const sums: Record<string, string[]> = {
  currentAssetsTotal: [
    'cash',
    'shortInvestment',
    'receivables',
    'prepayments',
    'inventory',
    'deferred',
    'currentInvestment',
    'otherCurrentAssets',
  ],
  investmentTotal: ['equityInvestment', 'debtInvestment', 'otherInvestment'],
  fixedTotal: ['fixedNet', 'construction', 'disposal'],
  noncurrentAssetsTotal: [
    'investmentTotal',
    'fixedTotal',
    'culturalResources',
    'intangibleNet',
    'longDeferred',
  ],
  assetsTotal: ['currentAssetsTotal', 'noncurrentAssetsTotal', 'agencyAsset'],
  currentLiabilitiesTotal: [
    'shortBorrowing',
    'payables',
    'employees',
    'taxes',
    'advances',
    'accruals',
    'currentDebt',
    'otherCurrentLiabilities',
  ],
  longLiabilitiesTotal: ['longBorrowing', 'longPayables', 'provisions', 'otherLongLiabilities'],
  liabilitiesTotal: ['currentLiabilitiesTotal', 'longLiabilitiesTotal', 'agencyLiability'],
  netAssetsTotal: ['unrestricted', 'restricted'],
  liabilitiesNetAssetsTotal: ['liabilitiesTotal', 'netAssetsTotal'],
};
const longRows = new Set([
  'debtInvestment',
  'otherInvestment',
  'longBorrowing',
  'longPayables',
  'otherLongLiabilities',
]);
function inOneYear(at: string, due: string) {
  const d = new Date(`${at}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return due <= d.toISOString().slice(0, 10);
}
function analyze(s: Sources, c: Configuration, point: 'opening' | 'closing') {
  const at = point === 'opening' ? s.openingDate : s.closingDate;
  const facts = c.balanceFacts.filter((f) => f.at === at),
    used = new Set<string>();
  const amounts: Record<string, number[]> = {},
    sources: Record<string, string[]> = {};
  const add = (row: string, raw: number, source: string) => {
    const n = liabilityIds.has(row) || ['depreciation', 'amortization'].includes(row) ? -raw : raw;
    (amounts[row] ??= []).push(n);
    (sources[row] ??= []).push(source);
  };
  for (const row of s.balances) {
    const raw = row[point],
      id = mappedRow(row.accountCode, c.mappings),
      key = balanceKey(row),
      root = row.accountCode.slice(0, 4);
    if (!id) {
      if (raw !== 0 || row.debit !== 0 || row.credit !== 0)
        throw new Error(`科目${row.accountCode}未映射报表项目，请先配置科目对应关系`);
      continue;
    }
    if (
      [
        'donations',
        'dues',
        'services',
        'grants',
        'sales',
        'headquarters',
        'investmentIncome',
        'otherIncome',
        'activityCost',
        'taxExpense',
        'administration',
        'fundraising',
        'impairment',
        'incomeTax',
        'otherExpense',
        'priorAdjustment',
      ].includes(id)
    )
      continue;
    const manual = facts.filter((f) => f.key === key);
    if (manual.length > 1) throw new Error(`${at}科目${row.accountCode}重复配置余额分析`);
    const link = `/m/ledgers/detail?account=${row.accountCode}&from=${s.from}&to=${point === 'opening' ? s.from : s.to}&dims=${encodeURIComponent(JSON.stringify(row.dimensions))}`;
    if (manual.length) {
      const f = manual[0]!;
      used.add(key);
      if (f.balance !== raw || exactSum(f.allocations.map((a) => a.amount)) !== raw)
        throw new Error(`${at}科目${row.accountCode}余额已变化或分配不守恒`);
      for (const a of f.allocations) {
        if (!balanceTargets.includes(a.row) && !['fixedNet', 'intangibleNet'].includes(a.row))
          throw new Error('余额分析不能写入小计或合计项目');
        if (raw !== 0 && a.amount !== 0 && Math.sign(raw) !== Math.sign(a.amount))
          throw new Error('余额拆分方向必须与真实余额一致');
        if (longRows.has(id)) {
          if (!a.maturity) throw new Error(`${at}长期项目缺少合同到期日`);
          const expected = inOneYear(at, a.maturity)
            ? liabilityIds.has(id)
              ? 'currentDebt'
              : 'currentInvestment'
            : id;
          if (a.row !== expected)
            throw new Error(`${at}科目${row.accountCode}到期分类与真实到期日不一致`);
        } else if (id === 'investmentAllowance') {
          if (
            ![
              'equityInvestment',
              'debtInvestment',
              'otherInvestment',
              'currentInvestment',
            ].includes(a.row)
          )
            throw new Error('长期投资减值准备须分配到对应投资项目');
          if (
            a.row !== 'equityInvestment' &&
            (!a.maturity || inOneYear(at, a.maturity) !== (a.row === 'currentInvestment'))
          )
            throw new Error('投资减值准备到期分类与对应投资不一致');
        } else if (id === 'cash') {
          if (!['cash', 'agencyAsset'].includes(a.row) || a.agency !== (a.row === 'agencyAsset'))
            throw new Error('受托现金须从货币资金移列受托代理资产');
        } else if (!['fixedAllowance', 'intangibleAllowance'].includes(id) && a.row !== id)
          throw new Error(`科目${row.accountCode}分析项目与科目用途不一致`);
        if (
          (id === 'fixedAllowance' && a.row !== 'fixedNet') ||
          (id === 'intangibleAllowance' && a.row !== 'intangibleNet')
        )
          throw new Error('资产备抵须抵减对应净值');
        add(a.row, a.amount, a.sourceReference);
      }
    } else {
      if (
        raw !== 0 &&
        (longRows.has(id) ||
          ['investmentAllowance', 'fixedAllowance', 'intangibleAllowance'].includes(id))
      )
        throw new Error(`${at}科目${row.accountCode}需逐项核对到期日或减值分配`);
      let target = id;
      if (['1111', '1121', '1122', '1141', '2201', '2202', '2203', '2209'].includes(root)) {
        if (raw > 0) target = ['1141', '2202'].includes(root) ? 'prepayments' : 'receivables';
        if (raw < 0) target = ['1121', '2203'].includes(root) ? 'advances' : 'payables';
        // 借方列资产，贷方列负债；各往来对象分别分析，不能先净额抵销。
      }
      if (raw !== 0 || balanceTargets.includes(target)) add(target, raw, link);
    }
  }
  if (facts.some((f) => !used.has(f.key)))
    throw new Error(`${at}余额分析存在已删除或结构变化的科目明细，请重新确认`);
  const get = (id: string) => exactSum(amounts[id] ?? []);
  const values: Record<string, number> = {};
  for (const id of [...assetIds, ...liabilityIds]) values[id] = get(id);
  values.fixedNet = exactSum([values.fixedCost!, -values.depreciation!, get('fixedNet')]);
  values.intangibleNet = exactSum([
    values.intangibleCost!,
    -values.amortization!,
    get('intangibleNet'),
  ]);
  for (const [id, parts] of Object.entries(sums))
    values[id] = exactSum(parts.map((x) => values[x]!));
  return { values, sources };
}
export function balanceStatement(s: Sources, c: Configuration, r: StatementRequest): Statement {
  const opening = analyze(s, c, 'opening'),
    closing = analyze(s, c, 'closing'),
    checks: Check[] = [];
  const adjustmentTransferred = validateAdjustmentClosings(s, c);
  const activity = activityStatement(s, c, r),
    net = activity.rows.find((x) => x.id === 'netChange')!;
  // 未结转损益按真实分类保留；已结转部分从未结转额扣除，前后报表结果一致。
  for (const [i, kind] of ['unrestricted', 'restricted'].entries()) {
    const pnlTransfer = exactSum(
      s.entries
        .filter((e) => e.closingKind === 'pnl' && mappedRow(e.accountCode, c.mappings) === kind)
        .map((e) => exactSum([e.credit, -e.debit])),
    );
    const pnlNet = exactSum([
      Number(net.values[3 + i]),
      -exactSum(
        classifyNetAssetEvents(s, c)
          .filter(
            (e) => e.kind === kind && ['release', 'restriction', 'priorAdjustment'].includes(e.row),
          )
          .map((e) => e.amount),
      ),
    ]);
    const unclosed = exactSum([pnlNet, -pnlTransfer]);
    const unclosedAdjustment =
      exactSum(
        classifyNetAssetEvents(s, c)
          .filter((e) => e.kind === kind && e.row === 'priorAdjustment')
          .map((e) => e.amount),
      ) - adjustmentTransferred[kind as 'unrestricted' | 'restricted'];
    closing.values[kind] = exactSum([closing.values[kind]!, unclosed, unclosedAdjustment]);
    const direct = exactSum(
      classifyNetAssetEvents(s, c)
        .filter((e) => e.kind === kind && e.row === 'directCapital')
        .map((e) => e.amount),
    );
    checks.push({
      name: '两类净资产首尾承接',
      row: kind === 'unrestricted' ? '非限定性净资产' : '限定性净资产',
      column: '期末余额',
      from: s.from,
      to: s.to,
      difference: exactSum([
        closing.values[kind]!,
        -opening.values[kind]!,
        -Number(net.values[3 + i]),
        -direct,
      ]),
      sources: s.entries
        .filter((e) => mappedRow(e.accountCode, c.mappings) === kind)
        .map((e) => `/m/voucher-entry/edit?id=${e.voucherId}`),
    });
  }
  for (const point of [opening, closing]) {
    point.values.netAssetsTotal = exactSum([point.values.unrestricted!, point.values.restricted!]);
    point.values.liabilitiesNetAssetsTotal = exactSum([
      point.values.liabilitiesTotal!,
      point.values.netAssetsTotal!,
    ]);
    checks.push({
      name: '资产等于负债和净资产',
      row: '资产总计',
      column: point === opening ? '年初余额' : '期末余额',
      from: s.from,
      to: point === opening ? s.from : s.to,
      difference: exactSum([point.values.assetsTotal!, -point.values.liabilitiesNetAssetsTotal!]),
      sources: Object.values(point.sources).flat(),
    });
    checks.push({
      name: '受托代理资产与负债对应',
      row: '受托代理资产',
      column: point === opening ? '年初余额' : '期末余额',
      from: s.from,
      to: point === opening ? s.from : s.to,
      difference: exactSum([point.values.agencyAsset!, -point.values.agencyLiability!]),
      sources: [...(point.sources.agencyAsset ?? []), ...(point.sources.agencyLiability ?? [])],
    });
  }
  const rows = [...assetRows, ...liabilityRows].map((row) => ({
    ...row,
    values: row.section ? [] : [opening.values[row.id]!, closing.values[row.id]!],
    sources: [...(opening.sources[row.id] ?? []), ...(closing.sources[row.id] ?? [])],
  }));
  return {
    code: '401',
    name: '资产负债表',
    organization: s.book.orgName,
    unpostedCount: s.unpostedCount,
    period: r,
    columns: ['年初余额', '期末余额'],
    rows,
    checks,
    notes: [`年初来源：${s.openingDate}新账；${c.transitionOpeningReference}`],
  };
}
