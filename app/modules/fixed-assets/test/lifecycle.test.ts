import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import fc from 'fast-check';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import type { CardInput } from '../shared';
import type { FixedAssetsTables } from '../server/migrations';

const caller = (a: TestApp, token?: string) => a.call(server, token);
let app: TestApp, api: ReturnType<typeof caller>, data: CardInput;
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'minfei' });
  api = caller(app);
  const categoryId = await api.saveMaster({
    data: {
      kind: 'category',
      code: '01',
      name: '设备',
      accountId: (await app.svc.accounts.require('1601')).id,
    },
  });
  const purposeId = await api.saveMaster({
    data: {
      kind: 'purpose',
      code: '01',
      name: '管理用',
      accountId: (await app.svc.accounts.require('6602')).id,
    },
  });
  const statusId = await api.saveMaster({ data: { kind: 'status', code: '01', name: '在用' } });
  data = {
    code: 'LIFE',
    name: '生命周期设备',
    categoryId,
    purposeId,
    statusId,
    departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
    acquired: '2026-01-01',
    useDate: '2026-01-01',
    original: 600000,
    rate: '0',
    method: '1',
    lifeMonths: 60,
  };
  await api.saveSettings({
    depreciationAccountId: (await app.svc.accounts.require('1602')).id,
    clearingAccountId: (await app.svc.accounts.require('1601')).id,
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});
async function run(period: number) {
  const p = await api.preview({ period });
  return api.depreciate({ period, token: p.token, confirm: true });
}
async function voucher(id: number) {
  const p = await api.voucherPreview({ id });
  return api.generateVoucher({ id, token: p.token });
}
async function report(cutoff: string, kind: 'list' | 'distribution' | 'ledger' = 'list') {
  return api.reports({ kind, cutoff, year: 2026 });
}
async function recalculate(filter: { id?: number } = {}) {
  const p = await api.recalculationPreview(filter);
  return api.recalculate({ filter, token: p.token, confirm: true });
}
const assetDb = () => app.svc.db.withTables<FixedAssetsTables>();
const recalculationRecords = () =>
  assetDb().selectFrom('fixed_assets_recalculation').selectAll().orderBy('id').execute();

