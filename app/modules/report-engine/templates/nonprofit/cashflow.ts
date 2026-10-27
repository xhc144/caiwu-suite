import { cashflowRows } from './forms';
import {
  exactSum,
  balanceKey,
  mappedRow,
  lineIdentity,
  sameLine,
  type Configuration,
  type Sources,
  type Statement,
  type StatementRequest,
  type Check,
} from './model';

const sums: Record<string, string[]> = {
  operatingReceipts: ['donations', 'dues', 'services', 'sales', 'grants', 'otherOperatingReceipts'],
  operatingPayments: [
    'donationsPaid',
    'employeesPaid',
    'goodsServicesPaid',
    'taxesPaid',
    'otherOperatingPayments',
  ],
  investingReceipts: [
    'investmentRecovered',
    'investmentIncome',
    'assetDisposal',
    'otherInvestingReceipts',
  ],
  investingPayments: ['assetPurchase', 'investmentPaid', 'otherInvestingPayments'],
  financingReceipts: ['borrowings', 'otherFinancingReceipts'],
  financingPayments: ['principalPaid', 'interestPaid', 'otherFinancingPayments'],
};
const outflows = new Set(cashflowRows.filter((r) => r.outflow).map((r) => r.id));
export function cashflowStatement(s: Sources, c: Configuration, r: StatementRequest): Statement {
  if (r.kind !== 'annual' || r.from % 100 !== 1 || r.to % 100 !== 12)
    throw new Error('正式现金流量表只能按完整年度生成');
  const scope = new Map(c.cashScope.map((a) => [a.account, a]));
  if (scope.size !== c.cashScope.length) throw new Error('同一现金科目重复配置范围');
  for (const a of s.accounts.filter(
    (a) =>
      a.isLeaf && (a.isCash || a.isBank || ['1001', '1002', '1009'].includes(a.code.slice(0, 4))),
  )) {
    if (!scope.has(a.code)) throw new Error(`科目${a.code}尚未确认可随时支付、受限或受托性质`);
  }
  for (const a of c.cashScope) {
    const actual = s.accounts.find((x) => x.code === a.account);
    if (!actual?.isLeaf) throw new Error('现金范围科目已删除或结构变化');
    if (
      !a.included &&
      !a.agency &&
      !a.restricted &&
      (actual.isCash || actual.isBank || ['1001', '1002', '1009'].includes(actual.code.slice(0, 4)))
    )
      throw new Error(`科目${a.account}未纳入现金，须明确受限或受托等不可随时支付性质及凭据`);
    if (
      a.included &&
      !a.equivalent &&
      !(
        actual.isCash ||
        actual.isBank ||
        ['1001', '1002', '1009'].includes(actual.code.slice(0, 4))
      )
    )
      throw new Error('仅库存现金、可随时支付的存款及经确认的现金等价物可纳入现金范围');
    if (a.included && a.equivalent && !['1101', '1402', '1403'].includes(actual.code.slice(0, 4)))
      throw new Error('现金等价物须为已确认的短期低风险投资，不能将其他资产列为现金');
    if (a.equivalent && a.included) {
      const start = Date.parse(a.acquiredOn!),
        end = Date.parse(a.maturity!);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end < start ||
        end - start > 93 * 86400000
      )
        throw new Error('现金等价物须为取得时短期、低风险且可转换为已知现金的投资');
      const rows = s.balances.filter((b) => b.accountCode === a.account);
      if (a.acquiredOn! > s.openingDate && rows.some((b) => b.opening !== 0))
        throw new Error('现金等价物取得日晚于真实年初余额，请核对取得来源');
      if (a.maturity! < s.closingDate && rows.some((b) => b.closing !== 0))
        throw new Error('投资已到期但仍有余额，请重新核对可转换现金及低风险依据');
    }
  }
  const included = (code: string) => scope.get(code)?.included === true;
  const entries = s.entries.filter((e) => included(e.accountCode));
  const confirmed = new Map(c.cashConfirmations.map((a) => [a.line.lineId, a]));
  if (confirmed.size !== c.cashConfirmations.length || confirmed.size !== entries.length)
    throw new Error('现金逐笔分类未完整覆盖实际分录，请核对新增及借贷抵销分录');
  const values: Record<string, number[]> = {},
    refs: Record<string, string[]> = {},
    internal = new Map<string, { voucherId: number; values: number[]; accounts: Set<string> }>();
  for (const e of entries) {
    const f = confirmed.get(e.lineId);
    if (!f || !sameLine(f.line, lineIdentity(e)))
      throw new Error(`凭证${e.displayNo}现金分类来源已变化，请重新确认`);
    if (exactSum(f.allocations.map((a) => a.amount)) !== exactSum([e.debit, -e.credit]))
      throw new Error(`凭证${e.displayNo}现金多项目拆分金额不守恒`);
    for (const a of f.allocations) {
      const net = exactSum([e.debit, -e.credit]);
      if (
        a.amount !== 0 &&
        (net === 0 || Math.sign(a.amount) !== Math.sign(net) || Math.abs(a.amount) > Math.abs(net))
      )
        throw new Error('现金拆分方向必须与实际现金分录一致，退款按原项目冲减');
      if (a.row === 'excluded') {
        const policy = scope.get(e.accountCode)!;
        if (
          !policy.partitioned ||
          !a.exclusionReason ||
          (a.exclusionReason === 'agency' && !policy.agency) ||
          (a.exclusionReason === 'restricted' && !policy.restricted)
        )
          throw new Error('不计入现金的分配须对应已确认的同科目受限或受托部分');
        continue;
      }
      if (a.row === 'internal') {
        if (!a.transferReference) throw new Error('现金内部划转须关联同一凭证的对应现金分录');
        const old = internal.get(a.transferReference) ?? {
          voucherId: e.voucherId,
          values: [],
          accounts: new Set<string>(),
        };
        if (old.voucherId !== e.voucherId) throw new Error('内部划转不能跨凭证抵销');
        old.values.push(a.amount);
        old.accounts.add(e.accountCode);
        internal.set(a.transferReference, old);
        continue;
      }
      if (a.nature === 'engineeringPayroll' && a.row !== 'assetPurchase')
        throw new Error('在建工程人员薪酬应列购建非流动资产支付的现金');
      if (a.nature === 'capitalizedInterest' && a.row !== 'interestPaid')
        throw new Error('资本化借款利息应列筹资活动偿付利息');
      if (a.nature === 'financeLease' && a.row !== 'otherFinancingPayments')
        throw new Error('融资租入固定资产租赁费应列其他筹资支付');
      if (a.nature === 'disposal' && a.row !== 'assetDisposal')
        throw new Error('处置非流动资产收支应按净额列处置收回现金');
      const n = outflows.has(a.row) ? -a.amount : a.amount;
      (values[a.row] ??= []).push(n);
      (refs[a.row] ??= []).push(a.sourceReference);
    }
  }
  for (const a of internal.values())
    if (exactSum(a.values) !== 0 || a.accounts.size < 2)
      throw new Error('现金内部划转对应分录不完整或金额未抵销');
  const totals: Record<string, number> = {};
  for (const row of cashflowRows.filter((r) => !r.section))
    totals[row.id] = exactSum(values[row.id] ?? []);
  for (const [id, parts] of Object.entries(sums))
    totals[id] = exactSum(parts.map((x) => totals[x]!));
  for (const group of ['operating', 'investing', 'financing'])
    totals[`${group}Net`] = exactSum([totals[`${group}Receipts`]!, -totals[`${group}Payments`]!]);
  totals.cashNet = exactSum([
    totals.operatingNet!,
    totals.investingNet!,
    totals.financingNet!,
    totals.fx!,
  ]);
  const cashAt = (point: 'opening' | 'closing') =>
    exactSum(
      s.balances
        .filter((b) => included(b.accountCode))
        .map((b) => {
          const policy = scope.get(b.accountCode)!;
          const at = point === 'opening' ? s.openingDate : s.closingDate;
          const facts = c.balanceFacts.filter((f) => f.at === at && f.key === balanceKey(b));
          if (!policy.partitioned) {
            if (facts.some((f) => f.allocations.some((a) => a.agency && a.amount !== 0)))
              throw new Error('纳入现金的普通科目同时存在受托部分，请按实际明细分配');
            return b[point];
          }
          if (facts.length !== 1)
            throw new Error(`${at}科目${b.accountCode}缺少可用、受限及受托现金余额分配`);
          const f = facts[0]!;
          if (
            f.balance !== b[point] ||
            exactSum(f.allocations.map((a) => a.amount)) !== b[point] ||
            f.allocations.some((a) => a.cashIncluded === undefined)
          )
            throw new Error(`${at}科目${b.accountCode}现金范围分配不完整或余额已变化`);
          for (const a of f.allocations) {
            if (
              a.amount !== 0 &&
              (b[point] === 0 ||
                Math.sign(a.amount) !== Math.sign(b[point]) ||
                Math.abs(a.amount) > Math.abs(b[point]))
            )
              throw new Error('现金余额拆分方向或金额与实际余额不一致');
            const eligibleRows = policy.equivalent
              ? ['shortInvestment', 'debtInvestment', 'otherInvestment', 'currentInvestment']
              : ['cash'];
            if (a.cashIncluded && (a.agency || !eligibleRows.includes(a.row)))
              throw new Error('受托代理或非货币项目不能计入本组织可用现金');
            if (a.agency && a.row !== 'agencyAsset')
              throw new Error('受托现金须对应受托代理资产项目');
            if (!a.cashIncluded && !a.agency && !policy.restricted)
              throw new Error('非受托的排除余额须有实际受限依据');
          }
          return exactSum(f.allocations.filter((a) => a.cashIncluded).map((a) => a.amount));
        }),
    );
  const cashOpening = cashAt('opening'),
    cashClosing = cashAt('closing');
  for (const point of ['opening', 'closing'] as const) {
    const at = point === 'opening' ? s.openingDate : s.closingDate;
    const agencyCash = exactSum(
      s.balances.map((b) => {
        const policy = scope.get(b.accountCode);
        if (!policy?.agency) return 0;
        const facts = c.balanceFacts.filter((f) => f.at === at && f.key === balanceKey(b));
        if (policy.partitioned)
          return exactSum(facts[0]!.allocations.filter((a) => a.agency).map((a) => a.amount));
        if (facts.some((f) => f.allocations.some((a) => a.amount !== 0 && !a.agency)))
          throw new Error(`${at}科目${b.accountCode}受托现金范围与余额分析不一致`);
        return b[point];
      }),
    );
    const assets = exactSum(
      s.balances
        .filter((b) => mappedRow(b.accountCode, c.mappings) === 'agencyAsset')
        .map((b) => b[point]),
    );
    const liabilities = exactSum(
      s.balances
        .filter((b) => mappedRow(b.accountCode, c.mappings) === 'agencyLiability')
        .map((b) => -b[point]),
    );
    if (exactSum([agencyCash, assets, -liabilities]) !== 0)
      throw new Error(`${at}受托现金及其他受托代理资产与受托负债不一致，请核对原始委托凭据`);
  }
  const checks: Check[] = [
    {
      name: '现金范围首尾与净增加额一致',
      row: '现金及现金等价物净增加额',
      column: '本年金额',
      from: r.from,
      to: r.to,
      difference: exactSum([cashClosing, -cashOpening, -totals.cashNet!]),
      sources: c.cashScope.map((a) => a.basis),
    },
  ];
  return {
    code: '403',
    name: '现金流量表',
    organization: s.book.orgName,
    unpostedCount: s.unpostedCount,
    period: r,
    columns: ['本年金额', '上年金额'],
    rows: cashflowRows.map((row) => ({
      ...row,
      values: row.section
        ? []
        : [
            totals[row.id]!,
            Math.floor(r.to / 100) === 2026 ? '不要求填列（2026年首次执行）' : '缺少上年来源',
          ],
      sources: refs[row.id] ?? [],
    })),
    checks,
    notes: [
      `现金及现金等价物政策：${c.cashPolicy}`,
      ...(c.policyChangeReference ? [`政策变更依据：${c.policyChangeReference}`] : []),
    ],
    cashOpening,
    cashClosing,
  };
}
