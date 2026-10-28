import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS } from '../shared';

let app: TestApp;
afterEach(async () => app?.close());

it('w_gz_gzgl/w_pz_build_gz 核心已有已审核工资来源但模块链接缺失时禁止读写来源，整账保持原样', async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  const api = app.call(payroll),
    svc = app.svcFor('payroll');
  const department = (await api.departments())[0]!;
  const employee = await api.saveEmployee({
    code: 'SRC001',
    name: '合成来源异常人员',
    startDate: '2026-01-01',
    departmentId: department.id,
  });
  const category = await api.saveCategory({ name: '合成来源异常工资', fields: DEFAULT_FIELDS });
  await api.confirmTax();
  const saved = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [{ employeeId: employee.id, values: { base: 1000000 }, tax: { confirmed: true } }],
  });
  const batch = await api.calculate({ id: saved.id, revision: saved.revision });
  const id = async (code: string) => (await app.svc.accounts.require(code)).id;
  await api.saveMapping({
    categoryId: category.id,
    mapping: {
      payableAccountId: await id('2211'),
      bankAccountId: await id('1001'),
      taxAccountId: await id('1001'),
      deductionAccountId: await id('1001'),
      expenseAccountId: await id('6602'),
      amountField: 'gross',
      allocationField: 'department',
    },
  });
  const input = {
    id: batch.id,
    revision: batch.revision,
    kind: 'allocation' as const,
    date: '2026-01-31',
  };
  const plan = await api.preview(input);
  const voucher = await svc.vouchers.create({
    date: '2026-01-31',
    voucherTypeId: plan.voucherTypeId,
    source: { type: 'batch', id: String(batch.id) },
    lines: plan.lines,
  });
  await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  const dump = () =>
    (
      raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map(({ name }) => ({
      name,
      rows: raw.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all(),
    }));
  const before = dump();
  await expect(api.batch({ id: batch.id })).rejects.toThrow('工资凭证来源关联不一致');
  const changedRows = batch.rows.map((row) => ({
    ...row,
    values: { ...row.values, base: 2000000 },
  }));
  const attempts = [
    () => api.saveBatch({ ...batch, categoryRevision: category.revision, rows: changedRows }),
    () => api.calculate({ id: batch.id, revision: batch.revision }),
    () =>
      api.previewCorrection({
        id: batch.id,
        revision: batch.revision,
        reason: '合成异常来源更正',
        rows: changedRows,
      }),
    () => api.preview(input),
    () => api.generate({ ...input, hash: plan.hash }),
    () => api.close({ id: batch.id, revision: batch.revision, confirmed: true }),
    () =>
      api.revoke({ id: batch.id, revision: batch.revision, kind: 'allocation', confirmed: true }),
  ];
  for (const attempt of attempts) {
    await expect(attempt()).rejects.toThrow('工资凭证来源关联不一致');
    expect(dump()).toEqual(before);
  }
  expect((await app.svc.vouchers.get(voucher.id))?.status).toBe('audited');
});
