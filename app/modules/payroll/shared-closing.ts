import { z } from 'zod';
import { zId } from '@caiwu/core';

export const ClosingInputSchema = z.object({ id: zId, revision: z.number().int().nonnegative() });
export const ClosingApplySchema = ClosingInputSchema.extend({
  hash: z.string().length(64),
  expiresAt: z.number().int().positive(),
  confirmed: z.boolean(),
});
