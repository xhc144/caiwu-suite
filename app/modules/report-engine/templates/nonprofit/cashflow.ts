import { cashflowRows } from './forms';
import { cashBalanceAt, validateCashScope } from './cash-scope';
import {
  exactSum,
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
  const scope = validateCashScope(s, c);
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
  const cashOpening = cashBalanceAt(s, c, 'opening'),
    cashClosing = cashBalanceAt(s, c, 'closing');
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
