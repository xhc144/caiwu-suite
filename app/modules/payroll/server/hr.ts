import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { type Employee } from '../shared';
import {
  HrFieldsSchema,
  HrProfileSchema,
  HrBasicBulkSchema,
  employmentMonths,
  employedInPeriod,
  type HrFields,
  type HrProfile,
  type EmploymentSpell,
  type EmployeeWithSpells,
  type HrBasicBulk,
} from '../shared-hr';
import type { PayrollTables } from './migrations';
import { fail } from './engine';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type HrTables = PayrollTables & {
  payroll_hr_profile: { employee_id: number; employment_json: string; values_json: string };
};

async function rawEmployee(svc: CoreServices, id: number) {
  const row = await svc.db
    .withTables<PayrollTables>()
    .selectFrom('payroll_employee')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) fail('NOT_FOUND', '人员不存在', '刷新人员列表');
  return { ...(JSON.parse(row.data) as Employee), id: row.id, revision: row.revision };
}

export async function hrFields(svc: CoreServices): Promise<HrFields> {
  return HrFieldsSchema.parse(await svc.settings.get('hr.fields', { revision: 0, fields: [] }));
}

export async function loadHrData(svc: CoreServices, employee: Employee) {
  const row = await svc.db
    .withTables<HrTables>()
    .selectFrom('payroll_hr_profile')
    .selectAll()
    .where('employee_id', '=', employee.id)
    .executeTakeFirst();
  return {
    employmentSpells: row
      ? (JSON.parse(row.employment_json) as EmploymentSpell[])
      : [{ startDate: employee.startDate, endDate: employee.endDate }],
    basicValues: row ? (JSON.parse(row.values_json) as Record<string, string>) : {},
  };
}

export async function hrProfile(svc: CoreServices, id: number): Promise<HrProfile> {
  const employee = await rawEmployee(svc, id),
    fields = await hrFields(svc);
  return {
    employeeId: id,
    employeeRevision: employee.revision,
    fieldsRevision: fields.revision,
    ...(await loadHrData(svc, employee)),
  };
}

export async function saveHrFields(svc: CoreServices, raw: z.input<typeof HrFieldsSchema>) {
  const input = HrFieldsSchema.parse(raw);
  if (new Set(input.fields.map((f) => f.key)).size !== input.fields.length)
    fail('HR_FIELD_DUPLICATE', '基本资料栏目变量不能重复', '为每一项选择不同变量');
  if (input.fields.some((f) => ['__proto__', 'prototype', 'constructor'].includes(f.key)))
    fail('HR_FIELD_KEY', '基本资料变量不可使用保留字', '修改栏目变量');
  return svc.tx(async (t) => {
    const old = await hrFields(t);
    if (old.revision !== input.revision) fail('STALE', '基本资料栏目已经变化', '刷新后重新修改');
    const profiles = await t.db
      .withTables<HrTables>()
      .selectFrom('payroll_hr_profile')
      .select('values_json')
      .execute();
    for (const field of old.fields) {
      const next = input.fields.find((f) => f.key === field.key);
      if (
        (!next || next.kind !== field.kind) &&
        profiles.some((p) => (JSON.parse(p.values_json) as Record<string, string>)[field.key])
      )
        fail(
          'HR_FIELD_USED',
          `基本资料“${field.name}”已有内容，不能删除或改变类型`,
          '使用停用保留资料',
        );
    }
    const saved = { ...input, revision: old.revision + 1 };
    await t.settings.set('hr.fields', saved);
    await t.log.write({ action: 'payroll.hr.fields', summary: '修改人事基本资料栏目' });
    return saved;
  });
}

function validateSpells(spells: EmploymentSpell[]) {
  const sorted = [...spells].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const [i, spell] of sorted.entries()) {
    if (spell.endDate && spell.endDate < spell.startDate)
      fail('DATES', '离职日期不能早于该段任职日期', '核对每段任职记录');
    const previous = sorted[i - 1];
    if (previous && (!previous.endDate || previous.endDate >= spell.startDate))
      fail(
        'EMPLOYMENT_OVERLAP',
        '任职记录重叠或前段尚未离职',
        '先填写前段离职日期；再次任职须在离职日期之后',
      );
  }
  return sorted;
}

