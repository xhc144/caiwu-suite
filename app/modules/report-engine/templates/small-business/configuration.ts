import { z } from 'zod';
import { BusinessError, type Account, type BalanceRow, type EntryRow } from '@caiwu/core';

export const roles = {
  money: '货币资金',
  shortInvestment: '短期投资',
  notesReceivable: '应收票据',
  receivable: '应收账款',
  prepaid: '预付账款',
  dividend: '应收股利',
  interest: '应收利息',
  otherReceivable: '其他应收款',
  purchases: '材料采购',
  inTransit: '在途物资',
  raw: '原材料',
  materialVariance: '材料成本差异',
  work: '在产品',
  goods: '库存商品',
  goodsVariance: '商品进销差价',
  outsourced: '委托加工物资',
  turnover: '周转材料',
  biologicalInventory: '消耗性生物资产',
  otherInventory: '其他存货',
  currentAsset: '其他流动资产',
  bond: '长期债券投资',
  equityInvestment: '长期股权投资',
  fixed: '固定资产原价',
  depreciation: '累计折旧',
  construction: '在建工程',
  constructionMaterials: '工程物资',
  disposal: '固定资产清理',
  biological: '生产性生物资产',
  biologicalDepreciation: '生产性生物资产累计折旧',
  intangible: '无形资产',
  amortization: '累计摊销',
  development: '开发支出',
  deferredExpense: '长期待摊费用',
  noncurrentAsset: '其他非流动资产',
  shortLoan: '短期借款',
  notesPayable: '应付票据',
  payable: '应付账款',
  advance: '预收账款',
  payroll: '应付职工薪酬',
  taxes: '应交税费',
  interestPayable: '应付利息',
  profitPayable: '应付利润',
  otherPayable: '其他应付款',
  currentLiability: '其他流动负债',
  longLoan: '长期借款',
  longPayable: '长期应付款',
  deferredIncome: '递延收益',
  noncurrentLiability: '其他非流动负债',
  capital: '实收资本',
  returnedCapital: '已归还投资',
  capitalReserve: '资本公积',
  surplus: '盈余公积',
  currentProfit: '本年利润',
  retained: '利润分配',
  revenue: '营业收入',
  cost: '营业成本',
  expenseTax: '税金及附加',
  selling: '销售费用',
  administration: '管理费用',
  finance: '财务费用',
  investmentIncome: '投资收益',
  nonoperatingIncome: '营业外收入',
  nonoperatingExpense: '营业外支出',
  incomeTax: '所得税费用',
} as const;
export type Role = keyof typeof roles;
export const standardRoots: Record<string, Role> = {
  '1001': 'money',
  '1002': 'money',
  '1012': 'money',
  '1101': 'shortInvestment',
  '1121': 'notesReceivable',
  '1122': 'receivable',
  '1123': 'prepaid',
  '1131': 'dividend',
  '1132': 'interest',
  '1221': 'otherReceivable',
  '1401': 'purchases',
  '1402': 'inTransit',
  '1403': 'raw',
  '1404': 'materialVariance',
  '1405': 'goods',
  '1407': 'goodsVariance',
  '1408': 'outsourced',
  '1411': 'turnover',
  '1421': 'biologicalInventory',
  '1501': 'bond',
  '1511': 'equityInvestment',
  '1601': 'fixed',
  '1602': 'depreciation',
  '1604': 'construction',
  '1605': 'constructionMaterials',
  '1606': 'disposal',
  '1621': 'biological',
  '1622': 'biologicalDepreciation',
  '1701': 'intangible',
  '1702': 'amortization',
  '1801': 'deferredExpense',
  '2001': 'shortLoan',
  '2201': 'notesPayable',
  '2202': 'payable',
  '2203': 'advance',
  '2211': 'payroll',
  '2221': 'taxes',
  '2231': 'interestPayable',
  '2232': 'profitPayable',
  '2241': 'otherPayable',
  '2401': 'deferredIncome',
  '2501': 'longLoan',
  '2701': 'longPayable',
  '3001': 'capital',
  '3002': 'capitalReserve',
  '3101': 'surplus',
  '3103': 'currentProfit',
  '3104': 'retained',
  '4001': 'work',
  '4101': 'work',
  '4301': 'development',
  '5001': 'revenue',
  '5051': 'revenue',
  '5111': 'investmentIncome',
  '5301': 'nonoperatingIncome',
  '5401': 'cost',
  '5402': 'cost',
  '5403': 'expenseTax',
  '5601': 'selling',
  '5602': 'administration',
  '5603': 'finance',
  '5711': 'nonoperatingExpense',
  '5801': 'incomeTax',
};
export const incomeDetails: Record<number, { role: Role; label: string }> = {
  4: { role: 'expenseTax', label: '消费税' },
  5: { role: 'expenseTax', label: '营业税（历史）' },
  6: { role: 'expenseTax', label: '城市维护建设税' },
  7: { role: 'expenseTax', label: '资源税' },
  8: { role: 'expenseTax', label: '土地增值税' },
  9: { role: 'expenseTax', label: '城镇土地使用税、房产税、车船税、印花税' },
  10: { role: 'expenseTax', label: '教育费附加、矿产资源补偿费、排污费' },
  12: { role: 'selling', label: '商品维修费' },
  13: { role: 'selling', label: '广告费和业务宣传费' },
  15: { role: 'administration', label: '开办费' },
  16: { role: 'administration', label: '业务招待费' },
  17: { role: 'administration', label: '研究费用' },
  19: { role: 'finance', label: '利息费用或收入' },
  23: { role: 'nonoperatingIncome', label: '政府补助' },
  25: { role: 'nonoperatingExpense', label: '坏账损失' },
  26: { role: 'nonoperatingExpense', label: '长期债券投资损失' },
  27: { role: 'nonoperatingExpense', label: '长期股权投资损失' },
  28: { role: 'nonoperatingExpense', label: '自然灾害等损失' },
  29: { role: 'nonoperatingExpense', label: '税收滞纳金' },
};
const money = z.number().int().refine(Number.isSafeInteger, '金额超出可计算范围');
const role = z.enum(Object.keys(roles) as [Role, ...Role[]]);
const reason = z.string().trim().min(1, '请填写确认依据').max(500);
export const ConfigurationSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().positive(),
    bookId: z.string().min(1),
    mappings: z.record(z.string(), z.object({ role, reason }).strict()),
    details: z.record(z.string(), z.object({ line: z.number().int().nullable(), reason }).strict()),
    facts: z.array(
      z
        .object({
          period: z.number().int(),
          key: z.string(),
          balance: money,
          reason,
          allocations: z.array(z.object({ role, amount: money }).strict()).min(1),
        })
        .strict(),
    ),
    cashScope: z.array(
      z
        .object({
          account: z.string(),
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          available: z.boolean(),
          reason,
        })
        .strict(),
    ),
    cashAllocations: z.record(
      z.string(),
      z
        .object({
          signature: z.string(),
          reason,
          parts: z.array(z.object({ line: z.number().int(), amount: money }).strict()).min(1),
        })
        .strict(),
    ),
    incomeAllocations: z.record(
      z.string(),
      z
        .object({
          signature: z.string(),
          reason,
          parts: z.array(z.object({ line: z.number().int(), amount: money }).strict()).min(1),
        })
        .strict(),
    ),
    firstYear: z.object({ year: z.number().int(), reason }).strict().nullable(),
    openingEvidence: z.array(
      z
        .object({
          year: z.number().int(),
          startPeriod: z.number().int(),
          reason,
          pnlClosing: z.array(
            z
              .object({
                key: z.string(),
                debit: money.nonnegative(),
                credit: money.nonnegative(),
                reason,
              })
              .strict(),
          ),
          cashHistory: z.array(
            z
              .object({
                key: z.string(),
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                line: z.number().int(),
                inflow: money.nonnegative(),
                outflow: money.nonnegative(),
                reason,
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type Configuration = z.infer<typeof ConfigurationSchema>;
export const inventoryRoles: Role[] = [
  'purchases',
  'inTransit',
  'raw',
  'materialVariance',
  'work',
  'goods',
  'goodsVariance',
  'outsourced',
  'turnover',
  'biologicalInventory',
  'otherInventory',
];
export const pnlRoles: Role[] = [
  'revenue',
  'cost',
  'expenseTax',
  'selling',
  'administration',
  'finance',
  'investmentIncome',
  'nonoperatingIncome',
  'nonoperatingExpense',
  'incomeTax',
];
export function problem(code: string, message: string, target = 'configuration'): never {
  throw new BusinessError({
    code: `SMALL_REPORT_${code}`,
    message,
    hint: '请在报表管理中补充或重新确认对应配置后重新生成。上次成功报表保留。',
    actions: [
      {
        label: '修正报表配置',
        to: `/m/report-engine?configuration=small-business&target=${encodeURIComponent(target)}`,
      },
    ],
  });
}
export function safe(value: bigint | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) problem('AMOUNT', '金额合计超出可计算范围');
  return n;
}
export const sum = (values: readonly number[]) => safe(values.reduce((s, n) => s + BigInt(n), 0n));
export function rowKey(row: Pick<BalanceRow, 'accountCode' | 'dimensions'>) {
  return `${row.accountCode}|${['partner', 'project', 'department', 'person'].map((k) => row.dimensions[k as keyof typeof row.dimensions] ?? '').join('|')}`;
}
export function entrySignature(e: EntryRow, voucherEntries: readonly EntryRow[] = []) {
  return JSON.stringify([
    e.voucherId,
    e.lineId,
    e.period,
    e.accountCode,
    e.debit,
    e.credit,
    e.dimensions,
    e.summary,
    voucherEntries
      .filter((v) => v.voucherId === e.voucherId)
      .sort((a, b) => a.lineId - b.lineId)
      .map((v) => [v.lineId, v.accountCode, v.debit, v.credit, v.dimensions, v.summary]),
  ]);
}
export function resolveRoles(
  accounts: readonly Account[],
  config: Configuration,
  options: { allowStaleMappings?: boolean } = {},
): Map<string, Role> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const result = new Map<string, Role>();
  for (const a of accounts.filter((a) => a.isLeaf)) {
    let current: Account | undefined = a;
    let found: Role | undefined;
    while (current) {
      found = config.mappings[current.code]?.role;
      if (!found)
        found =
          current.code === '4301' && ['费用化支出', '费用化研发支出'].includes(a.name.trim())
            ? 'administration'
            : current.code === '3001' && a.name.trim() === '已归还投资'
              ? 'returnedCapital'
              : standardRoots[current.code];
      if (found) break;
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    if (found) result.set(a.code, found);
  }
  for (const code of Object.keys(config.mappings))
    if (!options.allowStaleMappings && !accounts.some((a) => a.code === code))
      problem('MAPPING', `映射科目 ${code} 已不存在`, code);
  return result;
}
export function initialDetails(
  accounts: readonly Account[],
  config: Configuration,
): Configuration['details'] {
  const resolved = resolveRoles(accounts, config, { allowStaleMappings: true }),
    details: Configuration['details'] = {};
  const aliases: Record<number, string[]> = {
    5: ['营业税'],
    9: ['城镇土地使用税', '房产税', '车船税', '印花税'],
    10: ['教育费附加', '地方教育附加', '矿产资源补偿费', '排污费'],
    13: ['广告费', '业务宣传费'],
    17: ['费用化支出', '费用化研发支出'],
    19: ['利息费用', '利息支出', '利息收入', '利息净支出'],
  };
  for (const a of accounts.filter((a) => a.isLeaf))
    for (const [line, definition] of Object.entries(incomeDetails))
      if (
        resolved.get(a.code) === definition.role &&
        [definition.label, ...(aliases[Number(line)] ?? [])].includes(a.name.trim())
      )
        details[a.code] = {
          line: Number(line),
          reason: '按制度项目及真实科目名称自动对应，生成时重新核实科目来源',
        };
  return details;
}
export function initialConfiguration(bookId: string): Configuration {
  return {
    version: 1,
    revision: 1,
    bookId,
    mappings: {},
    details: {},
    facts: [],
    cashScope: [],
    cashAllocations: {},
    incomeAllocations: {},
    firstYear: null,
    openingEvidence: [],
  };
}
