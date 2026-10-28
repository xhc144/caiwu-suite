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
    manufacturer: z.string().max(100).default(''),
    installation: z.string().max(200).default(''),
    manufactured: zDate.nullable().default(null),
    machineCode: z.string().max(100).default(''),
    custodian: z.string().max(100).default(''),
    currencyCode: z.string().trim().min(1).max(10).default('CNY'),
    foreignOriginal: quantitySchema.default('0'),
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
  amount: { label: '折旧额（元）', type: 'number' },
  useDate: { label: '使用日期', type: 'date' },
  reference: { label: '参考编号', type: 'text' },
  model: { label: '规格型号', type: 'text' },
  manufacturer: { label: '制造厂', type: 'text' },
  installation: { label: '当前安装地点', type: 'text' },
  machineCode: { label: '本机编号', type: 'text' },
  custodian: { label: '当前保管人', type: 'text' },
  acquired: { label: '购置日期', type: 'date' },
  manufactured: { label: '制造日期', type: 'date' },
  original: { label: '该月原值（元）', type: 'number' },
  residual: { label: '该月残值（元）', type: 'number' },
  depreciation: { label: '月初累计折旧（元）', type: 'number' },
  months: { label: '月初累计月数', type: 'integer' },
  lifeMonths: { label: '使用年限（月）', type: 'integer' },
  period: { label: '折旧月份', type: 'integer' },
  quantity: { label: '当前数量', type: 'decimal' },
  work: { label: '本月工作量', type: 'decimal' },
  totalWork: { label: '总工作量', type: 'decimal' },
  method: { label: '折旧方法码', type: 'text' },
  currencyCode: { label: '币种', type: 'text' },
  foreignOriginal: { label: '外币原值（原币金额）', type: 'decimal' },
  department: { label: '部门名称', type: 'text' },
  category: { label: '类别名称', type: 'text' },
  purpose: { label: '用途名称', type: 'text' },
  status: { label: '当前状态名称', type: 'text' },
} as const;
export const queryOperators = {
  eq: '等于',
  contains: '含有',
  gt: '大于',
  lt: '小于',
  ne: '不等于',
  notContains: '不含有',
  gte: '大于等于',
  lte: '小于等于',
} as const;
export const QueryConditionSchema = z
  .object({
    field: z.enum([
      'code',
      'name',
      'amount',
      'useDate',
      'reference',
      'model',
      'manufacturer',
      'installation',
      'machineCode',
      'custodian',
      'acquired',
      'manufactured',
      'original',
      'residual',
      'depreciation',
      'months',
      'lifeMonths',
      'period',
      'quantity',
      'work',
      'totalWork',
      'method',
      'currencyCode',
      'foreignOriginal',
      'department',
      'category',
      'purpose',
      'status',
    ]),
    op: z.enum(['eq', 'contains', 'gt', 'lt', 'ne', 'notContains', 'gte', 'lte']),
    value: z.string().min(1, '条件值不能为空').max(500, '条件值不能超过 500 字'),
  })
  .strict();
export type QueryCondition = z.infer<typeof QueryConditionSchema>;
export const MAX_QUERY_CONDITIONS = 20;
export const queryDisplayLabels = {
  period: '月份',
  code: '编号',
  name: '设备',
  department: '部门',
  category: '类别',
  purpose: '用途',
  work: '月工作量',
  amount: '折旧额',
  issue: '跳过或说明',
  reference: '参考编号',
  model: '规格型号',
  method: '折旧方法码',
  useDate: '使用日期',
  acquired: '购置日期',
  original: '该月原值',
  residual: '该月预计残值',
  depreciation: '月初累计折旧',
  months: '月初累计月数',
  lifeMonths: '使用年限（月）',
  quantity: '当前数量',
  totalWork: '总工作量',
  manufacturer: '制造厂',
  installation: '当前安装地点',
  machineCode: '本机编号',
  custodian: '当前保管人',
  currencyCode: '币种',
  foreignOriginal: '外币原值',
  manufactured: '制造日期',
} as const;
export const queryMoneyColumns = ['amount', 'original', 'residual', 'depreciation'] as const;

