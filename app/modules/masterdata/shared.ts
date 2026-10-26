import { z } from 'zod';
import { DIMENSION_TYPE_IDS, zId } from '@caiwu/core';

const text = z.string().trim().min(1, '不能为空').max(100);
export const DimensionTypeSchema = z.enum(DIMENSION_TYPE_IDS);
export const ConfirmationSchema = z.array(z.string()).default([]);
export type Confirmation = { key: string; message: string };
export const AccountInputSchema = z.object({
  id: zId.optional(),
  code: text.max(48),
  name: text,
  categoryId: text.optional(),
  direction: z.enum(['debit', 'credit']),
  disabled: z.boolean().default(false),
  isCash: z.boolean().default(false),
  isBank: z.boolean().default(false),
  cashflowRequired: z.boolean().default(false),
  isPartner: z.boolean().default(false),
  currency: z.string().max(12).nullable().default(null),
  quantityUnit: z.string().trim().max(20).nullable().default(null),
  mnemonic: z.string().trim().max(40).nullable().default(null),
  dimensions: z
    .array(
      z.object({
        type: z.enum(['project', 'partner', 'department', 'person']),
        required: z.boolean().default(true),
        defaultItemId: zId.nullable().default(null),
      }),
    )
    .max(4)
    .default([]),
  confirmations: ConfirmationSchema,
});
export type AccountInput = z.input<typeof AccountInputSchema>;
export type AccountData = z.output<typeof AccountInputSchema>;

export const CashflowDirectionSchema = z.enum(['inflow', 'outflow', 'internal']);
export const DimensionAttrsSchema = z
  .object({
    shortName: z.string().max(100).optional(),
    role: z.enum(['customer', 'supplier', 'both']).optional(),
    address: z.string().max(300).optional(),
    postalCode: z.string().max(20).optional(),
    contact: z.string().max(100).optional(),
    phone: z.string().max(80).optional(),
    bank: z.string().max(100).optional(),
    bankAccount: z.string().max(100).optional(),
    taxNumber: z.string().max(100).optional(),
    category: z.string().max(100).optional(),
    cashflowDirection: CashflowDirectionSchema.optional(),
  })
  .catchall(z.unknown());
export const DimensionInputSchema = z.object({
  id: zId.optional(),
  type: DimensionTypeSchema,
  code: text.max(10).regex(/^[a-zA-Z0-9_-]+$/, '编码只能含字母、数字、下划线或连字符'),
  name: text,
  parentId: zId.nullable().default(null),
  disabled: z.boolean().default(false),
  attrs: DimensionAttrsSchema.default({}),
});
export type DimensionInput = z.input<typeof DimensionInputSchema>;
export const SchemeSchema = z
  .array(z.number().int().min(1).max(10))
  .min(1)
  .max(5)
  .refine((s) => s.reduce((a, b) => a + b, 0) <= 10, '最多5级，总长度不能超过10位');
export const BatchSchema = z.object({
  parentId: zId,
  start: z.number().int().min(0),
  names: z.array(text).min(1).max(500),
  confirmations: ConfirmationSchema,
});
export const ReferenceKindSchema = z.enum([
  'voucherTypes',
  'settlementMethods',
  'currencies',
  'summaries',
]);
export type ReferenceKind = z.infer<typeof ReferenceKindSchema>;
export const ReferenceInputSchema = z.object({
  kind: ReferenceKindSchema,
  id: zId.optional(),
  code: text.max(20),
  name: text.max(200),
  disabled: z.boolean().default(false),
  sort: z.number().int().min(0).max(100000).default(0),
  symbol: z.string().max(12).nullable().default(null),
  fullName: z.string().trim().max(200).default(''),
  shortName: z.string().trim().max(4).default(''),
  category: z.string().trim().max(100).default(''),
  shortcut: z.string().trim().max(30).default(''),
});
export type ReferenceInput = z.input<typeof ReferenceInputSchema>;
export type ReferenceRow = {
  id: number;
  code: string;
  name: string;
  disabled: boolean;
  sort: number;
  symbol: string | null;
  fullName: string;
  shortName: string;
  category: string;
  shortcut: string;
  useCount: number;
  pinyin: string;
  isBase: boolean;
};
export const ExcelInputSchema = z.object({
  kind: z.enum(['accounts', 'dimensions', 'reference']),
  type: DimensionTypeSchema.optional(),
  referenceKind: ReferenceKindSchema.optional(),
  fileName: z.string().max(200),
  content: z.string().max(900_000, '文件超过单次导入容量，请分批导入'),
  previewToken: z.string().max(128).optional(),
  confirmations: ConfirmationSchema,
});
export type ExcelInput = z.input<typeof ExcelInputSchema>;
export type ImportRow = { row: number; code: string; name: string; action: string; error: string };
export type ImportPreview = {
  rows: ImportRow[];
  confirmations: Confirmation[];
  valid: boolean;
  previewToken?: string;
};
export const SearchSchema = z
  .object({ keyword: z.string().default(''), locate: z.boolean().default(false) })
  .default({ keyword: '', locate: false });
