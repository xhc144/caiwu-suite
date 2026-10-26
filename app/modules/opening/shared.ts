import { z } from 'zod';
import {
  Decimal,
  BusinessError,
  assertCents,
  dimensionsKey,
  zCents,
  zId,
  type Account,
} from '@caiwu/core';

export const openingDimensions = [
  { id: 'project', name: '项目', window: 'w_xt_xmnc' },
  { id: 'partner', name: '客供', window: 'w_xt_dwnc' },
  { id: 'department', name: '部门', window: 'w_xt_bmnc' },
  { id: 'person', name: '个人', window: 'w_xt_grnc' },
] as const;
export type OpeningDimension = (typeof openingDimensions)[number]['id'];
export const YearSchema = z.object({ year: z.number().int().min(1900).max(9999) });
const dims = z
  .object({
    project: zId.nullable().optional(),
    partner: zId.nullable().optional(),
    department: zId.nullable().optional(),
    person: zId.nullable().optional(),
  })
  .strict();
export const RowSchema = YearSchema.extend({
  accountId: zId,
  dimensions: dims.default({}),
  currency: z.string().min(1).nullable().default(null),
  /** core 的起算余额：首年为启用余额，后续年度为年初余额。借正贷负，分。 */
  balance: zCents,
  ytdDebit: zCents.refine((v) => v >= 0, '账前累计借方不能为负').default(0),
  ytdCredit: zCents.refine((v) => v >= 0, '账前累计贷方不能为负').default(0),
  fcBalance: zCents.default(0),
  quantity: z
    .string()
    .regex(/^-?\d+(\.\d{1,6})?$/, '数量最多六位小数')
    .default('0'),
});
export type RowInput = z.input<typeof RowSchema>;
export type SavedRow = z.output<typeof RowSchema> & { id: number };
export const ChangeSchema = z.object({
  data: RowSchema,
  /** 缺省为新增；修改必须指定已保存行及原内容。键不允许在修改中改变。 */
  id: zId.optional(),
  expected: z.string().optional(),
  view: z.enum(['project', 'partner', 'department', 'person']).optional(),
});
export type Change = z.input<typeof ChangeSchema>;
export const BatchSchema = YearSchema.extend({ changes: z.array(ChangeSchema).min(1).max(5000) });
export const FileSchema = YearSchema.extend({
  file: z.string().min(1).max(900_000),
  mode: z.enum(['add', 'overwrite']),
});
export const ImportSchema = FileSchema.extend({ confirmed: z.boolean(), expected: z.string() });
export const RemoveSchema = YearSchema.extend({
  id: zId,
  expected: z.string(),
  confirmed: z.boolean(),
});
export const CleanupSchema = YearSchema.extend({ expected: z.string(), confirmation: z.string() });

export function exactSum(values: readonly number[]): number {
  return assertCents(values.reduce((s, n) => s.add(n), new Decimal(0)).toNumber());
}
export function yearStart(row: Pick<SavedRow, 'balance' | 'ytdDebit' | 'ytdCredit'>): number {
  return exactSum([row.balance, -row.ytdDebit, row.ytdCredit]);
}
export function openingKey(row: Pick<RowInput, 'year' | 'accountId' | 'dimensions' | 'currency'>) {
  return `${row.year}|${row.accountId}|${dimensionsKey(row.dimensions ?? {})}|${row.currency ?? ''}`;
}
export function rowVersion(row: SavedRow) {
  return JSON.stringify([
    openingKey(row),
    row.id,
    row.balance,
    row.ytdDebit,
    row.ytdCredit,
    row.fcBalance,
    new Decimal(row.quantity).toFixed(),
  ]);
}
export function rowsVersion(rows: SavedRow[]) {
  return JSON.stringify(rows.map(rowVersion));
}
export function strictMoney(text: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(text.trim())) {
    throw new BusinessError({
      code: 'OPENING_MONEY_FORMAT',
      message: '金额须为十进制元，最多两位小数',
      hint: '例如 123.45；不要使用公式、千分位或科学计数法',
    });
  }
  return assertCents(new Decimal(text.trim()).mul(100).toNumber());
}
export type SummaryRow = Account & {
  balance: number;
  yearStart: number;
  ytdDebit: number;
  ytdCredit: number;
  fcBalance: number;
  quantity: string;
  savedCount: number;
  children?: SummaryRow[];
};
/** 只从末级明细汇总，不把已有父级行二次加入。树依赖真实 parentId。 */
export function accountTree(accounts: Account[], rows: SavedRow[]): SummaryRow[] {
  const result = new Map<number, SummaryRow>();
  for (const a of accounts) {
    const own = a.isLeaf ? rows.filter((r) => r.accountId === a.id) : [];
    result.set(a.id, {
      ...a,
      balance: exactSum(own.map((r) => r.balance)),
      yearStart: exactSum(own.map(yearStart)),
      ytdDebit: exactSum(own.map((r) => r.ytdDebit)),
      ytdCredit: exactSum(own.map((r) => r.ytdCredit)),
      fcBalance: exactSum(own.map((r) => r.fcBalance)),
      quantity: own.reduce((s, r) => s.add(r.quantity), new Decimal(0)).toFixed(),
      savedCount: own.length,
    });
  }
  for (const a of [...accounts].sort((a, b) => b.level - a.level)) {
    const child = result.get(a.id)!;
    const parent = a.parentId == null ? undefined : result.get(a.parentId);
    if (!parent) continue;
    for (const field of ['balance', 'yearStart', 'ytdDebit', 'ytdCredit', 'fcBalance'] as const)
      parent[field] = exactSum([parent[field], child[field]]);
    parent.quantity = new Decimal(parent.quantity).add(child.quantity).toFixed();
    parent.savedCount += child.savedCount;
    (parent.children ??= []).unshift(child);
  }
  return [...result.values()].filter((a) => a.parentId == null);
}
