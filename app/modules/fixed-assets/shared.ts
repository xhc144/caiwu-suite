import { z } from 'zod';
import { Decimal, isValidDate, zCents, zCode, zDate, zDecimal, zId, zPeriod } from '@caiwu/core';

export const MasterKind = z.enum(['category', 'purpose', 'status', 'reason']);
export const masterLabels = {
  category: '资产类别',
  purpose: '资产用途',
  status: '设备状态',
  reason: '注销原因',
};
export const nonnegativeDecimal = zDecimal
  .refine((v) => new Decimal(v).gte(0), '数值不能为负')
  .refine((v) => new Decimal(v).lte('9000000000'), '数量或单价超出范围');
export const quantitySchema = nonnegativeDecimal.refine(
  (v) => /^\d+(\.\d{1,6})?$/.test(v),
  '数量最多六位小数',
);
export const MasterSchema = z.object({
  kind: MasterKind,
  code: zCode,
  name: z.string().trim().min(1, '名称必填').max(100),
  accountId: zId.nullable().default(null),
  rate: nonnegativeDecimal
    .refine((v) => new Decimal(v).lte(1), '残值率范围为 0 至 1')
    .default('0.05'),
  depreciates: z.boolean().default(true),
  disabled: z.boolean().default(false),
});
export const AccessorySchema = z.object({
  code: zCode,
  name: z.string().trim().min(1, '附属设备名称必填').max(100),
  quantity: quantitySchema.refine((v) => new Decimal(v).gt(0), '数量必须大于零'),
  unitPrice: nonnegativeDecimal,
  note: z.string().max(500).default(''),
});
export const CardSchema = z
  .object({
    code: zCode,
    name: z.string().trim().min(1, '设备名称必填').max(100),
    reference: z.string().max(100).default(''),
    categoryId: zId,
    statusId: zId,
    purposeId: zId,
    departmentId: zId,
    acquired: zDate,
    useDate: zDate,
    original: zCents.refine((v) => v > 0, '原值必须大于零'),
    rate: nonnegativeDecimal.refine((v) => new Decimal(v).lte(1), '残值率范围为 0 至 1'),
    residual: zCents.min(0).optional(),
    method: z.enum(['1', '2']),
    lifeMonths: z.number().int().min(0).max(12000),
    model: z.string().max(500).default(''),
    unit: z.string().max(20).default('台'),
    quantity: quantitySchema.default('1'),
    totalWork: quantitySchema.default('0'),
    openingWork: quantitySchema.default('0'),
    openingDepreciation: zCents.min(0).default(0),
    openingMonths: z.number().int().min(0).max(12000).default(0),
    accessories: z.array(AccessorySchema).max(1000).default([]),
    confirmShortLife: z.boolean().default(false),
    confirmCodeChange: z.boolean().default(false),
  })
  .superRefine((v, c) => {
    if (v.method === '1' && v.lifeMonths === 0)
      c.addIssue({
        code: 'custom',
        path: ['lifeMonths'],
        message: '平均年限法必须填写使用年限（月）',
      });
    if (v.method === '2' && new Decimal(v.totalWork).lte(0))
      c.addIssue({ code: 'custom', path: ['totalWork'], message: '工作量法必须填写正数总工作量' });
  });
export type CardInput = z.input<typeof CardSchema>;
export type CardData = z.output<typeof CardSchema>;
export const CardFilter = z
  .object({
    keyword: z.string().max(100).optional(),
    code: z.string().max(40).optional(),
    name: z.string().max(100).optional(),
    id: zId.optional(),
    categoryId: zId.optional(),
    departmentId: zId.optional(),
    statusId: zId.optional(),
    purposeId: zId.optional(),
    includeDisposed: z.boolean().default(false),
  })
  .strict();
