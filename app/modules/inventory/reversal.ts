import { z } from 'zod';
import { zDate, zId } from '@caiwu/core';
import { decimal } from './shared';

export const ReversalSchema = z
  .object({
    id: zId,
    revision: z.number().int().positive(),
    requestKey: z.string().min(8).max(80),
    number: z.string().trim().min(1, '反冲单号不能为空').max(200),
    date: zDate,
    accountId: zId,
    unitPrices: z.array(decimal).max(1000).optional(),
    confirmed: z.boolean().default(false),
    negativeConfirmation: z.string().optional(),
  })
  .strict();
export type ReversalInput = z.input<typeof ReversalSchema>;