describe('w_zc_zcgl / zc_zcbdb：按日期转移资产', () => {
  it('已审核的以前月份保留；新月份按转后部门用途状态计提，历史截止日按原部门取数', async () => {
    const id = await api.save({ data });
    const feb = await run(202602);
    const v = await voucher(feb);
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    const target = (await app.svc.dimensions.getByCode('department', '02'))!.id;
    const purpose = await api.saveMaster({
      data: {
        kind: 'purpose',
        code: '02',
        name: '生产用',
        accountId: (await app.svc.accounts.require('6602')).id,
      },
    });
    const c = (await api.detail({ id })).card;
    const transfer = await api.transfer({
      id,
      revision: c.revision,
      date: '2026-03-10',
      departmentId: target,
      purposeId: purpose,
      statusId: data.statusId,
      note: '调入生产部门',
      installation: '二号机房',
      custodian: '合成转入保管人',
      quantity: '2.5',
      confirm: true,
    });
    expect((await api.transfers({ id }))[0]).toMatchObject({
      from_department_id: data.departmentId,
      to_department_id: target,
      from_purpose_id: data.purposeId,
      to_purpose_id: purpose,
    });
    expect((await report('2026-02-28')).rows[0]?.department).toBe('行政部');
    expect((await report('2026-03-31')).rows[0]?.department).toBe('销售部');
    expect((await report('2026-02-28')).rows[0]?.quantity).toBe('1');
    expect((await report('2026-03-31')).rows[0]).toMatchObject({
      quantity: '2.5',
      installation: '二号机房',
      custodian: '合成转入保管人',
    });
    expect((await report('2026-02-28', 'distribution')).rows[0]?.name).toContain('行政部');
    const march = await run(202603);
    expect(
      await app.svc.db
        .withTables<FixedAssetsTables>()
        .selectFrom('fixed_assets_line')
        .selectAll()
        .where('batch_id', '=', march)
        .execute(),
    ).toMatchObject([{ department_id: target, purpose_id: purpose, amount: 10000 }]);
    await expect(api.undoTransfer({ id: transfer, confirm: true })).rejects.toThrow('已计提');
    expect((await app.svc.vouchers.get(v.id))?.status).toBe('audited');
    await api.cancel({ id: march, confirm: true });
    await api.undoTransfer({ id: transfer, confirm: true });
    expect((await api.detail({ id })).card.department_id).toBe(data.departmentId);
    expect((await api.detail({ id })).card).toMatchObject({
      quantity_e6: 1000000,
      installation: '',
      custodian: '',
    });
  });
  it('未来转移不污染前月状态；版本、停用目标、确认及逆序撤销在事务中复核', async () => {
    const id = await api.save({ data });
    const target = (await app.svc.dimensions.getByCode('department', '02'))!.id;
    const statusId = await api.saveMaster({
      data: { kind: 'status', code: '02', name: '停用待修', depreciates: false },
    });
    const input = {
      id,
      revision: 1,
      date: '2026-03-01',
      departmentId: target,
      purposeId: data.purposeId,
      statusId,
      note: '检修',
      confirm: true,
    };
    await expect(api.transfer({ ...input, confirm: false })).rejects.toThrow('确认');
    const tid = await api.transfer(input);
    expect((await api.preview({ period: 202602 })).total).toBe(10000);
    await expect(
      api.transfer({ ...input, date: '2026-04-01', statusId: data.statusId }),
    ).rejects.toThrow('已改变');
    expect(await api.transfers({ id })).toHaveLength(1);
    const plan = await api.departmentDeletePreview({ id: data.departmentId });
    expect(plan.references.some((r) => r.category === '资产转移记录')).toBe(true);
    await api.undoTransfer({ id: tid, confirm: true });
    expect(await api.transfers({ id })).toHaveLength(0);
  });
  it('相同月份已计提、关闭期间和有历史直接覆盖维度均被拒绝，失败不写转移记录', async () => {
    const id = await api.save({ data });
    await run(202602);
    const target = (await app.svc.dimensions.getByCode('department', '02'))!.id;
    const input = {
      id,
      revision: (await api.detail({ id })).card.revision,
      date: '2026-02-15',
      departmentId: target,
      purposeId: data.purposeId,
      statusId: data.statusId,
      note: '变更',
      confirm: true,
    };
    await expect(api.transfer(input)).rejects.toThrow('已计提');
    await app.svc.periods.setStatus(202603, 'closed');
    await expect(api.transfer({ ...input, date: '2026-03-01' })).rejects.toThrow();
    await expect(
      api.save({ id, revision: input.revision, data: { ...data, departmentId: target } }),
    ).rejects.toThrow('不能覆盖');
    expect(await api.transfers({ id })).toHaveLength(0);
  });
});

