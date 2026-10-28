import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS, TaxInputSchema, type Category } from '../shared';
let app: TestApp;
afterEach(async () => app?.close());
async function fixture() {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  const api = app.call(payroll);
  const departmentId = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  const employee = await api.saveEmployee({
    code: 'CT001',
    name: '合成自定义计税人员',
    departmentId,
    startDate: '2026-01-01',
  });
  const fields = [
    ...DEFAULT_FIELDS,
    {
      ...DEFAULT_FIELDS[0]!,
      key: 'custom_tax',
      name: '本次自定义税额',
      kind: 'calculated' as const,
      role: 'memo' as const,
    },
  ];
  const formulas = [
    {
      name: '示例会计计税公式',
      target: 'custom_tax',
      expression: 'round(base * 0.05, 0)',
      tax: true,
    },
  ];
  const save = (category: Category, period = 202601, amount = 1000000) =>
    api.saveBatch({
      categoryId: category.id,
      categoryRevision: category.revision,
      period,
      rows: [
        {
          employeeId: employee.id,
          values: { base: amount },
          tax: TaxInputSchema.parse({ confirmed: true }),
        },
      ],
    });
  return { api, employee, fields, formulas, save };
}
it('w_xt_gssz 自定义计税须显式选择、唯一计税公式且目标为备查计算项，禁止双扣', async () => {
  const { api, fields, formulas } = await fixture();
  await expect(api.saveCategory({ name: '未选自定义', fields, formulas })).rejects.toThrow(
    '内置税制',
  );
  await expect(
    api.saveCategory({
      name: '缺少计税公式',
      taxMode: 'custom',
      fields: DEFAULT_FIELDS,
      formulas: [],
    }),
  ).rejects.toThrow('须且只能');
  await expect(
    api.saveCategory({
      name: '重复计税',
      taxMode: 'custom',
      fields,
      formulas: [...formulas, { ...formulas[0]!, name: '重复' }],
    }),
  ).rejects.toThrow('只能有一条');
  for (const role of ['earning', 'deduction'] as const)
    await expect(
      api.saveCategory({
        name: `错误目标${role}`,
        taxMode: 'custom',
        fields: fields.map((f) => (f.key === 'custom_tax' ? { ...f, role } : f)),
        formulas,
      }),
    ).rejects.toThrow('备查计算');
  await expect(
    api.saveCategory({
      name: '目标不是计算项',
      taxMode: 'custom',
      fields: DEFAULT_FIELDS,
      formulas: [{ ...formulas[0]!, target: 'base' }],
    }),
  ).rejects.toThrow('备查计算');
  const category = await api.saveCategory({
    name: '明确自定义',
    taxMode: 'custom',
    fields,
    formulas,
  });
  expect(category.taxMode).toBe('custom');
});
it('w_gz_gzgl 自定义计税按整数分只扣一次、可重算及前期更正，原公式快照保留', async () => {
  const { api, fields, formulas, save } = await fixture();
  const category = await api.saveCategory({
    name: '自定义计税工资',
    taxMode: 'custom',
    fields,
    formulas,
  });
  // 此账套未确认任何官方内置税表；明确自定义类别依旧按自己的公式计算。
  const saved = await save(category),
    jan = await api.calculate({ id: saved.id, revision: saved.revision });
  expect(jan.snapshots[0]).toMatchObject({
    gross: 1000000,
    deductions: 0,
    taxAmount: 50000,
    net: 950000,
    calculatedValues: { custom_tax: 50000 },
    detail: {
      currentTax: 50000,
      rate: '自定义',
      version: `custom-formula-${category.id}-${category.revision}`,
    },
  });
  expect(jan.snapshots[0]!.formulaDetails).toContain(
    '自定义计税「示例会计计税公式」：round(base * 0.05, 0)，本次税额50000分',
  );
  const again = await api.calculate({ id: jan.id, revision: jan.revision });
  expect(again.snapshots).toEqual(jan.snapshots);
  const febSaved = await save(category, 202602),
    feb = await api.calculate({ id: febSaved.id, revision: febSaved.revision });
  const input = {
    id: again.id,
    revision: again.revision,
    reason: '补计自定义工资',
    rows: again.rows.map((r) => ({ ...r, values: { base: 2000000 } })),
  };
  const preview = await api.previewCorrection(input);
  expect(preview.changes.map((r) => r.afterTax)).toEqual([100000, 50000]);
  const corrected = await api.applyCorrection({ ...input, ...preview, confirmed: true });
  expect(corrected.snapshots[0]).toMatchObject({ gross: 2000000, taxAmount: 100000, net: 1900000 });
  expect((await api.batch({ id: feb.id })).snapshots).toEqual(feb.snapshots);
  const changed = await api.saveCategory({
    ...category,
    formulas: [{ ...formulas[0]!, expression: 'base * 0.1' }],
  });
  expect(changed.revision).toBe(category.revision + 1);
  expect((await api.batch({ id: corrected.id })).category.formulas[0]!.expression).toBe(
    'round(base * 0.05, 0)',
  );
});
it('w_xt_gssz 计税方式及公式修改要求计税权限，不能借工资结构权限更改税额', async () => {
  const { api, fields, formulas } = await fixture();
  const category = await api.saveCategory({
    name: '受控税式',
    taxMode: 'custom',
    fields,
    formulas,
  });
  const token = await app.addUser('salaryeditor', {
    permissions: ['payroll.salary.view', 'payroll.salary.edit'],
  });
  const editor = app.call(payroll, token);
  await expect(
    editor.saveCategory({ name: '越权自定义', taxMode: 'custom', fields, formulas }),
  ).rejects.toThrow('确认计税参数');
  await expect(
    editor.saveCategory({ ...category, formulas: [{ ...formulas[0]!, expression: 'base * 0.2' }] }),
  ).rejects.toThrow('确认计税参数');
  await expect(
    editor.saveCategory({ ...category, taxMode: 'builtin', fields: DEFAULT_FIELDS, formulas: [] }),
  ).rejects.toThrow('确认计税参数');
  expect((await api.categories())[0]!.formulas[0]!.expression).toBe(formulas[0]!.expression);
});
it('w_gz_gzgl 自定义计税负结果、超大金额及计算失败不写入工资或冲掉旧快照', async () => {
  const { api, fields, formulas, save } = await fixture();
  const category = await api.saveCategory({
    name: '合法计算',
    taxMode: 'custom',
    fields,
    formulas,
  });
  const b = await save(category),
    calculated = await api.calculate({ id: b.id, revision: b.revision });
  for (const expression of ['-1', 'base * 99999999999999999999', 'base / 0']) {
    const bad = await api.saveCategory({
      name: `错误税式${expression}`,
      taxMode: 'custom',
      fields,
      formulas: [{ ...formulas[0]!, expression }],
    });
    const pending = await save(bad);
    await expect(api.calculate({ id: pending.id, revision: pending.revision })).rejects.toThrow();
    expect(await api.batch({ id: pending.id })).toEqual(pending);
    expect(await api.batch({ id: calculated.id })).toEqual(calculated);
  }
});
it('w_gz_gzgl 后续内置累计税制合并自定义类别收入并扣除已分配自定义税额', async () => {
  const { api, fields, formulas, save } = await fixture();
  const custom = await api.saveCategory({
    name: '自定义先发',
    taxMode: 'custom',
    fields,
    formulas,
  });
  const jan = await save(custom, 202601, 4000000);
  const janCalc = await api.calculate({ id: jan.id, revision: jan.revision });
  expect(janCalc.snapshots[0]!.taxAmount).toBe(200000);
  await api.confirmTax();
  const builtin = await api.saveCategory({ name: '内置后发', fields: DEFAULT_FIELDS });
  const feb = await save(builtin, 202602, 4000000);
  const febCalc = await api.calculate({ id: feb.id, revision: feb.revision });
  expect(febCalc.snapshots[0]!.detail).toMatchObject({
    income: 8000000,
    cumulativeTax: 448000,
    allocatedTax: 200000,
    currentTax: 248000,
  });
});
