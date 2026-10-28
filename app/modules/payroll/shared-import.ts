import { z } from 'zod';
import { zId } from '@caiwu/core';

export const IMPORT_MAX_BYTES = 512 * 1024;
export const ImportFileSchema = z.object({
  id: zId,
  revision: z.number().int().nonnegative(),
  file: z
    .string()
    .min(4)
    .max(Math.ceil(IMPORT_MAX_BYTES / 3) * 4),
  sheet: z.string().min(1).max(31).optional(),
});
export const ImportColumnSchema = z.object({
  index: z.number().int().min(1).max(41),
  field: z.string().max(30).nullable(),
});
export const PayrollImportSchema = ImportFileSchema.extend({
  columns: z.array(ImportColumnSchema).min(2).max(41),
});
export const PayrollImportApplySchema = PayrollImportSchema.extend({
  hash: z.string().length(64),
  confirmed: z.boolean(),
});
export type PayrollImportInput = z.output<typeof PayrollImportSchema>;
export type ImportFileInput = z.output<typeof ImportFileSchema>;
export type ImportColumn = z.output<typeof ImportColumnSchema>;
export type ImportChange = {
  employeeId: number;
  employeeRevision: number;
  code: string;
  name: string;
  field: string;
  title: string;
  kind: 'money' | 'quantity';
  added: boolean;
  before: number | string | null;
  after: number | string;
};
