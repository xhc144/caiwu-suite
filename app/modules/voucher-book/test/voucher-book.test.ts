import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { sql } from '@caiwu/db';
import { type Voucher, type VoucherInput } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import server from '../server';
import {
  BookFilterSchema,
  PreviewSchema,
  type Action,
  type PreviewInput,
  type Transfer,
} from '../shared';
import { checkedInput, copiedInput, computerDeletionReason } from '../server/service';

let app: TestApp;
const caller = (token?: string) => app.call(server, token);
let api: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
  api = caller();
});
afterEach(async () => {
  await app.close();
});
async function seed(amount = 1, count = 1) {
  return seedVouchers(
    app.svc,
    Array.from({ length: count }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      lines: [
        { account: '6603', debit: amount },
        { account: '1001', credit: amount },
      ],
    })),
  );
}
async function auditor() {
  return caller(
    await app.addUser('B', {
      permissions: ['voucher-book.view', 'voucher-book.audit', 'voucher-book.unaudit'],
    }),
  );
}
async function plan(action: Action, ids: number[], more: Partial<PreviewInput> = {}) {
  return api.preview[action]({ action, selection: { ids }, ...more });
}
async function count() {
  return (await app.svc.vouchers.list({ includeVoided: true })).total;
}
async function snapshot() {
  return {
    vouchers: await app.svc.db.selectFrom('voucher').selectAll().orderBy('id').execute(),
    lines: await app.svc.db.selectFrom('voucher_line').selectAll().orderBy('id').execute(),
    logs: await app.svc.db.selectFrom('operation_log').selectAll().orderBy('id').execute(),
  };
}
async function input(): Promise<VoucherInput> {
  return voucherInputFromSpec(app.svc, {
    date: '2026-01-05',
    lines: [
      { account: '6603', debit: 1 },
      { account: '1001', credit: 1 },
    ],
  });
}
async function transfer(v: Voucher): Promise<Transfer> {
  return JSON.parse((await api.export({ filter: { id: v.id }, format: 'json' })).file) as Transfer;
}
async function setCashDirection(code: string, direction: string) {
  const item = (await app.svc.dimensions.getByCode('cashflow', code))!;
  await app.svc.db
    .updateTable('dimension_item')
    .set({ attrs: JSON.stringify({ cashflowDirection: direction }) })
    .where('id', '=', item.id)
    .execute();
  return item.id;
}

