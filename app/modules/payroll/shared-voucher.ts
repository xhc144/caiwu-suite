import { z } from 'zod';
import { zId } from '@caiwu/core';
import { MappingSchema } from './shared';

export const VoucherAuxiliarySchema = z.object({
  accountId: zId,
  employeeId: zId.optional(),
  values: z.object({
    project: zId.nullable().optional(),
    partner: zId.nullable().optional(),
    department: zId.nullable().optional(),
    person: zId.nullable().optional(),
    cashflow: zId.nullable().optional(),
  }),
});
export const VoucherMappingSchema = MappingSchema.extend({
  auxiliaries: z.array(VoucherAuxiliarySchema).max(1000).default([]),
});
export type VoucherMapping = z.output<typeof VoucherMappingSchema>;
export const VoucherDeletionPlanSchema = z.object({
  ids: z.array(zId).length(1),
  expiresAt: z.number().int(),
  fingerprint: z.string().min(1),
});
