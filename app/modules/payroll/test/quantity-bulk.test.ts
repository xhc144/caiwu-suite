import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS, type Employee } from '../shared';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});
async function fixture() {
  const api = app.call(payroll),
    departmentId = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  const category = await api.saveCategory({
    name: '合成数量置数',
    fields: [
      ...DEFAULT_FIELDS,
      {
        ...DEFAULT_FIELDS[0]!,
        key: 'hours',
        name: '工时',
        kind: 'quantity',
        role: 'memo',
        unit: '小时',
      },
    ],
  });
  const employees: Employee[] = [];
  for (let index = 0; index < 3; index++)
    employees.push(
      await api.saveEmployee({
        code: `QB${index}`,
        name: `合成置数人员${index}`,
        startDate: '2026-01-01',
        departmentId,
      }),
    );
  const batch = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: employees.map((employee, index) => ({
      employeeId: employee.id,
      values: { base: 1000000 + index, bonus: index },
      ...(index < 2 ? { quantities: { hours: index === 0 ? '0' : '1.234567' } } : {}),
      tax: { confirmed: true },
    })),
  });
  return { api, batch, employees, category };
}
describe('w_gz_edit_set 数量及金额统一置数/粘贴', () => {
  it('数量只填空白保留已有零与六位数量，取消不写；确认后金额完整保留', async () => {
    const { api, batch, employees } = await fixture();
    const input = {
      id: batch.id,
      revision: batch.revision,
      employeeIds: employees.map((employee) => employee.id),
      field: 'hours',
      value: '12.500000',
      onlyEmpty: true,
    };
    const plan = await api.previewBulk(input);
    expect(plan.preview.map((row) => [row.kind, row.before, row.after])).toEqual([
      ['quantity', '0', '0'],
      ['quantity', '1.234567', '1.234567'],
      ['quantity', null, '12.5'],
    ]);
    await expect(api.applyBulk({ ...input, hash: plan.hash, confirmed: false })).rejects.toThrow(
      '须确认',
    );
    expect(await api.batch({ id: batch.id })).toEqual(batch);
    const saved = await api.applyBulk({ ...input, hash: plan.hash, confirmed: true });
    expect(saved.rows.map((row) => row.quantities?.hours)).toEqual(['0', '1.234567', '12.5']);
    expect(saved.rows.map((row) => row.values)).toEqual(batch.rows.map((row) => row.values));
  });
  it('金额和数量类型不得互换，重复/跨批范围及超精度拒绝且批次不变', async () => {
    const { api, batch, employees } = await fixture();
    const input = {
      id: batch.id,
      revision: batch.revision,
      employeeIds: [employees[0]!.id],
      field: 'hours',
      value: '1.5',
    };
    await expect(api.previewBulk({ ...input, value: 150 })).rejects.toThrow('单位不一致');
    await expect(api.previewBulk({ ...input, field: 'base' })).rejects.toThrow('单位不一致');
    await expect(api.previewBulk({ ...input, value: '1.1234567' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      api.previewBulk({ ...input, employeeIds: [employees[0]!.id, employees[0]!.id] }),
    ).rejects.toThrow('重复');
    await expect(
      api.previewPaste({
        id: batch.id,
        revision: batch.revision,
        rows: [{ code: 'QB0', values: { hours: 1 } }],
      }),
    ).rejects.toThrow('金额录入');
    await expect(
      api.previewPaste({
        id: batch.id,
        revision: batch.revision,
        rows: [{ code: 'QB0', values: {}, quantities: { base: '1' } }],
      }),
    ).rejects.toThrow('数量录入');
    expect(await api.batch({ id: batch.id })).toEqual(batch);
  });
  it('混合TSV解析后的API按编号预览金额分与数量原单位，同批其余人员不丢失', async () => {
    const { api, batch } = await fixture();
    const input = {
      id: batch.id,
      revision: batch.revision,
      rows: [
        { code: 'QB0', values: { base: 1234567 }, quantities: { hours: '21.123456' } },
        { code: 'QB1', values: {} as Record<string, number>, quantities: { hours: '0' } },
      ],
    };
    const plan = await api.previewPaste(input);
    expect(plan.preview.map((row) => [row.field, row.kind, row.after])).toEqual([
      ['base', 'money', 1234567],
      ['hours', 'quantity', '21.123456'],
      ['hours', 'quantity', '0'],
    ]);
    const saved = await api.applyPaste({ ...input, hash: plan.hash, confirmed: true });
    expect(saved.rows[0]!.values).toEqual({ base: 1234567, bonus: 0 });
    expect(saved.rows[0]!.quantities).toEqual({ hours: '21.123456' });
    expect(saved.rows[1]!.quantities).toEqual({ hours: '0' });
    expect(saved.rows[1]!.values).toEqual(batch.rows[1]!.values);
    expect(saved.rows[2]).toEqual(batch.rows[2]);
  });
  it('数量置数及粘贴预览五分钟过期，人员修改也使计划失效，不沿用旧范围', async () => {
    const { api, batch, employees } = await fixture();
    const input = {
      id: batch.id,
      revision: batch.revision,
      employeeIds: [employees[0]!.id],
      field: 'hours',
      value: '5.5',
    };
    const bulk = await api.previewBulk(input);
    const pasteInput = {
      id: batch.id,
      revision: batch.revision,
      rows: [{ code: 'QB0', values: {}, quantities: { hours: '5.5' } }],
    };
    const pasted = await api.previewPaste(pasteInput);
    const actualNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(actualNow + 300001);
    await expect(api.applyBulk({ ...input, hash: bulk.hash, confirmed: true })).rejects.toThrow(
      '过期',
    );
    await expect(
      api.applyPaste({ ...pasteInput, hash: pasted.hash, confirmed: true }),
    ).rejects.toThrow('过期');
    vi.restoreAllMocks();
    await api.saveEmployee({ ...employees[0]!, name: '已变更合成姓名' });
    await expect(api.applyBulk({ ...input, hash: bulk.hash, confirmed: true })).rejects.toThrow(
      '失效',
    );
    await expect(
      api.applyPaste({ ...pasteInput, hash: pasted.hash, confirmed: true }),
    ).rejects.toThrow('失效');
    expect(await api.batch({ id: batch.id })).toEqual(batch);
  });
  it('数量写入第二人失败时金额、数量e6、工资版本及快照整批回滚', async () => {
    const { api, batch, employees } = await fixture();
    const input = {
      id: batch.id,
      revision: batch.revision,
      rows: [
        { code: 'QB0', values: { base: 12345 }, quantities: { hours: '1' } },
        { code: 'QB1', values: { base: 67890 }, quantities: { hours: '2' } },
      ],
    };
    const plan = await api.previewPaste(input);
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    const before = raw.prepare('SELECT * FROM payroll_quantity ORDER BY employee_id').all();
    raw.exec(
      `CREATE TRIGGER payroll_test_quantity_failure BEFORE INSERT ON payroll_quantity WHEN NEW.employee_id=${employees[1]!.id} BEGIN SELECT RAISE(ABORT,'合成数量写入故障'); END`,
    );
    await expect(api.applyPaste({ ...input, hash: plan.hash, confirmed: true })).rejects.toThrow(
      '合成数量写入故障',
    );
    expect(await api.batch({ id: batch.id })).toEqual(batch);
    expect(raw.prepare('SELECT * FROM payroll_quantity ORDER BY employee_id').all()).toEqual(
      before,
    );
  });
});
