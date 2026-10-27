import { cashflowRows } from './forms';
import {
  exactSum,
  incomeIds,
  expenseIds,
  type Configuration,
  type Statement,
  type StatementRequest,
} from './model';

/** 对真实可比明细按原发生期间重列，再重新计算全部小计、合计和净额。 */
export function attachComparative(
  current: Statement,
  previous: Statement,
  c: Configuration,
  pr: StatementRequest,
) {
  const restatements = c.comparison!.restatements.filter((a) => a.code === current.code);
  if (current.code === '402') {
    const previousDetails = previous.rows.filter((r) => r.id.startsWith('detail:'));
    const after = current.rows.findIndex((r) => r.id === 'activityCost') + 1;
    current.rows.splice(
      after,
      0,
      ...previousDetails
        .filter((old) => !current.rows.some((r) => r.id === old.id))
        .map((old) => ({ ...old, values: [0, 0, 0, 0, 0, 0], sources: [] })),
    );
  }
  const primitives =
    current.code === '402'
      ? new Set([
          ...incomeIds,
          ...expenseIds,
          'charitableTrust',
          'fundraisingCost',
          'priorAdjustment',
          ...current.rows.filter((r) => r.id.startsWith('detail:')).map((r) => r.id),
        ])
      : new Set(cashflowRows.filter((r) => !r.section && !r.total).map((r) => r.id));
  for (const a of restatements) {
    if (!primitives.has(a.row) || Math.floor(a.period / 100) !== Math.floor(pr.to / 100))
      throw new Error('比较重列须指向上年度真实发生期间及明细项目，不能直接填写小计或互转合计');
  }
  if (current.code === '402') current.columns.push('上年可比本期·合计', '上年可比累计·合计');
  const ranges = current.code === '402' ? [pr.from, Math.floor(pr.to / 100) * 100 + 1] : [pr.from];
  for (const [i, from] of ranges.entries()) {
    const values: Record<string, number> = {};
    for (const row of current.rows.filter((r) => !r.section)) {
      const old = previous.rows.find((r) => r.id === row.id);
      if (!old && !row.id.startsWith('detail:'))
        throw new Error(`上年比较缺少${row.label}，请核对业务组成及项目重列依据`);
      values[row.id] = exactSum([
        old ? Number(old.values[current.code === '402' ? (i === 0 ? 2 : 5) : 0]) : 0,
        ...restatements
          .filter((a) => a.row === row.id && a.period >= from && a.period <= pr.to)
          .map((a) => a.amount),
      ]);
    }
    if (current.code === '402') {
      values.incomeTotal = exactSum(incomeIds.map((id) => values[id]!));
      values.expenseTotal = exactSum(expenseIds.map((id) => values[id]!));
      values.netChange = exactSum([
        values.incomeTotal,
        -values.expenseTotal,
        values.release!,
        values.restriction!,
        values.priorAdjustment!,
      ]);
      const priorNet = Number(
        previous.rows.find((r) => r.id === 'netChange')!.values[i === 0 ? 2 : 5],
      );
      current.checks.push({
        name: '比较重列后净资产变动承接',
        row: '净资产变动额',
        column: i === 0 ? '上年可比本期' : '上年可比累计',
        from,
        to: pr.to,
        difference: exactSum([values.netChange, -priorNet]),
        sources: restatements.map((a) => a.basis),
      });
    } else {
      const parts: Record<string, string[]> = {
        operatingReceipts: [
          'donations',
          'dues',
          'services',
          'sales',
          'grants',
          'otherOperatingReceipts',
        ],
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
      for (const [id, children] of Object.entries(parts))
        values[id] = exactSum(children.map((x) => values[x]!));
      for (const group of ['operating', 'investing', 'financing'])
        values[`${group}Net`] = exactSum([
          values[`${group}Receipts`]!,
          -values[`${group}Payments`]!,
        ]);
      values.cashNet = exactSum([
        values.operatingNet!,
        values.investingNet!,
        values.financingNet!,
        values.fx!,
      ]);
      current.checks.push({
        name: '比较重列后现金首尾一致',
        row: '现金及现金等价物净增加额',
        column: '上年金额',
        from,
        to: pr.to,
        difference: exactSum([previous.cashClosing!, -previous.cashOpening!, -values.cashNet]),
        sources: restatements.map((a) => a.basis),
      });
    }
    for (const row of current.rows.filter((r) => !r.section)) {
      if (current.code === '403') row.values[1] = values[row.id]!;
      else row.values.push(values[row.id]!);
    }
  }
  current.notes.push(`上年比较口径及项目重列：${c.comparison!.basis}`);
}
