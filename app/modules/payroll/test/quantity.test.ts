import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS, QuantitySchema } from '../shared';
import { computeValues } from '../server/engine';
import { quantityFromE6, quantityText, quantityToE6 } from '../quantity';
import type { PayrollTables } from '../server/migrations';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
});
afterEach(async () => app.close());
async function setup() {
  const api = app.call(payroll);
  const category = await api.saveCategory({
    name: '计时工资',
    fields: [
      {
        ...DEFAULT_FIELDS[0]!,
        key: 'hours',
        name: '出勤工时',
        kind: 'quantity',
        role: 'memo',
        unit: '小时',
        carry: true,
        width: 160,
        description: '实际出勤工时',
      },
      { ...DEFAULT_FIELDS[0]!, key: 'rate', name: '小时工资', role: 'memo', carry: true },
      { ...DEFAULT_FIELDS[0]!, key: 'pay', name: '计时应发', kind: 'calculated' },
      {
        ...DEFAULT_FIELDS[0]!,
        key: 'hire',
        name: '任职日期',
        kind: 'basic',
        basicSource: 'startDate',
        role: 'memo',
      },
    ],
    formulas: [{ name: '计时应发', target: 'pay', expression: 'hours * rate' }],
  });
  const employee = await api.saveEmployee({
    code: 'Q01',
    name: '合成计时人员',
    startDate: '2026-01-01',
    departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
  });
  await api.confirmTax();
  return { api, category, employee };
}
describe('w_xt_gzsz / w_gz_gzgl 数量工资', () => {
  it('数量API限定十进制六位精度及安全e6，转换不经过浮点乘除', () => {
    for (const raw of ['1e2', 'NaN', 'Infinity', '12..3', '0.1234567', '9007199254.740992'])
      expect(QuantitySchema.safeParse(raw).success).toBe(false);
    expect(quantityText('１２３．４５００００')).toBe('123.45');
    expect(quantityText('12..3')).toBe(null);
    expect(quantityToE6('9007199254.740991')).toBe(Number.MAX_SAFE_INTEGER);
    expect(quantityFromE6(-1234567)).toBe('-1.234567');
    fc.assert(
      fc.property(fc.integer({ min: -1000000000, max: 1000000000 }), (e6) => {
        expect(quantityToE6(quantityFromE6(e6))).toBe(e6);
      }),
    );
  });
  it('w_gz_gzgl 数量整数e6落库、刷新不失真，工时乘分计单价只舍入最终金额', async () => {
    const { api, category, employee } = await setup();
    const b = await api.saveBatch({
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: [
        {
          employeeId: employee.id,
          values: { rate: 12345 },
          quantities: { hours: '1.234567' },
          tax: { confirmed: true },
        },
      ],
    });
    expect(b.rows[0]!.quantities).toEqual({ hours: '1.234567' });
    const stored = await app.svc.db
      .withTables<PayrollTables>()
      .selectFrom('payroll_quantity')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(stored.quantity_e6).toBe(1234567);
    const computed = await api.calculate({ id: b.id, revision: b.revision });
    expect(computed.snapshots[0]!.calculatedQuantities).toEqual({ hours: '1.234567' });
    expect(computed.snapshots[0]!.calculatedValues).toEqual({ rate: 12345, pay: 15241 });
    expect(computed.snapshots[0]!.gross).toBe(15241);
    const storedSnapshot = await app.svc.db
      .withTables<PayrollTables>()
      .selectFrom('payroll_row')
      .select('snapshot_json')
      .where('batch_id', '=', b.id)
      .executeTakeFirstOrThrow();
    const storedJson = JSON.parse(storedSnapshot.snapshot_json!) as Record<string, unknown>;
    expect(storedJson.calculated_quantities_e6).toEqual({ hours: 1234567 });
    expect(storedJson.quantities_e6).toEqual({ hours: 1234567 });
    expect(storedJson).not.toHaveProperty('quantities');
    expect(storedJson).not.toHaveProperty('calculatedQuantities');
    expect((await api.batch({ id: b.id })).snapshots).toEqual(computed.snapshots);
    const edited = await api.saveBatch({
      ...computed,
      categoryRevision: category.revision,
      rows: [{ ...computed.rows[0]!, quantities: { hours: '2.000000' } }],
    });
    expect(edited.rows[0]!.quantities).toEqual({ hours: '2' });
    expect(edited.calculated).toBe(false);
    expect(edited.previous[0]!.calculatedQuantities).toEqual({ hours: '1.234567' });
    expect(
      await app.svc.db
        .withTables<PayrollTables>()
        .selectFrom('payroll_quantity')
        .select('quantity_e6')
        .execute(),
    ).toEqual([{ quantity_e6: 2000000 }]);
  });
  it('w_xt_gzsz 数量和基本项不直接计入工资，人事资料不能作算术变量，已用类型不可更改', async () => {
    const { api, category, employee } = await setup();
    await expect(
      api.saveCategory({
        ...category,
        fields: category.fields.map((f) => (f.key === 'hours' ? { ...f, role: 'earning' } : f)),
      }),
    ).rejects.toThrow('不是金额');
    await expect(
      api.saveCategory({
        ...category,
        formulas: [{ name: '非法人事算术', target: 'pay', expression: 'hire * 100' }],
      }),
    ).rejects.toThrow('基本资料');
    const b = await api.saveBatch({
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: [{ employeeId: employee.id, values: { rate: 10000 }, quantities: { hours: '1' } }],
    });
    await expect(
      api.saveCategory({
        ...category,
        fields: category.fields.map((f) => (f.key === 'hours' ? { ...f, kind: 'money' } : f)),
      }),
    ).rejects.toThrow('类型不能');
    await expect(
      api.saveBatch({
        ...b,
        categoryRevision: category.revision,
        rows: [{ employeeId: employee.id, values: { hours: 1 } }],
      }),
    ).rejects.toThrow('不可录入');
    await expect(
      api.saveBatch({
        ...b,
        categoryRevision: category.revision,
        rows: [{ employeeId: employee.id, values: {}, quantities: { rate: '1' } }],
      }),
    ).rejects.toThrow('不可录入');
    expect(await api.batch({ id: b.id })).toEqual(b);
  });
  it('w_gz_jz 数量传递建下月及反结账删除数量均在同一事务', async () => {
    const { api, category, employee } = await setup();
    const b = await api.saveBatch({
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: [
        {
          employeeId: employee.id,
          values: { rate: 10000 },
          quantities: { hours: '21.5' },
          tax: { confirmed: true },
        },
      ],
    });
    const computed = await api.calculate({ id: b.id, revision: b.revision });
    const closed = await api.close({ id: b.id, revision: computed.revision, confirmed: true });
    const next = await api.batch({ id: closed.nextId! });
    expect(next.rows[0]!.quantities).toEqual({ hours: '21.5' });
    expect(next.rows[0]!.values).toEqual({ rate: 10000 });
    await api.reopen({ id: b.id, revision: closed.batch.revision, confirmed: true });
    expect(
      await app.svc.db
        .withTables<PayrollTables>()
        .selectFrom('payroll_quantity')
        .select('batch_id')
        .where('batch_id', '=', next.id)
        .execute(),
    ).toEqual([]);
  });
  it('w_gz_gzgl 分计金额和原单位数量在公式里明确区分，重复计算不累计舍入误差', async () => {
    const { category } = await setup();
    for (let i = 0; i < 3; i++) {
      const c = computeValues(category, { rate: 101 }, { period: 202601 }, { hours: '0.005' });
      expect(c.gross).toBe(1);
      expect(c.values).toEqual({ rate: 101, pay: 1 });
    }
  });
});