export type CardFilterInput = z.input<typeof CardFilter>;
export const MonthSchema = z.object({ period: zPeriod });
export const SettingsSchema = z.object({
  depreciationAccountId: zId,
  clearingAccountId: zId,
  voucherTypeId: zId,
});
export type Settings = z.infer<typeof SettingsSchema>;
export const DepreciationConfirm = z.object({
  period: zPeriod,
  token: z.string(),
  confirm: z.literal(true),
  skipMissing: z.boolean().default(false),
});
export const queryFields = {
  code: { label: '编码', type: 'text' },
  name: { label: '名称', type: 'text' },
  amount: { label: '折旧额（整数分）', type: 'number' },
  useDate: { label: '使用日期', type: 'date' },
} as const;
export const queryOperators = { eq: '等于', contains: '含有', gt: '大于', lt: '小于' } as const;
export const QueryConditionSchema = z
  .object({
    field: z.enum(['code', 'name', 'amount', 'useDate']),
    op: z.enum(['eq', 'contains', 'gt', 'lt']),
    value: z.string().min(1, '条件值不能为空').max(500, '条件值不能超过 500 字'),
  })
  .strict();
export type QueryCondition = z.infer<typeof QueryConditionSchema>;
export const MAX_QUERY_CONDITIONS = 20;

/** 页面与服务端共用条件语义；字段、操作符仍由白名单 schema 验证。 */
export function queryConditionProblem(c: QueryCondition) {
  if (!c.value.trim())
    return { code: 'QUERY_VALUE', message: '条件值不能为空', hint: '填写条件值或删除该条件' };
  if (c.op === 'contains' && queryFields[c.field].type !== 'text')
    return {
      code: 'QUERY_OPERATOR',
      message: `${c.field === 'amount' ? '金额' : '日期'}不能使用「含有」操作符`,
      hint: '请选择等于、大于或小于',
    };
  if (c.field === 'amount' && (!/^\d+$/.test(c.value) || !Number.isSafeInteger(Number(c.value))))
    return { code: 'QUERY_NUMBER', message: '金额条件必须为整数分', hint: '例如 100 元填 10000' };
  if (c.field === 'useDate' && !isValidDate(c.value))
    return { code: 'QUERY_DATE', message: '日期条件格式应为 YYYY-MM-DD', hint: '请填写真实日期' };
  return null;
}

export const QuerySchema = z
  .object({
    from: zPeriod,
    to: zPeriod,
    showZero: z.boolean().default(false),
    assetId: zId.optional(),
    departmentId: zId.optional(),
    categoryId: zId.optional(),
    purposeId: zId.optional(),
    conditions: z.array(QueryConditionSchema).max(MAX_QUERY_CONDITIONS).default([]),
    departmentLevel: z.enum(['detail', 'top']).default('detail'),
    categoryLevel: z.enum(['detail', 'top']).default('detail'),
  })
  .strict()
  .refine((v) => v.from <= v.to, '起始月份不能晚于截止月份');
export const reportKinds = {
  ledger: '资产明细账',
  list: '资产清单',
  accessories: '附属设备表',
  due: '到期资产清单',
  additions: '资产增加清单',
  reductions: '资产减少清单',
  distribution: '资产分布表',
  register: '固定资产台账',
  labels: '资产标签',
};
export const ReportSchema = z.object({
  kind: z.enum([
    'ledger',
    'list',
    'accessories',
    'due',
    'additions',
    'reductions',
    'distribution',
    'register',
    'labels',
  ]),
  year: z.number().int().min(1900).max(9999),
  cutoff: zDate,
  includeEarlier: z.boolean().default(false),
  fromCode: z.string().default(''),
  toCode: z.string().default(''),
  measure: z.enum(['original', 'net', 'depreciation']).default('original'),
  departmentLevel: z.enum(['detail', 'top']).default('detail'),
  categoryLevel: z.enum(['detail', 'top']).default('detail'),
});
export const BatchSchema = z.object({
  filter: CardFilter,
  field: z.enum(['model', 'unit', 'lifeMonths', 'acquired', 'padCode']),
  value: z.string().min(1).max(500),
});
export const ImportRowSchema = z.object({ row: z.number().int().positive(), data: z.unknown() });
