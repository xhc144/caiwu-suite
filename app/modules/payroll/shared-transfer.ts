import { z } from 'zod';
import { zId, zPeriod } from '@caiwu/core';
const id = zId;
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const json = z.string().max(4 * 1024 * 1024);
export const PayrollModuleStateSchema = z.object({
  categories: z.array(z.object({ id, name: z.string(), revision, data: json })).max(100),
  employees: z
    .array(z.object({ id, code: z.string(), revision, data: json, department_id: id }))
    .max(5000),
  batches: z
    .array(
      z.object({
        id,
        period: zPeriod,
        category_id: id,
        revision,
        category_json: json,
        previous_json: json,
        calculated: z.union([z.literal(0), z.literal(1)]),
        closed: z.union([z.literal(0), z.literal(1)]),
      }),
    )
    .max(2400),
  rows: z
    .array(
      z.object({ batch_id: id, employee_id: id, input_json: json, snapshot_json: json.nullable() }),
    )
    .max(100000),
  quantities: z
    .array(
      z.object({
        batch_id: id,
        employee_id: id,
        field_key: z.string(),
        quantity_e6: z.number().int().safe(),
      }),
    )
    .max(200000),
  periods: z
    .array(
      z.object({
        period: zPeriod,
        category_id: id,
        batch_id: id,
        closed: z.union([z.literal(0), z.literal(1)]),
        next_batch_id: id.nullable(),
      }),
    )
    .max(2400),
  profiles: z
    .array(z.object({ employee_id: id, employment_json: json, values_json: json }))
    .max(5000),
  corrections: z
    .array(
      z.object({
        id,
        batch_id: id,
        reason: z.string(),
        created_at: z.string(),
        user_id: id,
        user_name: z.string(),
        before_json: json,
        after_json: json,
      }),
    )
    .max(10000),
  origins: z
    .array(
      z.object({
        batch_id: id,
        source_book_id: z.string(),
        source_book_name: z.string(),
        source_batch_id: id,
        imported_at: z.string(),
        data: json,
      }),
    )
    .max(2400),
  settings: z.array(z.object({ key: z.string(), value: json, updated_at: z.string() })).max(1000),
});
export type PayrollModuleState = z.output<typeof PayrollModuleStateSchema>;
export const PayrollTransferEnvelopeSchema = z.object({
  format: z.literal('caiwu-payroll-v1'),
  exportedAt: z.string().datetime(),
  source: z.object({
    id: z.string(),
    name: z.string(),
    startPeriod: zPeriod,
    baseCurrency: z.string(),
  }),
  state: PayrollModuleStateSchema,
  references: z.object({
    accounts: z.array(z.object({ id, code: z.string(), name: z.string() })).max(2000),
    dimensions: z
      .array(
        z.object({
          id,
          type: z.enum(['department', 'project', 'partner', 'person', 'cashflow']),
          code: z.string(),
          name: z.string(),
        }),
      )
      .max(10000),
  }),
  sourceVoucherCount: z.number().int().nonnegative(),
  sha256: z.string().length(64),
});
export type PayrollTransferEnvelope = z.output<typeof PayrollTransferEnvelopeSchema>;
export const PayrollTransferInputSchema = z.object({
  file: z.string().min(4).max(700000),
  mappings: z
    .array(
      z.object({
        kind: z.enum(['account', 'department', 'project', 'partner', 'person', 'cashflow']),
        sourceCode: z.string().min(1).max(60),
        targetCode: z.string().min(1).max(60),
      }),
    )
    .max(10000)
    .default([]),
});
export const PayrollTransferApplySchema = PayrollTransferInputSchema.extend({
  hash: z.string().length(64),
  expiresAt: z.string().datetime(),
  confirmed: z.boolean(),
  targetName: z.string(),
});
export const PayrollTransferRestorePreviewSchema = z.object({ id });
export const PayrollTransferRestoreSchema = z.object({
  id,
  expiresAt: z.string().datetime(),
  hash: z.string().length(64),
  confirmed: z.boolean(),
  targetName: z.string(),
});
export type PayrollTransferInput = z.output<typeof PayrollTransferInputSchema>;
