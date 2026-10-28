import { z } from 'zod';
import { zDate, zId, periodOfDate } from '@caiwu/core';
import type { Employee } from './shared';

export const EmploymentSpellSchema = z.object({
  startDate: zDate,
  endDate: zDate.nullable().default(null),
});
export type EmploymentSpell = z.output<typeof EmploymentSpellSchema>;
export const HrFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, '变量须为小写字母开头的字母、数字或下划线'),
  name: z.string().trim().min(1, '栏目名称不能为空').max(40),
  kind: z.enum(['text', 'date']).default('text'),
  required: z.boolean().default(false),
  disabled: z.boolean().default(false),
});
export type HrField = z.output<typeof HrFieldSchema>;
export const HrFieldsSchema = z.object({
  revision: z.number().int().nonnegative(),
  fields: z.array(HrFieldSchema).max(20),
});
export type HrFields = z.output<typeof HrFieldsSchema>;
export const HrProfileSchema = z.object({
  employeeId: zId,
  employeeRevision: z.number().int().nonnegative(),
  fieldsRevision: z.number().int().nonnegative(),
  employmentSpells: z.array(EmploymentSpellSchema).min(1, '至少保留一段任职记录').max(30),
  basicValues: z.record(z.string(), z.string().max(200, '基本资料每项最多200字')).default({}),
});
export type HrProfile = z.output<typeof HrProfileSchema>;
export const EmployeeDeleteSchema = z.object({
  id: zId,
  revision: z.number().int().nonnegative(),
  hash: z.string().min(1),
  confirmed: z.boolean(),
});
export const HrBasicBulkSchema = z.object({
  employeeIds: z.array(zId).min(1, '请选择需要修改的人员').max(500),
  field: z.string().min(1, '请选择基本资料栏目').max(30),
  value: z.string().max(200, '基本资料每项最多200字'),
  onlyEmpty: z.boolean().default(false),
});
export const HrBasicBulkApplySchema = HrBasicBulkSchema.extend({
  hash: z.string().length(64),
  confirmed: z.boolean(),
});
export type HrBasicBulk = z.output<typeof HrBasicBulkSchema>;
export type EmployeeWithSpells = Employee & { employmentSpells?: EmploymentSpell[] };

export function employmentSpells(
  employee: Pick<EmployeeWithSpells, 'startDate' | 'endDate' | 'employmentSpells'>,
): EmploymentSpell[] {
  return employee.employmentSpells?.length
    ? employee.employmentSpells
    : [{ startDate: employee.startDate, endDate: employee.endDate }];
}

/** 同年截至本月，任一任职段覆盖的月份只计一次。 */
export function employmentMonths(
  employee: Pick<EmployeeWithSpells, 'startDate' | 'endDate' | 'employmentSpells'>,
  period: number,
): number {
  const year = Math.trunc(period / 100),
    months = new Set<number>();
  for (const spell of employmentSpells(employee)) {
    const first = Math.max(year * 100 + 1, periodOfDate(spell.startDate));
    const last = Math.min(period, spell.endDate ? periodOfDate(spell.endDate) : period);
    for (let month = first; month <= last; month++) months.add(month);
  }
  return months.size;
}

export function employedInPeriod(
  employee: Pick<EmployeeWithSpells, 'startDate' | 'endDate' | 'employmentSpells'>,
  period: number,
) {
  return employmentSpells(employee).some(
    (spell) =>
      periodOfDate(spell.startDate) <= period &&
      (!spell.endDate || periodOfDate(spell.endDate) >= period),
  );
}