function validateBasicValues(schema: HrFields, values: Record<string, string>) {
  const allowed = new Set(schema.fields.map((f) => f.key));
  if (Object.keys(values).some((key) => !allowed.has(key)))
    fail('HR_FIELD_UNKNOWN', '基本资料包含未知栏目', '刷新基本资料栏目');
  for (const field of schema.fields) {
    const value = values[field.key] ?? '';
    if (!field.disabled && field.required && !value.trim())
      fail('HR_REQUIRED', `请填写基本资料“${field.name}”`, '补齐必填项目');
    if (field.kind === 'date' && value && !z.string().date().safeParse(value).success)
      fail('HR_DATE', `基本资料“${field.name}”日期无效`, '使用有效的年月日');
  }
}

export async function saveHrProfile(svc: CoreServices, raw: z.input<typeof HrProfileSchema>) {
  const input = HrProfileSchema.parse(raw),
    spells = validateSpells(input.employmentSpells);
  return svc
    .tx(async (t) => {
      const employee = await rawEmployee(t, input.employeeId),
        fields = await hrFields(t);
      if (employee.revision !== input.employeeRevision || fields.revision !== input.fieldsRevision)
        fail('STALE', '人员或基本资料栏目已经变化', '刷新后重新核对并保存');
      validateBasicValues(fields, input.basicValues);
      const td = t.db.withTables<HrTables>(),
        old = { ...employee, ...(await loadHrData(t, employee)) };
      const history = await td
        .selectFrom('payroll_row as r')
        .innerJoin('payroll_batch as b', 'b.id', 'r.batch_id')
        .select('b.period')
        .where('r.employee_id', '=', employee.id)
        .where('b.calculated', '=', 1)
        .execute();
      const next = { ...employee, employmentSpells: spells };
      for (const h of history) {
        if (
          employmentMonths(old, h.period) !== employmentMonths(next, h.period) ||
          employedInPeriod(old, h.period) !== employedInPeriod(next, h.period)
        )
          fail(
            'EMPLOYMENT_HISTORY',
            '任职记录变更会改变已计算历史的任职月数',
            '保留已有历史；可登记后续离职和再次任职',
          );
      }
      await td
        .insertInto('payroll_hr_profile')
        .values({
          employee_id: employee.id,
          employment_json: JSON.stringify(spells),
          values_json: JSON.stringify(input.basicValues),
        })
        .onConflict((oc) =>
          oc.column('employee_id').doUpdateSet({
            employment_json: JSON.stringify(spells),
            values_json: JSON.stringify(input.basicValues),
          }),
        )
        .execute();
      await td
        .updateTable('payroll_employee')
        .set({
          revision: employee.revision + 1,
          data: JSON.stringify({
            ...employee,
            startDate: spells[0]!.startDate,
            endDate: spells[spells.length - 1]!.endDate,
          }),
        })
        .where('id', '=', employee.id)
        .execute();
      await t.log.write({
        action: 'payroll.hr.profile',
        summary: `修改 ${employee.code} ${employee.name} 的基本资料及任职记录`,
        targetType: 'payroll_employee',
        targetId: employee.id,
      });
      return hrProfile(t, employee.id);
    })
    .catch((error: unknown) => {
      if (error instanceof BusinessError) throw error;
      fail(
        'HR_SAVE_FAILED',
        '基本资料保存失败，本次修改没有写入',
        '输入已保留；核对后重试，仍失败时请联系管理员检查账套',
      );
    });
}

function containsEmployee(value: unknown, id: number): boolean {
  if (Array.isArray(value)) return value.some((item) => containsEmployee(item, id));
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record['employeeId'] === id || Object.values(record).some((item) => containsEmployee(item, id))
  );
}