describe('w_pz_tjsh / w_pz_pzxsb 审核与取消审核', () => {
  it('w_pz_tjsh 本人逐项跳过，跨人审核成功；审核人由服务端身份确定', async () => {
    const vs = await seed(1, 2);
    const mine = await plan(
      'audit',
      vs.map((v) => v.id),
    );
    expect(mine).toMatchObject({ eligibleCount: 0, skippedCount: 2 });
    expect(mine.rows.every((r) => r.reasons.some((x) => x.includes('制单人')))).toBe(true);
    await expect(api.commit({ token: mine.token, confirmed: true })).rejects.toThrow(
      /没有合格凭证/,
    );
    const b = await auditor();
    const p = await b.preview.audit({ action: 'audit', selection: { ids: vs.map((v) => v.id) } });
    expect(p.rows.every((r) => r.warnings.some((x) => x.includes('第2行')))).toBe(true);
    await expect(b.commit({ token: p.token, confirmed: true })).rejects.toThrow(/现金流量/);
    expect((await app.svc.vouchers.get(vs[0]!.id))!.status).toBe('pending');
    expect(
      await b.commit({ token: p.token, confirmed: true, cashflowConfirmed: true }),
    ).toMatchObject({ successCount: 2, skippedCount: 0 });
    for (const v of vs)
      expect(await app.svc.vouchers.get(v.id)).toMatchObject({
        status: 'audited',
        auditedBy: { name: 'B' },
      });
    const back = await b.preview.unaudit({
      action: 'unaudit',
      selection: { ids: vs.map((v) => v.id) },
    });
    await b.commit({ token: back.token, confirmed: true });
    for (const v of vs)
      expect(await app.svc.vouchers.get(v.id)).toMatchObject({
        status: 'pending',
        auditedBy: null,
        auditedAt: null,
      });
  });
  it('w_pz_tjsh 混合批次跳过本人而合格集合一次成功，成功数准确', async () => {
    const [mine] = await seed();
    await app.addUser('A');
    const aId = (
      await app.svc.db
        .selectFrom('app_user')
        .select('id')
        .where('code', '=', 'A')
        .executeTakeFirstOrThrow()
    ).id;
    const user = (await loadServiceUser(app.svc.db, aId))!;
    const otherSvc = createCoreServices({ ...app.svc.ctx, user });
    const [other] = await seedVouchers(otherSvc, [
      {
        date: '2026-01-01',
        lines: [
          { account: '6603', debit: 1 },
          { account: '1001', credit: 1 },
        ],
      },
    ]);
    const p = await plan('audit', [mine!.id, other!.id]);
    expect(p).toMatchObject({ eligibleCount: 1, skippedCount: 1 });
    expect(
      await api.commit({ token: p.token, confirmed: true, cashflowConfirmed: true }),
    ).toMatchObject({ successCount: 1, skippedCount: 1 });
    expect((await app.svc.vouchers.get(mine!.id))!.status).toBe('pending');
    expect((await app.svc.vouchers.get(other!.id))!.status).toBe('audited');
  });
  it('w_pz_tjsh 无候选、未选操作模式、未确认均阻止', async () => {
    expect(PreviewSchema.safeParse({ selection: { ids: [] } }).success).toBe(false);
    await expect(plan('audit', [])).rejects.toThrow(/没有可操作/);
    const [v] = await seed();
    const p = await plan('delete', [v!.id]);
    await expect(api.commit({ token: p.token, confirmed: false as true })).rejects.toThrow();
    expect(await count()).toBe(1);
  });
  it('w_pz_tjsh 未授权用户不能预检/确认/导出，不能伪造其它操作员预览', async () => {
    const [v] = await seed();
    const p = await plan('delete', [v!.id]);
    const viewer = caller(await app.addUser('viewer', { permissions: ['voucher-book.view'] }));
    await expect(
      viewer.preview.audit({ action: 'audit', selection: { ids: [v!.id] } }),
    ).rejects.toThrow(/权限/);
    await expect(
      viewer.preview.delete({ action: 'delete', selection: { ids: [v!.id] } }),
    ).rejects.toThrow(/权限/);
    await expect(viewer.commit({ token: p.token, confirmed: true })).rejects.toThrow(/其它操作员/);
    await expect(viewer.export({ filter: {}, format: 'json' })).rejects.toThrow(/权限/);
    const nobody = caller(await app.addUser('nobody'));
    await expect(nobody.list({})).rejects.toThrow(/权限/);
  });
  it('w_pz_tjsh revision变化或期间关闭使旧现金流确认失效', async () => {
    const [v] = await seed();
    const b = await auditor();
    const p = await b.preview.audit({ action: 'audit', selection: { ids: [v!.id] } });
    await app.svc.vouchers.update(v!.id, copiedInput(v!), { expectedRevision: v!.revision });
    await expect(
      b.commit({ token: p.token, confirmed: true, cashflowConfirmed: true }),
    ).rejects.toThrow(/已变更/);
    const p2 = await b.preview.audit({ action: 'audit', selection: { ids: [v!.id] } });
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(
      b.commit({ token: p2.token, confirmed: true, cashflowConfirmed: true }),
    ).rejects.toThrow(/资格已变化/);
    expect((await app.svc.vouchers.get(v!.id))!.status).toBe('pending');
  });
  it('w_pz_tjsh 现金流方向明确冲突禁止，旧项无法核验单独提示，非法项目禁止', async () => {
    const [v] = await seed();
    const cf = await setCashDirection('CF01', 'inflow');
    const next = copiedInput(v!);
    next.lines[1]!.dimensions = { cashflow: cf };
    await app.svc.vouchers.update(v!.id, next, { expectedRevision: v!.revision });
    const b = await auditor();
    const p = await b.preview.audit({ action: 'audit', selection: { ids: [v!.id] } });
    expect(p.rows[0]!.reasons.join()).toMatch(/第2行.*方向.*冲突/);
    await app.svc.db
      .updateTable('dimension_item')
      .set({ attrs: '{}' })
      .where('id', '=', cf)
      .execute();
    const unknown = await b.preview.audit({ action: 'audit', selection: { ids: [v!.id] } });
    expect(unknown.rows[0]!.warnings.join()).toMatch(/无法核验/);
    await app.svc.db
      .updateTable('dimension_item')
      .set({ disabled: 1 })
      .where('id', '=', cf)
      .execute();
    const invalid = await b.preview.audit({ action: 'audit', selection: { ids: [v!.id] } });
    expect(invalid.rows[0]!.reasons.join()).toMatch(/停用/);
  });
  it('w_pz_tjsh 非pending、作废、已过账与已结账逐项解释，不越过反过账', async () => {
    const vs = await seed(1, 4);
    await app.svc.vouchers.changeStatus({ ids: [vs[0]!.id, vs[1]!.id], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [vs[1]!.id], to: 'posted' });
    await app.svc.vouchers.setVoided(vs[2]!.id, true);
    const b = await auditor();
    const p = await b.preview.audit({ action: 'audit', selection: { ids: vs.map((v) => v.id) } });
    expect(p).toMatchObject({ eligibleCount: 1, skippedCount: 3 });
    const back = await b.preview.unaudit({ action: 'unaudit', selection: { ids: [vs[1]!.id] } });
    expect(back.rows[0]!.reasons.join()).toMatch(/先去期间处理反过账/);
    expect(back.rows[0]!.periodUrl).toBe('/m/period-close?period=202601');
    await app.svc.periods.setStatus(202601, 'closed');
    expect(
      (await b.preview.unaudit({ action: 'unaudit', selection: { ids: [vs[0]!.id] } }))
        .eligibleCount,
    ).toBe(0);
  });
  it('w_pz_tjsh 运行时失败，合格批次与日志全部回滚，不返回假成功', async () => {
    const vs = await seed(1, 2);
    const b = await auditor();
    const p = await b.preview.audit({ action: 'audit', selection: { ids: vs.map((v) => v.id) } });
    await sql`CREATE TRIGGER voucher_book_test_fail BEFORE UPDATE OF status ON voucher WHEN NEW.id = ${sql.lit(vs[1]!.id)} BEGIN SELECT RAISE(ABORT, '测试事务故障'); END`.execute(
      app.svc.db,
    );
    const before = await snapshot();
    await expect(
      b.commit({ token: p.token, confirmed: true, cashflowConfirmed: true }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it('w_pz_tjsh 重复点击同一确认只变更一次revision和日志', async () => {
    const [v] = await seed();
    const b = await auditor();
    const p = await b.preview.audit({ action: 'audit', selection: { ids: [v!.id] } });
    const args = { token: p.token, confirmed: true as const, cashflowConfirmed: true };
    const first = await b.commit(args);
    const before = await snapshot();
    expect(await b.commit(args)).toEqual(first);
    expect(await snapshot()).toEqual(before);
  });
});
describe('w_pz_tjdel / w_pz_pzxsb 删除、作废与来源保护', () => {
  it('w_pz_tjdel 删除先预览，取消不变；确认后保留断号、不暗中重排', async () => {
    const vs = await seed(1, 3);
    const before = await snapshot();
    const p = await plan('delete', [vs[1]!.id]);
    expect(await snapshot()).toEqual(before);
    expect(p.warnings.join()).toMatch(/编号将空出/);
    await api.commit({ token: p.token, confirmed: true });
    expect((await app.svc.vouchers.list({})).items.map((v) => v.number)).toEqual([1, 3]);
  });
  it('w_pz_tjdel 计算机编号同月同类型且最高号策略保留，W0不擅自启用', async () => {
    const vs = await seed(1, 3);
    expect(computerDeletionReason([vs[0]!], vs)).toMatch(/最高号/);
    expect(computerDeletionReason([vs[2]!], vs)).toBeNull();
    expect(computerDeletionReason([vs[0]!, { ...vs[1]!, period: 202602 }], vs)).toMatch(
      /同月同类型/,
    );
  });
  it('w_pz_pzxsb 审核/过账/来源/作废只读原因和来源跳转，打开不取消审核', async () => {
    const v = await app
      .svcFor('voucher-book')
      .vouchers.create({ ...(await input()), source: { type: 'reversal', id: '1' } });
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    const before = await snapshot();
    const d = await api.detail({ id: v.id });
    expect(d.readonlyReasons.join()).toMatch(/已审核.*来源页面/);
    expect(d.sourceUrl).toBe('/m/voucher-book/?id=1');
    expect(await snapshot()).toEqual(before);
  });
  it('w_pz_tjdel 他模块来源不可删、不可作废，已审核不可删，闭账不可写', async () => {
    const foreign = await app
      .svcFor('cashier')
      .vouchers.create({ ...(await input()), source: { type: 'document', id: '1' } });
    for (const action of ['delete', 'void'] as const)
      expect((await plan(action, [foreign.id])).rows[0]!.reasons.join()).toMatch(/其他业务生成/);
    const [v] = await seed();
    await app.svc.vouchers.changeStatus({ ids: [v!.id], to: 'audited' });
    expect((await plan('delete', [v!.id])).eligibleCount).toBe(0);
    await app.svc.periods.setStatus(202601, 'closed');
    expect((await plan('void', [v!.id])).eligibleCount).toBe(0);
  });
  it('w_pz_pzxsb 作废保留编号、分录，默认排除；草稿和已过账阻止', async () => {
    const [v] = await seed();
    const p = await plan('void', [v!.id]);
    await api.commit({ token: p.token, confirmed: true });
    const voided = (await app.svc.vouchers.get(v!.id))!;
    expect(voided.number).toBe(v!.number);
    expect(voided.lines).toEqual(v!.lines);
    expect((await api.list({})).total).toBe(0);
    expect((await api.list({ includeVoided: true })).total).toBe(1);
    const back = await plan('unvoid', [v!.id]);
    await api.commit({ token: back.token, confirmed: true });
    const draft = await app.svc.vouchers.create({ ...(await input()), draft: true });
    expect((await plan('void', [draft.id])).rows[0]!.reasons.join()).toMatch(/草稿不需要作废/);
    await app.svc.vouchers.changeStatus({ ids: [v!.id], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [v!.id], to: 'posted' });
    expect((await plan('void', [v!.id])).rows[0]!.reasons.join()).toMatch(/已过账/);
  });
});
describe('w_pzedit_copy / w_pzedit_fc / w_pz_bhzl / 插入', () => {
  it('w_pzedit_copy 新pending当前制单人，新号，不复制来源/审核人/冲销链，原件不变', async () => {
    const v = await app
      .svcFor('cashier')
      .vouchers.create({ ...(await input()), source: { type: 'document', id: '1' } });
    const before = await app.svc.vouchers.get(v.id);
    const p = await plan('copy', [v.id], { date: '2026-02-03', voucherTypeId: v.voucherTypeId });
    expect(await count()).toBe(1);
    const r = await api.commit({ token: p.token, confirmed: true });
    expect(await app.svc.vouchers.get(r.createdIds[0]!)).toMatchObject({
      date: '2026-02-03',
      number: 1,
      status: 'pending',
      source: null,
      reversalOfId: null,
      auditedBy: null,
      postedBy: null,
      createdBy: { id: app.svc.user.id },
      revision: 1,
    });
    expect(await app.svc.vouchers.get(v.id)).toEqual(before);
  });
  it('w_pzedit_copy 原件不存在有提示，目标闭账与停用科目不能绕过保存检查', async () => {
    await expect(plan('copy', [999], { date: '2026-02-01', voucherTypeId: 1 })).rejects.toThrow(
      /原凭证不存在/,
    );
    const [v] = await seed();
    await app.svc.periods.setStatus(202602, 'closed');
    await expect(
      plan('copy', [v!.id], { date: '2026-02-01', voucherTypeId: v!.voucherTypeId }),
    ).rejects.toThrow(/已经结账/);
    await app.svc.db
      .updateTable('account')
      .set({ disabled: 1 })
      .where('id', '=', v!.lines[0]!.accountId)
      .execute();
    await expect(
      plan('copy', [v!.id], { date: '2026-01-01', voucherTypeId: v!.voucherTypeId }),
    ).rejects.toThrow(/已停用/);
  });
  it('w_pzedit_fc 同向红字1分、外币与数量取反，汇率单价不取反，双向关联且幂等', async () => {
    await app.svc.accounts.create(
      { code: '100203', name: '外币数量测试', currency: 'USD', quantityUnit: '件' },
      [4, 2, 2],
    );
    const [v] = await seedVouchers(app.svc, [
      {
        date: '2026-01-01',
        lines: [
          {
            account: '100203',
            debit: 1,
            currency: 'USD',
            rate: '7.1',
            fcAmount: 1,
            quantity: '1.25',
            unitPrice: '0.008',
          },
          { account: '6603', credit: 1 },
        ],
      },
    ]);
    const before = await app.svc.vouchers.get(v!.id);
    const p = await plan('reverse', [v!.id], {
      date: '2026-02-01',
      voucherTypeId: v!.voucherTypeId,
    });
    expect(p.generatedDebit).toBe(-1);
    const r = await api.commit({ token: p.token, confirmed: true });
    const reverse = (await app.svc.vouchers.get(r.createdIds[0]!))!;
    expect(reverse).toMatchObject({
      reversalOfId: v!.id,
      status: 'pending',
      source: { module: 'voucher-book', type: 'reversal', id: String(v!.id) },
    });
    expect(reverse.lines[0]).toMatchObject({
      debit: -1,
      credit: 0,
      fcAmount: -1,
      quantity: '-1.25',
      exchangeRate: '7.1',
      unitPrice: '0.008',
    });
    expect(reverse.lines[1]).toMatchObject({ debit: 0, credit: -1 });
    expect((await api.detail({ id: v!.id })).reversals[0]!.id).toBe(reverse.id);
    expect(await app.svc.vouchers.get(v!.id)).toEqual(before);
    expect(await api.commit({ token: p.token, confirmed: true })).toEqual(r);
    expect(await count()).toBe(2);
  });
  it('w_pz_pzxsb 插入必须完整平衡输入，预览/取消不变，腾号与create失败全部回滚', async () => {
    const vs = await seed(1, 3);
    const v = vs[1]!;
    const before = await snapshot();
    await expect(plan('insert', [v.id])).rejects.toThrow(/完整平衡分录/);
    const p = await plan('insert', [v.id], { input: copiedInput(v) });
    expect(await snapshot()).toEqual(before);
    expect(p.mappings.map((m) => [m.from, m.to])).toEqual([
      [2, 3],
      [3, 4],
    ]);
    await expect(api.commit({ token: p.token, confirmed: true })).rejects.toThrow(/编号变动/);
    await sql`CREATE TRIGGER voucher_book_test_insert BEFORE INSERT ON voucher BEGIN SELECT RAISE(ABORT, '测试插入故障'); END`.execute(
      app.svc.db,
    );
    await expect(
      api.commit({ token: p.token, confirmed: true, numberingConfirmed: true }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await sql`DROP TRIGGER voucher_book_test_insert`.execute(app.svc.db);
    const r = await api.commit({ token: p.token, confirmed: true, numberingConfirmed: true });
    expect((await app.svc.vouchers.get(r.createdIds[0]!))!.number).toBe(2);
    expect((await app.svc.vouchers.list({})).items.map((x) => x.number)).toEqual([1, 2, 3, 4]);
  });
  it('w_pz_bhzl 稳定排序、作废参与，草稿不编号，前后映射入日志', async () => {
    const vs = await seed(1, 3);
    await app.svc.vouchers.setNumbers(vs.map((v, i) => ({ id: v.id, number: (i + 1) * 2 })));
    await app.svc.vouchers.setVoided(vs[1]!.id, true);
    const draft = await app.svc.vouchers.create({ ...(await input()), draft: true });
    const before = await snapshot();
    const p = await plan('renumber', [], {
      period: 202601,
      voucherTypeId: vs[0]!.voucherTypeId,
      byDate: true,
    });
    expect(await snapshot()).toEqual(before);
    expect(p.mappings.map((m) => m.to)).toEqual([1, 2, 3]);
    await api.commit({ token: p.token, confirmed: true, numberingConfirmed: true });
    expect((await app.svc.vouchers.get(draft.id))!.number).toBeNull();
    expect(
      (await app.svc.vouchers.list({ includeVoided: true })).items
        .filter((v) => v.number != null)
        .map((v) => v.number),
    ).toEqual([1, 2, 3]);
    const logs = await app.svc.db
      .selectFrom('operation_log')
      .selectAll()
      .where('action', '=', 'voucher-book.number.mapping')
      .execute();
    expect(JSON.stringify(logs)).toContain('mappings');
  });
  it('w_pz_bhzl 并发插入、闭账令旧映射失效；唯一冲突不留下临时负号', async () => {
    const [v] = await seed();
    const p = await plan('renumber', [], { period: 202601, voucherTypeId: v!.voucherTypeId });
    await seed();
    const before = await snapshot();
    await expect(
      api.commit({ token: p.token, confirmed: true, numberingConfirmed: true }),
    ).rejects.toThrow(/编号集合已变化/);
    expect(await snapshot()).toEqual(before);
    await expect(app.svc.vouchers.setNumbers([{ id: v!.id, number: 2 }])).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(
      plan('renumber', [], { period: 202601, voucherTypeId: v!.voucherTypeId }),
    ).rejects.toThrow(/已经结账/);
  });
});
describe('w_pz_pzxsb_see / w_pz_zhcx 查询及汇总', () => {
  it('w_pz_pzxsb 金额/摘要/科目筛选与总数分页同口径，超过默认500仍遍历查询全范围', async () => {
    await seed(1, 5);
    await seed(2, 3);
    const f = {
      amountFrom: 2,
      amountTo: 2,
      accountCode: '1001',
      summaryContains: '测试',
      limit: 2,
      offset: 0,
    };
    expect(await api.list(f)).toMatchObject({ total: 3, items: expect.any(Array) });
    expect((await api.list(f)).items).toHaveLength(2);
    expect((await api.list({ ...f, offset: 2 })).items).toHaveLength(1);
    expect((await api.list({ amountFrom: 3 })).total).toBe(0);
    await expect(api.list({ accountCode: 'not-existing' })).rejects.toThrow(/科目.*不存在/);
    expect(BookFilterSchema.safeParse({ amountFrom: 2, amountTo: 1 }).success).toBe(false);
  });
  it.each([
    { field: 'amount', operator: 'contains', value: '1' },
    { field: 'number', operator: 'eq', value: '1.5' },
    { field: 'date', operator: 'eq', value: '2026-02-30' },
    { field: 'unknown', operator: 'eq', value: 'x' },
    { field: 'summary', operator: 'raw SQL', value: 'x' },
  ])('w_pz_zhcx 非法类型/操作符拒绝，不能忽略后查询全部：%j', async (condition) => {
    expect(BookFilterSchema.safeParse({ conditions: [condition] }).success).toBe(false);
    await expect(api.list({ conditions: [condition as never] })).rejects.toThrow();
  });
  it('w_pz_kmhz / w_pz_ttsee 汇总只取所选凭证发生，含1分，不含草稿作废或期初；丁字账必须选科目', async () => {
    const vs = await seed(1, 2);
    await app.svc.vouchers.setVoided(vs[1]!.id, true);
    await app.svc.vouchers.create({ ...(await input()), draft: true });
    const rows = await api.summary({ filter: {}, level: 'root', foreign: true });
    expect(rows.find((r) => r.code === '1001')).toMatchObject({
      debit: 0,
      credit: 1,
      fcCredit: 1,
      currency: 'CNY',
    });
    await expect(api.tAccount({})).rejects.toThrow(/没有选择科目/);
    expect(await api.tAccount({ accountCode: '6603' })).toHaveLength(1);
    expect(await api.tAccount({ accountCode: '6602' })).toEqual([]);
    expect(await api.summary({ filter: { statuses: ['posted'] } })).toEqual([]);
  });
});
describe('w_pz_get 导入/导出', () => {
  it('w_pz_get Excel与结构文本往返全部字段，原号冲突明确阻止，自动编号原子写入', async () => {
    const [v] = await seed();
    const f = await api.export({ filter: { id: v!.id }, format: 'xlsx' });
    const before = await snapshot();
    const p = await api.importPreview({
      file: f.file,
      format: 'xlsx',
      targetDate: '2026-02-01',
      numbering: 'auto',
    });
    expect(p).toMatchObject({ validCount: 1, errorCount: 0 });
    expect(await snapshot()).toEqual(before);
    const r = await api.importCommit({ token: p.token, confirmed: true });
    const copied = (await app.svc.vouchers.get(r.createdIds[0]!))!;
    expect(copied.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual(
      v!.lines.map((l) => [l.accountCode, l.debit, l.credit]),
    );
    expect(copied).toMatchObject({
      date: '2026-02-01',
      status: 'pending',
      source: null,
      auditedBy: null,
    });
    const collision = await api.importPreview({
      file: f.file,
      format: 'xlsx',
      numbering: 'original',
    });
    expect(collision.rows[0]!.errors.join()).toMatch(/已经有编号/);
  });
  it.each(['', 'not json'])('w_pz_get 无文件或无法读取明确阻止：%s', async (file) => {
    await expect(api.importPreview({ file, format: 'json' })).rejects.toThrow();
    expect(await count()).toBe(0);
  });
  it('w_pz_get 空范围、无效日期、编号>10000、不存在/非末级科目、重复号逐凭证提示，无半批写入', async () => {
    const [v] = await seed();
    const data = await transfer(v!);
    data.vouchers = [
      { ...data.vouchers[0]!, key: 'bad-date', date: '2026-02-30' },
      { ...data.vouchers[0]!, key: 'too-big', number: 10001 },
      {
        ...data.vouchers[0]!,
        key: 'parent',
        number: 7,
        lines: data.vouchers[0]!.lines.map((l, i) => (i === 0 ? { ...l, account: '1002' } : l)),
      },
      {
        ...data.vouchers[0]!,
        key: 'missing',
        number: 8,
        lines: data.vouchers[0]!.lines.map((l, i) => (i === 0 ? { ...l, account: 'not-here' } : l)),
      },
      { ...data.vouchers[0]!, key: 'valid', number: 9 },
      { ...data.vouchers[0]!, key: 'duplicate', number: 9 },
    ];
    const file = JSON.stringify(data);
    const p = await api.importPreview({ file, format: 'json', numbering: 'original' });
    expect(p.errorCount).toBe(5);
    expect(p.validCount).toBe(1);
    const before = await snapshot();
    await expect(api.importCommit({ token: p.token, confirmed: true })).rejects.toThrow(/仍有错误/);
    expect(await snapshot()).toEqual(before);
    const valid = await api.importPreview({
      file,
      format: 'json',
      numbering: 'original',
      onlyValid: true,
    });
    expect(await api.importCommit({ token: valid.token, confirmed: true })).toMatchObject({
      successCount: 1,
      skippedCount: 5,
    });
    await expect(api.importPreview({ file, format: 'json', from: 999 })).rejects.toThrow(
      /没有凭证/,
    );
  });
  it('w_pz_get 保留原日验证目标月份，101项错误停止且提供清单', async () => {
    const [v] = await seed();
    const data = await transfer(v!);
    data.vouchers[0]!.date = '2026-01-31';
    const p = await api.importPreview({
      file: JSON.stringify(data),
      format: 'json',
      targetDate: '2026-02-01',
      keepDay: true,
    });
    expect(p.rows[0]!.errors.join()).toMatch(/2026-02-31.*不存在/);
    data.vouchers = Array.from({ length: 101 }, (_, i) => ({
      ...data.vouchers[0]!,
      key: String(i),
      date: 'invalid',
    }));
    const errors = await api.importPreview({
      file: JSON.stringify(data),
      format: 'json',
      onlyValid: true,
    });
    expect(errors).toMatchObject({ stopped: true, errorCount: 101 });
    expect(errors.rows).toHaveLength(101);
    await expect(api.importCommit({ token: errors.token, confirmed: true })).rejects.toThrow(
      /超过100项/,
    );
    expect(await count()).toBe(1);
  });
  it('w_pz_get 已审核/过账/来源同号不覆盖；确认前出现新同号时整批回滚', async () => {
    const [v] = await seed();
    const data = await transfer(v!);
    data.vouchers = [
      { ...data.vouchers[0]!, key: 'a', number: 3 },
      { ...data.vouchers[0]!, key: 'b', number: 4 },
    ];
    const p = await api.importPreview({
      file: JSON.stringify(data),
      format: 'json',
      numbering: 'original',
    });
    await app.svc.vouchers.create({ ...(await input()), number: 4 });
    const before = await snapshot();
    await expect(api.importCommit({ token: p.token, confirmed: true })).rejects.toThrow(
      /已经有编号/,
    );
    expect(await snapshot()).toEqual(before);
    await app.svc.vouchers.changeStatus({ ids: [v!.id], to: 'audited' });
    const invalid = await api.importPreview({
      file: JSON.stringify(await transfer(v!)),
      format: 'json',
      numbering: 'original',
    });
    expect(invalid.validCount).toBe(0);
  });
});

describe('w_pz_plxg / w_pz_get 补充事务与完整范围', () => {
  it('w_pz_pzxsb / w_pz_tjsh 超过500条查询范围仍完整预检，分页、总数与汇总一致', async () => {
    await app.svc.tx(async (t) => {
      await seedVouchers(
        t,
        Array.from({ length: 507 }, (_, i) => ({
          date: '2026-01-01',
          summary: `完整范围${i}`,
          lines: [
            { account: '6603', debit: i < 505 ? 1 : 2 },
            { account: '1001', credit: i < 505 ? 1 : 2 },
          ],
        })),
      );
    });
    const f = {
      periodFrom: 202601,
      periodTo: 202601,
      amountFrom: 1,
      amountTo: 1,
      limit: 10,
      offset: 500,
    };
    expect(await api.list(f)).toMatchObject({ total: 505 });
    expect((await api.list(f)).items).toHaveLength(5);
    const b = await auditor();
    const p = await b.preview.audit({ action: 'audit', selection: { filter: f } });
    expect(p.rows).toHaveLength(505);
    expect(p.eligibleCount).toBe(505);
    const rows = await api.summary({ filter: f });
    expect(rows.find((r) => r.code === '6603')!.debit).toBe(505);
  });
  it('w_pz_zhcx 摘要不含有必须所有分录均不含，百分号按字面查询，非法过滤不能降级', async () => {
    const v = await app.svc.vouchers.create({
      ...(await input()),
      lines: [
        { summary: '含有关键字', accountId: (await app.svc.accounts.require('6603')).id, debit: 1 },
        { summary: '另外一行', accountId: (await app.svc.accounts.require('1001')).id, credit: 1 },
      ],
    });
    expect(
      (
        await api.list({
          conditions: [{ field: 'summary', operator: 'notContains', value: '关键字' }],
        })
      ).total,
    ).toBe(0);
    expect((await api.list({ summaryContains: '%' })).total).toBe(0);
    const to = await api.ledgerLink({ id: v.id, lineId: v.lines[0]!.id });
    const params = new URL('http://localhost' + to).searchParams;
    expect(params.get('account')).toBe('6603');
    expect(params.get('from')).toBe('202601');
    expect(params.get('dims')).toContain('cashflow');
    await expect(api.ledgerLink({ id: v.id, lineId: 999999 })).rejects.toThrow(
      /科目不存在或分录已变更/,
    );
  });
  it('w_pz_tjdel 删除与明确选择的整理同事务，实际展示断号；故障后删除也回滚', async () => {
    const vs = await seed(1, 3);
    const p = await plan('delete', [vs[1]!.id], { compactAfter: true });
    expect(p.warnings.join()).toMatch(/删除后断号：2/);
    expect(p.mappings.find((m) => m.id === vs[2]!.id)).toMatchObject({ from: 3, to: 2 });
    const before = await snapshot();
    await sql`CREATE TRIGGER voucher_book_compact_failure BEFORE UPDATE OF number ON voucher BEGIN SELECT RAISE(ABORT, '删除后整理故障'); END`.execute(
      app.svc.db,
    );
    await expect(
      api.commit({ token: p.token, confirmed: true, numberingConfirmed: true }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await sql`DROP TRIGGER voucher_book_compact_failure`.execute(app.svc.db);
    await api.commit({ token: p.token, confirmed: true, numberingConfirmed: true });
    expect((await app.svc.vouchers.list({})).items.map((v) => v.number)).toEqual([1, 2]);
  });
  it('w_pzedit_fc 两个并发反冲预览只能执行一个；重新预览明确提示再次冲销', async () => {
    const [v] = await seed();
    const itemId = await setCashDirection('CF01', 'inflow');
    const args = { date: '2026-02-01', voucherTypeId: v!.voucherTypeId };
    const p = await plan('reverse', [v!.id], args),
      second = await plan('reverse', [v!.id], args);
    await api.commit({
      token: p.token,
      confirmed: true,
      cashflowMappings: [{ lineNo: 2, itemId }],
    });
    await expect(
      api.commit({
        token: second.token,
        confirmed: true,
        cashflowMappings: [{ lineNo: 2, itemId }],
      }),
    ).rejects.toThrow(/冲销关系已变更/);
    expect((await plan('reverse', [v!.id], args)).warnings.join()).toMatch(
      /已有 1 张冲销.*再次冲销/,
    );
  });
  it('w_pz_plxg 批量日期修改预览编号影响，原子更新、草稿不编号，不改变编号模式', async () => {
    const vs = await seed(1, 2);
    const draft = await app.svc.vouchers.create({ ...(await input()), draft: true });
    const p = await plan('modify', [...vs.map((v) => v.id), draft.id], {
      change: { field: 'date', date: '2026-02-03' },
    });
    expect(p.warnings.join()).toMatch(/原范围可能留下断号/);
    expect(p.warnings.join()).toMatch(/不会更改账套编号模式/);
    const before = await snapshot();
    await expect(api.commit({ token: p.token, confirmed: true })).rejects.toThrow(/编号变动/);
    expect(await snapshot()).toEqual(before);
    await api.commit({ token: p.token, confirmed: true, numberingConfirmed: true });
    expect((await app.svc.vouchers.get(draft.id))!).toMatchObject({
      date: '2026-02-03',
      number: null,
      status: 'draft',
    });
    expect((await app.svc.vouchers.get(vs[0]!.id))!).toMatchObject({
      date: '2026-02-03',
      number: 1,
    });
    expect((await app.svc.vouchers.get(vs[1]!.id))!).toMatchObject({
      date: '2026-02-03',
      number: 2,
    });
  });
  it('w_pz_plxg 类型相同不改、已审核/过账/来源保护；保留原日无效日期逐项跳过', async () => {
    const [v] = await seed();
    expect(
      (
        await plan('modify', [v!.id], {
          change: { field: 'type', voucherTypeId: v!.voucherTypeId },
        })
      ).rows[0]!.reasons.join(),
    ).toMatch(/类型一致/);
    const input31 = { ...(await input()), date: '2026-01-31' };
    const day31 = await app.svc.vouchers.create(input31);
    const p = await plan('modify', [day31.id, v!.id], {
      change: { field: 'date', date: '2026-02-01', keepDay: true },
    });
    expect(p).toMatchObject({ eligibleCount: 1, skippedCount: 1 });
    expect(p.rows[0]!.reasons.join()).toMatch(/2026-02-31.*不存在/);
    await app.svc.vouchers.changeStatus({ ids: [v!.id], to: 'audited' });
    expect(
      (await plan('modify', [v!.id], { change: { field: 'date', date: '2026-02-01' } }))
        .eligibleCount,
    ).toBe(0);
  });
  it('w_pz_plxg 闭账目标、并发编号变动、批次中失败都不留下半次修改', async () => {
    const vs = await seed(1, 2);
    const args = { change: { field: 'date' as const, date: '2026-02-01' } };
    const p = await plan(
      'modify',
      vs.map((v) => v.id),
      args,
    );
    await app.svc.vouchers.create({ ...(await input()), date: '2026-02-02' });
    await expect(
      api.commit({ token: p.token, confirmed: true, numberingConfirmed: true }),
    ).rejects.toThrow(/编号集合已变化/);
    const second = await plan(
        'modify',
        vs.map((v) => v.id),
        args,
      ),
      before = await snapshot();
    await sql`CREATE TRIGGER voucher_book_modify_failure BEFORE UPDATE OF date ON voucher WHEN NEW.id = ${sql.lit(vs[1]!.id)} BEGIN SELECT RAISE(ABORT, '批量修改故障'); END`.execute(
      app.svc.db,
    );
    await expect(
      api.commit({ token: second.token, confirmed: true, numberingConfirmed: true }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await app.svc.periods.setStatus(202602, 'closed');
    expect(
      (
        await plan(
          'modify',
          vs.map((v) => v.id),
          args,
        )
      ).rows.every((r) => r.reasons.some((x) => x.includes('目标期间已结账'))),
    ).toBe(true);
  });
  it('w_pz_get 待审核覆盖独立权限、版本清单、再次确认；审核/过账/作废/来源禁止覆盖', async () => {
    const [v] = await seed();
    const data = await transfer(v!);
    data.vouchers[0]!.lines.forEach((l) => {
      l.debit *= 2;
      l.credit *= 2;
    });
    const args = {
      file: JSON.stringify(data),
      format: 'json' as const,
      numbering: 'original' as const,
      overwritePending: true,
    };
    const importer = caller(
      await app.addUser('importer', { permissions: ['voucher-book.view', 'voucher-book.import'] }),
    );
    expect((await importer.importPreview(args)).rows[0]!.errors.join()).toMatch(/权限/);
    const p = await api.importPreview(args);
    expect(p.rows[0]!.replacement).toMatchObject({ id: v!.id, revision: v!.revision });
    const before = await snapshot();
    await expect(api.importCommit({ token: p.token, confirmed: true })).rejects.toThrow(/确认覆盖/);
    expect(await snapshot()).toEqual(before);
    await api.importCommit({ token: p.token, confirmed: true, overwriteConfirmed: true });
    expect((await app.svc.vouchers.get(v!.id))!.debitTotal).toBe(2);
    expect(await count()).toBe(1);
    const stale = await api.importPreview(args);
    await app.svc.vouchers.update(v!.id, copiedInput((await app.svc.vouchers.get(v!.id))!), {
      expectedRevision: 2,
    });
    await expect(
      api.importCommit({ token: stale.token, confirmed: true, overwriteConfirmed: true }),
    ).rejects.toThrow(/已变化/);
    await app.svc.vouchers.changeStatus({ ids: [v!.id], to: 'audited' });
    expect((await api.importPreview(args)).rows[0]!.errors.join()).toMatch(/已审核/);
    await app.svc.vouchers.changeStatus({ ids: [v!.id], to: 'posted' });
    expect((await api.importPreview(args)).validCount).toBe(0);
  });
});

describe('w_pz_get / w_pz_tjsh 细项回归', () => {
  it('w_pz_get 同一凭证超过100条非法分录，错误总数按行累计并禁止写入', async () => {
    const [v] = await seed();
    const data = await transfer(v!);
    data.vouchers[0]!.number = 9;
    data.vouchers[0]!.lines = Array.from({ length: 102 }, (_, i) => ({
      ...data.vouchers[0]!.lines[i % 2]!,
      account: `missing-${i}`,
    }));
    const p = await api.importPreview({ file: JSON.stringify(data), format: 'json' });
    expect(p).toMatchObject({ errorCount: 102, stopped: true, validCount: 0 });
    expect(p.rows[0]!.errors).toHaveLength(102);
    await expect(api.importCommit({ token: p.token, confirmed: true })).rejects.toThrow(
      /超过100项/,
    );
    expect(await count()).toBe(1);
  });
  it('w_pz_get 外币数量、所有维度编码、票号、业务日期、结算方式和附单数Excel往返', async () => {
    await app.svc.accounts.create(
      {
        code: '100203',
        name: '多维外币数量',
        currency: 'USD',
        quantityUnit: '件',
        cashflowRequired: true,
        dimensions: [
          { type: 'project', required: true },
          { type: 'partner', required: true },
          { type: 'department', required: true },
          { type: 'person', required: true },
        ],
      },
      [4, 2, 2],
    );
    const vInput = await voucherInputFromSpec(app.svc, {
      date: '2026-01-01',
      lines: [
        {
          account: '100203',
          debit: 1,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 1,
          quantity: '0.125',
          unitPrice: '0.08',
          dims: {
            project: 'XM01',
            partner: 'C001',
            department: '01',
            person: 'P01',
            cashflow: 'CF01',
          },
        },
        { account: '6603', credit: 1 },
      ],
    });
    const method = (await app.svc.reference.settlementMethods())[0];
    const v = await app.svc.vouchers.create({
      ...vInput,
      attachments: 3,
      note: '凭证头备注',
      lines: vInput.lines.map((l, i) =>
        i ? l : { ...l, settlementMethodId: method?.id, refNo: '银行单001', bizDate: '2025-12-31' },
      ),
    });
    const xlsx = await api.export({ filter: { id: v.id }, format: 'xlsx' });
    const p = await api.importPreview({
      file: xlsx.file,
      format: 'xlsx',
      targetDate: '2026-02-01',
    });
    expect(p.errorCount).toBe(0);
    const r = await api.importCommit({ token: p.token, confirmed: true });
    const copy = (await app.svc.vouchers.get(r.createdIds[0]!))!;
    expect(copy).toMatchObject({ attachments: 3, note: '凭证头备注' });
    const normalized = (v: Voucher) => v.lines.map(({ id: _id, ...line }) => line);
    expect(normalized(copy)).toEqual(normalized(v));
  });
  it('w_pzedit_fc 红冲预览显式选反向项目，原方向拒绝；成功后仍须跨人审核', async () => {
    const cf = await setCashDirection('CF02', 'outflow');
    const inflow = await setCashDirection('CF01', 'inflow');
    const base = await input();
    base.lines[1]!.dimensions = { cashflow: cf };
    const v = await app.svc.vouchers.create(base);
    const p = await plan('reverse', [v.id], { date: '2026-02-01', voucherTypeId: v.voucherTypeId });
    const before = await snapshot();
    await expect(api.commit({ token: p.token, confirmed: true })).rejects.toThrow(/尚未选择/);
    await expect(
      api.commit({
        token: p.token,
        confirmed: true,
        cashflowMappings: [{ lineNo: 2, itemId: cf }],
      }),
    ).rejects.toThrow(/方向冲突/);
    expect(await snapshot()).toEqual(before);
    const r = await api.commit({
      token: p.token,
      confirmed: true,
      cashflowMappings: [{ lineNo: 2, itemId: inflow }],
    });
    const mine = await plan('audit', r.createdIds);
    expect(mine.eligibleCount).toBe(0);
    expect(mine.rows[0]!.reasons.join()).toContain('制单人与审核人相同');
    const b = await auditor();
    const audit = await b.preview.audit({ action: 'audit', selection: { ids: r.createdIds } });
    expect(audit).toMatchObject({ eligibleCount: 1, skippedCount: 0 });
    expect(audit.rows[0]!.warnings).toEqual([]);
    await b.commit({ token: audit.token, confirmed: true });
    expect((await app.svc.vouchers.get(r.createdIds[0]!))!.auditedBy!.name).toBe('B');
    expect(await app.svc.vouchers.get(v.id)).toEqual(v);
  });
  it('w_pz_tjsh 预览后撤回权限不能继续审核', async () => {
    const [v] = await seed();
    const b = await auditor();
    const p = await b.preview.audit({ action: 'audit', selection: { ids: [v!.id] } });
    const user = await app.svc.db
      .selectFrom('app_user')
      .select('id')
      .where('code', '=', 'B')
      .executeTakeFirstOrThrow();
    await app.svc.db
      .deleteFrom('user_permission')
      .where('user_id', '=', user.id)
      .where('permission', '=', 'voucher-book.audit')
      .execute();
    await expect(
      b.commit({ token: p.token, confirmed: true, cashflowConfirmed: true }),
    ).rejects.toThrow(/权限/);
    expect((await app.svc.vouchers.get(v!.id))!.status).toBe('pending');
  });
});

it('w_pz_get Excel保留无分录草稿凭证头，不静默丢弃；仅合法集合须用户明确选择', async () => {
  await seed();
  await app.svc.vouchers.create({ ...(await input()), draft: true, lines: [], note: '未完成草稿' });
  const f = await api.export({ filter: {}, format: 'xlsx' });
  const p = await api.importPreview({ file: f.file, format: 'xlsx', targetDate: '2026-02-01' });
  expect(p.rows).toHaveLength(2);
  expect(p.validCount).toBe(1);
  expect(p.errorCount).toBe(1);
  expect(p.rows[1]!.errors.join()).toMatch(/至少要有两行/);
  await expect(api.importCommit({ token: p.token, confirmed: true })).rejects.toThrow(/仍有错误/);
  expect(await count()).toBe(2);
});
it('w_pz_get 修正Excel字段映射才导入，不自动替换缺失科目列', async () => {
  await seed();
  const f = await api.export({ filter: {}, format: 'xlsx' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(f.file, 'base64')).buffer);
  const sheet = wb.getWorksheet('凭证')!;
  sheet.getRow(1).eachCell((cell) => {
    if (cell.value === '科目编码') cell.value = '我的科目列';
  });
  const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  await expect(api.importPreview({ file, format: 'xlsx' })).rejects.toThrow(/account.*未映射/);
  const p = await api.importPreview({
    file,
    format: 'xlsx',
    mapping: { account: '我的科目列' },
    targetDate: '2026-02-01',
  });
  expect(p).toMatchObject({ validCount: 1, errorCount: 0 });
  await api.importCommit({ token: p.token, confirmed: true });
  expect(await count()).toBe(2);
});
it('w_pz_pzxsb 插入与导入金额中间合计也必须保持安全整数分', async () => {
  const base = await input();
  expect(() =>
    checkedInput({
      ...base,
      lines: [
        { ...base.lines[0], debit: Number.MAX_SAFE_INTEGER },
        { ...base.lines[0], debit: 1 },
        { ...base.lines[1], credit: Number.MAX_SAFE_INTEGER },
        { ...base.lines[1], credit: 1 },
      ],
    }),
  ).toThrow(/合计超过可保存金额/);
});

it('w_pz_get 预览后编码字典变更使确认失效，不把原科目悄悄映射成改名后的编码', async () => {
  const [v] = await seed();
  const data = await transfer(v!);
  const p = await api.importPreview({
    file: JSON.stringify(data),
    format: 'json',
    targetDate: '2026-02-01',
  });
  await app.svc.db
    .updateTable('account')
    .set({ name: '确认后改名' })
    .where('id', '=', v!.lines[0]!.accountId)
    .execute();
  const before = await snapshot();
  await expect(api.importCommit({ token: p.token, confirmed: true })).rejects.toThrow(
    /档案或凭证类型已变化/,
  );
  expect(await snapshot()).toEqual(before);
});
