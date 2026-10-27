import type { Account, BalanceRow, EntryRow } from '@caiwu/core';
import {
  balanceLines,
  incomeLines,
  cashflowLines,
  cashflowItems,
  type FilingMode,
} from './catalogue';
import {
  incomeDetails,
  inventoryRoles,
  pnlRoles,
  problem,
  rowKey,
  sum,
  entrySignature,
  roles,
  type Configuration,
  type Role,
} from './configuration';

export type Source = {
  account: string;
  from: number;
  to: number;
  dimensions: BalanceRow['dimensions'];
  voucherId?: number;
  lineId?: number;
  amount: number;
  toRoute: string;
};
export type Amount = { value: number; formula: string; sources: Source[] };
export type StatementRow = { line: number; label: string; amounts: [Amount, Amount | null] };
export type Check = {
  name: string;
  column: number;
  line: number;
  difference: number;
  sources: Source[];
};
export type Statement = {
  code: '301' | '302' | '303';
  name: string;
  columns: [string, string];
  rows: StatementRow[];
  checks: Check[];
  returnedInvestment?: [number, number];
  notes?: string[];
};
export type Scope = { from: number; to: number; label: string };
export type DomainData = {
  accounts: Account[];
  roles: Map<string, Role>;
  closing: BalanceRow[];
  opening: BalanceRow[];
  current: EntryRow[];
  comparison: EntryRow[];
  unclosed: BalanceRow[];
  unclosedOpening: BalanceRow[];
  scopes: [Scope, Scope | null];
  period: number;
  mode: FilingMode;
  config: Configuration;
  closingKinds: Map<number, string | null>;
  developmentAdjustments?: [Amount, Amount | null];
};
export function source(
  row: BalanceRow | EntryRow,
  amount: number,
  from: number,
  to: number,
): Source {
  const params = new URLSearchParams({
    account: row.accountCode,
    from: String(from),
    to: String(to),
    dims: JSON.stringify(
      Object.fromEntries(
        Object.entries(row.dimensions).filter(([, value]) => value !== null && value !== undefined),
      ),
    ),
  });
  return {
    account: row.accountCode,
    from,
    to,
    dimensions: row.dimensions,
    amount,
    toRoute:
      ('historical' in row && row.historical === true) || ('voucherId' in row && row.voucherId < 0)
        ? '/m/report-engine?configuration=small-business&target=openingEvidence'
        : 'voucherId' in row
          ? `/m/voucher-entry/edit?id=${row.voucherId}`
          : `/m/ledgers/detail?${params}`,
    ...('voucherId' in row ? { voucherId: row.voucherId, lineId: row.lineId } : {}),
  };
}
const amount = (value: number, formula: string, sources: Source[] = []): Amount => ({
  value: value === 0 ? 0 : value,
  formula,
  sources,
});
function combine(parts: Amount[], formula: string) {
  return amount(
    sum(parts.map((a) => a.value)),
    formula,
    parts.flatMap((a) => a.sources),
  );
}
function rows(labels: readonly string[]): StatementRow[] {
  return labels.map((label, i) => ({ line: i + 1, label, amounts: [amount(0, '尚未计算'), null] }));
}
const analyzed: Role[] = [
  'prepaid',
  'advance',
  'bond',
  'deferredExpense',
  'longLoan',
  'longPayable',
  'deferredIncome',
  'capital',
  'returnedCapital',
  'development',
];
export const analysisDestinations: Partial<Record<Role, Role[]>> = {
  prepaid: ['prepaid', 'noncurrentAsset'],
  advance: ['advance', 'noncurrentLiability'],
  bond: ['bond', 'currentAsset'],
  deferredExpense: ['deferredExpense', 'currentAsset'],
  longLoan: ['longLoan', 'currentLiability'],
  longPayable: ['longPayable', 'currentLiability'],
  deferredIncome: ['deferredIncome', 'currentLiability'],
  capital: ['capital'],
  returnedCapital: ['returnedCapital'],
  development: ['development', 'administration'],
};
export function effectiveBalanceRole(role: Role, value: number): Role {
  if (role === 'receivable' && value < 0) return 'advance';
  if (role === 'payable' && value > 0) return 'prepaid';
  if (role === 'prepaid' && value < 0) return 'payable';
  if (role === 'advance' && value > 0) return 'receivable';
  return role;
}
/** 费用化但尚未转入损益的研发余额按报告范围首尾差额调整；实际转入管理费用后自动抵销，不重计。 */
export function developmentAdjustment(
  opening: BalanceRow[],
  closing: BalanceRow[],
  scope: Scope,
  config: Configuration,
  roles: Map<string, Role>,
): Amount {
  const read = (rows: BalanceRow[], field: 'opening' | 'closing', at: number) => {
    const parts: Amount[] = [];
    for (const row of rows) {
      if (roles.get(row.accountCode) !== 'development') continue;
      const balance = row[field];
      if (!balance) continue;
      const facts = config.facts.filter((f) => f.key === rowKey(row) && f.period === at),
        fact = facts[0];
      if (facts.length !== 1 || !fact || fact.balance !== balance)
        problem(
          'DEVELOPMENT',
          `${at} ${row.accountCode} 费用化与资本化研发的明细分析缺失或余额已改变`,
          rowKey(row),
        );
      if (
        sum(fact.allocations.map((p) => p.amount)) !== balance ||
        fact.allocations.some(
          (p) =>
            !['development', 'administration'].includes(p.role) ||
            (balance > 0 ? p.amount < 0 : p.amount > 0),
        )
      )
        problem(
          'DEVELOPMENT_SUM',
          `${at} ${row.accountCode} 研发分析金额、方向或项目不正确`,
          rowKey(row),
        );
      for (const p of fact.allocations)
        if (p.role === 'administration')
          parts.push(
            amount(p.amount, fact.reason, [
              source(
                row,
                p.amount,
                field === 'opening' ? scope.from : scope.to,
                field === 'opening' ? scope.from : scope.to,
              ),
            ]),
          );
    }
    return combine(parts, `${at}费用化但未转入管理费用的研发余额`);
  };
  const atStart =
    scope.from % 100 === 1 ? (Math.floor(scope.from / 100) - 1) * 100 + 12 : scope.from - 1;
  const start = read(opening, 'opening', atStart),
    end = read(closing, 'closing', scope.to);
  return amount(
    sum([end.value, -start.value]),
    '期末未转损益费用化研发余额－期初未转损益费用化研发余额',
    [...end.sources, ...start.sources.map((s) => ({ ...s, amount: -s.amount }))],
  );
}
export function balanceSheet(data: DomainData): Statement {
  const result: Statement = {
    code: '301',
    name: '小企业资产负债表',
    columns: ['期末余额', '年初余额'],
    rows: rows(balanceLines),
    checks: [],
  };
  const returns: [number, number] = [0, 0];
  for (const column of [0, 1] as const) {
    const from = column === 0 ? data.period : Math.floor(data.period / 100) * 100 + 1;
    const to = column === 0 ? data.period : from;
    const at = column === 0 ? data.period : (Math.floor(data.period / 100) - 1) * 100 + 12;
    const buckets = new Map<Role, Amount[]>();
    const add = (role: Role, value: Amount) =>
      buckets.set(role, [...(buckets.get(role) ?? []), value]);
    for (const row of column === 0 ? data.closing : data.opening) {
      const value = column === 0 ? row.closing : row.opening;
      if (!value) continue;
      const mappedRole = data.roles.get(row.accountCode);
      if (!mappedRole)
        problem('UNMAPPED', `${at} 科目 ${row.accountCode} 未指定报表项目`, row.accountCode);
      const role = effectiveBalanceRole(mappedRole, value);
      const src = source(row, value, from, to);
      if (role === 'returnedCapital' && value < 0)
        problem(
          'RETURNED_CAPITAL',
          `${at} ${row.accountCode} 已归还投资必须根据真实借方明细确认，不能列负减项`,
          rowKey(row),
        );
      if (analyzed.includes(role)) {
        const facts = data.config.facts.filter((f) => f.period === at && f.key === rowKey(row));
        const fact = facts[0];
        if (facts.length !== 1 || !fact || fact.balance !== value)
          problem(
            'ANALYSIS',
            `${at} ${row.accountCode} 的期限或性质确认缺失、重复或余额已变化`,
            rowKey(row),
          );
        if (sum(fact.allocations.map((a) => a.amount)) !== value)
          problem('ANALYSIS_SUM', `${at} ${row.accountCode} 分类合计与余额不相等`, rowKey(row));
        for (const allocation of fact.allocations) {
          if (!analysisDestinations[role]?.includes(allocation.role))
            problem('ANALYSIS_ROLE', `${at} ${row.accountCode} 分类去向不适用`, rowKey(row));
          if (value > 0 ? allocation.amount < 0 : allocation.amount > 0)
            problem('ANALYSIS_SIGN', `${at} ${row.accountCode} 分类方向与余额不一致`, rowKey(row));
          add(
            allocation.role,
            amount(allocation.amount, `${fact.reason}：按明细分析`, [
              { ...src, amount: allocation.amount },
            ]),
          );
        }
      } else if (role === 'receivable' || role === 'payable') {
        add(
          value > 0
            ? role === 'receivable'
              ? 'receivable'
              : 'prepaid'
            : role === 'receivable'
              ? 'advance'
              : 'payable',
          amount(Math.abs(value), '末级科目及往来对象分别分借贷方向', [src]),
        );
      } else add(role, amount(value, '总账真实有符号余额', [src]));
    }
    const b = (role: Role, negative = false) => {
      const a = combine(buckets.get(role) ?? [], `${roles[role]}：完整末级总账汇总`);
      return negative ? amount(-a.value, `贷方正常余额：${rolesLabel(role)}`, a.sources) : a;
    };
    // 往来桶已经转换为正数，其他负债与权益按贷方正常方向列示。
    for (const role of ['prepaid', 'advance'] as const) {
      const values = buckets.get(role) ?? [];
      buckets.set(
        role,
        values.map((a) => amount(Math.abs(a.value), a.formula, a.sources)),
      );
    }
    const set = (line: number, a: Amount) => {
      result.rows[line - 1]!.amounts[column] = a;
    };
    const mapping: Record<number, [Role, boolean?]> = {
      1: ['money'],
      2: ['shortInvestment'],
      3: ['notesReceivable'],
      4: ['receivable'],
      5: ['prepaid'],
      6: ['dividend'],
      7: ['interest'],
      8: ['otherReceivable'],
      10: ['raw'],
      11: ['work'],
      12: ['goods'],
      13: ['turnover'],
      14: ['currentAsset'],
      16: ['bond'],
      17: ['equityInvestment'],
      18: ['fixed'],
      19: ['depreciation', true],
      21: ['construction'],
      22: ['constructionMaterials'],
      23: ['disposal'],
      26: ['development'],
      27: ['deferredExpense'],
      28: ['noncurrentAsset'],
      31: ['shortLoan', true],
      32: ['notesPayable', true],
      33: ['payable'],
      34: ['advance'],
      35: ['payroll', true],
      36: ['taxes', true],
      37: ['interestPayable', true],
      38: ['profitPayable', true],
      39: ['otherPayable', true],
      40: ['currentLiability', true],
      42: ['longLoan', true],
      43: ['longPayable', true],
      44: ['deferredIncome', true],
      45: ['noncurrentLiability', true],
      48: ['capital', true],
      49: ['capitalReserve', true],
      50: ['surplus', true],
    };
    for (const [line, [role, negative]] of Object.entries(mapping))
      set(Number(line), b(role, negative));
    set(
      9,
      combine(
        inventoryRoles.map((r) => b(r)),
        '全部存货组成按借正贷负相加，差异不取绝对值',
      ),
    );
    const equation = (line: number, terms: [number, number][]) =>
      set(
        line,
        combine(
          terms.map(([n, sign]) => {
            const a = result.rows[n - 1]!.amounts[column]!;
            return amount(a.value * sign, `行${n}`, a.sources);
          }),
          terms.map(([n, s]) => `${s === 1 ? '+' : '-'}行${n}`).join(''),
        ),
      );
    equation(20, [
      [18, 1],
      [19, -1],
    ]);
    set(
      24,
      combine([b('biological'), b('biologicalDepreciation')], '生产性生物资产原值加有符号累计折旧'),
    );
    set(25, combine([b('intangible'), b('amortization')], '无形资产原值加有符号累计摊销'));
    set(
      51,
      combine(
        [b('retained', true), b('currentProfit', true), ...pnlRoles.map((r) => b(r, true))],
        '利润分配＋本年利润＋尚未结转损益贷方净余额',
      ),
    );
    for (const [line, lines] of [
      [15, [1, 2, 3, 4, 5, 6, 7, 8, 9, 14]],
      [29, [16, 17, 20, 21, 22, 23, 24, 25, 26, 27, 28]],
      [30, [15, 29]],
      [41, [31, 32, 33, 34, 35, 36, 37, 38, 39, 40]],
      [46, [42, 43, 44, 45]],
      [47, [41, 46]],
      [52, [48, 49, 50, 51]],
      [53, [47, 52]],
    ] as const)
      equation(
        line,
        lines.map((n) => [n, 1]),
      );
    returns[column] = b('returnedCapital').value;
    if (returns[column]) {
      const a = result.rows[51]!.amounts[column]!;
      set(52, amount(sum([a.value, -returns[column]]), '行48＋49＋50＋51－已归还投资', a.sources));
      equation(53, [
        [47, 1],
        [52, 1],
      ]);
    }
    result.checks.push({
      name: `${result.columns[column]}资产与负债权益平衡`,
      column,
      line: 53,
      difference: sum([
        result.rows[29]!.amounts[column]!.value,
        -result.rows[52]!.amounts[column]!.value,
      ]),
      sources: [
        ...result.rows[29]!.amounts[column]!.sources,
        ...result.rows[52]!.amounts[column]!.sources,
      ],
    });
  }
  result.returnedInvestment = returns;
  return result;
}
function rolesLabel(role: Role) {
  return roles[role];
}
const incomeMain: Record<number, Role> = {
  1: 'revenue',
  2: 'cost',
  3: 'expenseTax',
  11: 'selling',
  14: 'administration',
  18: 'finance',
  20: 'investmentIncome',
  22: 'nonoperatingIncome',
  24: 'nonoperatingExpense',
  31: 'incomeTax',
};
export function incomeStatement(data: DomainData): Statement {
  const result: Statement = {
    code: '302',
    name: '小企业利润表',
    columns:
      data.mode === 'monthly' ? ['本年累计金额', '本月金额'] : ['本年累计金额', '上年全年金额'],
    rows: rows(incomeLines),
    checks: [],
  };
  result.rows[2]!.label = '税金及附加';
  result.notes = [
    '营业税、矿产资源补偿费、排污费等名称保留2011年附录的历史表样项目。本表只读取账簿已有发生，不依据这些历史名称计算现行税费。税金及附加按财会〔2016〕22号更名。',
  ];
  for (const column of [0, 1] as const) {
    const scope = data.scopes[column];
    if (!scope) continue;
    const entries = (column === 0 ? data.current : data.comparison).filter(
      (e) => data.closingKinds.get(e.voucherId) !== 'pnl',
    );
    const amounts = new Map<number, Amount[]>();
    const add = (line: number, a: Amount) => amounts.set(line, [...(amounts.get(line) ?? []), a]);
    for (const e of entries) {
      const role = data.roles.get(e.accountCode);
      if (!role || !pnlRoles.includes(role)) continue;
      const main = Number(Object.keys(incomeMain).find((k) => incomeMain[Number(k)] === role));
      const sign = ['revenue', 'investmentIncome', 'nonoperatingIncome'].includes(role) ? -1 : 1;
      const value = sum([e.debit, -e.credit]) * sign;
      const src = source(e, value, scope.from, scope.to);
      add(main, amount(value, '已排除真实损益结转的净发生额', [src]));
      if (Object.values(incomeDetails).some((d) => d.role === role)) {
        const allocation = data.config.incomeAllocations[String(e.lineId)];
        if (allocation) {
          if (
            allocation.signature !==
            entrySignature(e, column === 0 ? data.current : data.comparison)
          )
            problem(
              'INCOME_CHANGED',
              `${e.displayNo} 第${e.lineNo}行及其对方分录已改变，请重新确认费用分类`,
              String(e.lineId),
            );
          if (sum(allocation.parts.map((p) => p.amount)) !== value)
            problem(
              'INCOME_SUM',
              `${e.displayNo} 第${e.lineNo}行费用分类合计与净发生额不相等`,
              String(e.lineId),
            );
          for (const p of allocation.parts) {
            if (p.line === 0) continue;
            if (incomeDetails[p.line]?.role !== role)
              problem('DETAIL_ROLE', `${e.accountCode} 的明细项目与科目用途不一致`, e.accountCode);
            add(p.line, amount(p.amount, allocation.reason, [{ ...src, amount: p.amount }]));
          }
          continue;
        }
        const detail = data.config.details[e.accountCode];
        if (!detail)
          problem(
            'DETAIL',
            `${scope.label} ${e.accountCode} 尚未分类费用或税费明细`,
            e.accountCode,
          );
        if (detail.line !== null) {
          if (incomeDetails[detail.line]?.role !== role)
            problem('DETAIL_ROLE', `${e.accountCode} 的明细项目与科目用途不一致`, e.accountCode);
          add(detail.line, amount(value, detail.reason, [src]));
        }
      }
    }
    const development = data.developmentAdjustments?.[column];
    if (
      !data.developmentAdjustments &&
      entries.some((e) => data.roles.get(e.accountCode) === 'development')
    )
      problem('DEVELOPMENT', '研发支出的费用化分析缺少期间首尾依据，请重新确认');
    if (development) {
      add(14, development);
      add(17, development);
    }
    for (const row of result.rows)
      row.amounts[column] = combine(
        amounts.get(row.line) ?? [],
        `${scope.label}：完整真实分录净发生额汇总`,
      );
    const eq = (line: number, terms: [number, number][]) => {
      const a = combine(
        terms.map(([n, s]) => {
          const v = result.rows[n - 1]!.amounts[column]!;
          return amount(s * v.value, `行${n}`, v.sources);
        }),
        terms.map(([n, s]) => `${s === 1 ? '+' : '-'}行${n}`).join(''),
      );
      result.rows[line - 1]!.amounts[column] = a;
    };
    eq(21, [
      [1, 1],
      [2, -1],
      [3, -1],
      [11, -1],
      [14, -1],
      [18, -1],
      [20, 1],
    ]);
    eq(30, [
      [21, 1],
      [22, 1],
      [24, -1],
    ]);
    eq(32, [
      [30, 1],
      [31, -1],
    ]);
    const allPnl = entries.filter((e) => pnlRoles.includes(data.roles.get(e.accountCode)!));
    const actual = sum([
      ...allPnl.map((e) => sum([e.credit, -e.debit])),
      -(development?.value ?? 0),
    ]);
    result.checks.push({
      name: `${scope.label}净利润与全部损益净发生额`,
      column,
      line: 32,
      difference: sum([result.rows[31]!.amounts[column]!.value, -actual]),
      sources: allPnl.map((e) => source(e, sum([e.credit, -e.debit]), scope.from, scope.to)),
    });
  }
  return result;
}
function included(e: { accountCode: string; date: string }, data: DomainData): boolean {
  const scopes = data.config.cashScope.filter(
    (s) => s.account === e.accountCode && s.from <= e.date && s.to >= e.date,
  );
  if (scopes.length !== 1)
    problem('CASH_SCOPE', `${e.date} ${e.accountCode} 现金范围未确认或日期范围重叠`, e.accountCode);
  return scopes[0]!.available;
}
export function cashflowStatement(
  data: DomainData,
  balances: [
    { opening: BalanceRow[]; closing: BalanceRow[] },
    { opening: BalanceRow[]; closing: BalanceRow[] } | null,
  ],
): Statement {
  const result: Statement = {
    code: '303',
    name: '小企业现金流量表',
    columns:
      data.mode === 'monthly' ? ['本年累计金额', '本月金额'] : ['本年全年金额', '上年全年金额'],
    rows: rows(cashflowLines),
    checks: [],
  };
  for (const column of [0, 1] as const) {
    const scope = data.scopes[column];
    const balance = balances[column];
    if (!scope || !balance) continue;
    const entries = column === 0 ? data.current : data.comparison;
    const byVoucher = new Map<number, EntryRow[]>();
    for (const e of entries) byVoucher.set(e.voucherId, [...(byVoucher.get(e.voucherId) ?? []), e]);
    const values = new Map<number, Amount[]>();
    const internal = new Map<number, number[]>();
    const add = (line: number, a: Amount) => values.set(line, [...(values.get(line) ?? []), a]);
    for (const e of entries) {
      if (data.roles.get(e.accountCode) !== 'money' || !included(e, data)) continue;
      const signed = sum([e.debit, -e.credit]);
      if (!signed) continue;
      const allocation = data.config.cashAllocations[String(e.lineId)];
      const voucher = byVoucher.get(e.voucherId)!;
      const pure = voucher.every(
        (v) => data.roles.get(v.accountCode) === 'money' && included(v, data),
      );
      const parts = allocation?.parts ?? (pure ? [{ line: 0, amount: signed }] : undefined);
      if (!parts)
        problem(
          'CASH_CLASSIFICATION',
          `${scope.label} ${e.displayNo} 第${e.lineNo}行现金收付未分类`,
          String(e.lineId),
        );
      if (allocation && allocation.signature !== entrySignature(e, voucher))
        problem(
          'CASH_CHANGED',
          `${e.displayNo} 第${e.lineNo}行来源已改变，请重新确认现金分类`,
          String(e.lineId),
        );
      if (sum(parts.map((p) => p.amount)) !== signed)
        problem(
          'CASH_SUM',
          `${e.displayNo} 第${e.lineNo}行分配合计与实际现金收付不相等`,
          String(e.lineId),
        );
      for (const p of parts) {
        if (p.line === 0) {
          if (!pure)
            problem(
              'INTERNAL',
              `${e.displayNo} 含非现金科目，不能全部作为内部划转`,
              String(e.lineId),
            );
          internal.set(e.voucherId, [...(internal.get(e.voucherId) ?? []), p.amount]);
          continue;
        }
        const item = cashflowItems.find((i) => i.line === p.line);
        if (!item) problem('CASH_PROJECT', `${e.displayNo} 使用了无效现金项目`, String(e.lineId));
        add(
          p.line,
          amount(
            item.side === 'in' ? p.amount : -p.amount,
            allocation?.reason ?? '已确认的现金项目',
            [source(e, p.amount, scope.from, scope.to)],
          ),
        );
      }
    }
    for (const [id, parts] of internal)
      if (sum(parts) !== 0) problem('INTERNAL_SUM', `凭证 ${id} 内部划转未抵销`, String(id));
    for (const row of result.rows)
      row.amounts[column] = combine(
        values.get(row.line) ?? [],
        `${scope.label}：逐现金分录完整分类净额`,
      );
    const date = (period: number, end: boolean) => {
      const y = Math.floor(period / 100),
        m = period % 100;
      return end
        ? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
        : `${y}-${String(m).padStart(2, '0')}-01`;
    };
    const cashBalance = (rs: BalanceRow[], opening: boolean) => {
      const at = date(opening ? scope.from : scope.to, !opening);
      return combine(
        rs
          .filter(
            (r) =>
              data.roles.get(r.accountCode) === 'money' &&
              included({ accountCode: r.accountCode, date: at }, data),
          )
          .map((r) => {
            const v = opening ? r.opening : r.closing;
            return amount(v, '确认现金范围内的真实总账余额', [
              source(r, v, opening ? scope.from : scope.to, opening ? scope.from : scope.to),
            ]);
          }),
        `${at} 已确认现金范围余额`,
      );
    };
    const eq = (line: number, terms: [number, number][]) => {
      result.rows[line - 1]!.amounts[column] = combine(
        terms.map(([n, s]) => {
          const a = result.rows[n - 1]!.amounts[column]!;
          return amount(s * a.value, `行${n}`, a.sources);
        }),
        terms.map(([n, s]) => `${s === 1 ? '+' : '-'}行${n}`).join(''),
      );
    };
    eq(7, [
      [1, 1],
      [2, 1],
      [3, -1],
      [4, -1],
      [5, -1],
      [6, -1],
    ]);
    eq(13, [
      [8, 1],
      [9, 1],
      [10, 1],
      [11, -1],
      [12, -1],
    ]);
    eq(19, [
      [14, 1],
      [15, 1],
      [16, -1],
      [17, -1],
      [18, -1],
    ]);
    eq(20, [
      [7, 1],
      [13, 1],
      [19, 1],
    ]);
    result.rows[20]!.amounts[column] = cashBalance(balance.opening, true);
    eq(22, [
      [20, 1],
      [21, 1],
    ]);
    const actual = cashBalance(balance.closing, false);
    result.checks.push({
      name: `${scope.label}期末现金与真实总账现金范围一致`,
      column,
      line: 22,
      difference: sum([result.rows[21]!.amounts[column]!.value, -actual.value]),
      sources: actual.sources,
    });
  }
  return result;
}