export async function previewEmployeeDelete(svc: CoreServices, id: number, revision: number) {
  const employee = await rawEmployee(svc, id);
  if (employee.revision !== revision) fail('STALE', '人员资料已变化', '刷新人员列表');
  const references = await svc.db
    .withTables<PayrollTables>()
    .selectFrom('payroll_row as r')
    .innerJoin('payroll_batch as b', 'b.id', 'r.batch_id')
    .select(['b.id', 'b.period', 'b.calculated', 'b.closed'])
    .where('r.employee_id', '=', id)
    .orderBy('b.period')
    .execute();
  const db = svc.db.withTables<PayrollTables>();
  const previous = await db
    .selectFrom('payroll_batch')
    .select(['id', 'period', 'previous_json'])
    .where('previous_json', '!=', '[]')
    .execute();
  const corrections = await db
    .selectFrom('payroll_correction as c')
    .innerJoin('payroll_batch as b', 'b.id', 'c.batch_id')
    .select(['c.id', 'b.period', 'c.before_json', 'c.after_json'])
    .execute();
  const mappings = await db
    .selectFrom('book_setting')
    .select(['key', 'value'])
    .where('scope', '=', 'payroll')
    .where('key', 'like', 'mapping.%')
    .execute();
  const archiveReferences = [
    ...previous
      .filter((b) => containsEmployee(JSON.parse(b.previous_json) as unknown, id))
      .map((b) => `${b.period}工资批次${b.id}的重算前快照`),
    ...corrections
      .filter(
        (c) =>
          containsEmployee(JSON.parse(c.before_json) as unknown, id) ||
          containsEmployee(JSON.parse(c.after_json) as unknown, id),
      )
      .map((c) => `${c.period}工资更正记录${c.id}`),
    ...mappings
      .filter((m) => containsEmployee(JSON.parse(m.value) as unknown, id))
      .map((m) => `工资类别${m.key.slice('mapping.'.length)}的人员凭证映射`),
  ];
  const profile = await hrProfile(svc, id);
  return {
    employee,
    references,
    archiveReferences,
    allowed: references.length === 0 && archiveReferences.length === 0,
    hash: hash({ employee, references, archiveReferences, profile }),
  };
}

export async function deleteEmployee(
  svc: CoreServices,
  input: { id: number; revision: number; hash: string; confirmed: boolean },
) {
  if (!input.confirmed)
    fail('CONFIRM_REQUIRED', '删除人员须明确确认', '先预览引用并确认要删除的人员');
  return svc
    .tx(async (t) => {
      const plan = await previewEmployeeDelete(t, input.id, input.revision);
      if (plan.hash !== input.hash) fail('STALE', '删除预览已失效', '重新预览人员与引用');
      if (!plan.allowed)
        fail(
          'EMPLOYEE_REFERENCED',
          '人员已被工资批次、历史快照或凭证设置引用，不能删除',
          '使用停用保留工资历史及人员映射',
        );
      const td = t.db.withTables<HrTables>();
      await td.deleteFrom('payroll_hr_profile').where('employee_id', '=', input.id).execute();
      await td.deleteFrom('payroll_employee').where('id', '=', input.id).execute();
      await t.log.write({
        action: 'payroll.hr.delete',
        summary: `删除人员 ${plan.employee.code} ${plan.employee.name}`,
        targetType: 'payroll_employee',
        targetId: input.id,
      });
      return { deleted: true };
    })
    .catch((error: unknown) => {
      if (error instanceof BusinessError) throw error;
      fail(
        'EMPLOYEE_DELETE_FAILED',
        '存入失败，人员和基本资料没有删除',
        '刷新人员与引用后重试；若仍失败，请联系管理员检查账套',
      );
    });
}

export async function exportPersonnel(svc: CoreServices, ids: number[]) {
  if (!ids.length || new Set(ids).size !== ids.length)
    fail('HR_SELECTION', '请选择不重复的人员', '选中人员后另存或打印');
  const fields = await hrFields(svc);
  const rows = await Promise.all(
    ids.map(async (id) => {
      const employee = await rawEmployee(svc, id),
        department = await svc.dimensions.get(employee.departmentId);
      return {
        ...employee,
        departmentName: department?.name ?? '',
        ...(await loadHrData(svc, employee)),
      };
    }),
  );
  return { fields: fields.fields.filter((f) => !f.disabled), rows };
}