describe('w_zc_zcgl.ue_action_zjjs：历史累计折旧重算', () => {
  it('工作量法按期初累计和每月真实工作量重算，不把金额或数量当浮点相乘', async () => {
    const rows = [
      {
        row: 2,
        data: {
          ...data,
          code: 'WORK',
          acquired: '2025-01-01',
          useDate: '2025-01-01',
          method: '2',
          totalWork: '100',
          openingWork: '25',
          openingMonths: 5,
          openingDepreciation: 300000,
        },
      },
    ];
    const p = await api.importPreview({ rows });
    await api.importConfirm({ rows, token: p.token, confirm: true });
    const id = (await api.list({}))[0]!.id;
    await api.setWork({ id, period: 202601, quantity: '10' });
    await run(202601);
    const preview = await api.recalculationPreview({ id });
    expect(preview.rows[0]).toMatchObject({ opening: 150000, after: 210000, afterMonths: 6 });
    await api.recalculate({ filter: { id }, token: preview.token, confirm: true });
    expect((await api.detail({ id })).card).toMatchObject({
      depreciation: 210000,
      work_e6: 35000000,
    });
  });
  it('月记录保存失败整批回滚；关闭启用期间拒绝重算，原数与重算历史均保留', async () => {
    const id = await api.save({ data });
    await run(202602);
    const before = await api.detail({ id });
    const p = await api.recalculationPreview({ id });
    const db = app.svc.db.withTables<FixedAssetsTables>();
    const lines = await db.selectFrom('fixed_assets_line').selectAll().execute();
    await sql`CREATE TRIGGER fixed_assets_test_recalc BEFORE UPDATE OF amount ON fixed_assets_line BEGIN SELECT RAISE(ABORT,'synthetic recalculation write failure'); END`.execute(
      db,
    );
    await expect(
      api.recalculate({ filter: { id }, token: p.token, confirm: true }),
    ).rejects.toThrow('synthetic recalculation write failure');
    expect(await api.detail({ id })).toEqual(before);
    expect(await db.selectFrom('fixed_assets_line').selectAll().execute()).toEqual(lines);
    expect(await api.recalculations()).toEqual([]);
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(api.recalculationPreview({ id })).rejects.toThrow();
    expect(await api.detail({ id })).toEqual(before);
  });
  it('R1 重建期初和月份→零差额 R2→逆序撤回 R2/R1，恢复 700 元和原月记录且版本递增', async () => {
    const rows = [
      {
        row: 2,
        data: {
          ...data,
          useDate: '2025-01-01',
          acquired: '2025-01-01',
          openingDepreciation: 50000,
          openingMonths: 5,
        },
      },
    ];
    const p = await api.importPreview({ rows });
    await api.importConfirm({ rows, token: p.token, confirm: true });
    const id = (await api.list({}))[0]!.id;
    await run(202601);
    await run(202602);
    const before = await api.detail({ id });
    const linesBefore = await assetDb().selectFrom('fixed_assets_line').selectAll().execute();
    const preview = await api.recalculationPreview({});
    expect(preview.rows[0]).toMatchObject({ opening: 110000, after: 130000, afterMonths: 13 });
    expect(preview.totalDifference).toBe(130000 - before.card.depreciation);
    await expect(
      api.recalculate({ filter: {}, token: preview.token, confirm: false }),
    ).rejects.toThrow('确认');
    const recalc = await api.recalculate({ filter: {}, token: preview.token, confirm: true });
    expect((await api.detail({ id })).card).toMatchObject({
      opening_depreciation: 110000,
      depreciation: 130000,
      months: 13,
    });
    const secondPreview = await api.recalculationPreview({});
    expect(secondPreview.totalDifference).toBe(0);
    const second = await api.recalculate({
      filter: {},
      token: secondPreview.token,
      confirm: true,
    });
    const immutable = (await recalculationRecords()).map((r) => [r.before_json, r.after_json]);
    expect(await api.recalculations()).toMatchObject([
      { id: second, canUndo: true },
      { id: recalc, canUndo: false },
    ]);
    await expect(api.undoRecalculation({ id: recalc, confirm: true })).rejects.toThrow('后续');
    await api.undoRecalculation({ id: second, confirm: true });
    expect((await api.detail({ id })).card).toMatchObject({
      revision: before.card.revision + 3,
      depreciation: 130000,
    });
    expect(await api.recalculations()).toMatchObject([
      { id: second, undone: 1, canUndo: false },
      { id: recalc, canUndo: true },
    ]);
    await api.undoRecalculation({ id: recalc, confirm: true });
    expect((await api.detail({ id })).card).toMatchObject({
      revision: before.card.revision + 4,
      depreciation: before.card.depreciation,
      months: before.card.months,
      opening_depreciation: 50000,
    });
    expect(await assetDb().selectFrom('fixed_assets_line').selectAll().execute()).toEqual(
      linesBefore,
    );
    expect((await recalculationRecords()).map((r) => [r.before_json, r.after_json])).toEqual(
      immutable,
    );
    expect((await api.recalculations()).map((r) => r.undone)).toEqual([1, 1]);
  });
  it('跨资产、部分重叠和三级零差额链只推进各资产最近的未撤回前驱', async () => {
    const a = await api.save({ data });
    const b = await api.save({ data: { ...data, code: 'OTHER' } });
    await run(202602);
    const original = await api.list({});
    const first = await recalculate();
    const second = await recalculate({ id: b });
    const third = await recalculate({ id: b });
    const independent = await recalculate({ id: a });
    await api.undoRecalculation({ id: independent, confirm: true });
    await expect(api.undoRecalculation({ id: first, confirm: true })).rejects.toThrow('后续');
    await expect(api.undoRecalculation({ id: second, confirm: true })).rejects.toThrow('后续');
    await api.undoRecalculation({ id: third, confirm: true });
    // A new zero-difference calculation after a successful undo must also link.
    const fourth = await recalculate({ id: b });
    await api.undoRecalculation({ id: fourth, confirm: true });
    await api.undoRecalculation({ id: second, confirm: true });
    await api.undoRecalculation({ id: first, confirm: true });
    expect((await api.list({})).map((c) => [c.id, c.depreciation, c.months])).toEqual(
      original.map((c) => [c.id, c.depreciation, c.months]),
    );
    expect((await api.detail({ id: a })).card.revision).toBe(6);
    expect((await api.detail({ id: b })).card.revision).toBe(10);
  });
  it('任意资产范围的重算链逆序撤回保持原累计数和月记录，版本精确增加两次每个参与批次', async () => {
    const a = await api.save({ data });
    const b = await api.save({ data: { ...data, code: 'PROPERTY' } });
    await run(202602);
    const lines = await assetDb().selectFrom('fixed_assets_line').selectAll().execute();
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(0, a, b), { minLength: 1, maxLength: 8 }),
        async (scopes) => {
          const original = await assetDb().selectFrom('fixed_assets_card').selectAll().execute();
          const chain = [];
          for (const scope of scopes) chain.push(await recalculate(scope ? { id: scope } : {}));
          for (const id of chain.reverse()) await api.undoRecalculation({ id, confirm: true });
          for (const card of original) {
            const count = scopes.filter((id) => id === 0 || id === card.id).length;
            expect((await api.detail({ id: card.id })).card).toEqual({
              ...card,
              revision: card.revision + 2 * count,
            });
          }
          expect(await assetDb().selectFrom('fixed_assets_line').selectAll().execute()).toEqual(
            lines,
          );
        },
      ),
      { numRuns: 15 },
    );
  });
  it('旧格式未撤回快照继续完整校验，撤回后继时不改写原始快照或回退版本', async () => {
    const id = await api.save({ data });
    await run(202602);
    const first = await recalculate({ id });
    const second = await recalculate({ id });
    // Emulate records produced before the additive migration, without a guard.
    for (const record of await recalculationRecords()) {
      const oldFormat = (json: string) => {
        const state = JSON.parse(json) as { cards: unknown[]; lines: unknown[] };
        return JSON.stringify({ cards: state.cards, lines: state.lines });
      };
      await assetDb()
        .updateTable('fixed_assets_recalculation')
        .set({
          before_json: oldFormat(record.before_json),
          after_json: oldFormat(record.after_json),
          undo_guard_json: null,
        })
        .where('id', '=', record.id)
        .execute();
    }
    await api.undoRecalculation({ id: second, confirm: true });
    await api.undoRecalculation({ id: first, confirm: true });
    expect((await api.detail({ id })).card.revision).toBe(6);
  });
  it.each(['between', 'after'] as const)(
    '外部同值保存发生于 %s 时仍拒绝 R1，不会把相同金额或版本差当作重算链',
    async (when) => {
      const id = await api.save({ data });
      await run(202602);
      const first = await recalculate({ id });
      const externalSave = async () =>
        api.saveListEdits({
          rows: [
            {
              id,
              revision: (await api.detail({ id })).card.revision,
              changes: { name: data.name },
            },
          ],
        });
      if (when === 'between') await externalSave();
      const second = await recalculate({ id });
      await api.undoRecalculation({ id: second, confirm: true });
      if (when === 'after') await externalSave();
      const current = await api.detail({ id });
      const records = await recalculationRecords();
      await expect(api.undoRecalculation({ id: first, confirm: true })).rejects.toThrow('后续');
      expect(await api.detail({ id })).toEqual(current);
      expect(await recalculationRecords()).toEqual(records);
    },
  );
  it.each(['card', 'line'] as const)(
    '外部直接更改 %s 内容而不递增版本时也拒绝，拒绝不写数据',
    async (target) => {
      const id = await api.save({ data });
      await run(202602);
      const first = await recalculate({ id });
      const second = await recalculate({ id });
      await api.undoRecalculation({ id: second, confirm: true });
      // Synthetic external-writer fixtures; production mutations never use this path.
      if (target === 'card')
        await assetDb()
          .updateTable('fixed_assets_card')
          .set({ name: '外部修改' })
          .where('id', '=', id)
          .execute();
      else
        await assetDb()
          .updateTable('fixed_assets_line')
          .set({ amount: 9999 })
          .where('asset_id', '=', id)
          .execute();
      const current = await api.detail({ id });
      const records = await recalculationRecords();
      const lines = await assetDb().selectFrom('fixed_assets_line').selectAll().execute();
      await expect(api.undoRecalculation({ id: first, confirm: true })).rejects.toThrow('后续');
      expect(await api.detail({ id })).toEqual(current);
      expect(await recalculationRecords()).toEqual(records);
      expect(await assetDb().selectFrom('fixed_assets_line').selectAll().execute()).toEqual(lines);
    },
  );
  it('工作量后续业务不改卡片版本，R2 撤回也不能追认该变更为 R1 的正常链', async () => {
    const id = await api.save({ data: { ...data, method: '2', totalWork: '100' } });
    const first = await recalculate({ id });
    const revision = (await api.detail({ id })).card.revision;
    await api.setWork({ id, period: 202602, quantity: '10' });
    expect((await api.detail({ id })).card.revision).toBe(revision);
    const second = await recalculate({ id });
    await api.undoRecalculation({ id: second, confirm: true });
    await expect(api.undoRecalculation({ id: first, confirm: true })).rejects.toThrow('后续');
    expect(await assetDb().selectFrom('fixed_assets_work').selectAll().execute()).toMatchObject([
      { asset_id: id, quantity_e6: 10000000 },
    ]);
  });
  it('R2 撤回后来源的待审核、审核和过账锁仍生效，正常删除来源后 R1 可撤回', async () => {
    const id = await api.save({ data });
    const batch = await run(202602);
    const first = await recalculate({ id });
    const second = await recalculate({ id });
    await api.undoRecalculation({ id: second, confirm: true });
    const v = await voucher(batch);
    const records = await recalculationRecords();
    const current = await api.detail({ id });
    for (const status of ['pending', 'audited', 'posted'] as const) {
      if (status !== 'pending') await app.svc.vouchers.changeStatus({ ids: [v.id], to: status });
      await expect(api.undoRecalculation({ id: first, confirm: true })).rejects.toThrow('已生成');
      expect((await app.svc.vouchers.get(v.id))?.status).toBe(status);
      expect(await api.detail({ id })).toEqual(current);
      expect(await recalculationRecords()).toEqual(records);
    }
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'pending' });
    const deletion = await api.voucherDeletePreview({ id: batch });
    await api.deleteVoucher({
      id: batch,
      confirm: true,
      expectedVoucherId: v.id,
      voucherDeletion: deletion.voucherDeletion ?? undefined,
    });
    await api.undoRecalculation({ id: first, confirm: true });
    expect((await api.detail({ id })).card.depreciation).toBe(10000);
  });
  it('关闭启用月、受影响月或锁定期初时，R2 撤回后的 R1 仍拒绝并保留整批数据', async () => {
    const id = await api.save({ data: { ...data, method: '2', totalWork: '100' } });
    await api.setWork({ id, period: 202602, quantity: '0' });
    await run(202602);
    const first = await recalculate({ id });
    const second = await recalculate({ id });
    await api.undoRecalculation({ id: second, confirm: true });
    const current = await api.detail({ id });
    const records = await recalculationRecords();
    for (const period of [202601, 202602]) {
      await app.svc.periods.setStatus(period, 'closed');
      await expect(api.undoRecalculation({ id: first, confirm: true })).rejects.toThrow();
      expect(await api.detail({ id })).toEqual(current);
      expect(await recalculationRecords()).toEqual(records);
      await app.svc.periods.setStatus(period, 'open');
    }
    await app.svcFor('opening').settings.set('lock.2026', true);
    await expect(api.undoRecalculation({ id: first, confirm: true })).rejects.toThrow();
    expect(await api.detail({ id })).toEqual(current);
    expect(await recalculationRecords()).toEqual(records);
  });
  it('前驱校验快照已推进后发生故障，卡片、月记录、校验快照和撤回标记同事务回滚', async () => {
    const id = await api.save({ data });
    await run(202602);
    const first = await recalculate({ id });
    const second = await recalculate({ id });
    const current = await api.detail({ id });
    const lines = await assetDb().selectFrom('fixed_assets_line').selectAll().execute();
    const records = await recalculationRecords();
    await sql`CREATE TRIGGER fixed_assets_test_undo BEFORE UPDATE OF undone ON fixed_assets_recalculation BEGIN SELECT RAISE(ABORT,'synthetic undo finalization failure'); END`.execute(
      assetDb(),
    );
    await expect(api.undoRecalculation({ id: second, confirm: true })).rejects.toThrow(
      'synthetic undo finalization failure',
    );
    expect(await api.detail({ id })).toEqual(current);
    expect(await assetDb().selectFrom('fixed_assets_line').selectAll().execute()).toEqual(lines);
    expect(await recalculationRecords()).toEqual(records);
    await sql`DROP TRIGGER fixed_assets_test_undo`.execute(assetDb());
    await api.undoRecalculation({ id: second, confirm: true });
    await api.undoRecalculation({ id: first, confirm: true });
  });
  it('过期预览、后续业务、关闭期间及审核来源均保护现存数据', async () => {
    const id = await api.save({ data });
    await run(202602);
    const p = await api.recalculationPreview({});
    await api.saveMaster({
      data: { kind: 'status', code: '02', name: '闲置', depreciates: false },
    });
    await expect(api.recalculate({ filter: {}, token: p.token, confirm: true })).rejects.toThrow(
      '已改变',
    );
    const current = await api.recalculationPreview({ id });
    const recalc = await api.recalculate({ filter: { id }, token: current.token, confirm: true });
    await run(202603);
    await expect(api.undoRecalculation({ id: recalc, confirm: true })).rejects.toThrow('后续');
    const b = (await api.batches())[0]!;
    const v = await voucher(b.id);
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    await expect(api.recalculationPreview({ id })).rejects.toThrow('已生成');
    expect((await app.svc.vouchers.get(v.id))?.status).toBe('audited');
  });
});

