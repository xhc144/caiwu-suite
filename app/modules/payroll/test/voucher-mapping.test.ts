import { afterEach, beforeEach, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS, TaxInputSchema, type VoucherMappingRule } from '../shared';

let app: TestApp;
const caller = (testApp: TestApp) => testApp.call(payroll);
let api: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  api = caller(app);
});
afterEach(async () => app.close());

async function setup() {
  const departments = await api.departments();
  const first = departments.find((d) => d.code === '01')!;
  const second = departments.find((d) => d.code === '02')!;
  const category = await api.saveCategory({
    name: '自定义栏目制证',
    fields: [
      ...DEFAULT_FIELDS,
      { ...DEFAULT_FIELDS[0]!, key: 'allowance', name: '津贴', kind: 'calculated' },
    ],
    formulas: [{ name: '津贴计算', target: 'allowance', expression: 'base * 0.1' }],
  });
  const employees = await Promise.all(
    [first, second].map((department, i) =>
      api.saveEmployee({
        code: `MAP${i + 1}`,
        name: `合成映射员工${i + 1}`,
        startDate: '2026-01-01',
        departmentId: department.id,
      }),
    ),
  );
  await api.confirmTax();
  const scheme = (await app.svc.book.info()).codeScheme;
  await app.svc.accounts.create(
    { code: '2241', name: '合成个人扣款', categoryId: 'liability' },
    scheme,
  );
  await app.svc.accounts.create({ code: '222102', name: '合成个人所得税' }, scheme);
  const accountId = async (code: string) => (await app.svc.accounts.require(code)).id;
  const mapping = await api.saveMapping({
    categoryId: category.id,
    mapping: {
      payableAccountId: await accountId('2211'),
      bankAccountId: await accountId('1001'),
      taxAccountId: await accountId('222102'),
      deductionAccountId: await accountId('2241'),
      expenseAccountId: await accountId('6602'),
      amountField: 'gross',
      allocationField: 'department',
    },
  });
  const rows = employees.map((e) => ({
    employeeId: e.id,
    values: { base: 1_000_000, bonus: 20_000, deduction: 5_000 },
    tax: TaxInputSchema.parse({ confirmed: true }),
  }));
  const saved = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows,
  });
  const batch = await api.calculate({ id: saved.id, revision: saved.revision });
  return { category, employees, first, second, mapping, batch, accountId };
}

it('w_pz_sz / w_pz_build_gz 任意工资项及计算项可分别映射，指定部门覆盖默认费用科目，发放仍可用标准设置', async () => {
  const { category, first, second, mapping, batch, accountId } = await setup();
  const expenses = await accountId('6603');
  const rules: VoucherMappingRule[] = [
    {
      kind: 'allocation',
      field: 'allowance',
      debitAccountId: mapping.expenseAccountId,
      creditAccountId: mapping.payableAccountId,
    },
    {
      kind: 'allocation',
      field: 'allowance',
      debitAccountId: expenses,
      creditAccountId: mapping.payableAccountId,
      departmentId: second.id,
    },
    {
      kind: 'allocation',
      field: 'bonus',
      debitAccountId: mapping.expenseAccountId,
      creditAccountId: mapping.payableAccountId,
    },
  ];
  await api.saveMapping({ categoryId: category.id, mapping: { ...mapping, rules } });
  const input = {
    id: batch.id,
    revision: batch.revision,
    date: '2026-01-31',
    kind: 'allocation' as const,
  };
  const plan = await api.preview(input);
  expect(plan.debit).toBe(240_000);
  expect(plan.credit).toBe(240_000);
  expect(plan.lines.filter((l) => l.accountId === expenses).map((l) => l.debit)).toEqual([100_000]);
  expect(
    plan.lines
      .filter((l) => l.accountId === mapping.expenseAccountId)
      .reduce((n, l) => n + (l.debit ?? 0), 0),
  ).toBe(140_000);
  const departmentLines = plan.lines.filter((l) => l.accountId === mapping.expenseAccountId);
  expect(departmentLines.some((l) => l.dimensions?.department === first.id)).toBe(true);
  const payment = await api.preview({ ...input, kind: 'payment' });
  expect(payment.debit).toBe(2_240_000);
  const generated = await api.generate({ ...input, hash: plan.hash });
  const voucher = await app.svc.vouchers.get(generated.vouchers[0]!.id);
  expect(voucher?.source).toEqual({ module: 'payroll', type: 'batch', id: String(batch.id) });
  expect(voucher?.debitTotal).toBe(240_000);
  expect(voucher?.creditTotal).toBe(240_000);
  expect((await api.batch({ id: batch.id })).snapshots).toEqual(batch.snapshots);
});