export async function previewHrBasicBulk(
  svc: CoreServices,
  raw: z.input<typeof HrBasicBulkSchema>,
) {
  await svc.permissions.require('payroll.hr.edit');
  await svc.permissions.require('payroll.hr.view');
  const input = HrBasicBulkSchema.parse(raw);
  if (new Set(input.employeeIds).size !== input.employeeIds.length)
    fail('PERSONNEL_SCOPE', '置数范围含有重复人员', '重新勾选需要修改的人员');
  const schema = await hrFields(svc),
    field = schema.fields.find((f) => f.key === input.field && !f.disabled);
  if (!field) fail('HR_FIELD_UNKNOWN', '所选基本资料栏目不存在或已停用', '刷新栏目后重新选择');
  if (field.required && !input.value.trim())
    fail('HR_REQUIRED', `请填写基本资料“${field.name}”`, '填写要统一设置的内容');
  if (field.kind === 'date' && input.value && !z.string().date().safeParse(input.value).success)
    fail('HR_DATE', `基本资料“${field.name}”日期无效`, '使用有效的年月日');
  const records = await Promise.all(
    input.employeeIds.map(async (id) => {
      const employee = await rawEmployee(svc, id),
        profile = await hrProfile(svc, id);
      const before = profile.basicValues[field.key] ?? '';
      const after = input.onlyEmpty && before.trim() ? before : input.value;
      validateBasicValues(schema, { ...profile.basicValues, [field.key]: after });
      return { employee, profile, before, after, changed: before !== after };
    }),
  );
  return {
    hash: hash({ input, schema, records }),
    label: field.name,
    preview: records.map((r) => ({
      employeeId: r.employee.id,
      code: r.employee.code,
      name: r.employee.name,
      before: r.before,
      after: r.after,
      changed: r.changed,
    })),
  };
}

export async function applyHrBasicBulk(
  svc: CoreServices,
  input: HrBasicBulk,
  expectedHash: string,
  confirmed: boolean,
) {
  await svc.permissions.require('payroll.hr.edit');
  if (!confirmed)
    fail('CONFIRM', '自定义资料统一置数须确认预览', '核对人员范围及修改前后内容后确认');
  return svc
    .tx(async (t) => {
      const plan = await previewHrBasicBulk(t, input);
      if (plan.hash !== expectedHash)
        fail('PLAN_STALE', '自定义资料置数预览已失效', '人员或栏目资料已经变化，请重新预览后确认');
      for (const row of plan.preview) {
        if (!row.changed) continue;
        const profile = await hrProfile(t, row.employeeId);
        await saveHrProfile(t, {
          ...profile,
          basicValues: { ...profile.basicValues, [input.field]: row.after },
        });
      }
      await t.log.write({
        action: 'payroll.hr.basic-bulk',
        summary: `基本资料统一置数：${plan.label}，范围${plan.preview.length}人，实际修改${plan.preview.filter((r) => r.changed).length}人`,
      });
      return { changed: plan.preview.filter((r) => r.changed).length };
    })
    .catch((error: unknown) => {
      if (error instanceof BusinessError) throw error;
      fail(
        'HR_BULK_SAVE_FAILED',
        '自定义资料置数保存失败，整批资料没有修改',
        '输入已保留，请重新预览后重试',
      );
    });
}

/** 工资编辑对多段任职资料沿用已明确登记的各段。 */
export function assertEmployeeDatesMatchProfile(
  employee: EmployeeWithSpells,
  input: Pick<Employee, 'startDate' | 'endDate'>,
) {
  if (
    (employee.employmentSpells?.length ?? 0) > 1 &&
    (input.startDate !== employee.startDate || input.endDate !== employee.endDate)
  )
    fail(
      'EMPLOYMENT_PROFILE',
      '人员有多段任职记录，请在基本资料中修改',
      '打开“基本资料 / 任职记录”统一维护',
    );
}

/** 删改普通任职起止时，同步唯一任职段，保留基本资料。 */
export async function syncSingleEmployment(svc: CoreServices, employee: Employee) {
  const td = svc.db.withTables<HrTables>();
  const row = await td
    .selectFrom('payroll_hr_profile')
    .select('employment_json')
    .where('employee_id', '=', employee.id)
    .executeTakeFirst();
  if (row && (JSON.parse(row.employment_json) as EmploymentSpell[]).length === 1)
    await td
      .updateTable('payroll_hr_profile')
      .set({
        employment_json: JSON.stringify([
          { startDate: employee.startDate, endDate: employee.endDate },
        ]),
      })
      .where('employee_id', '=', employee.id)
      .execute();
}
