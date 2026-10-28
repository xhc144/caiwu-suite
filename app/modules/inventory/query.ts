import { Decimal, zDate } from '@caiwu/core';
import { z } from 'zod';

export const queryFields = {
  direction: { label: '入出库方向', type: 'text', header: true },
  warehouseCode: { label: '仓库编码', type: 'text', header: true },
  warehouseName: { label: '仓库名称', type: 'text', header: true },
  warehouseKind: { label: '仓库性质', type: 'text', header: true },
  warehouseStatus: { label: '仓库状态', type: 'text', header: true },
  number: { label: '单号', type: 'text', header: true },
  date: { label: '日期', type: 'date', header: true },
  period: { label: '会计月份', type: 'integer', header: true },
  category: { label: '类别', type: 'text', header: true },
  operator: { label: '经办人', type: 'text', header: true },
  summary: { label: '摘要', type: 'text', header: true },
  taxRate: { label: '税率（%）', type: 'decimal', header: false },
  accountCode: { label: '收付款科目编码', type: 'text', header: true },
  accountName: { label: '收付款科目名称', type: 'text', header: true },
  costAccountCode: { label: '成本科目编码', type: 'text', header: true },
  costAccountName: { label: '成本科目名称', type: 'text', header: true },
  auditStatus: { label: '审核状态', type: 'text', header: true },
  auditor: { label: '审核人', type: 'text', header: true },
  auditDate: { label: '审核日期', type: 'date', header: true },
  creator: { label: '制单人', type: 'text', header: true },
  voucherStatus: { label: '凭证状态', type: 'text', header: true },
  calculationStatus: { label: '核算状态', type: 'text', header: true },
  productCode: { label: '产品编号', type: 'text', header: false },
  productName: { label: '产品名称', type: 'text', header: false },
  specification: { label: '规格', type: 'text', header: false },
  unit: { label: '单位', type: 'text', header: false },
  receiptPrice: { label: '默认入库价（元）', type: 'decimal', header: false },
  issuePrice: { label: '默认出库价（元）', type: 'decimal', header: false },
  planPrice: { label: '计划价（元）', type: 'decimal', header: false },
  allocationFactor: { label: '费用分摊系数', type: 'decimal', header: false },
  productStatus: { label: '产品状态', type: 'text', header: false },
  inventoryAccountCode: { label: '存货科目编码', type: 'text', header: false },
  inventoryAccountName: { label: '存货科目名称', type: 'text', header: false },
  salesAccountCode: { label: '销售科目编码', type: 'text', header: false },
  salesAccountName: { label: '销售科目名称', type: 'text', header: false },
  position: { label: '行号', type: 'integer', header: false },
  quantity: { label: '数量', type: 'quantity', header: false },
  unitPrice: { label: '不含税单价（元）', type: 'decimal', header: false },
  taxUnitPrice: { label: '含税单价（元）', type: 'decimal', header: false },
  priceBasis: { label: '原单价口径', type: 'text', header: false },
  netCents: { label: '金额（元）', type: 'money', header: false },
  taxCents: { label: '税额（元）', type: 'money', header: false },
  grossCents: { label: '价税合计（元）', type: 'money', header: false },
  costCents: { label: '已核算出库成本（元）', type: 'money', header: false },
  unitCost: { label: '已核算单位成本（元）', type: 'decimal', header: false },
  note: { label: '明细说明', type: 'text', header: false },
} as const;
export type QueryField = keyof typeof queryFields;
export const queryFieldKeys = Object.keys(queryFields) as QueryField[];
export const QueryFieldSchema = z.enum(queryFieldKeys);
export const queryOperators = {
  eq: '等于',
  ne: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  contains: '含有',
  notContains: '不含有',
  startsWith: '开头是',
  endsWith: '结尾是',
  empty: '为空',
  notEmpty: '不为空',
} as const;
export type QueryOperator = keyof typeof queryOperators;
export function operatorsFor(field: QueryField): QueryOperator[] {
  return [
    'eq',
    'ne',
    'gt',
    'gte',
    'lt',
    'lte',
    ...(queryFields[field].type === 'text'
      ? (['contains', 'notContains', 'startsWith', 'endsWith'] as const)
      : []),
    'empty',
    'notEmpty',
  ];
}
export type QueryCondition = {
  type: 'condition';
  field: QueryField;
  operator: QueryOperator;
  value: string;
};
export type QueryGroup = { type: 'group'; logic: 'and' | 'or'; children: QueryNode[] };
export type QueryNode = QueryCondition | QueryGroup;
const conditionSchema = z
  .object({
    type: z.literal('condition'),
    field: QueryFieldSchema,
    operator: z.enum(Object.keys(queryOperators) as QueryOperator[]),
    value: z.string().max(200).default(''),
  })
  .strict()
  .superRefine((condition, ctx) => {
    const meta = queryFields[condition.field];
    if (!operatorsFor(condition.field).includes(condition.operator)) {
      ctx.addIssue({ code: 'custom', message: `${meta.label}不是文字，不能使用含有等文字运算符` });
      return;
    }
    if (condition.operator === 'empty' || condition.operator === 'notEmpty') {
      if (condition.value)
        ctx.addIssue({ code: 'custom', message: '为空或不为空条件不能同时填写比较值' });
      return;
    }
    if (meta.type === 'text') return;
    if (meta.type === 'date') {
      if (!zDate.safeParse(condition.value).success)
        ctx.addIssue({ code: 'custom', message: `${meta.label}应为有效日期，格式为 YYYY-MM-DD` });
      return;
    }
    const pattern =
      meta.type === 'integer'
        ? /^-?\d{1,15}$/
        : meta.type === 'money'
          ? /^-?\d{1,13}(\.\d{1,2})?$/
          : meta.type === 'quantity'
            ? /^-?\d{1,9}(\.\d{1,6})?$/
            : /^-?\d{1,15}(\.\d{1,60})?$/;
    if (!pattern.test(condition.value)) {
      ctx.addIssue({
        code: 'custom',
        message: `${meta.label}应为数字${meta.type === 'money' ? '，金额最多两位小数' : meta.type === 'quantity' ? '，数量最多六位小数' : ''}`,
      });
      return;
    }
    if (
      meta.type === 'money' &&
      !Number.isSafeInteger(new Decimal(condition.value).mul(100).toNumber())
    )
      ctx.addIssue({ code: 'custom', message: `${meta.label}超出允许范围` });
  });
