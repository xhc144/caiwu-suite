import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { TaxInputSchema, type Category, type Employee } from '../shared';
let app: TestApp | undefined;
afterEach(async () => app?.close());

it('w_gzgl_lshz 多类别人员累计只合并选中快照，税额按批次分配相加、数量保持六位精度和来源类别', async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  const api = app.call(payroll);
  await api.confirmTax();
  const fields = [
    { key: 'base', name: '基本工资', kind: 'money' as const, role: 'earning' as const },
    { key: 'hours', name: '工时', kind: 'quantity' as const, role: 'memo' as const, unit: '小时' },
    {
      key: 'person',
      name: '姓名',
      kind: 'basic' as const,
      role: 'memo' as const,
      basicSource: 'name' as const,
    },
  ];
  const categories: Category[] = [];
  for (const name of ['月工资', '项目工资', '未选类别'])
    categories.push(await api.saveCategory({ name, fields }));
  const employee: Employee = await api.saveEmployee({
    code: 'MERGE01',
    name: '合并人员',
    startDate: '2026-01-01',
    departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
  });
  const batches = [];
  for (const category of categories) {
    const batch = await api.saveBatch({
      categoryId: category.id,
      categoryRevision: category.revision,
      period: 202601,
      rows: [
        {
          employeeId: employee.id,
          values: { base: 1000000 },
          quantities: { hours: '1.000001' },
          tax: TaxInputSchema.parse({ confirmed: true }),
        },
      ],
    });
    batches.push(await api.calculate({ id: batch.id, revision: batch.revision }));
  }
  const input = {
    categoryId: categories[0]!.id,
    additionalCategoryIds: [categories[1]!.id],
    from: 202601,
    to: 202601,
    employeeIds: [employee.id],
    columns: ['gross', 'taxAmount', 'net', 'hours', 'person'],
    kind: 'cumulative' as const,
  };
  const result = await api.report(input);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]!.values.gross).toBe(2000000);
  expect(result.rows[0]!.values.taxAmount).toBe(45000);
  expect(result.rows[0]!.values.net).toBe(1955000);
  expect(batches[0]!.snapshots[0]!.taxAmount).toBe(15000);
  expect(batches[1]!.snapshots[0]!.taxAmount).toBe(30000);
  expect(result.quantityTotals).toEqual({ hours: '2.000002' });
  expect(result.rows[0]!.quantities).toEqual({ hours: '2.000002' });
  expect(result.rows[0]!.basicValues).toEqual({ person: '合并人员' });
  expect(result.rows[0]!.categoryNames).toEqual(['月工资', '项目工资']);
  expect(result.sourceDetails.map((source) => source.categoryName)).toEqual(['月工资', '项目工资']);
  expect(result.sourceBatches).toEqual(batches.slice(0, 2).map((batch) => batch.id));
  expect(await api.exportReport(input)).toEqual(result);
  const departments = await api.report({ ...input, kind: 'department' });
  expect(departments.rows[0]!.values).toEqual(result.rows[0]!.values);
  const table = await api.report({ ...input, kind: 'table' });
  expect(table.rows).toHaveLength(2);
  expect(table.rows[0]!.categoryNames).toEqual(['月工资']);
  expect(table.rows[1]!.categoryNames).toEqual(['项目工资']);
  await expect(
    api.report({ ...input, additionalCategoryIds: [categories[1]!.id, categories[1]!.id] }),
  ).rejects.toThrow('不能重复');
  await expect(
    api.report({ ...input, additionalCategoryIds: [categories[0]!.id] }),
  ).rejects.toThrow('主工资类别');
  await expect(api.report({ ...input, additionalCategoryIds: [99999] })).rejects.toThrow();
  await expect(api.report({ ...input, kind: 'cash', cashField: 'hours' })).rejects.toThrow(
    '只接受金额',
  );
});

it('w_gzgl_lshz 自定义同名变量类型、名称、单位不一致时拒绝混合，通用金额仍可累计', async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  const api = app.call(payroll);
  await api.confirmTax();
  const employee = await api.saveEmployee({
    code: 'TYPE01',
    name: '类型人员',
    startDate: '2026-01-01',
    departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
  });
  const primary = await api.saveCategory({
    name: '原类别',
    fields: [{ key: 'item', name: '备查', kind: 'quantity', role: 'memo', unit: '小时' }],
  });
  const categories = [
    primary,
    await api.saveCategory({
      name: '不同类型',
      fields: [{ key: 'item', name: '备查', kind: 'money', role: 'memo', unit: '小时' }],
    }),
    await api.saveCategory({
      name: '不同单位',
      fields: [{ key: 'item', name: '备查', kind: 'quantity', role: 'memo', unit: '件' }],
    }),
    await api.saveCategory({
      name: '不同名称',
      fields: [{ key: 'item', name: '其它', kind: 'quantity', role: 'memo', unit: '小时' }],
    }),
  ];
  for (const category of categories) {
    const batch = await api.saveBatch({
      categoryId: category.id,
      categoryRevision: category.revision,
      period: 202601,
      rows: [
        {
          employeeId: employee.id,
          values: category.fields[0]!.kind === 'money' ? { item: 100 } : {},
          quantities: category.fields[0]!.kind === 'quantity' ? { item: '1' } : {},
          tax: TaxInputSchema.parse({ confirmed: true }),
        },
      ],
    });
    await api.calculate({ id: batch.id, revision: batch.revision });
  }
  const input = {
    categoryId: primary.id,
    from: 202601,
    to: 202601,
    employeeIds: [employee.id],
    columns: ['item'],
    kind: 'cumulative' as const,
  };
  for (const category of categories.slice(1))
    await expect(api.report({ ...input, additionalCategoryIds: [category.id] })).rejects.toThrow(
      '栏目与主类别不一致',
    );
  await expect(
    api.report({
      ...input,
      columns: ['gross'],
      additionalCategoryIds: categories.slice(1).map((category) => category.id),
    }),
  ).resolves.toMatchObject({ totals: { gross: 0 } });
});
