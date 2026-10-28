import { z } from 'zod';
import { AnalysisCodeSchema } from './custom';

export const CopySourceSchema = z.object({
  bookId: z.uuid('请选择来源账套'),
  userCode: z.string().trim().min(1, '请输入来源账套操作员编号').max(20),
  password: z.string().max(64),
});
export const CopyDefinitionSchema = z.object({
  source: CopySourceSchema,
  definitionId: z.number().int().positive('请选择来源分析表'),
  sourceRevision: z.number().int().positive(),
  code: AnalysisCodeSchema,
  name: z.string().trim().min(1, '请输入新分析表名称').max(80),
});
