import { createHash } from 'node:crypto';
import type { CoreServices } from '@caiwu/core/server';
import { EmployeeSchema } from '../shared';
import {
  PERSONNEL_BULK_FIELDS,
  PersonnelBulkInputSchema,
  type PersonnelBulkInput,
  type PersonnelBulkPreview,
} from '../shared-personnel';
import { fail } from './engine';
import { payrollService } from './service';

const names: Record<string, string> = {
  resident: '居民工资薪金',
  nonresident: '非居民',
  labor: '劳务',
  bonus: '年终奖',
  employment: '按任职月数',
  annual60000: '年度六万元资格',
  firstIncome: '首次取得工资资格',
};

export async function previewPersonnelBulk(
  svc: CoreServices,
  raw: PersonnelBulkInput,
): Promise<PersonnelBulkPreview> {
  await svc.permissions.require('payroll.hr.edit');
  const input = PersonnelBulkInputSchema.parse(raw);
  const selectedIds = new Set(input.employeeIds);
  if (selectedIds.size !== input.employeeIds.length)
    fail('PERSONNEL_SCOPE', '置数范围含有重复人员', '重新勾选需要修改的人员');
  const label = PERSONNEL_BULK_FIELDS.find((f) => f.value === input.field)!.label;
  const parsedValue = EmployeeSchema.shape[input.field].safeParse(input.value);
  if (!parsedValue.success) {
    const hints: Record<PersonnelBulkInput['field'], string> = {
      name: '请输入一至六十字的姓名',
      departmentId: '请选择启用的末级部门',
      startDate: '请输入有效任职日期，格式为 YYYY-MM-DD',
      endDate: '请输入有效离职日期，格式为 YYYY-MM-DD，或清空日期',
      disabled: '请选择启用或停用状态',
      taxKind: '请选择列表中的所得类型',
      policy: '请选择列表中的居民预扣方式',
      qualificationYear: '资格年度须为 2019 至 2100 的整数，或清空年度',
      qualificationConfirmed: '请选择资格是否已确认',
    };
    fail('PERSONNEL_VALUE', `${label}的修改值无效`, hints[input.field]);
  }
  const value = parsedValue.data;
  const people = await payrollService(svc).employees();
  const selected = input.employeeIds.map((id) => {
    const person = people.find((e) => e.id === id);
    if (!person) fail('PERSONNEL_SCOPE', '置数范围含有不存在的人员', '刷新人员档案后重新选择范围');
    return person;
  });
  const departments = await svc.dimensions.items('department');
  if (input.field === 'departmentId') {
    const department = departments.find((d) => d.id === value);
    if (!department || department.disabled || !department.isLeaf)
      fail('DEPARTMENT', '请选择启用的末级部门', '核对部门档案后重新预览');
  }
  const text = (v: PersonnelBulkInput['value']) => {
    if (v === null) return '空白';
    if (input.field === 'departmentId') {
      const department = departments.find((d) => d.id === v);
      return department ? `${department.code} ${department.name}` : '部门不存在';
    }
    if (typeof v === 'boolean')
      return input.field === 'disabled' ? (v ? '停用' : '启用') : v ? '已确认' : '未确认';
    if (input.field === 'taxKind' || input.field === 'policy') return names[String(v)] ?? String(v);
    return String(v);
  };
  const preview = selected.map((employee) => {
    const before = employee[input.field];
    const after = input.onlyEmpty && before !== null && before !== '' ? before : value;
    const next = EmployeeSchema.parse({ ...employee, [input.field]: after });
    if (next.endDate && next.endDate < next.startDate)
      fail(
        'DATES',
        `人员 ${employee.code} 的离职日期早于任职日期`,
        '更改日期或缩小置数范围后重新预览',
      );
    return {
      employeeId: employee.id,
      revision: employee.revision,
      code: employee.code,
      name: employee.name,
      before,
      after,
      beforeText: text(before),
      afterText: text(after),
      changed: before !== after,
    };
  });
  const hash = createHash('sha256')
    .update(JSON.stringify({ input, selected, departments, preview }))
    .digest('hex');
  return {
    hash,
    field: input.field,
    label,
    preview,
  };
}

export async function applyPersonnelBulk(
  svc: CoreServices,
  raw: PersonnelBulkInput,
  expectedHash: string,
  confirmed: boolean,
) {
  await svc.permissions.require('payroll.hr.edit');
  if (!confirmed)
    fail('CONFIRM', '人事统一置数须确认预览', '核对所列人员和修改内容；取消不会修改档案');
  const input = PersonnelBulkInputSchema.parse(raw);
  return svc.tx(async (t) => {
    const plan = await previewPersonnelBulk(t, input);
    if (plan.hash !== expectedHash)
      fail('PLAN_STALE', '人事置数预览已失效', '人员或部门资料发生变化，请重新预览后确认');
    const service = payrollService(t);
    for (const change of plan.preview) {
      if (!change.changed) continue;
      const employee = await service.employee(change.employeeId);
      await service.saveEmployee({ ...employee, [input.field]: change.after });
    }
    await t.log.write({
      action: 'payroll.hr.bulk',
      summary: `人事统一置数：${plan.label}，范围 ${plan.preview.length} 人，实际修改 ${plan.preview.filter((r) => r.changed).length} 人`,
      targetType: 'payroll_employee',
    });
    return service.employees();
  });
}
