import { afterEach, beforeEach, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { type VoucherLineInput } from '@caiwu/core';
import payroll from '../server';
import { DEFAULT_FIELDS } from '../shared';
import { aggregatePayrollLines } from '../server/voucher-extra';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
});
afterEach(async () => app.close());
async function setup(count = 2) {
  const api = app.call(payroll);
  const departments = await api.departments();
  const category = await api.saveCategory({ name: '合成扩展凭证', fields: DEFAULT_FIELDS });
  const employees = [];
  for (let i = 0; i < count; i++)
    employees.push(
      await api.saveEmployee({
        code: `EX${i.toString().padStart(4, '0')}`,
        name: `合成人员${i}`,
        departmentId: departments[i % 2]!.id,
        startDate: '2026-01-01',
      }),
    );
  await api.confirmTax();
  const saved = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: employees.map((e) => ({
      employeeId: e.id,
      values: { base: 1_000_000 },
      tax: { confirmed: true },
    })),
  });
  const batch = await api.calculate({ id: saved.id, revision: saved.revision });
  const accountId = async (code: string) => (await app.svc.accounts.require(code)).id;
  const mapping = await api.saveMapping({
    categoryId: category.id,
    mapping: {
      payableAccountId: await accountId('2211'),
      bankAccountId: await accountId('1001'),
      taxAccountId: await accountId('1001'),
      deductionAccountId: await accountId('1001'),
      expenseAccountId: await accountId('6602'),
      amountField: 'gross',
      allocationField: 'department',
    },
  });
  const input = {
    id: batch.id,
    revision: batch.revision,
    date: '2026-01-31',
    kind: 'allocation' as const,
  };
  return { api, category, employees, batch, mapping, input };
}

it('w_gz_pz / w_pz_build_gz 项目客供个人按科目及人员映射，设置引用保护且档案变更使旧预览失效', async () => {
  const { api, category, employees, mapping, input } = await setup();
  const scheme = (await app.svc.book.info()).codeScheme;
  const expense = await app.svc.accounts.create(
    {
      code: '660201',
      name: '合成多维工资费',
      dimensions: [
        { type: 'department', required: true },
        { type: 'project', required: true },
        { type: 'partner', required: true },
        { type: 'person', required: true },
      ],
    },
    scheme,
  );
  const project = (await app.svc.dimensions.getByCode('project', 'XM01'))!;
  const partner = (await app.svc.dimensions.getByCode('partner', 'C001'))!;
  const person = (await app.svc.dimensions.getByCode('person', 'P01'))!;
  const second = await app.svc.dimensions.create({
    type: 'person',
    code: 'P02',
    name: '合成第二个人',
  });
  const values = { project: project.id, partner: partner.id, person: person.id };
  const configured = await api.saveMapping({
    categoryId: category.id,
    mapping: {
      ...mapping,
      expenseAccountId: expense.id,
      auxiliaries: [
        { accountId: expense.id, values },
        {
          accountId: expense.id,
          employeeId: employees[1]!.id,
          values: { ...values, person: second.id },
        },
      ],
    },
  });
  expect(configured.auxiliaries).toHaveLength(2);
  const plan = await api.preview(input);
  const lines = plan.lines.filter((line) => line.accountId === expense.id);
  expect(lines.map((line) => line.dimensions?.person)).toEqual([person.id, second.id]);
  expect(lines.map((line) => line.dimensions?.project)).toEqual([project.id, project.id]);
  expect(lines.map((line) => line.dimensions?.partner)).toEqual([partner.id, partner.id]);
  expect(lines.map((line) => line.dimensions?.department)).toEqual(
    employees.map((e) => e.departmentId),
  );
  expect(await app.svc.dimensions.references(project.id)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ category: '工资凭证辅助核算映射', count: 1 }),
    ]),
  );
  await app.svc.dimensions.setDisabled(second.id, true, { expectedRevision: second.revision ?? 0 });
  await expect(api.generate({ ...input, hash: plan.hash })).rejects.toThrow('已停用');
  expect((await app.svc.vouchers.list({})).total).toBe(0);
});

it('w_pz_sz 错维度、重复辅助设置及非末级档案被阻止，失败保持原设置', async () => {
  const { api, category, mapping } = await setup();
  const person = (await app.svc.dimensions.getByCode('person', 'P01'))!;
  await expect(
    api.saveMapping({
      categoryId: category.id,
      mapping: {
        ...mapping,
        auxiliaries: [{ accountId: mapping.expenseAccountId, values: { project: person.id } }],
      },
    }),
  ).rejects.toThrow('未启用项目');
  const aux = { accountId: mapping.expenseAccountId, values: {} };
  await expect(
    api.saveMapping({ categoryId: category.id, mapping: { ...mapping, auxiliaries: [aux, aux] } }),
  ).rejects.toThrow('不能重复');
  expect(await api.mapping({ categoryId: category.id })).toEqual(mapping);
});

