import { z } from 'zod';

export const IMPORT_KINDS = ['accounts', 'dimensions', 'opening', 'vouchers'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const KIND_LABELS: Record<ImportKind, string> = {
  accounts: '科目',
  dimensions: '辅助档案',
  opening: '期初',
  vouchers: '凭证',
};
export const ImportFileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(1).max(16_000_000),
  encoding: z.enum(['utf-8', 'gb18030', 'utf-16le', 'utf-16be']).default('utf-8'),
  kind: z.enum(IMPORT_KINDS).optional(),
  columnMap: z.record(z.string().max(100), z.string().max(100)).default({}),
  valueMap: z
    .record(z.string().max(100), z.record(z.string().max(100), z.string().max(100)))
    .default({}),
});
export const ImportOptionsSchema = z.object({
  numbering: z.enum(['automatic', 'preserve']).default('automatic'),
  openingMode: z.enum(['reject-existing', 'replace-matching']).default('reject-existing'),
});
export const PrepareSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    files: z.array(ImportFileSchema).min(1).max(20),
    options: ImportOptionsSchema.default({
      numbering: 'automatic',
      openingMode: 'reject-existing',
    }),
  })
  .refine(
    (v) => v.files.reduce((n, f) => n + f.contentBase64.length, 0) <= 24_000_000,
    '本批文件合计过大，请分批导入',
  );
export type PrepareInput = z.input<typeof PrepareSchema>;
export type ImportOptions = z.output<typeof ImportOptionsSchema>;
export type ImportIssue = {
  file: string;
  sheet: string;
  row: number;
  column: string;
  message: string;
  severity: 'error' | 'warning';
};
export type ImportLocation = { file: string; sheet: string; row: number };
export type ImportSummary = {
  accounts: number;
  dimensions: number;
  opening: number;
  vouchers: number;
  lines: number;
  reusedAccounts: number;
  reusedDimensions: number;
};
export type ImportReceipt = {
  batchId: string;
  completedAt: string;
  summary: ImportSummary;
  vouchers: { original: string; id: number; displayNo: string; location: ImportLocation }[];
};
export type ImportBatch = {
  id: string;
  name: string;
  revision: number;
  status: 'prepared' | 'checked' | 'failed' | 'completed';
  createdAt: string;
  updatedAt: string;
  issues: ImportIssue[];
  summary: ImportSummary;
  options: ImportOptions;
  files: {
    name: string;
    sheets: {
      name: string;
      kind: ImportKind;
      headers: string[];
      rowCount: number;
      headerRow?: number;
    }[];
  }[];
  receipt: ImportReceipt | null;
};
export const BatchIdSchema = z.object({ id: z.string().uuid() });
export const CommitSchema = BatchIdSchema.extend({
  revision: z.number().int().positive(),
  confirmed: z.literal(true),
});