it('w_pz_sz 自定义规则拒绝未知或停用工资项、重复映射、相同借贷科目、无效部门及非末级科目，失败保持旧设置', async () => {
  const { category, mapping, accountId } = await setup();
  const rule: VoucherMappingRule = {
    kind: 'payment',
    field: 'bonus',
    debitAccountId: mapping.payableAccountId,
    creditAccountId: mapping.bankAccountId,
  };
  const save = (rules: VoucherMappingRule[]) =>
    api.saveMapping({ categoryId: category.id, mapping: { ...mapping, rules } });
  await expect(save([{ ...rule, field: 'not_a_wage' }])).rejects.toThrow('不存在或已停用');
  await expect(save([rule, rule])).rejects.toThrow('不能重复映射');
  await expect(save([{ ...rule, debitAccountId: rule.creditAccountId }])).rejects.toThrow(
    '借贷科目不能相同',
  );
  const partner = (await app.svc.dimensions.getByCode('partner', 'C001'))!;
  await expect(save([{ ...rule, departmentId: partner.id }])).rejects.toThrow('末级部门');
  await expect(save([{ ...rule, debitAccountId: await accountId('1002') }])).rejects.toThrow(
    '末级科目',
  );
  await api.saveCategory({
    ...category,
    fields: category.fields.map((f) => (f.key === 'bonus' ? { ...f, disabled: true } : f)),
  });
  await expect(save([rule])).rejects.toThrow('不存在或已停用');
  expect(await api.mapping({ categoryId: category.id })).toEqual(mapping);
});

it('w_pz_build_gz 自定义规则设置修订使旧预览失效，确认失败不生成或覆盖工资', async () => {
  const { category, mapping, batch } = await setup();
  const rules: VoucherMappingRule[] = [
    {
      kind: 'payment',
      field: 'bonus',
      debitAccountId: mapping.payableAccountId,
      creditAccountId: mapping.bankAccountId,
    },
  ];
  const custom = await api.saveMapping({ categoryId: category.id, mapping: { ...mapping, rules } });
  const input = {
    id: batch.id,
    revision: batch.revision,
    date: '2026-01-31',
    kind: 'payment' as const,
  };
  const preview = await api.preview(input);
  await api.saveMapping({
    categoryId: category.id,
    mapping: { ...custom, rules: [{ ...rules[0]!, field: 'allowance' }] },
  });
  await expect(api.generate({ ...input, hash: preview.hash })).rejects.toThrow('预览已失效');
  expect(await api.batch({ id: batch.id })).toEqual(batch);
  expect((await app.svc.vouchers.list({})).total).toBe(0);
});

it('w_pz_build_gz 缺失历史栏目不得按零制证，负额保留原借贷方向生成红字', async () => {
  const { category, mapping, batch } = await setup();
  const memo = { ...DEFAULT_FIELDS[0]!, key: 'memo', name: '备注金额', role: 'memo' as const };
  const updated = await api.saveCategory({ ...category, fields: [...category.fields, memo] });
  await api.saveMapping({
    categoryId: category.id,
    mapping: {
      ...mapping,
      rules: [
        {
          kind: 'allocation',
          field: 'memo',
          debitAccountId: mapping.expenseAccountId,
          creditAccountId: mapping.payableAccountId,
        },
      ],
    },
  });
  const input = {
    id: batch.id,
    revision: batch.revision,
    date: '2026-01-31',
    kind: 'allocation' as const,
  };
  await expect(api.preview(input)).rejects.toThrow('不在本批次启用栏目内');
  const saved = await api.saveBatch({
    ...batch,
    categoryRevision: updated.revision,
    rows: batch.rows.map((r) => ({ ...r, values: { ...r.values, memo: -1 } })),
  });
  const calculated = await api.calculate({ id: saved.id, revision: saved.revision });
  const plan = await api.preview({ ...input, revision: calculated.revision });
  expect(plan.debit).toBe(-2);
  expect(plan.credit).toBe(-2);
  expect(plan.lines.map((l) => [l.debit, l.credit])).toEqual([
    [-1, 0],
    [0, -1],
    [-1, 0],
    [0, -1],
  ]);
  const generated = await api.generate({
    ...input,
    revision: calculated.revision,
    hash: plan.hash,
  });
  const voucher = await app.svc.vouchers.get(generated.vouchers[0]!.id);
  expect(voucher?.debitTotal).toBe(-2);
  expect(voucher?.creditTotal).toBe(-2);
  expect(voucher?.lines.map((l) => [l.entrySide, l.debit, l.credit])).toEqual([
    ['debit', -1, 0],
    ['credit', 0, -1],
    ['debit', -1, 0],
    ['credit', 0, -1],
  ]);
  expect((await api.batch({ id: batch.id })).snapshots).toEqual(calculated.snapshots);
});

it('w_pz_build_gz 自定义工资项借贷整数分不变量', async () => {
  const { category, mapping, batch } = await setup();
  await api.saveMapping({
    categoryId: category.id,
    mapping: {
      ...mapping,
      rules: [
        {
          kind: 'allocation',
          field: 'bonus',
          debitAccountId: mapping.expenseAccountId,
          creditAccountId: mapping.payableAccountId,
        },
      ],
    },
  });
  let current = batch;
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (bonus) => {
      current = await api.saveBatch({
        ...current,
        categoryRevision: category.revision,
        rows: current.rows.map((r) => ({ ...r, values: { ...r.values, bonus } })),
      });
      current = await api.calculate({ id: current.id, revision: current.revision });
      const plan = await api.preview({
        id: current.id,
        revision: current.revision,
        kind: 'allocation',
        date: '2026-01-31',
      });
      expect(plan.debit).toBe(bonus * 2);
      expect(plan.credit).toBe(plan.debit);
      expect(
        plan.lines.every(
          (line) => Number.isSafeInteger(line.debit) && Number.isSafeInteger(line.credit),
        ),
      ).toBe(true);
    }),
    { numRuns: 12 },
  );
});
