import { z } from 'zod';
import { zId } from '@caiwu/core';
import { PayrollReportInputSchema } from './shared-report';

export const PrintModeSchema = z.enum(['table', 'slips', 'summary']);
export type PayrollPrintMode = z.output<typeof PrintModeSchema>;
export const PrintColumnSchema = z.object({
  key: z.string().min(1).max(30),
  widthMm: z.number().min(12).max(80),
  integerDigits: z.number().int().min(1).max(14),
  decimals: z.number().int().min(0).max(6),
});
export const PayrollPrintLayoutSchema = z.object({
  mode: PrintModeSchema,
  revision: z.number().int().nonnegative().default(0),
  title: z.string().trim().min(1, '打印标题不能为空').max(80),
  unitName: z.string().trim().max(100).default(''),
  footer: z.string().max(200).default('制表：____________　复核：____________'),
  landscape: z.boolean().default(true),
  fontSize: z.number().int().min(8).max(14).default(10),
  rowsPerPage: z.number().int().min(1).max(40).default(18),
  slipsPerPage: z.number().int().min(1).max(6).default(3),
  margins: z.object({
    top: z.number().min(0).max(50),
    right: z.number().min(0).max(50),
    bottom: z.number().min(0).max(50),
    left: z.number().min(0).max(50),
  }),
  columns: z
    .array(PrintColumnSchema)
    .min(1, '至少选择一个打印栏目')
    .max(44)
    .refine(
      (columns) => new Set(columns.map((c) => c.key)).size === columns.length,
      '打印栏目不能重复',
    ),
});
export type PayrollPrintLayout = z.output<typeof PayrollPrintLayoutSchema>;
export const PrintLayoutSaveSchema = z.object({
  categoryId: zId,
  categoryRevision: z.number().int().nonnegative(),
  layout: PayrollPrintLayoutSchema,
});
export const PayrollPrintRequestSchema = z.object({
  report: PayrollReportInputSchema,
  mode: PrintModeSchema,
});