/** 页面与服务端共用条件语义；字段、操作符仍由白名单 schema 验证。 */
export function queryConditionProblem(c: QueryCondition) {
  if (!c.value.trim())
    return { code: 'QUERY_VALUE', message: '条件值不能为空', hint: '填写条件值或删除该条件' };
  if ((c.op === 'contains' || c.op === 'notContains') && queryFields[c.field].type !== 'text')
    return {
      code: 'QUERY_OPERATOR',
      message: `${queryFields[c.field].type === 'number' ? '金额' : queryFields[c.field].type === 'date' ? '日期' : '数值'}不能使用「${queryOperators[c.op]}」操作符`,
      hint: '请选择等于、大于或小于',
    };
  if (
    queryFields[c.field].type === 'number' &&
    (!/^\d+$/.test(c.value) || !Number.isSafeInteger(Number(c.value)))
  )
    return { code: 'QUERY_NUMBER', message: '金额条件必须为整数分', hint: '例如 100 元填 10000' };
  if (
    queryFields[c.field].type === 'integer' &&
    (!/^\d+$/.test(c.value) || !Number.isSafeInteger(Number(c.value)))
  )
    return { code: 'QUERY_NUMBER', message: '数量条件必须为非负整数', hint: '请核对月份或月数' };
  if (queryFields[c.field].type === 'decimal' && !quantitySchema.safeParse(c.value).success)
    return {
      code: 'QUERY_NUMBER',
      message: '数量或工作量必须为非负数，最多六位小数',
      hint: '请修正数量条件',
    };
  if (queryFields[c.field].type === 'date' && !isValidDate(c.value))
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
    expression: z.string().max(500).default(''),
    displayColumns: z
      .array(z.enum(Object.keys(queryDisplayLabels) as (keyof typeof queryDisplayLabels)[]))
      .min(1)
      .max(Object.keys(queryDisplayLabels).length)
      .refine((v) => new Set(v).size === v.length, '显示列不能重复')
      .default([
        'period',
        'code',
        'name',
        'department',
        'category',
        'purpose',
        'work',
        'amount',
        'issue',
      ]),
    sortField: z
      .enum(Object.keys(queryDisplayLabels) as (keyof typeof queryDisplayLabels)[])
      .default('period'),
    sortDirection: z.enum(['asc', 'desc']).default('asc'),
    sorts: z
      .array(
        z
          .object({
            field: z.enum(Object.keys(queryDisplayLabels) as (keyof typeof queryDisplayLabels)[]),
            direction: z.enum(['asc', 'desc']),
          })
          .strict(),
      )
      .max(5)
      .refine((rows) => new Set(rows.map((r) => r.field)).size === rows.length, '排序字段不能重复')
      .default([]),
    hideRepeated: z.boolean().default(false),
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
  fromCode: z.string().max(40).default(''),
  toCode: z.string().max(40).default(''),
  labelRange: z.enum(['all', 'serial']).default('all'),
  fromSerial: z.number().int().positive('起始序号必须为正整数').default(1),
  toSerial: z.number().int().positive('截止序号必须为正整数').default(1),
  labelColor: z.enum(['monochrome', 'color']).default('monochrome'),
  measure: z.enum(['original', 'net', 'depreciation']).default('original'),
  departmentLevel: z.enum(['detail', 'top']).default('detail'),
  categoryLevel: z.enum(['detail', 'top']).default('detail'),
});
export const BatchSchema = z.object({
  filter: CardFilter,
  field: z.enum([
    'model',
    'unit',
    'lifeMonths',
    'acquired',
    'padCode',
    'name',
    'reference',
    'manufacturer',
    'machineCode',
    'manufactured',
  ]),
  value: z.string().min(1).max(500),
});
export const batchFieldLabels = {
  model: '规格型号',
  unit: '单位',
  lifeMonths: '使用年限（月）',
  acquired: '购置日期',
  padCode: '编号补零长度',
  name: '设备名称',
  reference: '参考编号',
  manufacturer: '制造厂',
  machineCode: '本机编号',
  manufactured: '制造日期',
} as const;
export const ListEditSchema = z
  .object({
    name: z.string().trim().min(1, '设备名称必填').max(100),
    model: z.string().max(500),
    unit: z.string().max(20),
    reference: z.string().max(100),
    manufacturer: z.string().max(100),
    machineCode: z.string().max(100),
  })
  .partial()
  .strict();
export const ImportRowSchema = z.object({ row: z.number().int().positive(), data: z.unknown() });

export const AssetPrintSettingsSchema = z
  .object({
    version: z.literal(1).default(1),
    labelTitle: z.string().trim().min(1).max(40).default('固定资产标签'),
    labelFields: z
      .array(z.enum(['code', 'name', 'department', 'category', 'date', 'description', 'reference']))
      .min(2)
      .max(7)
      .refine(
        (v) => new Set(v).size === v.length && v.includes('code') && v.includes('name'),
        '标签字段不能重复且必须包含编号和名称',
      )
      .default(['code', 'name', 'department', 'category']),
    labelFont: z.number().int().min(6).max(12).default(9),
    labelBorder: z.boolean().default(false),
    pageSize: z.enum(['A4', 'B5']).default('A4'),
    rowsPerPage: z.number().int().min(5).max(30).default(18),
    color: z.enum(['monochrome', 'color']).default('monochrome'),
    scale: z.number().int().min(50).max(100).default(100),
    ruler: z.boolean().default(false),
  })
  .strict();
export type AssetPrintSettings = z.output<typeof AssetPrintSettingsSchema>;
