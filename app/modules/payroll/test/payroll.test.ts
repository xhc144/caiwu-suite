import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import {
  DEFAULT_FIELDS,
  TaxInputSchema,
  type Batch,
  type Category,
  type Employee,
  type Mapping,
  type RowInput,
} from '../shared';
import payroll from '../server';
import {
  calculateTax,
  computeValues,
  evaluate,
  parseFormula,
  taxForTaxable,
} from '../server/engine';
let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(payroll, token);
let api: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  api = caller(app);
});
afterEach(async () => app.close());
async function setup() {
  const departmentId = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  const category = await api.saveCategory({ name: '月薪', fields: DEFAULT_FIELDS });
  const employees: Employee[] = [];
  for (let i = 1; i <= 3; i++)
    employees.push(
      await api.saveEmployee({
        code: `S00${i}`,
        name: `合成员工${i}`,
        departmentId,
        startDate: '2026-01-01',
      }),
    );
  await api.confirmTax();
  return { category, employees, departmentId };
}
const row = (employeeId: number, amount: number, additional = 0): RowInput => ({
  employeeId,
  values: { base: amount },
  tax: TaxInputSchema.parse({ additional, confirmed: true }),
});
async function batch(category: Category, rows: RowInput[], period = 202601) {
  return api.saveBatch({
    period,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows,
  });
}
async function computed(category: Category, rows: RowInput[], period = 202601) {
  const b = await batch(category, rows, period);
  return api.calculate({ id: b.id, revision: b.revision });
}
async function mapping(category: Category): Promise<Mapping> {
  const id = async (code: string) => (await app.svc.accounts.require(code)).id;
  await app.svc.accounts.create(
    { code: '2241', name: '合成其他应付款', categoryId: 'liability' },
    (await app.svc.book.info()).codeScheme,
  );
  await app.svc.accounts.create(
    { code: '222102', name: '合成个人所得税' },
    (await app.svc.book.info()).codeScheme,
  );
  const m = {
    payableAccountId: await id('2211'),
    bankAccountId: await id('1001'),
    taxAccountId: await id('222102'),
    deductionAccountId: await id('2241'),
    expenseAccountId: await id('6602'),
    amountField: 'gross' as const,
    allocationField: 'department' as const,
  };
  return api.saveMapping({ categoryId: category.id, mapping: m });
}
async function makeVoucher(b: Batch, kind: 'payment' | 'allocation' = 'payment') {
  const date = `${String(b.period).slice(0, 4)}-${String(b.period).slice(4)}-28`;
  const p = await api.preview({ id: b.id, revision: b.revision, kind, date });
  return api.generate({ id: b.id, revision: b.revision, kind, date, hash: p.hash });
}
describe('工资纵切', () => {
  it('w_gz_rsgl_ins/_xg 编号姓名必填、重号拒绝、改编号保留内部标识和历史、停用保留档案', async () => {
    const { category, employees, departmentId } = await setup(),
      e = employees[0]!;
    await expect(
      api.saveEmployee({ code: '', name: '', departmentId, startDate: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(api.saveEmployee({ ...e, id: undefined })).rejects.toThrow('人员编号重复');
    await expect(api.saveEmployee({ ...employees[1]!, code: e.code })).rejects.toThrow(
      '人员编号重复',
    );
    const b = await computed(category, [row(e.id, 1000000)]);
    const updated = await api.saveEmployee({ ...e, code: 'S999', disabled: true });
    expect(updated.id).toBe(e.id);
    expect((await api.batch({ id: b.id })).snapshots[0]!.employee.code).toBe('S001');
    await expect(batch(category, [row(e.id, 1)], 202602)).rejects.toThrow('停用人员');
    expect((await api.employees()).find((x) => x.id === e.id)?.disabled).toBe(true);
  });
  it('w_gz_bmwh 使用 core 部门，拒绝客供冒充部门、非末级/停用部门', async () => {
    const dept = await api.createDepartment({ code: 'PAY', name: '合成部门' });
    expect((await app.svc.dimensions.get(dept.id))?.typeId).toBe('department');
    const customer = (await app.svc.dimensions.getByCode('partner', 'C001'))!;
    await expect(
      api.saveEmployee({
        code: 'x',
        name: 'x',
        departmentId: customer.id,
        startDate: '2026-01-01',
      }),
    ).rejects.toThrow('末级部门');
    await expect(
      api.saveEmployee({
        code: 'x',
        name: 'x',
        departmentId: dept.id,
        startDate: '2026-02-01',
        endDate: '2026-01-01',
      }),
    ).rejects.toThrow('离职日期');
  });
  it('w_xt_gzsz 已用栏目类型/变量不可删除，停用不破坏工资快照，修订冲突阻止覆盖', async () => {
    const { category, employees } = await setup();
    const b = await computed(category, [row(employees[0]!.id, 1000000)]);
    await expect(
      api.saveCategory({ ...category, fields: category.fields.slice(1) }),
    ).rejects.toThrow('已使用栏目');
    await expect(
      api.saveCategory({
        ...category,
        fields: category.fields.map((f) => (f.key === 'base' ? { ...f, kind: 'calculated' } : f)),
        formulas: [{ name: 'x', target: 'base', expression: '1' }],
      }),
    ).rejects.toThrow('已使用栏目');
    const c = await api.saveCategory({
      ...category,
      fields: category.fields.map((f) => ({ ...f, disabled: true })),
    });
    expect(c.revision).toBe(2);
    expect((await api.batch({ id: b.id })).snapshots[0]!.gross).toBe(1000000);
    await expect(api.saveCategory({ ...category, name: '冲突' })).rejects.toThrow('其他操作修改');
  });
  it('w_xt_gs_edit/gssz 缺字段、未知变量、括号、参数、运算符、循环、重复计税和除零给定位错误；删除保存需完整有效结构', async () => {
    const { category } = await setup();
    await expect(
      api.saveCategory({ ...category, formulas: [{ name: '', target: '', expression: '' }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    for (const source of [
      'unknown + 1',
      '(base+1',
      'base +',
      'base bonus',
      'unknownfunction()',
      'base;1',
    ])
      expect(() => parseFormula(source, new Set(['base', 'bonus']))).toThrow(/第\d+位/);
    expect(() => evaluate(parseFormula('base / 0', new Set(['base'])).ast, { base: 1 })).toThrow(
      '除数为零',
    );
    const calculated = {
      ...DEFAULT_FIELDS[0]!,
      key: 'extra',
      name: '津贴',
      kind: 'calculated' as const,
    };
    await expect(
      api.saveCategory({
        ...category,
        fields: [...category.fields, calculated],
        formulas: [{ name: '循环', target: 'extra', expression: 'extra+1' }],
      }),
    ).rejects.toThrow('循环');
    await expect(
      api.saveCategory({
        ...category,
        formulas: [
          { name: '税一', target: 'base', expression: '1', tax: true },
          { name: '税二', target: 'bonus', expression: '1', tax: true },
        ],
      }),
    ).rejects.toThrow('计税公式');
    const c = await api.saveCategory({
      ...category,
      fields: [...category.fields, calculated],
      formulas: [
        { name: '津贴', target: 'extra', expression: 'base * 0.1', condition: 'base > 0' },
      ],
    });
    expect(computeValues(c, { base: 1000000 }).gross).toBe(1100000);
    expect(computeValues(c, { base: 0 }).values.extra).toBe(0);
    await expect(api.saveCategory({ ...c, formulas: [] })).rejects.toThrow('缺少启用公式');
  });
  it('w_gz_gzgl 三人两个月独立手算、专项附加/减免/已扣区分、重复计算不累加', async () => {
    const { category, employees: e } = await setup();
    // 一月：10000-5000-1000=4000，税120；30000-5000-2000=23000，税690；50000-5000=45000，税1980。
    let jan = await computed(category, [
      row(e[0]!.id, 1000000, 100000),
      row(e[1]!.id, 3000000, 200000),
      row(e[2]!.id, 5000000),
    ]);
    expect(jan.snapshots.map((r) => r.taxAmount)).toEqual([12000, 69000, 198000]);
    const before = jan.snapshots;
    jan = await api.calculate({ id: jan.id, revision: jan.revision });
    expect(jan.snapshots).toEqual(before);
    // 二月累计：8000*3%=240，减已扣120得120；46000*10%-2520=2080，减690得1390；90000*10%-2520=6480，减1980得4500。
    const feb = await computed(
      category,
      [row(e[0]!.id, 1000000, 200000), row(e[1]!.id, 3000000, 400000), row(e[2]!.id, 5000000)],
      202602,
    );
    expect(feb.snapshots.map((r) => r.taxAmount)).toEqual([12000, 139000, 450000]);
    expect(feb.snapshots[0]!.detail).toMatchObject({
      income: 2000000,
      additional: 200000,
      alreadyWithheld: 12000,
      currentTax: 12000,
      months: 2,
    });
    await expect(api.calculate({ id: jan.id, revision: jan.revision })).rejects.toThrow(
      '后续工资批次',
    );
  });
  it('w_gz_gzgl 同月跨类别合并且费用/扣除仅享一次，禁止同类别重复批次，后续批次锁前批', async () => {
    const { category, employees } = await setup(),
      e = employees[0]!;
    const jan = await computed(category, [row(e.id, 1000000, 100000)]);
    const extra = await api.saveCategory({ name: '绩效', fields: DEFAULT_FIELDS });
    let second = await batch(extra, [row(e.id, 1000000, 100000)]);
    second = await api.calculate({ id: second.id, revision: second.revision });
    expect(second.snapshots[0]!.detail).toMatchObject({
      income: 2000000,
      expense: 500000,
      additional: 100000,
      alreadyWithheld: 12000,
      currentTax: 30000,
    });
    await expect(batch(category, [row(e.id, 1)])).rejects.toThrow('已有工资批次');
    await expect(api.saveBatch({ ...jan, categoryRevision: category.revision })).rejects.toThrow(
      '后续工资批次',
    );
    const third = await api.saveCategory({ name: '补发', fields: DEFAULT_FIELDS });
    const wrong = await batch(third, [row(e.id, 1000, 200000)]);
    await expect(api.calculate({ id: wrong.id, revision: wrong.revision })).rejects.toThrow(
      '累计扣除必须一致',
    );
  });
  it('w_gz_gzgl 参数未确认、扣除未确认、非居民/劳务/年终奖阻止，历史税额与资格不可静默换', async () => {
    const { category, employees } = await setup(),
      e = employees[0]!;
    await app.svcFor('payroll').settings.set('taxVersion', '');
    let b = await batch(category, [row(e.id, 1000000)]);
    await expect(api.calculate({ id: b.id, revision: b.revision })).rejects.toThrow(
      '尚未确认本账套',
    );
    await api.confirmTax();
    b = await api.saveBatch({
      ...b,
      categoryRevision: category.revision,
      rows: [{ ...row(e.id, 1000000), tax: TaxInputSchema.parse({}) }],
    });
    await expect(api.calculate({ id: b.id, revision: b.revision })).rejects.toThrow(
      '尚未确认本单位',
    );
    for (const taxKind of ['nonresident', 'labor', 'bonus'] as const) {
      const current = (await api.employees())[0]!;
      await api.saveEmployee({ ...current, taxKind });
      b = await api.saveBatch({
        ...b,
        categoryRevision: category.revision,
        rows: [row(e.id, 1000000)],
      });
      await expect(api.calculate({ id: b.id, revision: b.revision })).rejects.toThrow(
        '所得类型尚不支持',
      );
    }
  });
  it('w_gz_gzgl 年中入离职、首次工资/全年费用资格、追补负额不自动退、跨年清零', async () => {
    const { category, employees } = await setup();
    let e = await api.saveEmployee({
      ...employees[0]!,
      startDate: '2026-03-20',
      endDate: '2026-04-02',
    });
    const r = row(e.id, 2000000);
    r.tax.openingIncome = 100000;
    r.tax.openingTax = 1234;
    const march = await computed(category, [r], 202603);
    expect(march.snapshots[0]!.detail).toMatchObject({
      months: 1,
      expense: 500000,
      openingTax: 1234,
      currentTax: 46766,
    });
    const april = await computed(
      category,
      [{ ...r, tax: { ...r.tax, additional: 5000000 } }],
      202604,
    );
    expect(april.snapshots[0]!.detail).toMatchObject({
      months: 2,
      currentTax: 0,
      refundDeferred: 48000,
    });
    const may = await computed(
      category,
      [{ ...r, tax: { ...r.tax, additional: 5000000 } }],
      202605,
    );
    expect(may.snapshots[0]!.detail.months).toBe(2);
    const nextYear = await api.saveEmployee({ ...e, endDate: null });
    e = nextYear;
    await app.svc.periods.ensureYear(2027);
    const year = await computed(category, [row(e.id, 1000000)], 202701);
    expect(year.snapshots[0]!.detail).toMatchObject({
      income: 1000000,
      alreadyWithheld: 0,
      months: 1,
      currentTax: 15000,
    });
    const synthetic = {
      ...e,
      policy: 'annual60000' as const,
      qualificationYear: 2026,
      qualificationConfirmed: true,
    };
    expect(
      calculateTax(synthetic, 202605, TaxInputSchema.parse({ confirmed: true }), 6500000, 0, 0),
    ).toMatchObject({ expense: 6000000, currentTax: 15000 });
    expect(() =>
      calculateTax(
        { ...synthetic, qualificationConfirmed: false },
        202605,
        TaxInputSchema.parse({ confirmed: true }),
        6500000,
        0,
        0,
      ),
    ).toThrow('资格');
    expect(
      calculateTax(
        { ...synthetic, policy: 'firstIncome' },
        202603,
        TaxInputSchema.parse({ confirmed: true }),
        2000000,
        0,
        0,
      ),
    ).toMatchObject({ expense: 1500000, currentTax: 15000 });
  });
  it('w_pz_sz 金额/基本分配栏目类型、非末级科目校验', async () => {
    const { category } = await setup();
    const m = await mapping(category);
    await expect(
      api.saveMapping({ categoryId: category.id, mapping: { ...m, amountField: 'net' } }),
    ).rejects.toThrow('应付工资须');
    await expect(
      api.saveMapping({
        categoryId: category.id,
        mapping: { ...m, expenseAccountId: (await app.svc.accounts.require('1002')).id },
      }),
    ).rejects.toThrow('末级科目');
  });
  it('w_pz_build_gz 缺设置、日期封锁、预览设置变化失效、重复生成、来源保护、待审核撤销和审核锁', async () => {
    const { category, employees } = await setup();
    let b = await computed(category, [row(employees[0]!.id, 1000000)]);
    await expect(
      api.preview({ id: b.id, revision: b.revision, kind: 'payment', date: '2026-01-31' }),
    ).rejects.toThrow('缺少工资凭证设置');
    const m = await mapping(category),
      input = { id: b.id, revision: b.revision, kind: 'payment' as const, date: '2026-01-31' };
    await expect(api.preview({ ...input, date: '2026-02-01' })).rejects.toThrow('属于工资期间');
    let plan = await api.preview(input);
    expect(plan.debit).toBe(plan.credit);
    await api.saveMapping({
      categoryId: category.id,
      mapping: { ...m, bankAccountId: m.deductionAccountId },
    });
    await expect(api.generate({ ...input, hash: plan.hash })).rejects.toThrow('预览已失效');
    plan = await api.preview(input);
    b = await api.generate({ ...input, hash: plan.hash });
    const v = (await app.svc.vouchers.get(b.vouchers[0]!.id))!;
    expect(v.status).toBe('pending');
    expect(v.source).toEqual({ module: 'payroll', type: 'batch', id: String(b.id) });
    expect(v.debitTotal).toBe(v.creditTotal);
    await expect(app.svc.vouchers.delete(v.id)).rejects.toThrow('由「工资」生成');
    await expect(api.generate({ ...input, hash: plan.hash })).rejects.toThrow('其他操作修改');
    await expect(api.calculate({ id: b.id, revision: b.revision })).rejects.toThrow('生成凭证');
    await expect(
      api.revoke({ id: b.id, revision: b.revision, kind: 'payment', confirmed: false }),
    ).rejects.toThrow('须确认');
    b = await api.revoke({ id: b.id, revision: b.revision, kind: 'payment', confirmed: true });
    expect(b.vouchers).toEqual([]);
    expect(await app.svc.vouchers.get(v.id)).toBeNull();
    b = await makeVoucher(b, 'allocation');
    await app.svc.vouchers.changeStatus({ ids: [b.vouchers[0]!.id], to: 'audited' });
    await expect(
      api.revoke({ id: b.id, revision: b.revision, kind: 'allocation', confirmed: true }),
    ).rejects.toThrow('不能删除');
    expect((await api.batch({ id: b.id })).vouchers).toHaveLength(1);
    await app.svc.vouchers.changeStatus({ ids: [b.vouchers[0]!.id], to: 'posted' });
    await expect(
      api.revoke({ id: b.id, revision: b.revision, kind: 'allocation', confirmed: true }),
    ).rejects.toThrow('不能删除');
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(
      api.preview({ id: b.id, revision: b.revision, kind: 'payment', date: '2026-01-31' }),
    ).rejects.toThrow();
  });
  it('w_pz_build_gz 负实发以贷方红字调整、总额配平；修改工资过期版本不覆盖', async () => {
    const { category, employees } = await setup();
    const r = row(employees[0]!.id, 1000);
    r.values.deduction = 2000;
    const b = await computed(category, [r]);
    await mapping(category);
    const input = { id: b.id, revision: b.revision, kind: 'payment' as const, date: '2026-01-31' };
    const plan = await api.preview(input);
    expect(plan.lines.some((line) => line.credit === -1000 && line.debit === 0)).toBe(true);
    expect(plan.debit).toBe(1000);
    expect(plan.credit).toBe(plan.debit);
    await expect(
      api.saveBatch({ ...b, revision: 0, categoryRevision: category.revision }),
    ).rejects.toThrow('其他操作修改');
    expect(await api.batch({ id: b.id })).toEqual(b);
    const generated = await api.generate({ ...input, hash: plan.hash });
    const voucher = await app.svc.vouchers.get(generated.vouchers[0]!.id);
    expect(voucher?.debitTotal).toBe(1000);
    expect(
      voucher?.lines.some((line) => line.entrySide === 'credit' && line.credit === -1000),
    ).toBe(true);
    expect(generated.snapshots).toEqual(b.snapshots);
  });
  it('w_gz_gzgl/w_pz_build_gz 中途失败整批回滚，不留半批税额和孤儿凭证', async () => {
    const { category, employees } = await setup();
    const b = await batch(category, [
      row(employees[0]!.id, 1000000),
      { ...row(employees[1]!.id, 1000000), tax: TaxInputSchema.parse({ confirmed: false }) },
    ]);
    await expect(api.calculate({ id: b.id, revision: b.revision })).rejects.toThrow('尚未确认');
    expect((await api.batch({ id: b.id })).snapshots).toEqual([]);
    let ready = await api.saveBatch({
      ...b,
      categoryRevision: category.revision,
      rows: [row(employees[0]!.id, 1000000)],
    });
    ready = await api.calculate({ id: ready.id, revision: ready.revision });
    await mapping(category);
    await sql`CREATE TRIGGER payroll_test_failure BEFORE INSERT ON payroll_voucher BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`.execute(
      app.svc.db,
    );
    await expect(makeVoucher(ready)).rejects.toThrow('synthetic failure');
    expect((await app.svc.vouchers.list({})).items).toHaveLength(0);
    expect((await api.batch({ id: ready.id })).vouchers).toHaveLength(0);
  });
  it('w_gz_prt_gzb 空选择、非批次选择阻止，工资条来自快照且人事查看不能读工资/导出', async () => {
    const { category, employees } = await setup(),
      b = await computed(category, [row(employees[0]!.id, 1000000)]);
    await expect(api.exportRows({ id: b.id, employeeIds: [] })).rejects.toThrow('没有选中');
    await expect(api.exportRows({ id: b.id, employeeIds: [employees[1]!.id] })).rejects.toThrow(
      '不属于',
    );
    expect((await api.exportRows({ id: b.id, employeeIds: [employees[0]!.id] })).rows[0]!.net).toBe(
      985000,
    );
    const hr = caller(app, await app.addUser('hr', { permissions: ['payroll.hr.view'] }));
    expect(await hr.employees()).toHaveLength(3);
    for (const denied of [
      hr.batch({ id: b.id }),
      hr.exportRows({ id: b.id, employeeIds: [employees[0]!.id] }),
      hr.calculate({ id: b.id, revision: b.revision }),
      hr.confirmTax(),
    ])
      await expect(denied).rejects.toThrow('权限');
  });
});
describe('官方税表独立样本与不变量', () => {
  it('w_gz_gzgl 每级边界前后1分：独立分段积分预期，不调用计税函数作为预期', () => {
    const limits = [3600000, 14400000, 30000000, 42000000, 66000000, 96000000];
    const rates = [3, 10, 20, 25, 30, 35, 45];
    const independent = (value: number) => {
      let previous = 0,
        total = 0;
      for (let i = 0; i < rates.length; i++) {
        const end = limits[i] ?? value;
        const width = Math.max(0, Math.min(value, end) - previous);
        total += width * rates[i]!;
        previous = end;
      }
      return Math.round(total / 100);
    };
    for (const limit of limits)
      for (const delta of [-1, 0, 1])
        expect(taxForTaxable(limit + delta).amount).toBe(independent(limit + delta));
  });
  it('w_gz_gzgl fast-check 应发-扣款-税=实发、重复计算稳定、发放/分配平衡及整数安全', async () => {
    const { category, employees } = await setup(),
      employee = employees[0]!;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000000 }),
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        (gross, deduction, additional) => {
          const c = computeValues(category, { base: gross, deduction });
          const tax = calculateTax(
            employee,
            202601,
            TaxInputSchema.parse({ confirmed: true, additional }),
            gross,
            0,
            0,
          );
          const again = calculateTax(
            employee,
            202601,
            TaxInputSchema.parse({ confirmed: true, additional }),
            gross,
            0,
            0,
          );
          const net = c.gross - c.deductions - tax.currentTax;
          expect(tax).toEqual(again);
          expect(net + deduction + tax.currentTax).toBe(gross);
          expect(gross).toBe(c.gross);
          expect(Number.isSafeInteger(net)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('窗口规则补充', () => {
  it('w_gz_gzgl 录入范围、类别身份、起始期间和顺序检查保留输入，未知栏目拒绝', async () => {
    const { category, employees: e } = await setup();
    await expect(api.saveCategory({ name: category.name, fields: DEFAULT_FIELDS })).rejects.toThrow(
      '名称已存在',
    );
    await expect(batch(category, [row(e[0]!.id, 1), row(e[0]!.id, 2)])).rejects.toThrow('重复录入');
    await expect(
      batch(category, [{ ...row(e[0]!.id, 1), values: { unknown: 1 } }]),
    ).rejects.toThrow('不可录入');
    await expect(batch(category, [row(e[0]!.id, 1)], 202512)).rejects.toThrow('早于启用');
    const b = await batch(category, [row(e[0]!.id, 1)]);
    await expect(
      api.saveBatch({ ...b, period: 202602, categoryRevision: category.revision }),
    ).rejects.toThrow('不能换期间');
    await expect(
      api.preview({ id: b.id, revision: b.revision, kind: 'payment', date: '2026-01-31' }),
    ).rejects.toThrow('尚未计算');
    await expect(api.exportRows({ id: b.id, employeeIds: [e[0]!.id] })).rejects.toThrow('尚未计算');
    const later = await batch(category, [row(e[0]!.id, 1000000)], 202602);
    await expect(api.calculate({ id: later.id, revision: later.revision })).rejects.toThrow(
      '较早的未计算',
    );
    await api.saveCategory({ ...category, disabled: true });
    await expect(batch({ ...category, revision: 2 }, [row(e[0]!.id, 1)], 202603)).rejects.toThrow(
      '已停用',
    );
  });
  it('w_gz_gzgl 期初已扣与计税方式/任职日期变更不能覆盖历史，免税不得超过累计收入', async () => {
    const { category, employees: e } = await setup();
    const invalid = await batch(category, [
      { ...row(e[0]!.id, 100), tax: TaxInputSchema.parse({ confirmed: true, exempt: 101 }) },
    ]);
    await expect(api.calculate({ id: invalid.id, revision: invalid.revision })).rejects.toThrow(
      '累计免税',
    );
    const b = await api.saveBatch({
      ...invalid,
      categoryRevision: category.revision,
      rows: [row(e[0]!.id, 1000000)],
    });
    await api.calculate({ id: b.id, revision: b.revision });
    await expect(api.saveEmployee({ ...e[0]!, startDate: '2026-02-01' })).rejects.toThrow(
      '任职日期变更',
    );
    let feb = await batch(
      category,
      [{ ...row(e[0]!.id, 1), tax: TaxInputSchema.parse({ confirmed: true, openingIncome: 1 }) }],
      202602,
    );
    await expect(api.calculate({ id: feb.id, revision: feb.revision })).rejects.toThrow(
      '期初收入或已扣税',
    );
    feb = await api.saveBatch({
      ...feb,
      categoryRevision: category.revision,
      rows: [row(e[0]!.id, 1)],
    });
    await api.saveEmployee({
      ...e[0]!,
      policy: 'annual60000',
      qualificationYear: 2026,
      qualificationConfirmed: true,
    });
    await expect(api.calculate({ id: feb.id, revision: feb.revision })).rejects.toThrow('计税方式');
  });
  it('w_xt_gs_edit 精确Decimal、比较条件、重复/停用目标及超出金额安全范围拒绝', async () => {
    const keys = new Set(['base', 'bonus']);
    expect(evaluate(parseFormula('-(base + 2) * 3 / 2', keys).ast, { base: 10 }).toString()).toBe(
      '-18',
    );
    for (const [expression, expected] of [
      ['base>=10', 1],
      ['base<=10', 1],
      ['base==10', 1],
      ['base!=10', 0],
      ['base<10', 0],
      ['base>10', 0],
    ] as const)
      expect(evaluate(parseFormula(expression, keys).ast, { base: 10 }).toNumber()).toBe(expected);
    const { category } = await setup();
    await expect(
      api.saveCategory({ ...category, fields: [...DEFAULT_FIELDS, DEFAULT_FIELDS[0]!] }),
    ).rejects.toThrow('变量重复');
    const c = {
      ...category,
      fields: [
        ...DEFAULT_FIELDS,
        { ...DEFAULT_FIELDS[0]!, key: 'total', kind: 'calculated' as const },
      ],
      formulas: [
        {
          name: '合计',
          target: 'total',
          expression: 'base*100',
          condition: '',
          enabled: true,
          tax: false,
        },
      ],
    };
    expect(() => computeValues(c, { base: Number.MAX_SAFE_INTEGER })).toThrow('安全整数范围');
    await expect(
      api.saveCategory({ ...c, formulas: [...c.formulas, ...c.formulas] }),
    ).rejects.toThrow('重复目标');
    await expect(
      api.saveCategory({
        ...c,
        fields: c.fields.map((f) => (f.key === 'base' ? { ...f, disabled: true } : f)),
      }),
    ).rejects.toThrow('停用栏目');
    await expect(
      api.saveCategory({
        ...category,
        formulas: [{ name: '错误', target: 'base', expression: '1' }],
      }),
    ).rejects.toThrow('计算栏目');
    const saved = await api.saveCategory(c);
    const removed = await api.saveCategory({ ...saved, fields: DEFAULT_FIELDS, formulas: [] });
    expect(removed.formulas).toEqual([]);
  });
  it('w_pz_build_gz 未配置其他必需维度、无可制证工资、缺贷方映射、关闭会计期都列出原因', async () => {
    const { category, employees: e } = await setup(),
      m = await mapping(category);
    const scheme = (await app.svc.book.info()).codeScheme;
    const person = await app.svc.accounts.create(
      {
        code: '2242',
        name: '合成人员维度',
        categoryId: 'liability',
        dimensions: [{ type: 'person', required: true }],
      },
      scheme,
    );
    await api.saveMapping({
      categoryId: category.id,
      mapping: { ...m, deductionAccountId: person.id },
    });
    const r = row(e[0]!.id, 1000000);
    r.values.deduction = 1000;
    let b = await computed(category, [r]);
    const input = { id: b.id, revision: b.revision, kind: 'payment' as const, date: '2026-01-31' };
    await expect(api.preview(input)).rejects.toThrow('需要个人');
    expect(await api.batch({ id: b.id })).toEqual(b);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    const personalItem = (await app.svc.dimensions.getByCode('person', 'P01'))!;
    const currentMapping = (await api.mapping({ categoryId: category.id }))!;
    await api.saveMapping({
      categoryId: category.id,
      mapping: {
        ...currentMapping,
        auxiliaries: [{ accountId: person.id, values: { person: personalItem.id } }],
      },
    });
    const withPersonal = await api.preview(input);
    expect(withPersonal.lines.find((line) => line.accountId === person.id)).toMatchObject({
      credit: 1000,
      dimensions: { person: personalItem.id },
    });
    expect(withPersonal.debit).toBe(withPersonal.credit);
    await expect(
      api.saveMapping({ categoryId: category.id, mapping: { ...m, taxAccountId: 0 } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    b = await api.saveBatch({
      ...b,
      categoryRevision: category.revision,
      rows: [row(e[0]!.id, 0)],
    });
    b = await api.calculate({ id: b.id, revision: b.revision });
    await expect(api.preview({ ...input, revision: b.revision })).rejects.toThrow('非零工资');
  });
  it('w_gz_gzgl fast-check 真实批次反复保存重算和发放/分配计划的借贷不变量', async () => {
    const { category, employees: e } = await setup();
    await mapping(category);
    let b = await batch(category, [row(e[0]!.id, 1000000)]);
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100000, max: 10000000 }),
        fc.integer({ min: 0, max: 10000 }),
        async (gross, deduction) => {
          const r = row(e[0]!.id, gross);
          r.values.deduction = deduction;
          b = await api.saveBatch({ ...b, categoryRevision: category.revision, rows: [r] });
          b = await api.calculate({ id: b.id, revision: b.revision });
          const before = b.snapshots;
          b = await api.calculate({ id: b.id, revision: b.revision });
          expect(b.snapshots).toEqual(before);
          const snapshot = b.snapshots[0]!;
          expect(snapshot.net).toBe(gross - deduction - snapshot.taxAmount);
          for (const kind of ['payment', 'allocation'] as const) {
            const p = await api.preview({
              id: b.id,
              revision: b.revision,
              kind,
              date: '2026-01-31',
            });
            expect(p.debit).toBe(gross);
            expect(p.credit).toBe(gross);
            expect(p.lines.reduce((v, l) => v + (l.debit ?? 0) - (l.credit ?? 0), 0)).toBe(0);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

it('w_gz_gzgl 官方累计预扣全部扣除分项与税额解释，政策施行日/资格年度/无任职月份阻止', async () => {
  const { employees } = await setup();
  const e = employees[0]!;
  const profile = TaxInputSchema.parse({
    confirmed: true,
    special: 100000,
    additional: 50000,
    other: 25000,
    relief: 750,
    openingTax: 1000,
  });
  expect(calculateTax(e, 202601, profile, 1000000, 100000, 2000)).toMatchObject({
    taxable: 225000,
    expense: 500000,
    rate: '0.03',
    cumulativeTax: 6000,
    alreadyWithheld: 3000,
    currentTax: 3000,
  });
  expect(() => calculateTax(e, 201812, profile, 1000000, 0, 0)).toThrow('专项附加');
  expect(
    calculateTax(e, 201812, TaxInputSchema.parse({ confirmed: true }), 1000000, 0, 0),
  ).toMatchObject({
    expense: 500000,
    taxable: 500000,
    currentTax: 29000,
    version: 'cn-salary-monthly-2018-10',
  });
  expect(() =>
    calculateTax(
      Object.assign({ ...e, startDate: '2027-01-01' }, { employmentSpells: [] }),
      202601,
      profile,
      1000000,
      0,
      0,
    ),
  ).toThrow('没有任职受雇月份');
  const previous = {
    ...e,
    employmentSpells: [],
    startDate: '2019-01-01',
    policy: 'annual60000' as const,
    qualificationYear: 2020,
    qualificationConfirmed: true,
  };
  expect(() => calculateTax(previous, 202001, profile, 1000000, 0, 0)).toThrow('自2021年');
  expect(() =>
    calculateTax({ ...previous, policy: 'firstIncome' }, 202001, profile, 1000000, 0, 0),
  ).toThrow('自2020年');
  expect(() =>
    calculateTax({ ...previous, qualificationYear: 2025 }, 202601, profile, 1000000, 0, 0),
  ).toThrow('逐年确认');
});
it('w_pz_sz/build_gz 设置乐观锁、基本栏目类型与失衡拦截使用真实批次/凭证服务', async () => {
  const { category, employees } = await setup();
  const m = await mapping(category);
  let b = await computed(category, [row(employees[0]!.id, 1000000)]);
  await expect(
    api.saveMapping({
      categoryId: category.id,
      mapping: { ...m, allocationField: 'base' },
    } as never),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  const newer = await api.saveMapping({
    categoryId: category.id,
    mapping: { ...m, bankAccountId: m.deductionAccountId },
  });
  expect(newer.revision).toBe(m.revision + 1);
  await expect(api.saveMapping({ categoryId: category.id, mapping: m })).rejects.toThrow(
    '其他操作修改',
  );
  // 注入本模块快照损坏，验证失衡阻止；凭证读写仍使用真实 core 服务。
  const broken = { ...b.snapshots[0]!, net: 1 };
  await sql`UPDATE payroll_row SET snapshot_json=${JSON.stringify(broken)} WHERE batch_id=${b.id}`.execute(
    app.svc.db,
  );
  await expect(
    api.preview({ id: b.id, revision: b.revision, kind: 'payment', date: '2026-01-31' }),
  ).rejects.toThrow('借贷金额不平');
  expect((await app.svc.vouchers.list({})).items).toHaveLength(0);
  b = await api.calculate({ id: b.id, revision: b.revision });
  expect(b.snapshots[0]!.net).toBe(985000);
});

it('w_xt_gzsz 保留变量名拒绝，防止原型属性混入工资取值', async () => {
  await expect(
    api.saveCategory({ name: '变量校验', fields: [{ ...DEFAULT_FIELDS[0]!, key: 'constructor' }] }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});
