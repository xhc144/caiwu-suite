import { z } from 'zod';
import { zPeriod, periodYear } from '@caiwu/core';

export const CashSummarySchema = z
  .object({
    from: zPeriod,
    to: zPeriod,
    includeUnclosed: z.boolean().default(true),
  })
  .refine(
    (input) => input.from <= input.to && periodYear(input.from) === periodYear(input.to),
    '请选择同一年度内起止顺序正确的汇总期间',
  );

export type CashSummaryInput = z.input<typeof CashSummarySchema>;
