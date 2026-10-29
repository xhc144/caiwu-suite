import { z } from 'zod';

export const ContractImportPreviewSchema = z.object({
  fileBase64: z.string().min(1).max(6_000_000, '文件不能超过4MB'),
  overwrite: z.boolean().default(false),
});
export const ContractImportCommitSchema = ContractImportPreviewSchema.extend({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.boolean(),
});
export type ContractImportPreviewInput = z.input<typeof ContractImportPreviewSchema>;
export type ContractImportCommitInput = z.input<typeof ContractImportCommitSchema>;
export const CONTRACT_ARCHIVE_HEADERS = [
  '合同号',
  '合同名称',
  '客供编码',
  '收付款科目编码',
  '签订日期',
  '收付款类型',
  '合同金额（元）',
  '期初收付款（元）',
  '合同说明',
  '备注1',
  '备注2',
] as const;
