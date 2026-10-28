import { z } from 'zod';
import {
  CellSchema,
  CheckSchema,
  ReportTemplateSchema,
  StructureChangesSchema,
  type Report,
} from '../shared';

/** 草稿保留未完成的输入；保存到服务端时仍使用完整业务校验。 */
const DraftTemplateSchema = z
  .object({
    ...ReportTemplateSchema.shape,
    code: z.string().max(100_000),
    name: z.string().max(100_000),
    cells: z.array(CellSchema.extend({ source: z.string().max(100_000) })).max(5000),
    checks: z
      .array(
        CheckSchema.extend({
          name: z.string().max(100_000),
          condition: z.string().max(100_000).optional(),
          left: z.string().max(100_000),
          right: z.string().max(100_000),
          tolerance: z.string().max(100_000),
        }),
      )
      .max(100),
  })
  .strict();
const DraftSchema = z
  .object({
    revision: z.number().int().positive(),
    template: DraftTemplateSchema,
    structureChanges: StructureChangesSchema.default([]),
  })
  .strict();
export type DraftRecovery = { raw: string; message: string };
export function readEditorDraft(raw: string | null, initial: Report) {
  const fallback = {
    template: initial.template,
    structureChanges: [] as z.infer<typeof StructureChangesSchema>,
  };
  if (!raw) return { ...fallback, recovery: null as DraftRecovery | null };
  try {
    const parsed = DraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return {
        ...fallback,
        recovery: {
          raw,
          message: '本机草稿无法自动恢复，原始内容已保留。请先导出草稿，再选择保留副本并继续。',
        },
      };
    if (parsed.data.revision !== initial.revision)
      return {
        ...fallback,
        recovery: {
          raw,
          message: `发现版本${parsed.data.revision}的本机草稿，服务器已是版本${initial.revision}。请先导出草稿；保留副本后可继续编辑服务器版本。`,
        },
      };
    return {
      template: parsed.data.template,
      structureChanges: parsed.data.structureChanges,
      recovery: null as DraftRecovery | null,
    };
  } catch {
    return {
      ...fallback,
      recovery: {
        raw,
        message: '本机草稿读取失败，原始内容已保留。请先导出草稿，再选择保留副本并继续。',
      },
    };
  }
}
