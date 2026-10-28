import { z } from 'zod';
import { zPeriod } from '@caiwu/core';
import { TrendFilterSchema } from './shared';

const revision = z.number().int().nonnegative();
const id = z.number().int().positive();
const cents = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const AnalysisCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, '分析编号须为1至3位数字')
  .transform((s) => s.padStart(3, '0'));
export const DefinitionRowSchema = z.object({
  key: z.number().int().min(1).max(9999),
  name: z.string().trim().min(1, '请输入项目名称').max(80),
  formula: z.string().trim().min(1, '请输入项目公式').max(1000),
  subtotal: z.boolean().default(false),
  unit: z.enum(['money', 'percent', 'number']).default('money'),
});
export const DefinitionInputSchema = z.object({
  id: id.optional(),
  expectedRevision: revision,
  code: AnalysisCodeSchema,
  name: z.string().trim().min(1, '请输入分析名称').max(80),
  rows: z
    .array(DefinitionRowSchema)
    .min(1, '至少保留一个分析项目')
    .max(100)
    .refine((rows) => new Set(rows.map((r) => r.key)).size === rows.length, '项目编号不能重复'),
});
export type DefinitionInput = z.input<typeof DefinitionInputSchema>;
export type Definition = z.output<typeof DefinitionInputSchema> & { id: number; revision: number };
export const CustomFilterSchema = z
  .object({
    definitionId: id,
    periodFrom: zPeriod,
    periodTo: zPeriod,
    includeUnposted: z.boolean().default(false),
    scope: z.enum(['operating', 'ledger']).default('operating'),
  })
  .refine((f) => f.periodFrom <= f.periodTo, '开始期间不能晚于结束期间')
  .refine(
    (f) =>
      (Math.trunc(f.periodTo / 100) - Math.trunc(f.periodFrom / 100)) * 12 +
        (f.periodTo % 100) -
        (f.periodFrom % 100) <
      36,
    '一次最多分析36个月',
  );
export type CustomFilter = z.input<typeof CustomFilterSchema>;
export const SheetSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trend'), filter: TrendFilterSchema }),
  z.object({ kind: z.literal('custom'), filter: CustomFilterSchema }),
]);
export const AnalysisSheetSchema = z.object({
  source: SheetSourceSchema,
  sourceHash: z.string().length(64),
  generatedAt: z.string().max(60),
  title: z.string().max(100),
  note: z.string().max(1500),
  definitionRevision: revision.optional(),
  periods: z.array(zPeriod).min(1).max(36),
  rows: z
    .array(
      z.object({
        key: z.string().max(50),
        name: z.string().max(1000, '科目或项目名称过长'),
        formula: z.string().max(1000),
        subtotal: z.boolean(),
        unit: z.enum(['money', 'percent', 'number']),
        values: z.array(cents.nullable()).min(1).max(36),
        originalValues: z.array(cents.nullable()).min(1).max(36),
        total: cents,
        average: cents,
        averageNumerator: cents,
        averageDivisor: z.number().int().min(1).max(36),
        ratio: z.string().max(100).nullable(),
      }),
    )
    .min(1)
    .max(2000, '一次最多保存2000个科目项目，请缩小科目范围'),
});
export type AnalysisSheet = z.output<typeof AnalysisSheetSchema>;
export const SaveResultSchema = z.object({
  saveAs: z.boolean().default(false),
  id: id.optional(),
  expectedRevision: revision,
  name: z.string().trim().min(1, '请输入结果名称').max(100),
  sheet: AnalysisSheetSchema,
});
export type SaveResult = z.input<typeof SaveResultSchema>;
export const VersionSchema = z.object({ id, expectedRevision: revision });
export const ConfirmRemoveSchema = VersionSchema.extend({ confirmed: z.boolean() });
export const UNIT_NAMES = { money: '元', percent: '%', number: '数值' };

export const ACCOUNT_FUNCTIONS = [
  '借方',
  '贷方',
  '余额',
  '期初',
  '年初',
  '累计借方',
  '累计贷方',
] as const;