const nodeSchema: z.ZodType<QueryNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    conditionSchema,
    z
      .object({
        type: z.literal('group'),
        logic: z.enum(['and', 'or']),
        children: z.array(nodeSchema).max(64),
      })
      .strict(),
  ]),
);
// Bound the tree before recursive parsing; malformed/oversized trees never become a broad query.
const boundedNodeSchema = z.preprocess((value, ctx) => {
  const queue = [{ value, depth: 0 }];
  let count = 0;
  while (queue.length) {
    const current = queue.pop()!;
    if (++count > 128 || current.depth > 8) {
      ctx.addIssue({
        code: 'custom',
        message: '查询最多允许 128 个条件和 8 层括号，请简化条件后重试',
      });
      return z.NEVER;
    }
    const node = current.value;
    if (node && typeof node === 'object' && 'children' in node && Array.isArray(node.children)) {
      if (current.depth > 0 && !node.children.length) {
        ctx.addIssue({ code: 'custom', message: '括号条件组不能为空，请添加条件或删除该组' });
        return z.NEVER;
      }
      for (const child of node.children) queue.push({ value: child, depth: current.depth + 1 });
    }
  }
  return value;
}, nodeSchema);
export const defaultQueryColumns: QueryField[] = [
  'date',
  'number',
  'direction',
  'warehouseName',
  'category',
  'productCode',
  'productName',
  'quantity',
  'unitPrice',
  'netCents',
  'taxCents',
  'grossCents',
];
export const InventoryQuerySchema = z
  .object({
    where: boundedNodeSchema.default({ type: 'group', logic: 'and', children: [] }),
    columns: z
      .array(QueryFieldSchema)
      .min(1, '请至少选择一个显示列')
      .max(queryFieldKeys.length)
      .default(defaultQueryColumns),
    sort: z
      .array(z.object({ field: QueryFieldSchema, direction: z.enum(['asc', 'desc']) }).strict())
      .max(8)
      .default([]),
    hideRepeatedHeaders: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (new Set(input.columns).size !== input.columns.length)
      ctx.addIssue({ code: 'custom', message: '显示列不能重复选择' });
    if (new Set(input.sort.map((item) => item.field)).size !== input.sort.length)
      ctx.addIssue({ code: 'custom', message: '排序字段不能重复选择' });
  });
export type InventoryQueryInput = z.input<typeof InventoryQuerySchema>;
export type InventoryQuery = z.output<typeof InventoryQuerySchema>;
export type QueryRow = {
  id: number;
  documentId: number;
  kind: 'receipt' | 'issue';
  repeatedHeader: boolean;
} & Record<QueryField, string | number | null>;

export function compareQueryValues(
  field: QueryField,
  a: string | number,
  b: string | number,
): number {
  const type = queryFields[field].type;
  if (type === 'text' || type === 'date')
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  const right =
    type === 'money' && typeof b === 'string' ? new Decimal(b).mul(100) : new Decimal(b);
  return new Decimal(a).comparedTo(right);
}
export function matchesQuery(row: QueryRow, node: QueryNode): boolean {
  if (node.type === 'group')
    return (
      !node.children.length ||
      (node.logic === 'and'
        ? node.children.every((child) => matchesQuery(row, child))
        : node.children.some((child) => matchesQuery(row, child)))
    );
  const actual = row[node.field];
  const empty = actual == null || actual === '';
  if (node.operator === 'empty') return empty;
  if (node.operator === 'notEmpty') return !empty;
  if (actual == null) return false;
  if (node.operator === 'contains') return String(actual).includes(node.value);
  if (node.operator === 'notContains') return !String(actual).includes(node.value);
  if (node.operator === 'startsWith') return String(actual).startsWith(node.value);
  if (node.operator === 'endsWith') return String(actual).endsWith(node.value);
  const compared = compareQueryValues(node.field, actual, node.value);
  return node.operator === 'eq'
    ? compared === 0
    : node.operator === 'ne'
      ? compared !== 0
      : node.operator === 'gt'
        ? compared > 0
        : node.operator === 'gte'
          ? compared >= 0
          : node.operator === 'lt'
            ? compared < 0
            : compared <= 0;
}
export function applyInventoryQuery(rows: QueryRow[], input: InventoryQuery): QueryRow[] {
  const result = rows.filter((row) => matchesQuery(row, input.where));
  result.sort((a, b) => {
    for (const sort of input.sort) {
      const left = a[sort.field],
        right = b[sort.field];
      const compared =
        left == null
          ? right == null
            ? 0
            : -1
          : right == null
            ? 1
            : compareQueryValues(sort.field, left, right);
      if (compared) return sort.direction === 'asc' ? compared : -compared;
    }
    return a.documentId - b.documentId || a.id - b.id;
  });
  return result.map((row, index) => ({
    ...row,
    repeatedHeader:
      input.hideRepeatedHeaders && index > 0 && result[index - 1]!.documentId === row.documentId,
  }));
}