describe('w_xt_kgzb_zc：完整保护备份与排他重置', () => {
  it('重置后重新登录可预览完整保护副本；过期内容和错误口令拒绝，确认后完整恢复', async () => {
    const id = await api.save({ data });
    const b = await run(202602);
    const v = await voucher(b);
    const p = await api.resetPreview();
    await api.reset({
      revision: p.revision,
      bookName: app.book.name,
      password: 'admin',
      confirmText: '清空固定资产',
    });
    let active = caller(app, await app.login());
    expect(await active.resetProtection()).toMatchObject({ assetCount: 1 });
    const plan = await active.resetRestorePreview();
    expect(plan.cardCount).toBe(1);
    await expect(
      active.resetRestore({ ...plan, password: 'wrong', confirmText: '恢复重置前整账' }),
    ).rejects.toThrow('管理员密码');
    expect(await active.list({})).toEqual([]);
    await active.enable();
    await expect(
      active.resetRestore({ ...plan, password: 'admin', confirmText: '恢复重置前整账' }),
    ).rejects.toThrow('已改变');
    const fresh = await active.resetRestorePreview();
    await expect(
      active.resetRestore({ ...fresh, password: 'admin', confirmText: '是' }),
    ).rejects.toThrow('准确输入');
    await active.resetRestore({ ...fresh, password: 'admin', confirmText: '恢复重置前整账' });
    active = caller(app, await app.login());
    expect((await active.detail({ id })).card.code).toBe('LIFE');
    const book = app.runtime.bookStore.open(app.book.id);
    expect(book.raw.prepare('SELECT status FROM voucher WHERE id=?').get(v.id)).toEqual({
      status: 'pending',
    });
  });
  it('重置预览五分钟后失效；保护备份失败时不清空原卡片', async () => {
    const id = await api.save({ data });
    const p = await api.resetPreview();
    const input = {
      revision: p.revision,
      bookName: app.book.name,
      password: 'admin',
      confirmText: '清空固定资产',
    };
    const now = vi.spyOn(Date, 'now').mockReturnValue(p.expiresAt + 1);
    await expect(api.reset(input)).rejects.toThrow('五分钟');
    now.mockRestore();
    const fresh = await api.resetPreview();
    vi.spyOn(app.runtime.bookStore.open(app.book.id).raw, 'backup').mockRejectedValueOnce(
      new Error('synthetic protection backup failure'),
    );
    await expect(api.reset({ ...input, revision: fresh.revision })).rejects.toThrow(
      'synthetic protection backup failure',
    );
    const active = caller(app, await app.login());
    expect((await active.detail({ id })).card.code).toBe('LIFE');
  });
  it('口令、强确认、过期预览与非管理员均拒绝，原账套保持不变', async () => {
    const id = await api.save({ data });
    const p = await api.resetPreview();
    const input = {
      revision: p.revision,
      bookName: app.book.name,
      password: 'admin',
      confirmText: '清空固定资产',
    };
    await expect(api.reset({ ...input, password: 'wrong' })).rejects.toThrow('密码错误');
    await expect(api.reset({ ...input, confirmText: '是' })).rejects.toThrow('准确输入');
    const clerk = caller(app, await app.addUser('clerk', { permissions: ['fixed-assets.reset'] }));
    await expect(clerk.resetPreview()).rejects.toThrow('管理员');
    await expect(api.reset(input)).rejects.toThrow('已改变');
    expect((await api.detail({ id })).card.code).toBe('LIFE');
  });
  it('通过共享维护清空本域、删除待审核来源并保留其他业务，整账保护副本可回读', async () => {
    const id = await api.save({ data });
    const b = await run(202602);
    const v = await voucher(b);
    const unrelated = await app.svc.vouchers.create({
      date: '2026-02-28',
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      lines: [
        { summary: '其他业务', accountId: (await app.svc.accounts.require('1001')).id, debit: 100 },
        {
          summary: '其他业务',
          accountId: (await app.svc.accounts.require('6001')).id,
          credit: 100,
        },
      ],
    });
    await app.svc.voucherPolicy.set({
      ...(await app.svc.voucherPolicy.get()),
      renumberAfterDelete: true,
    });
    const p = await api.resetPreview();
    expect(p.vouchers.map((v) => v.id)).toEqual([v.id]);
    expect(p.voucherDeletion?.impacts).toMatchObject([
      { id: unrelated.id, oldNumber: 2, number: 1 },
    ]);
    await api.reset({
      revision: p.revision,
      bookName: app.book.name,
      password: 'admin',
      confirmText: '清空固定资产',
    });
    await expect(api.list({})).rejects.toThrow('登录');
    const fresh = caller(app, await app.login());
    expect(await fresh.list({})).toHaveLength(0);
    expect(await fresh.masters()).toHaveLength(0);
    const core = app.core(await app.login());
    expect(await core.vouchers.get({ id: unrelated.id })).toMatchObject({
      id: unrelated.id,
      number: 1,
    });
    const dir = path.join(app.runtime.dataDir, 'core-protection', app.book.id);
    expect(existsSync(dir)).toBe(true);
    const file = readdirSync(dir).find((name) => name.endsWith('.caiwu'))!;
    const backup = new Database(path.join(dir, file), { readonly: true });
    try {
      expect(backup.prepare('SELECT code FROM fixed_assets_card WHERE id=?').get(id)).toEqual({
        code: 'LIFE',
      });
      expect(backup.prepare('SELECT status FROM voucher WHERE id=?').get(v.id)).toEqual({
        status: 'pending',
      });
      const metadata = JSON.parse(readFileSync(path.join(dir, `${file}.json`), 'utf8')) as {
        bookId: string;
      };
      expect(metadata.bookId).toBe(app.book.id);
    } finally {
      backup.close();
    }
  });
  it('审核来源禁止重置；共享替换验收故障自动回滚，资产和原凭证保持', async () => {
    const id = await api.save({ data });
    const b = await run(202602);
    const v = await voucher(b);
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    await expect(api.resetPreview()).rejects.toThrow('已审核');
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'pending' });
    const p = await api.resetPreview();
    const maintain = app.runtime.lifecycle.maintainBook.bind(app.runtime.lifecycle);
    vi.spyOn(app.runtime.lifecycle, 'maintainBook').mockImplementation((input) =>
      maintain({
        ...input,
        plan: {
          ...input.plan,
          validate: async () => {
            throw new Error('synthetic validation failure');
          },
        },
      }),
    );
    await expect(
      api.reset({
        revision: p.revision,
        bookName: app.book.name,
        password: 'admin',
        confirmText: '清空固定资产',
      }),
    ).rejects.toThrow('synthetic validation failure');
    const fresh = caller(app, await app.login());
    expect((await fresh.detail({ id })).card.code).toBe('LIFE');
    const book = app.runtime.bookStore.open(app.book.id);
    expect(book.raw.prepare('SELECT status FROM voucher WHERE id=?').get(v.id)).toEqual({
      status: 'pending',
    });
  });
});
