import { z } from 'zod';
import { zId } from '@caiwu/core';
import { ReportInputSchema } from './shared';

export const PayrollReportInputSchema = ReportInputSchema.extend({
  additionalCategoryIds: z
    .array(zId)
    .max(20, '最多合并二十个其它工资类别')
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, '合并工资类别不能重复'),
}).refine(
  (input) => !input.additionalCategoryIds.includes(input.categoryId),
  '主工资类别不能重复加入合并范围',
);
export type PayrollReportInput = z.input<typeof PayrollReportInputSchema>;
