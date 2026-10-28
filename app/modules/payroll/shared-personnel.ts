import { z } from 'zod';
import { zId } from '@caiwu/core';

export const PERSONNEL_BULK_FIELDS = [
  { value: 'name', label: '姓名' },
  { value: 'departmentId', label: '部门' },
  { value: 'startDate', label: '任职日期' },
  { value: 'endDate', label: '离职日期' },
  { value: 'disabled', label: '停用状态' },
  { value: 'taxKind', label: '所得类型' },
  { value: 'policy', label: '居民预扣方式' },
  { value: 'qualificationYear', label: '资格年度' },
  { value: 'qualificationConfirmed', label: '资格已确认' },
] as const;

export const PersonnelBulkInputSchema = z.object({
  employeeIds: z.array(zId).min(1, '请选择需要修改的人员').max(500),
  field: z.enum([
    'name',
    'departmentId',
    'startDate',
    'endDate',
    'disabled',
    'taxKind',
    'policy',
    'qualificationYear',
    'qualificationConfirmed',
  ]),
  value: z.union([z.string().max(100), z.number().int(), z.boolean(), z.null()]),
  onlyEmpty: z.boolean().default(false),
});
export type PersonnelBulkInput = z.output<typeof PersonnelBulkInputSchema>;

export const PersonnelBulkApplySchema = PersonnelBulkInputSchema.extend({
  hash: z.string().length(64),
  confirmed: z.boolean(),
});

export type PersonnelBulkPreview = {
  hash: string;
  field: PersonnelBulkInput['field'];
  label: string;
  preview: {
    employeeId: number;
    revision: number;
    code: string;
    name: string;
    before: PersonnelBulkInput['value'];
    after: PersonnelBulkInput['value'];
    beforeText: string;
    afterText: string;
    changed: boolean;
  }[];
};
