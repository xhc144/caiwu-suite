import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import type { CoreServiceProviders } from '@caiwu/core/server';
import payroll from '../server';
import { DEFAULT_FIELDS, type Batch, type Employee } from '../shared';
import type { PayrollTables } from '../server/migrations';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
});
afterEach(async () => app.close());
async function setup() {
  const api = app.call(payroll),
    departmentId = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  const category = await api.saveCategory({
    name: '合成合并传递',
    fields: [
      ...DEFAULT_FIELDS,
      {
        ...DEFAULT_FIELDS[0]!,
        key: 'days',
        name: '出勤天数',
        kind: 'quantity',
        role: 'memo',
        unit: '天',
        carry: true,
      },
    ],
  });
  const employees: Employee[] = [];
  for (let index = 0; index < 3; index++)
    employees.push(
      await api.saveEmployee({
        code: `CM${index}`,
        name: `合成人员${index}`,
        departmentId,
        startDate: '2026-01-01',
      }),
    );
  await api.confirmTax();
  const pending = await api.saveBatch({
    period: 202601,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: employees.slice(0, 2).map((employee) => ({
      employeeId: employee.id,
      values: { base: 1000000, bonus: 10000 },
      quantities: { days: '21.123456' },
      tax: { confirmed: true },
    })),
  });
  const source = await api.calculate({ id: pending.id, revision: pending.revision });
  const target = await api.saveBatch({
    period: 202602,
    categoryId: category.id,
    categoryRevision: category.revision,
    rows: [
      {
        employeeId: employees[0]!.id,
        values: { base: 0, bonus: 12345 },
        tax: { additional: 10000, confirmed: false },
      },
      {
        employeeId: employees[2]!.id,
        values: { base: 77777 },
        quantities: { days: '1.5' },
        tax: { confirmed: true },
      },
    ],
  });
  return { api, category, employees, source, target };
}
const request = (batch: Batch) => ({ id: batch.id, revision: batch.revision });
describe('w_gz_jz / w_gz_qxfz 人工处理已有下月', () => {
  it('预览不写入；合并只补缺失金额/数量及人员，显式0/下月扣除/额外人员完整保留', async () => {
    const { api, source, target, employees } = await setup();
    await expect(api.close({ ...request(source), confirmed: true })).rejects.toThrow('下月已有');
    const plan = await api.previewCloseMerge(request(source));
    expect(plan.changes.map((change) => change.key)).toEqual([
      `${employees[0]!.id}.days`,
      `${employees[1]!.id}.person`,
      `${employees[1]!.id}.base`,
      `${employees[1]!.id}.days`,
    ]);
    expect(plan.afterPeople).toBe(3);
    expect(await api.batch({ id: source.id })).toEqual(source);
    expect(await api.batch({ id: target.id })).toEqual(target);
    await expect(
      api.applyCloseMerge({ ...request(source), ...plan, confirmed: false }),
    ).rejects.toThrow('须确认');
    const result = await api.applyCloseMerge({ ...request(source), ...plan, confirmed: true });
    expect(result.batch.closed).toBe(true);
    const first = result.next.rows.find((row) => row.employeeId === employees[0]!.id)!;
    expect(first.values).toEqual({ base: 0, bonus: 12345 });
    expect(first.tax).toEqual(target.rows[0]!.tax);
    expect(first.quantities).toEqual({ days: '21.123456' });
    expect(result.next.rows.find((row) => row.employeeId === employees[2]!.id)).toEqual(
      target.rows[1],
    );
    const added = result.next.rows.find((row) => row.employeeId === employees[1]!.id)!;
    expect(added.values).toEqual({ base: 1000000 });
    expect(added.quantities).toEqual({ days: '21.123456' });
    expect(added.tax.confirmed).toBe(false);
    expect(result.next.calculated).toBe(false);
    expect((await app.svc.periods.require(202601)).status).toBe('open');
  });
  it('人事或目标版本变化使预览失效，过期/未授权请求不修改源和下月', async () => {
    const { api, source, target, employees } = await setup();
    const plan = await api.previewCloseMerge(request(source));
    await api.saveEmployee({ ...employees[1]!, name: '已修改合成姓名' });
    await expect(
      api.applyCloseMerge({ ...request(source), ...plan, confirmed: true }),
    ).rejects.toThrow('预览已经失效');
    expect(await api.batch({ id: source.id })).toEqual(source);
    expect(await api.batch({ id: target.id })).toEqual(target);
    const fresh = await api.previewCloseMerge(request(source));
    await expect(
      api.applyCloseMerge({
        ...request(source),
        ...fresh,
        expiresAt: Date.now() - 1,
        confirmed: true,
      }),
    ).rejects.toThrow('过期');
    const limited = app.call(
      payroll,
      await app.addUser('close-reader', { permissions: ['payroll.salary.view'] }),
    );
    await expect(limited.previewCloseMerge(request(source))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      limited.applyCloseMerge({ ...request(source), ...fresh, confirmed: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const changed = await api.saveBatch({
      ...target,
      categoryRevision: target.category.revision,
      rows: target.rows.map((row) => ({ ...row, values: { ...row.values, bonus: 1 } })),
    });
    await expect(
      api.applyCloseMerge({ ...request(source), ...fresh, confirmed: true }),
    ).rejects.toThrow('预览已经失效');
    expect(await api.batch({ id: target.id })).toEqual(changed);
    expect(await api.batch({ id: source.id })).toEqual(source);
  });
  it('合并保存下月后本期冻结失败，金额/数量/版本和日志整笔回滚', async () => {
    const { api, source, target } = await setup();
    const plan = await api.previewCloseMerge(request(source));
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      `CREATE TRIGGER payroll_test_close_failure BEFORE UPDATE OF closed ON payroll_batch WHEN NEW.id=${source.id} BEGIN SELECT RAISE(ABORT,'合成冻结故障'); END`,
    );
    await expect(
      api.applyCloseMerge({ ...request(source), ...plan, confirmed: true }),
    ).rejects.toThrow('合成冻结故障');
    expect(await api.batch({ id: source.id })).toEqual(source);
    expect(await api.batch({ id: target.id })).toEqual(target);
    expect(
      raw
        .prepare("SELECT count(*) AS count FROM operation_log WHERE action='payroll.close.merge'")
        .get(),
    ).toEqual({ count: 0 });
  });
  it('已计算下月有缺值则明确待重算，无缺值合并保留原计算及版本', async () => {
    const { api, source, target, employees } = await setup();
    const full = await api.saveBatch({
      ...target,
      categoryRevision: target.category.revision,
      rows: employees.slice(0, 2).map((employee) => ({
        employeeId: employee.id,
        values: { base: 500000 },
        quantities: { days: '0' },
        tax: { confirmed: true },
      })),
    });
    const computed = await api.calculate(request(full));
    const plan = await api.previewCloseMerge(request(source));
    expect(plan.changes).toEqual([]);
    expect(plan.willRecalculate).toBe(false);
    const result = await api.applyCloseMerge({ ...request(source), ...plan, confirmed: true });
    expect(result.next).toEqual(computed);
  });
  it('w_gz_qxfz 明确保留下月已修改及已计算数据，旧自动回退仍拒绝，反结账不改变账务期间', async () => {
    const { api, source, target, category } = await setup();
    const plan = await api.previewCloseMerge(request(source));
    const closed = await api.applyCloseMerge({ ...request(source), ...plan, confirmed: true });
    const changed = await api.saveBatch({
      ...closed.next,
      categoryRevision: category.revision,
      rows: closed.next.rows.map((row) => ({
        ...row,
        tax: { ...row.tax, additional: 0, confirmed: true },
      })),
    });
    const computed = await api.calculate(request(changed));
    await expect(api.reopen({ ...request(closed.batch), confirmed: true })).rejects.toThrow(
      '下月传递批次已修改',
    );
    const keep = await api.previewReopenKeep(request(closed.batch));
    expect(keep.retainedPeople).toBe(computed.rows.length);
    expect(keep.retainedRows[0]!.fields.some((field) => field.kind === 'quantity')).toBe(true);
    await expect(
      api.applyReopenKeep({ ...request(closed.batch), ...keep, confirmed: false }),
    ).rejects.toThrow('须明确确认');
    const reopened = await api.applyReopenKeep({
      ...request(closed.batch),
      ...keep,
      confirmed: true,
    });
    expect(reopened.closed).toBe(false);
    expect(await api.batch({ id: target.id })).toEqual(computed);
    expect((await app.svc.periods.require(202601)).status).toBe('open');
  });
  it('w_gz_jz 账务期间锁、下月工资结账保护以及反结账最近月份保护不被新入口绕过', async () => {
    const { api, source, target } = await setup();
    await app.svc.periods.setStatus(202602, 'closed');
    await expect(api.previewCloseMerge(request(source))).rejects.toThrow();
    await app.svc.periods.setStatus(202602, 'open');
    const plan = await api.previewCloseMerge(request(source));
    const closed = await api.applyCloseMerge({ ...request(source), ...plan, confirmed: true });
    const nextPending = await api.saveBatch({
      ...closed.next,
      categoryRevision: target.category.revision,
      rows: closed.next.rows.map((row) => ({
        ...row,
        tax: { ...row.tax, additional: 0, confirmed: true },
      })),
    });
    const next = await api.calculate(request(nextPending));
    await api.close({ ...request(next), confirmed: true });
    await expect(api.previewReopenKeep(request(closed.batch))).rejects.toThrow('最近');
    expect((await api.batch({ id: source.id })).closed).toBe(true);
  });
  it('w_gz_jz 下月已生成真实来源凭证禁止合并，不改变本期或下月金额', async () => {
    const { api, source, target, category } = await setup();
    const edited = await api.saveBatch({
      ...target,
      categoryRevision: category.revision,
      rows: target.rows.map((row) => ({
        ...row,
        tax: { ...row.tax, additional: 0, confirmed: true },
      })),
    });
    const calculated = await api.calculate(request(edited));
    const account = async (code: string) => (await app.svc.accounts.require(code)).id;
    await api.saveMapping({
      categoryId: category.id,
      mapping: {
        payableAccountId: await account('2211'),
        bankAccountId: await account('1001'),
        taxAccountId: await account('22210102'),
        deductionAccountId: await account('2211'),
        expenseAccountId: await account('6602'),
        amountField: 'gross',
        allocationField: 'department',
      },
    });
    const preview = await api.preview({
      ...request(calculated),
      kind: 'payment',
      date: '2026-02-28',
    });
    const generated = await api.generate({
      ...request(calculated),
      kind: 'payment',
      date: '2026-02-28',
      hash: preview.hash,
    });
    await expect(api.previewCloseMerge(request(source))).rejects.toThrow('已生成凭证');
    expect(await api.batch({ id: source.id })).toEqual(source);
    expect(await api.batch({ id: target.id })).toEqual(generated);
  });
  it('w_gz_qxfz 来源凭证预览后审核，保留下月入口仍拒绝且工资与来源金额不变', async () => {
    const { api, source, category, target } = await setup();
    const account = async (code: string) => (await app.svc.accounts.require(code)).id;
    await api.saveMapping({
      categoryId: category.id,
      mapping: {
        payableAccountId: await account('2211'),
        bankAccountId: await account('1001'),
        taxAccountId: await account('22210102'),
        deductionAccountId: await account('2211'),
        expenseAccountId: await account('6602'),
        amountField: 'gross',
        allocationField: 'department',
      },
    });
    const preview = await api.preview({ ...request(source), kind: 'payment', date: '2026-01-28' });
    const generated = await api.generate({
      ...request(source),
      kind: 'payment',
      date: '2026-01-28',
      hash: preview.hash,
    });
    const merge = await api.previewCloseMerge(request(generated));
    const closed = await api.applyCloseMerge({ ...request(generated), ...merge, confirmed: true });
    const keep = await api.previewReopenKeep(request(closed.batch));
    await app.svc.vouchers.changeStatus({ ids: [closed.batch.vouchers[0]!.id], to: 'audited' });
    const sourceBefore = await api.batch({ id: source.id }),
      targetBefore = await api.batch({ id: target.id });
    const voucher = await app.svc.vouchers.get(closed.batch.vouchers[0]!.id);
    await expect(
      api.applyReopenKeep({ ...request(closed.batch), ...keep, confirmed: true }),
    ).rejects.toThrow('已审核或过账');
    expect(await api.batch({ id: source.id })).toEqual(sourceBefore);
    expect(await api.batch({ id: target.id })).toEqual(targetBefore);
    expect(await app.svc.vouchers.get(closed.batch.vouchers[0]!.id)).toEqual(voucher);
  });
  it('w_gz_qxfz 宿主工资自锁可正常取消，但其他依赖和会计期间/年度锁仍阻止', async () => {
    await app.close();
    let unrelated = false;
    const provider: NonNullable<CoreServiceProviders['periodDependencies']>[number] = async (
      ctx,
      input,
    ) => {
      if (input.mode !== 'business' || ctx.moduleId !== 'payroll') return [];
      const closed = await ctx.db
        .withTables<PayrollTables>()
        .selectFrom('payroll_period')
        .select('batch_id')
        .where('period', '=', input.period)
        .where('closed', '=', 1)
        .execute();
      return [
        { category: '工资已结账批次', count: closed.length },
        { category: '合成其他阻止项', count: unrelated ? 1 : 0 },
      ];
    };
    const module = {
      ...payroll,
      providers: { ...payroll.providers, periodDependencies: [provider] },
    };
    app = await createTestApp({ modules: [module], product: 'minfei' });
    const { api, source, target } = await setup();
    const merge = await api.previewCloseMerge(request(source));
    const closed = await api.applyCloseMerge({ ...request(source), ...merge, confirmed: true });
    const keep = await api.previewReopenKeep(request(closed.batch));
    unrelated = true;
    await expect(
      api.applyReopenKeep({ ...request(closed.batch), ...keep, confirmed: true }),
    ).rejects.toThrow('合成其他阻止项');
    unrelated = false;
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(
      api.applyReopenKeep({ ...request(closed.batch), ...keep, confirmed: true }),
    ).rejects.toThrow('会计期间已经结账');
    await app.svc.periods.setStatus(202601, 'open');
    await app.svc.db
      .updateTable('fiscal_year')
      .set({ status: 'closed' })
      .where('year', '=', 2026)
      .execute();
    await expect(
      api.applyReopenKeep({ ...request(closed.batch), ...keep, confirmed: true }),
    ).rejects.toThrow('已经年结');
    await app.svc.db
      .updateTable('fiscal_year')
      .set({ status: 'open' })
      .where('year', '=', 2026)
      .execute();
    const nextBefore = await api.batch({ id: target.id });
    const reopened = await api.applyReopenKeep({
      ...request(closed.batch),
      ...keep,
      confirmed: true,
    });
    expect(reopened.closed).toBe(false);
    expect(await api.batch({ id: target.id })).toEqual(nextBefore);
  });
});