it('w_pz_build_gz 500人工资超999条按科目和部门汇总后真实生成，工资明细不丢失', async () => {
  const { api, batch, input } = await setup(500);
  const plan = await api.preview(input);
  expect(plan.originalLineCount).toBe(1000);
  expect(plan.aggregated).toBe(true);
  expect(plan.lines).toHaveLength(3);
  expect(plan.debit).toBe(500_000_000);
  expect(plan.credit).toBe(plan.debit);
  const generated = await api.generate({ ...input, hash: plan.hash });
  const voucher = await app.svc.vouchers.get(generated.vouchers[0]!.id);
  expect(voucher?.lines).toHaveLength(3);
  expect(voucher?.debitTotal).toBe(500_000_000);
  expect(generated.snapshots).toEqual(batch.snapshots);
}, 20000);

it('w_pz_build_gz 汇总保留完整辅助、红蓝符号和借贷方向，整数分总额不变', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1_000_000 }), (amount) => {
      const lines: VoucherLineInput[] = Array.from({ length: 1000 }, (_, i) => ({
        accountId: 1,
        summary: '合成分录',
        debit: i % 2 ? -amount : amount,
        credit: 0,
        dimensions: { person: i % 3, department: 1 },
      }));
      const result = aggregatePayrollLines(lines, '合成汇总');
      expect(result.lines).toHaveLength(6);
      expect(result.lines.reduce((n, l) => n + (l.debit ?? 0), 0)).toBe(0);
      expect(
        result.lines.filter((l) => (l.debit ?? 0) > 0).reduce((n, l) => n + (l.debit ?? 0), 0),
      ).toBe(amount * 500);
      expect(result.lines.every((l) => l.credit === 0 && l.dimensions?.department === 1)).toBe(
        true,
      );
    }),
  );
});

it('w_pz_build_gz 撤销预览绑定编号重排，过期版本及审核保护失败全部回滚', async () => {
  const { api, input, batch } = await setup();
  const plan = await api.preview(input);
  const generated = await api.generate({ ...input, hash: plan.hash });
  const source = (await app.svc.vouchers.get(generated.vouchers[0]!.id))!;
  const later = await app.svcFor('payroll').vouchers.create({
    date: '2026-01-31',
    voucherTypeId: source.voucherTypeId,
    lines: [
      {
        accountId: (await app.svc.accounts.require('1001')).id,
        summary: '合成后续现金',
        debit: 100,
      },
      {
        accountId: (await app.svc.accounts.require('2211')).id,
        summary: '合成后续应付',
        credit: 100,
      },
    ],
  });
  expect(later.number).toBe(2);
  const policy = await app.svc.voucherPolicy.get();
  await app.svc.voucherPolicy.set({ ...policy, renumberAfterDelete: true });
  const current = { id: generated.id, revision: generated.revision, kind: 'allocation' as const };
  await expect(api.revoke({ ...current, confirmed: true })).rejects.toThrow('先预览');
  expect((await api.batch({ id: batch.id })).vouchers).toHaveLength(1);
  const deletionPlan = await api.previewRevoke(current);
  expect(deletionPlan.ids).toEqual([generated.vouchers[0]!.id]);
  expect(deletionPlan.impacts).toContainEqual({ id: later.id, oldNumber: 2, number: 1 });
  await expect(
    api.revoke({ ...current, deletionPlan: { ...deletionPlan, ids: [later.id] }, confirmed: true }),
  ).rejects.toThrow('不一致');
  await expect(
    api.revoke({ ...current, deletionPlan: { ...deletionPlan, expiresAt: 0 }, confirmed: true }),
  ).rejects.toThrow('过期');
  expect((await app.svc.vouchers.get(later.id))?.number).toBe(2);
  await expect(
    api.revoke({ ...current, revision: current.revision - 1, deletionPlan, confirmed: true }),
  ).rejects.toThrow('已被其他操作修改');
  expect((await app.svc.vouchers.list({})).total).toBe(2);
  const voucherId = generated.vouchers[0]!.id;
  await app.svc.vouchers.changeStatus({ ids: [voucherId], to: 'audited' });
  await expect(api.previewRevoke(current)).rejects.toThrow('已审核');
  await expect(api.revoke({ ...current, deletionPlan, confirmed: true })).rejects.toThrow('已审核');
  expect((await api.batch({ id: batch.id })).vouchers).toHaveLength(1);
  await app.svc.vouchers.changeStatus({ ids: [voucherId], to: 'pending' });
  await expect(api.revoke({ ...current, deletionPlan, confirmed: true })).rejects.toThrow('已变化');
  expect((await api.batch({ id: batch.id })).vouchers).toHaveLength(1);
  const freshPlan = await api.previewRevoke(current);
  const revoked = await api.revoke({ ...current, deletionPlan: freshPlan, confirmed: true });
  expect(revoked.vouchers).toEqual([]);
  expect(revoked.snapshots).toEqual(batch.snapshots);
  expect((await app.svc.vouchers.list({})).total).toBe(1);
  expect((await app.svc.vouchers.get(later.id))?.number).toBe(1);
});
