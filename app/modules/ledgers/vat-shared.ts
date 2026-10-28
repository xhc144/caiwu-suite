import { z } from 'zod';

/** 原版 w_xt_tz_zc_zzsmxz：借贷各五栏，栏目名称与科目对应关系由会计设置。 */
export const VatColumnSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,40}$/, '栏目编号格式无效')
    .refine(
      (id) => !['unclassified_debit', 'unclassified_credit'].includes(id),
      '栏目编号与系统保留的未分类栏目冲突',
    ),
  label: z.string().trim().min(1, '请填写栏目名称').max(60),
  side: z.enum(['debit', 'credit']),
  accountCodes: z.array(z.string().trim().min(1).max(40)).min(1, '请至少选择一个对应科目').max(500),
});
export const VatColumnsSchema = z
  .array(VatColumnSchema)
  .max(10)
  .superRefine((columns, ctx) => {
    if (new Set(columns.map((c) => c.id)).size !== columns.length)
      ctx.addIssue({ code: 'custom', message: '栏目编号不能重复' });
    for (const side of ['debit', 'credit'] as const) {
      const selected = columns.filter((c) => c.side === side);
      if (selected.length > 5)
        ctx.addIssue({
          code: 'custom',
          message: `${side === 'debit' ? '借方' : '贷方'}最多设置五个分类栏目`,
        });
      if (new Set(selected.map((c) => c.label)).size !== selected.length)
        ctx.addIssue({ code: 'custom', message: '同一借贷方向的栏目名称不能重复' });
    }
  });
export const VatMappingSchema = z.object({
  columns: VatColumnsSchema,
  revision: z.number().int().nonnegative(),
});
export const VatMappingChangeSchema = z.object({
  columns: VatColumnsSchema,
  expectedRevision: z.number().int().nonnegative(),
  confirmed: z.boolean(),
});
export type VatColumn = z.infer<typeof VatColumnSchema>;
export type VatMapping = z.infer<typeof VatMappingSchema>;
