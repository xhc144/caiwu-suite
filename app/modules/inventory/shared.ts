import { z } from 'zod';
import { zCents, zDate, zId } from '@caiwu/core';
const text = z.string().trim().max(200);
export const decimal = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,6})?$/, '请输入非负十进制数，最多六位小数');
export const signedQuantity = z
  .string()
  .trim()
  .regex(/^-?\d{1,9}(\.\d{1,6})?$/, '数量必须为十进制数，最多六位小数');
export const Kind = z.enum(['receipt', 'issue']);
export const InvoiceKind = z.enum(['none', 'ordinary', 'special']);
export const ProductSchema = z.object({
  id: zId.optional(),
  revision: z.number().int().positive().optional(),
  code: text.min(1, '产品编号不能为空'),
  name: text.min(1, '产品名称不能为空'),
  specification: text.default(''),
  unit: text.default('件'),
  receiptPrice: decimal.default('0'),
  issuePrice: decimal.default('0'),
  planPrice: decimal.default('0'),
  inventoryAccountId: zId.nullable().default(null),
  salesAccountId: zId.nullable().default(null),
  allocationFactor: decimal.default('1'),
  confirmZeroFactor: z.boolean().default(false),
  disabled: z.boolean().default(false),
});
export const WarehouseSchema = z.object({
  id: zId.optional(),
  revision: z.number().int().positive().optional(),
  code: text.min(1, '仓库编码不能为空'),
  name: text.min(1, '仓库名称不能为空'),
  kind: z.enum(['warehouse', 'workshop']).default('warehouse'),
  disabled: z.boolean().default(false),
});
export const LineSchema = z.object({
  productCode: text.min(1, '产品编号不能为空'),
  quantity: decimal.refine((v) => /[1-9]/.test(v), '数量必须大于零'),
  unitPrice: decimal,
  priceIncludesTax: z.boolean().default(false),
  note: text.default(''),
});
export const DocumentSchema = z.object({
  id: zId.optional(),
  revision: z.number().int().positive().optional(),
  requestKey: z.string().min(8).max(100),
  kind: Kind,
  warehouseId: zId,
  number: text.min(1, '单号不能为空'),
  date: zDate,
  category: z.enum(['采购', '其他入库', '销售', '领用', '其他出库']),
  operator: text.default(''),
  summary: text.default(''),
  accountId: zId.nullable().default(null),
  costAccountId: zId.nullable().default(null),
  taxRate: decimal.default('0'),
  invoiceKind: InvoiceKind.default('none'),
  lines: z.array(LineSchema).max(1000),
  sourceType: z.enum(['contract', 'document']).nullable().default(null),
  sourceId: zId.nullable().default(null),
  negativeConfirmation: z.string().optional(),
});
export const OpeningRowSchema = z
  .object({
    productCode: text.min(1, '产品编号不能为空'),
    quantity: decimal,
    valueBasis: z.enum(['unitPrice', 'amount']).default('unitPrice'),
    unitPrice: decimal.optional(),
    amountCents: zCents.nonnegative('期初金额不能为负数').optional(),
  })
  .strict()
  .superRefine((row, ctx) => {
    const amount = row.valueBasis === 'amount';
    if ((amount ? row.amountCents : row.unitPrice) === undefined)
      ctx.addIssue({
        code: 'custom',
        path: [amount ? 'amountCents' : 'unitPrice'],
        message: amount ? '直接金额口径必须填写整数分金额' : '数量×单价口径必须填写单价',
      });
    if ((amount ? row.unitPrice : row.amountCents) !== undefined)
      ctx.addIssue({
        code: 'custom',
        message: '只能提交所选口径的输入，不能同时提交单价和金额或静默覆盖',
      });
  });
export type OpeningRowInput = z.input<typeof OpeningRowSchema>;
export const OpeningSchema = z.object({
  warehouseId: zId,
  revision: z.number().int().nonnegative(),
  confirmReplace: z.boolean().default(false),
  rows: z.array(OpeningRowSchema).max(1000),
});
export const FilterSchema = z
  .object({
    warehouseId: zId.optional(),
    productCode: text.optional(),
    productFrom: text.optional(),
    productTo: text.optional(),
    keyword: text.optional(),
    id: zId.optional(),
    from: zDate.optional(),
    to: zDate.optional(),
    kind: Kind.optional(),
    category: text.optional(),
    unaudited: z.boolean().optional(),
    unvouchered: z.boolean().optional(),
    hideZero: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.to >= v.from, '截止日期不能早于起始日期')
  .refine(
    (v) => !v.productFrom || !v.productTo || v.productTo >= v.productFrom,
    '截止产品编号不能小于起始产品编号',
  );
export const CountSchema = z.object({
  warehouseId: zId,
  period: z.number().int(),
  revision: z.number().int().nonnegative(),
  rows: z
    .array(z.object({ productCode: text.min(1), actual: signedQuantity, note: text.default('') }))
    .max(1000),
});
export const ContractSchema = z.object({
  id: zId.optional(),
  revision: z.number().int().positive().optional(),
  number: text.min(1, '合同号不能为空'),
  warehouseId: zId,
  supplierId: zId,
  date: zDate,
  agent: text.default(''),
  dueDate: zDate.nullable().default(null),
  note: text.default(''),
  status: z.enum(['open', 'completed', 'cancelled']).default('open'),
  lines: z.array(LineSchema).min(1).max(1000),
});
export const SettingsSchema = z.object({
  numberRule: z.enum(['daily', 'monthly', 'sequence']),
  autoRefresh: z.boolean(),
  quantityDigits: z.number().int().min(0).max(6).default(6),
  priceDigits: z.number().int().min(0).max(6).default(6),
  ordinaryTaxRate: decimal
    .refine((v) => Number(v) <= 100, '默认普票税率应在 0 到 100 之间')
    .default('0'),
  specialTaxRate: decimal
    .refine((v) => Number(v) <= 100, '默认专票税率应在 0 到 100 之间')
    .default('0'),
});
export const BulkSchema = z.object({
  products: z
    .array(z.object({ id: zId, revision: z.number().int().positive() }))
    .min(1)
    .max(1000),
  field: z.enum([
    'receiptPrice',
    'issuePrice',
    'planPrice',
    'allocationFactor',
    'disabled',
    'unit',
    'name',
    'specification',
    'inventoryAccountCode',
    'salesAccountCode',
  ]),
  value: z.string().max(100),
  confirmed: z.boolean().default(false),
  confirmZeroFactor: z.boolean().default(false),
});
export type BulkField = z.infer<typeof BulkSchema>['field'];
export type ProductInput = z.input<typeof ProductSchema>;
export type DocumentInput = z.input<typeof DocumentSchema>;
export type Filter = z.infer<typeof FilterSchema>;
export type OpeningInput = z.input<typeof OpeningSchema>;
export type ContractInput = z.input<typeof ContractSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
