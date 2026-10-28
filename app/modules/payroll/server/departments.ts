import type { z } from 'zod';
import type { CoreServices } from '@caiwu/core/server';
import {
  DepartmentDeleteSchema,
  DepartmentStatusSchema,
  DepartmentUpdateSchema,
} from '../shared-departments';
import { fail } from './engine';

async function requireDepartment(svc: CoreServices, id: number) {
  const item = await svc.dimensions.get(id);
  if (!item || item.typeId !== 'department')
    fail('DEPARTMENT', '部门不存在', '刷新部门列表后重试', '/m/payroll/employees');
  return item;
}
export async function updateDepartment(
  svc: CoreServices,
  raw: z.input<typeof DepartmentUpdateSchema>,
) {
  const input = DepartmentUpdateSchema.parse(raw);
  return svc.tx(async (t) => {
    await requireDepartment(t, input.id);
    return t.dimensions.update(
      input.id,
      { code: input.code, name: input.name },
      { expectedRevision: input.revision },
    );
  });
}
export async function setDepartmentDisabled(
  svc: CoreServices,
  raw: z.input<typeof DepartmentStatusSchema>,
) {
  const input = DepartmentStatusSchema.parse(raw);
  if (!input.confirmed)
    fail('CONFIRM', '部门状态变更须确认', '停用后保留历史，新工资不能使用该部门');
  return svc.tx(async (t) => {
    await requireDepartment(t, input.id);
    return t.dimensions.setDisabled(input.id, input.disabled, { expectedRevision: input.revision });
  });
}
export async function previewDepartmentDelete(svc: CoreServices, id: number) {
  await requireDepartment(svc, id);
  return svc.dimensions.previewDelete(id);
}
export async function deleteDepartment(
  svc: CoreServices,
  raw: z.input<typeof DepartmentDeleteSchema>,
) {
  const input = DepartmentDeleteSchema.parse(raw);
  return svc.tx(async (t) => {
    await requireDepartment(t, input.id);
    return t.dimensions.delete(input, input.confirmed);
  });
}
