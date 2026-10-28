import { z } from 'zod';
import { QueryConditionSchema, SalaryQuerySchema } from './shared';

export const QueryGroupSchema = z.object({
  mode: z.enum(['all', 'any']),
  conditions: z.array(QueryConditionSchema).min(1, '查询组不能为空').max(10),
});
export const QuerySortSchema = z.object({
  field: z.enum([
    'period',
    'code',
    'name',
    'department',
    'startDate',
    'gross',
    'deductions',
    'taxAmount',
    'net',
  ]),
  direction: z.enum(['asc', 'desc']),
});
export const GroupedSalaryQuerySchema = SalaryQuerySchema.extend({
  groupMode: z.enum(['all', 'any']).default('all'),
  groups: z.array(QueryGroupSchema).max(8).default([]),
  sorts: z.array(QuerySortSchema).max(5).default([]),
}).superRefine((query, ctx) => {
  if (new Set(query.sorts.map((sort) => sort.field)).size !== query.sorts.length)
    ctx.addIssue({ code: 'custom', message: '同一排序字段只能选择一次', path: ['sorts'] });
  if (
    query.conditions.length + query.groups.reduce((n, group) => n + group.conditions.length, 0) >
    50
  )
    ctx.addIssue({ code: 'custom', message: '查询条件最多五十项', path: ['groups'] });
});
export type GroupedSalaryQuery = z.output<typeof GroupedSalaryQuerySchema>;
