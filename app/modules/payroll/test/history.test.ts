import { afterEach, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import {
  DEFAULT_FIELDS,
  TaxInputSchema,
  type Category,
  type RowInput,
  type Batch,
} from '../shared';
import { calculateHistoricalTax } from '../server/historical-tax';
import { HISTORICAL_TAX_RULES } from '../shared-history';
let app: TestApp;
afterEach(async () => app?.close());
async function fixture(year = 2026) {
  app = await createTestApp({ modules: [payroll], product: 'minfei', startYear: year });
  const api = app.call(payroll);
  const departmentId = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  const employee = await api.saveEmployee({
    code: 'H001',
    name: '合成历史人员',
    departmentId,
    startDate: `${year}-01-01`,
  });
  const category = await api.saveCategory({ name: '合成历史月薪', fields: DEFAULT_FIELDS });
  await api.confirmTax();
  const row = (amount: number): RowInput => ({
    employeeId: employee.id,
    values: { base: amount },
    tax: TaxInputSchema.parse({ confirmed: true }),
  });
  const save = async (period: number, amount: number, c: Category = category) => {
    const b = await api.saveBatch({
      period,
      categoryId: c.id,
      categoryRevision: c.revision,
      rows: [row(amount)],
    });
    return api.calculate({ id: b.id, revision: b.revision });
  };
  return { api, employee, category, row, save };
}
const correctedRows = (b: Batch, amount: number) =>
  b.rows.map((r) => ({ ...r, values: { ...r.values, base: amount } }));

it('w_gz_gzgl/w_xt_kgzb_1_gz 历史税制跨期提示、确认及全部税档边界', async () => {
  const { api, employee } = await fixture(2011);
  await expect(
    api.confirmHistoricalTax({ period: 201109, monthlyExpense: 500000, confirmed: true }),
  ).rejects.toThrow('3500元');
  await expect(
    api.confirmHistoricalTax({ period: 201810, monthlyExpense: 350000, confirmed: true }),
  ).rejects.toThrow('5000元');
  await expect(
    api.confirmHistoricalTax({ period: 201109, monthlyExpense: 350000, confirmed: false }),
  ).rejects.toThrow('确认');
  await expect(
    api.confirmHistoricalTax({ period: 201108, monthlyExpense: 350000, confirmed: true }),
  ).rejects.toThrow('2000元');
  await expect(
    api.confirmHistoricalTax({ period: 200802, monthlyExpense: 200000, confirmed: true }),
  ).rejects.toThrow('历史工资税制范围');
  for (const rule of HISTORICAL_TAX_RULES) {
    await api.confirmHistoricalTax({
      period: rule.from,
      monthlyExpense: rule.monthlyExpense,
      confirmed: true,
    });
    for (const [limit] of rule.brackets.slice(0, -1))
      for (const taxable of [limit, limit + 1]) {
        let due = new Decimal(0),
          previous = 0;
        // 独立按各级距累进计算，不直接用速算扣除公式作为期望。
        for (const [upper, rate] of rule.brackets) {
          due = due.plus(new Decimal(Math.max(0, Math.min(taxable, upper) - previous)).mul(rate));
          previous = upper;
          if (upper >= taxable) break;
        }
        expect(
          calculateHistoricalTax(
            employee,
            rule.from,
            TaxInputSchema.parse({ confirmed: true }),
            taxable + rule.monthlyExpense,
            0,
            0,
          ).currentTax,
        ).toBe(due.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());
      }
  }
  expect((await api.historicalTaxConfig()).map((r) => r.confirmed)).toEqual([true, true, true]);
});

it('w_gz_gzgl 历史月税制可保存计算；月份独立，同月跨类别费用只享一次', async () => {
  const { api, category, row } = await fixture(2018);
  const saved = await api.saveBatch({
    period: 201809,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [row(1000000)],
  });
  await expect(api.calculate({ id: saved.id, revision: saved.revision })).rejects.toThrow('该期间');
  await api.confirmHistoricalTax({ period: 201809, monthlyExpense: 350000, confirmed: true });
  const september = await api.calculate({ id: saved.id, revision: saved.revision });
  expect(september.snapshots[0]!.detail).toMatchObject({
    expense: 350000,
    taxable: 650000,
    currentTax: 74500,
    months: 1,
  });
  await api.confirmHistoricalTax({ period: 201810, monthlyExpense: 500000, confirmed: true });
  const october = await api.saveBatch({
    period: 201810,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [row(1000000)],
  });
  const calculated = await api.calculate({ id: october.id, revision: october.revision });
  expect(calculated.snapshots[0]!.detail).toMatchObject({
    income: 1000000,
    expense: 500000,
    currentTax: 29000,
    allocatedTax: 0,
  });
  const second = await api.saveCategory({ name: '同月另一类别', fields: DEFAULT_FIELDS });
  const extra = await api.saveBatch({
    period: 201810,
    categoryId: second.id,
    categoryRevision: second.revision,
    rows: [row(1000000)],
  });
  const combined = await api.calculate({ id: extra.id, revision: extra.revision });
  expect(combined.snapshots[0]!.detail).toMatchObject({
    income: 2000000,
    expense: 500000,
    cumulativeTax: 159000,
    allocatedTax: 29000,
    currentTax: 130000,
  });
  expect(() =>
    calculateHistoricalTax(
      calculated.snapshots[0]!.employee,
      201810,
      TaxInputSchema.parse({ confirmed: true, additional: 1 }),
      1000000,
      0,
      0,
    ),
  ).toThrow('专项附加');
});

it('w_gz_gzgl 前期更正预览不写入，确认后原子重算并保留原人事及金额快照', async () => {
  const { api, employee, save } = await fixture();
  const jan = await save(202601, 4000000),
    feb = await save(202602, 4000000);
  expect(jan.snapshots[0]!.taxAmount).toBe(105000);
  expect(feb.snapshots[0]!.taxAmount).toBe(343000);
  await api.saveEmployee({ ...employee, name: '现档案更名' });
  const input = {
    id: jan.id,
    revision: jan.revision,
    reason: '漏计工资更正',
    rows: correctedRows(jan, 5000000),
  };
  const preview = await api.previewCorrection(input);
  expect(preview.changes).toMatchObject([
    { id: jan.id, beforeGross: 4000000, afterGross: 5000000, beforeTax: 105000, afterTax: 198000 },
    { id: feb.id, beforeTax: 343000, afterTax: 350000 },
  ]);
  expect(await api.batch({ id: jan.id })).toEqual(jan);
  expect(await api.correctionHistory({ id: jan.id })).toEqual([]);
  await expect(api.applyCorrection({ ...input, ...preview, confirmed: false })).rejects.toThrow(
    '须确认',
  );
  await api.applyCorrection({ ...input, ...preview, confirmed: true });
  const nextJan = await api.batch({ id: jan.id }),
    nextFeb = await api.batch({ id: feb.id });
  expect(nextJan.revision).toBe(jan.revision + 1);
  expect(nextJan.snapshots[0]).toMatchObject({
    employee: { name: '合成历史人员' },
    gross: 5000000,
    taxAmount: 198000,
    net: 4802000,
  });
  expect(nextFeb.snapshots[0]!.taxAmount).toBe(350000);
  expect(nextJan.previous).toEqual(jan.snapshots);
  expect(nextFeb.previous).toEqual(feb.snapshots);
  const audit = (await api.correctionHistory({ id: feb.id }))[0]!;
  expect(audit.reason).toBe(input.reason);
  expect(audit.before).toEqual([jan, feb]);
  expect(audit.after.map((b) => b.snapshots)).toEqual([nextJan.snapshots, nextFeb.snapshots]);
  await expect(api.applyCorrection({ ...input, ...preview, confirmed: true })).rejects.toThrow(
    '已变化',
  );
});

it('w_gz_gzgl 更正计划过期、篡改或并发版本变化均拒绝，整批保持原工资', async () => {
  const { api, save } = await fixture();
  const jan = await save(202601, 4000000),
    feb = await save(202602, 4000000);
  const input = {
    id: jan.id,
    revision: jan.revision,
    reason: '补计金额',
    rows: correctedRows(jan, 5000000),
  };
  const preview = await api.previewCorrection(input);
  await expect(
    api.applyCorrection({
      ...input,
      ...preview,
      expiresAt: new Date(0).toISOString(),
      confirmed: true,
    }),
  ).rejects.toThrow('过期');
  await expect(
    api.applyCorrection({
      ...input,
      ...preview,
      rows: correctedRows(jan, 6000000),
      confirmed: true,
    }),
  ).rejects.toThrow('预览');
  await api.calculate({ id: feb.id, revision: feb.revision });
  await expect(api.applyCorrection({ ...input, ...preview, confirmed: true })).rejects.toThrow(
    '已变化',
  );
  expect(await api.batch({ id: jan.id })).toEqual(jan);
});

it('w_gz_gzgl 更正不能绕过期间锁和工资冻结；末步审计失败回滚所有工资', async () => {
  const { api, save } = await fixture();
  const jan = await save(202601, 4000000),
    feb = await save(202602, 4000000);
  const input = {
    id: jan.id,
    revision: jan.revision,
    reason: '验证回滚',
    rows: correctedRows(jan, 5000000),
  };
  const preview = await api.previewCorrection(input);
  await app.svc.periods.setStatus(202602, 'closed');
  await expect(api.applyCorrection({ ...input, ...preview, confirmed: true })).rejects.toThrow();
  expect(await api.batch({ id: jan.id })).toEqual(jan);
  await app.svc.periods.setStatus(202602, 'open');
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  raw.exec(
    "CREATE TRIGGER payroll_correction_fail BEFORE INSERT ON payroll_correction BEGIN SELECT RAISE(ABORT,'synthetic correction audit failure'); END",
  );
  const fresh = await api.previewCorrection(input);
  await expect(api.applyCorrection({ ...input, ...fresh, confirmed: true })).rejects.toThrow(
    'synthetic correction audit failure',
  );
  expect(await api.batch({ id: jan.id })).toEqual(jan);
  expect(await api.batch({ id: feb.id })).toEqual(feb);
  expect(await api.correctionHistory({ id: jan.id })).toEqual([]);
  raw.exec('DROP TRIGGER payroll_correction_fail');
  await api.close({ id: feb.id, revision: feb.revision, confirmed: true });
  await expect(api.previewCorrection(input)).rejects.toThrow('已经结账');
});

it('w_gz_gzgl 级联更正同时要求编辑与计算权限', async () => {
  const { api, save } = await fixture();
  const jan = await save(202601, 4000000);
  const token = await app.addUser('histedit', {
    permissions: ['payroll.salary.view', 'payroll.salary.edit'],
  });
  await expect(
    app.call(payroll, token).previewCorrection({
      id: jan.id,
      revision: jan.revision,
      reason: '权限验证',
      rows: correctedRows(jan, 5000000),
    }),
  ).rejects.toThrow('计算工资');
  expect(await api.batch({ id: jan.id })).toEqual(jan);
});

it('w_gz_gzgl 2008年九档月税制可保存并持久化计算，2011年9月切换3500费用', async () => {
  const { api, save } = await fixture(2011);
  await api.confirmHistoricalTax({ period: 201108, monthlyExpense: 200000, confirmed: true });
  const august = await save(201108, 1000000);
  expect(august.snapshots[0]!.detail).toMatchObject({
    expense: 200000,
    taxable: 800000,
    currentTax: 122500,
    version: 'cn-salary-monthly-2008-03',
  });
  await api.confirmHistoricalTax({ period: 201109, monthlyExpense: 350000, confirmed: true });
  const september = await save(201109, 1000000);
  expect(september.snapshots[0]!.detail).toMatchObject({
    expense: 350000,
    taxable: 650000,
    currentTax: 74500,
  });
  expect((await api.batch({ id: august.id })).snapshots).toEqual(august.snapshots);
});

it('w_gz_gzgl 跨类别人员依赖闭包全部列入更正，范围外人员及新年度保持原工资', async () => {
  const { api, category, employee, save } = await fixture();
  const jan = await save(202601, 4000000);
  const other = await api.saveEmployee({
    ...employee,
    id: undefined,
    code: 'H002',
    name: '合成第二人员',
  });
  const categoryB = await api.saveCategory({ ...category, id: undefined, name: '合成类别二' });
  const feb = await api.saveBatch({
    period: 202602,
    categoryId: categoryB.id,
    categoryRevision: categoryB.revision,
    rows: [
      {
        employeeId: employee.id,
        values: { base: 1000000 },
        tax: TaxInputSchema.parse({ confirmed: true }),
      },
      {
        employeeId: other.id,
        values: { base: 2000000 },
        tax: TaxInputSchema.parse({ confirmed: true }),
      },
    ],
  });
  const febCalc = await api.calculate({ id: feb.id, revision: feb.revision });
  const march = await api.saveBatch({
    period: 202603,
    categoryId: categoryB.id,
    categoryRevision: categoryB.revision,
    rows: [
      {
        employeeId: other.id,
        values: { base: 2000000 },
        tax: TaxInputSchema.parse({ confirmed: true }),
      },
    ],
  });
  const marchCalc = await api.calculate({ id: march.id, revision: march.revision });
  await app.svc.periods.ensureYear(2027);
  const nextYear = await save(202701, 1000000);
  const input = {
    id: jan.id,
    revision: jan.revision,
    reason: '跨类补计',
    rows: correctedRows(jan, 5000000),
  };
  const preview = await api.previewCorrection(input);
  expect(preview.changes.map((c) => c.id)).toEqual([jan.id, feb.id, march.id]);
  await api.applyCorrection({ ...input, ...preview, confirmed: true });
  expect((await api.batch({ id: feb.id })).snapshots[1]).toEqual(febCalc.snapshots[1]);
  expect((await api.batch({ id: march.id })).snapshots).toEqual(marchCalc.snapshots);
  expect(await api.batch({ id: nextYear.id })).toEqual(nextYear);
});

it('w_gz_gzgl 更正数量工资及审计以e6落库，所有更正前后数量与金额可回读', async () => {
  const { api, employee, category } = await fixture();
  const c = await api.saveCategory({
    ...category,
    fields: [
      {
        ...DEFAULT_FIELDS[0]!,
        key: 'days',
        name: '工作天数',
        kind: 'quantity',
        role: 'memo',
        unit: '天',
      },
      { ...DEFAULT_FIELDS[0]!, key: 'pay', name: '计件工资', kind: 'calculated' },
    ],
    formulas: [{ name: '天数工资', target: 'pay', expression: 'days * 12345' }],
  });
  const b = await api.saveBatch({
    categoryId: c.id,
    categoryRevision: c.revision,
    period: 202601,
    rows: [
      {
        employeeId: employee.id,
        values: {},
        quantities: { days: '1.234567' },
        tax: TaxInputSchema.parse({ confirmed: true }),
      },
    ],
  });
  const before = await api.calculate({ id: b.id, revision: b.revision });
  expect(before.snapshots[0]!.gross).toBe(15241);
  const input = {
    id: before.id,
    revision: before.revision,
    reason: '工作量更正',
    rows: before.rows.map((r) => ({ ...r, quantities: { days: '2.234567' } })),
  };
  const preview = await api.previewCorrection(input);
  const after = await api.applyCorrection({ ...input, ...preview, confirmed: true });
  expect(after.rows[0]!.quantities).toEqual({ days: '2.234567' });
  expect(after.snapshots[0]!.gross).toBe(27586);
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  expect(raw.prepare('SELECT quantity_e6 FROM payroll_quantity').get()).toEqual({
    quantity_e6: 2234567,
  });
  const stored = raw.prepare('SELECT before_json,after_json FROM payroll_correction').get() as {
    before_json: string;
    after_json: string;
  };
  expect(stored.before_json).toContain('1234567');
  expect(stored.before_json).not.toContain('1.234567');
  expect(stored.after_json).not.toContain('2.234567');
  const audit = (await api.correctionHistory({ id: b.id }))[0]!;
  expect(audit.before[0]!.snapshots).toEqual(before.snapshots);
  expect(audit.after[0]!.snapshots).toEqual(after.snapshots);
});

it('w_gz_gzgl 下游工资已有真实凭证时整个前期更正拒绝；审核和过账不得绕过来源锁', async () => {
  const { api, category, save } = await fixture();
  const jan = await save(202601, 4000000),
    feb = await save(202602, 4000000);
  const input = {
    id: jan.id,
    revision: jan.revision,
    reason: '锁定回归',
    rows: correctedRows(jan, 5000000),
  };
  const earlier = await api.previewCorrection(input);
  const scheme = (await app.svc.book.info()).codeScheme;
  await app.svc.accounts.create(
    { code: '2241', name: '合成扣款', categoryId: 'liability' },
    scheme,
  );
  await app.svc.accounts.create({ code: '222102', name: '合成个税' }, scheme);
  const id = async (code: string) => (await app.svc.accounts.require(code)).id;
  await api.saveMapping({
    categoryId: category.id,
    mapping: {
      payableAccountId: await id('2211'),
      bankAccountId: await id('1001'),
      taxAccountId: await id('222102'),
      deductionAccountId: await id('2241'),
      expenseAccountId: await id('6602'),
      amountField: 'gross',
      allocationField: 'department',
    },
  });
  const p = await api.preview({
    id: feb.id,
    revision: feb.revision,
    kind: 'payment',
    date: '2026-02-28',
  });
  const locked = await api.generate({
    id: feb.id,
    revision: feb.revision,
    kind: 'payment',
    date: '2026-02-28',
    hash: p.hash,
  });
  const voucherId = locked.vouchers[0]!.id;
  for (const status of ['pending', 'audited', 'posted'] as const) {
    if (status !== 'pending') await app.svc.vouchers.changeStatus({ ids: [voucherId], to: status });
    await expect(api.previewCorrection(input)).rejects.toThrow('生成凭证');
    await expect(api.applyCorrection({ ...input, ...earlier, confirmed: true })).rejects.toThrow(
      '生成凭证',
    );
    expect(await api.batch({ id: jan.id })).toEqual(jan);
    expect((await app.svc.vouchers.get(voucherId))!.status).toBe(status);
  }
  expect(await api.correctionHistory({ id: jan.id })).toEqual([]);
});
