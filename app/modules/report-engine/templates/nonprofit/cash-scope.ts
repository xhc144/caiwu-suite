import { exactSum, balanceKey, mappedRow, type Configuration, type Sources } from './model';

/** 现金范围同时用于法定表和历史重列，两个时点各自核对。 */
export function validateCashScope(s: Sources, c: Configuration, point?: 'opening' | 'closing') {
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
      if (point !== 'closing' && a.acquiredOn! > s.openingDate && rows.some((b) => b.opening !== 0))
        throw new Error('现金等价物取得日晚于真实年初余额，请核对取得来源');
      if (point !== 'opening' && a.maturity! < s.closingDate && rows.some((b) => b.closing !== 0))
        throw new Error('投资已到期但仍有余额，请重新核对可转换现金及低风险依据');
    }
  }
  return scope;
}

export function cashBalanceAt(s: Sources, c: Configuration, point: 'opening' | 'closing') {
  const scope = validateCashScope(s, c, point);
  const included = (code: string) => scope.get(code)?.included === true;
  const total = exactSum(
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
  {
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
  return total;
}
