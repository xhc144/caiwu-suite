import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS } from '../shared';
import { GroupedSalaryQuerySchema } from '../shared-query';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
});
afterEach(() => app.close());
it('w_gz_zhcx 条件组内及组间可分别全选/任选，金额按整数分比较，多列排序与导出一致', async () => {
  const api = app.call(payroll);
  await api.confirmTax();
  const category = await api.saveCategory({ name: '分组工资', fields: DEFAULT_FIELDS });
  const department = (await api.departments())[0]!;
  const employees = [];
  for (let i = 1; i <= 4; i++)
    employees.push(
      await api.saveEmployee({
        code: `Q00${i}`,
        name: `合成查询${i}`,
        departmentId: department.id,
        startDate: '2026-01-01',
      }),
    );
  const saved = await api.saveBatch({
    categoryId: category.id,
    categoryRevision: category.revision,
    period: 202601,
    rows: employees.map((e, i) => ({
      employeeId: e.id,
      values: { base: [1000000, 2000000, 2000000, 4000000][i]! },
      tax: { confirmed: true },
    })),
  });
  await api.calculate({ id: saved.id, revision: saved.revision });
  const input = {
    categoryId: category.id,
    from: 202601,
    to: 202601,
    conditions: [{ field: 'gross' as const, operator: 'gte' as const, value: 1000000 }],
    groupMode: 'any' as const,
    groups: [
      {
        mode: 'all' as const,
        conditions: [
          { field: 'code' as const, operator: 'equals' as const, value: 'Q001' },
          { field: 'gross' as const, operator: 'lt' as const, value: 2000000 },
        ],
      },
      {
        mode: 'any' as const,
        conditions: [
          { field: 'code' as const, operator: 'equals' as const, value: 'Q002' },
          { field: 'code' as const, operator: 'equals' as const, value: 'Q003' },
        ],
      },
    ],
    sorts: [
      { field: 'gross' as const, direction: 'desc' as const },
      { field: 'code' as const, direction: 'desc' as const },
    ],
  };
  const rows = await api.querySalary(input);
  expect(rows.map((r) => r.employee.code)).toEqual(['Q003', 'Q002', 'Q001']);
  expect(rows.map((r) => r.gross)).toEqual([2000000, 2000000, 1000000]);
  expect(await api.exportQuery(input)).toEqual(rows);
  expect(await api.querySalary({ ...input, groupMode: 'all' })).toEqual([]);
  const rejected = {
    ...input,
    groups: [{ mode: 'all', conditions: [{ field: 'gross', operator: 'contains', value: '2' }] }],
  };
  expect(GroupedSalaryQuerySchema.safeParse(rejected).success).toBe(false);
  await expect(api.querySalary(rejected as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await expect(
    api.querySalary({ ...input, sorts: [input.sorts[0]!, input.sorts[0]!] }),
  ).rejects.toThrow('同一排序');
  expect((await api.batch({ id: saved.id })).snapshots).toHaveLength(4);
});
