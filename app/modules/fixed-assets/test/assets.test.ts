import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { Decimal, qtyToE6, sourceRoute, type BusinessError } from '@caiwu/core';
import { sql } from '@caiwu/db';
import { buildAssetHistory, dueDate } from '../server/history';
import type { TRPCError } from '@trpc/server';
import server from '../server';
import manifest from '../manifest';
import type { CardInput } from '../shared';
import type { FixedAssetsTables } from '../server/migrations';
import { calculateDepreciation } from '../server/service';
import { createOpeningWorkbook, readOpeningWorkbook } from '../web/opening-workbook';
let app: TestApp;
let api: ReturnType<TestApp['call']> & ReturnType<typeof caller>;
const caller = (a: TestApp, token?: string) => a.call(server, token);
let data: CardInput;
let categoryId: number, purposeId: number, statusId: number, reasonId: number;
const code = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(e).not.toBeNull();
  return ((e as TRPCError).cause as BusinessError).data;
};
async function run(period: number, skipMissing = false) {
  const p = await api.preview({ period });
  return api.depreciate({ period, token: p.token, confirm: true, skipMissing });
}
async function voucher(id: number) {
  const p = await api.voucherPreview({ id });
  return api.generateVoucher({ id, token: p.token });
}
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'minfei' });
  api = caller(app) as typeof api;
  const aid = async (c: string) => (await app.svc.accounts.require(c)).id;
  categoryId = await api.saveMaster({
    data: { kind: 'category', code: '01', name: '办公设备', accountId: await aid('1601') },
  });
  purposeId = await api.saveMaster({
    data: { kind: 'purpose', code: '01', name: '管理用', accountId: await aid('6602') },
  });
  statusId = await api.saveMaster({
    data: { kind: 'status', code: '01', name: '在用', depreciates: true },
  });
  reasonId = await api.saveMaster({ data: { kind: 'reason', code: '01', name: '报废' } });
  await app.svc.accounts.create(
    { code: '1606', name: '固定资产清理', categoryId: 'asset' },
    (await app.svc.book.info()).codeScheme,
  );
  await api.saveSettings({
    depreciationAccountId: await aid('1602'),
    clearingAccountId: await aid('1606'),
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
  });
  data = {
    code: 'A001',
    name: '服务器',
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
    quantity: '1',
  };
});
afterEach(async () => app.close());

describe('固定资产规则与闭环', () => {
  it('w_zcgl_kp / w_zjjs / w_pz_build / w_zc_qxfz：使用当月不提、三月计提、来源分录、取消恢复及幂等', async () => {
    const id = await api.save({ data });
    expect((await api.preview({ period: 202601 })).total).toBe(0);
    for (const p of [202602, 202603, 202604]) {
      const b = await run(p);
      expect(await run(p)).toBe(b);
    }
    expect((await api.detail({ id })).card).toMatchObject({
      depreciation: 30000,
      months: 3,
      work_e6: 0,
    });
    const b = (await api.batches())[0]!;
    const v = await voucher(b.id);
    expect(v.source).toEqual({ module: 'fixed-assets', type: 'depreciation', id: String(b.id) });
    expect(v.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['6602', 10000, 0],
      ['1602', 0, 10000],
    ]);
    expect((await voucher(b.id)).id).toBe(v.id);
    expect(sourceRoute(manifest, 'depreciation', String(b.id))).toBe(
      `/m/fixed-assets/depreciation?id=${b.id}`,
    );
    await api.cancel({ id: b.id, confirm: true });
    await api.cancel({ id: b.id, confirm: true });
    expect(await app.svc.vouchers.get(v.id)).toBeNull();
    expect((await api.detail({ id })).card).toMatchObject({ depreciation: 20000, months: 2 });
  });
  it.each(['audited', 'posted'] as const)(
    'w_pz_build / w_zc_qxfz：%s 凭证锁定来源卡片和批次，失败全部回滚',
    async (status) => {
      const id = await api.save({ data });
      const b = await run(202602),
        v = await voucher(b);
      await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
      if (status === 'posted') await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
      expect(
        (await code(api.save({ id, revision: 2, data: { ...data, name: '不能改' } }))).code,
      ).toBe('FIXED_ASSETS_SOURCE_VOUCHER');
      expect((await code(api.remove({ id, confirm: true }))).code).toBe(
        'FIXED_ASSETS_SOURCE_VOUCHER',
      );
      expect((await code(api.cancel({ id: b, confirm: true }))).code).toBe('VOUCHER_LOCKED');
      expect((await api.detail({ id })).card.depreciation).toBe(10000);
      expect((await api.batches())[0]!.voucher_id).toBe(v.id);
    },
  );
  it.each(['audited', 'posted'] as const)(
    'w_zcgl_yztz/w_zcgl_delete：2月%s凭证保留，3月可增量调整、继续折旧及注销，既有来源不可改',
    async (status) => {
      const id = await api.save({ data }),
        feb = await run(202602),
        febVoucher = await voucher(feb);
      await app.svc.vouchers.changeStatus({ ids: [febVoucher.id], to: 'audited' });
      if (status === 'posted') {
        await app.svc.vouchers.changeStatus({ ids: [febVoucher.id], to: 'posted' });
        await app.svc.periods.setStatus(202601, 'closed');
        await app.svc.periods.setStatus(202602, 'closed');
      }
      const historicalVoucher = await app.svc.vouchers.get(febVoucher.id);
      const db = app.svc.db.withTables<FixedAssetsTables>();
      const historicalBatch = await db
        .selectFrom('fixed_assets_batch')
        .selectAll()
        .where('id', '=', feb)
        .executeTakeFirstOrThrow();
      const historicalLines = await db
        .selectFrom('fixed_assets_line')
        .selectAll()
        .where('batch_id', '=', feb)
        .execute();
      const input = {
        id,
        date: '2026-03-01',
        value: 659000,
        note: '后续期间增加原值',
        expectedOriginal: 600000,
        expectedChain: 600000,
        confirmMismatch: false,
      };
      const first = await api.adjust(input);
      // 删除本期未被后续折旧引用的调整，不要求删除上一期凭证。
      await api.removeAdjustment({ id: first, confirm: true });
      expect((await api.detail({ id })).card.original).toBe(600000);
      const adjustment = await api.adjust(input);
      expect((await api.preview({ period: 202603 })).total).toBe(11000);
      const march = await run(202603),
        marchVoucher = await voucher(march);
      await app.svc.vouchers.changeStatus({ ids: [marchVoucher.id], to: 'audited' });
      if (status === 'posted')
        await app.svc.vouchers.changeStatus({ ids: [marchVoucher.id], to: 'posted' });
      const marchSource = await app.svc.vouchers.get(marchVoucher.id);
      // 同月调整会改变已经形成的折旧来源，仍须拦截。
      expect(
        (
          await code(
            api.adjust({
              ...input,
              date: '2026-03-15',
              value: 700000,
              expectedOriginal: 659000,
              expectedChain: 659000,
            }),
          )
        ).code,
      ).toBe('FIXED_ASSETS_SOURCE_VOUCHER');
      expect((await code(api.removeAdjustment({ id: adjustment, confirm: true }))).code).toBe(
        'FIXED_ASSETS_SOURCE_VOUCHER',
      );
      expect((await code(api.remove({ id, confirm: true }))).code).toBe(
        'FIXED_ASSETS_SOURCE_VOUCHER',
      );
      expect((await code(api.cancel({ id: march, confirm: true }))).code).toBe('VOUCHER_LOCKED');
      expect((await api.detail({ id })).card).toMatchObject({
        original: 659000,
        depreciation: 21000,
        months: 2,
      });
      // 注销追加清理业务，不重写同月已计提的折旧与凭证。
      const preview = await api.disposalPreview({
        id,
        date: '2026-03-31',
        reasonId,
        generate: true,
      });
      const clearing = await api.dispose({
        id,
        date: '2026-03-31',
        reasonId,
        generate: true,
        token: preview.token,
        confirm: true,
      });
      expect(
        (await app.svc.vouchers.get(clearing!))!.lines.map((l) => [
          l.accountCode,
          l.debit,
          l.credit,
        ]),
      ).toEqual([
        ['1606', 638000, 0],
        ['1602', 21000, 0],
        ['1601', 0, 659000],
      ]);
      expect((await api.detail({ id })).card.disposal_date).toBe('2026-03-31');
      await api.undoDisposal({ id, confirm: true });
      expect(await app.svc.vouchers.get(clearing!)).toBeNull();
      const again = await api.disposalPreview({ id, date: '2026-03-31', reasonId, generate: true });
      const lockedClearing = await api.dispose({
        id,
        date: '2026-03-31',
        reasonId,
        generate: true,
        token: again.token,
        confirm: true,
      });
      await app.svc.vouchers.changeStatus({ ids: [lockedClearing!], to: 'audited' });
      expect((await code(api.undoDisposal({ id, confirm: true }))).code).toBe('VOUCHER_LOCKED');
      expect(await app.svc.vouchers.get(febVoucher.id)).toEqual(historicalVoucher);
      expect(await app.svc.vouchers.get(marchVoucher.id)).toEqual(marchSource);
      expect(
        await db
          .selectFrom('fixed_assets_batch')
          .selectAll()
          .where('id', '=', feb)
          .executeTakeFirstOrThrow(),
      ).toEqual(historicalBatch);
      expect(
        await db.selectFrom('fixed_assets_line').selectAll().where('batch_id', '=', feb).execute(),
      ).toEqual(historicalLines);
    },
  );
  it('w_zcgl_yztz/w_zcgl_delete：历史过账不替代本期闭月、后续折旧及逆序撤销保护', async () => {
    const id = await api.save({ data }),
      feb = await run(202602),
      v = await voucher(feb);
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
    await app.svc.periods.setStatus(202602, 'closed');
    const input = {
      id,
      date: '2026-03-01',
      value: 659000,
      note: '后续调整',
      expectedOriginal: 600000,
      expectedChain: 600000,
      confirmMismatch: false,
    };
    await app.svc.periods.setStatus(202603, 'closed');
    expect((await code(api.adjust(input))).code).toBe('PERIOD_CLOSED');
    expect(
      (await code(api.disposalPreview({ id, date: '2026-03-31', reasonId, generate: false }))).code,
    ).toBe('PERIOD_CLOSED');
    await app.svc.periods.setStatus(202603, 'open');
    expect(
      (await code(api.disposalPreview({ id, date: '2026-03-31', reasonId, generate: false }))).code,
    ).toBe('FIXED_ASSETS_DISPOSAL_DEPRECIATION');
    const adjustment = await api.adjust(input),
      march = await run(202603);
    expect((await code(api.removeAdjustment({ id: adjustment, confirm: true }))).code).toBe(
      'FIXED_ASSETS_ADJUST_HISTORY',
    );
    const p = await api.disposalPreview({ id, date: '2026-03-31', reasonId, generate: false });
    await api.dispose({
      id,
      date: '2026-03-31',
      reasonId,
      generate: false,
      token: p.token,
      confirm: true,
    });
    expect((await code(api.cancel({ id: march, confirm: true }))).code).toBe(
      'FIXED_ASSETS_REVERSE_ORDER',
    );
    await api.undoDisposal({ id, confirm: true });
    await api.cancel({ id: march, confirm: true });
    await api.removeAdjustment({ id: adjustment, confirm: true });
    expect((await api.detail({ id })).card).toMatchObject({
      original: 600000,
      depreciation: 10000,
      months: 1,
      disposal_date: null,
    });
    expect((await app.svc.vouchers.get(v.id))!.status).toBe('posted');
    expect((await code(api.cancel({ id: feb, confirm: true }))).code).toBe('PERIOD_CLOSED');
  });
  it('w_zc_qxfz：非最后月、缺确认、关闭期间拒绝', async () => {
    await api.save({ data });
    const a = await run(202602),
      b = await run(202603);
    expect((await code(api.cancel({ id: a, confirm: true }))).code).toBe(
      'FIXED_ASSETS_FUTURE_BATCH',
    );
    expect((await code(api.cancel({ id: b, confirm: false }))).code).toBe('FIXED_ASSETS_CONFIRM');
    await voucher(b);
    await app.svc.periods.setStatus(202603, 'closed');
    expect((await code(api.cancel({ id: b, confirm: true }))).code).toBe('PERIOD_CLOSED');
  });
  it('w_zjjs：月序、未来月份和关闭期间保护', async () => {
    await api.save({ data });
    await run(202602);
    expect((await code(api.preview({ period: 202604 }))).code).toBe('FIXED_ASSETS_MONTH_GAP');
    await run(202603);
    expect((await code(api.preview({ period: 202601 }))).code).toBe('FIXED_ASSETS_FUTURE_BATCH');
    await app.svc.periods.setStatus(202604, 'closed');
    expect((await code(api.preview({ period: 202604 }))).code).toBe('PERIOD_CLOSED');
  });
  it('w_zcgl_kp：必填、重复编码、改编号确认、少于30月确认及稳定ID', async () => {
    await expect(api.save({ data: { ...data, name: '' } })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect((await code(api.save({ data: { ...data, lifeMonths: 12 } }))).code).toBe(
      'FIXED_ASSETS_SHORT_LIFE',
    );
    const id = await api.save({ data });
    expect((await code(api.save({ data }))).code).toBe('FIXED_ASSETS_DUPLICATE');
    expect((await code(api.save({ id, revision: 1, data: { ...data, code: 'A002' } }))).code).toBe(
      'FIXED_ASSETS_CODE_CONFIRM',
    );
    expect(
      await api.save({ id, revision: 1, data: { ...data, code: 'A002', confirmCodeChange: true } }),
    ).toBe(id);
    expect((await api.detail({ id })).card.code).toBe('A002');
    expect((await code(api.save({ id, revision: 1, data: { ...data, code: 'A002' } }))).code).toBe(
      'FIXED_ASSETS_STALE',
    );
  });
  it('w_zcgl_kp_fssb：附属必填/唯一、十进制金额和失败回滚', async () => {
    const a = { code: '01', name: '硬盘', quantity: '0.1', unitPrice: '0.2', note: '' };
    const id = await api.save({ data: { ...data, accessories: [a] } });
    expect((await api.detail({ id })).accessories[0]).toMatchObject({
      quantity_e6: 100000,
      amount: 2,
    });
    expect(
      (await code(api.save({ id, revision: 1, data: { ...data, accessories: [a, a] } }))).code,
    ).toBe('FIXED_ASSETS_ACCESSORY_DUPLICATE');
    expect((await api.detail({ id })).accessories).toHaveLength(1);
    await expect(
      api.save({ data: { ...data, code: 'B', accessories: [{ ...a, name: '' }] } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await api.list({ code: 'B' })).toHaveLength(0);
  });
  it.each(['category', 'purpose', 'status', 'reason'] as const)(
    'w_zc_sblb/w_zc_sbyt/w_zc_sbzt/w_zc_sbzx：%s 编码唯一、引用保护、停用替代、删除确认',
    async (kind) => {
      const id = await api.save({ data });
      const mid = { category: categoryId, purpose: purposeId, status: statusId, reason: reasonId }[
        kind
      ];
      if (kind === 'reason') {
        const p = await api.disposalPreview({ id, date: '2026-01-31', reasonId, generate: false });
        await api.dispose({
          id,
          date: '2026-01-31',
          reasonId,
          generate: false,
          token: p.token,
          confirm: true,
        });
      }
      expect((await code(api.saveMaster({ data: { kind, code: '01', name: '重复' } }))).code).toBe(
        'FIXED_ASSETS_MASTER_DUPLICATE',
      );
      const e = await code(api.removeMaster({ id: mid, confirm: true }));
      expect(e.code).toBe('FIXED_ASSETS_MASTER_USED');
      expect(e.message).toContain('A001');
      expect(e.hint).toContain('停用');
      const unused = await api.saveMaster({ data: { kind, code: '99', name: '未使用' } });
      expect((await code(api.removeMaster({ id: unused, confirm: false }))).code).toBe(
        'FIXED_ASSETS_CONFIRM',
      );
      await api.removeMaster({ id: unused, confirm: true });
    },
  );
  it.each(['category', 'purpose'] as const)(
    'w_zc_sblb / w_zc_sbyt：%s 拒绝非末级/停用科目',
    async (kind) => {
      const parent = await app.svc.accounts.require('1002');
      expect(
        (
          await code(
            api.saveMaster({ data: { kind, code: '20', name: 'x', accountId: parent.id } }),
          )
        ).code,
      ).toBe('FIXED_ASSETS_ACCOUNT_INVALID');
      const aid = (await app.svc.accounts.require('6603')).id;
      await app.svc.db.updateTable('account').set({ disabled: 1 }).where('id', '=', aid).execute();
      expect(
        (await code(api.saveMaster({ data: { kind, code: '20', name: 'x', accountId: aid } })))
          .code,
      ).toBe('FIXED_ASSETS_ACCOUNT_INVALID');
    },
  );
  it('w_zc_zcgl / w_zc_sydw：前置资料与core部门类型校验、去新增入口', async () => {
    const e = await code(api.save({ data: { ...data, categoryId: 99999 } }));
    expect(e.code).toBe('FIXED_ASSETS_MASTER_MISSING');
    expect(e.actions?.[0]?.to).toBe('/m/fixed-assets/masters');
    const partner = (await app.svc.dimensions.getByCode('partner', 'C001'))!.id;
    expect((await code(api.save({ data: { ...data, departmentId: partner } }))).code).toBe(
      'FIXED_ASSETS_DEPARTMENT',
    );
    const d = await api.createDepartment({ code: '03', name: '研发部' });
    expect(d.typeId).toBe('department');
  });
  it('w_zc_zcgl：已折旧不能物理删除，未折旧删除确认', async () => {
    const id = await api.save({ data });
    expect((await code(api.remove({ id, confirm: false }))).code).toBe('FIXED_ASSETS_CONFIRM');
    await run(202602);
    expect((await code(api.remove({ id, confirm: true }))).code).toBe('FIXED_ASSETS_DEPRECIATED');
  });
  it('w_zjjs：状态不提折旧，缺工作量需明确跳过，超剩余阻止，取消恢复工作量', async () => {
    const off = await api.saveMaster({
      data: { kind: 'status', code: '02', name: '停用设备', depreciates: false },
    });
    await api.save({ data: { ...data, code: 'OFF', statusId: off } });
    const id = await api.save({ data: { ...data, method: '2', lifeMonths: 0, totalWork: '100' } });
    const p = await api.preview({ period: 202602 });
    expect(p.rows.find((r) => r.assetId === id)?.skip).toBe(true);
    expect(
      (await code(api.depreciate({ period: 202602, token: p.token, confirm: true }))).code,
    ).toBe('FIXED_ASSETS_MISSING_INPUT');
    expect((await code(api.setWork({ id, period: 202602, quantity: '101' }))).code).toBe(
      'FIXED_ASSETS_WORK_EXCEEDS',
    );
    await api.setWork({ id, period: 202602, quantity: '25' });
    const b = await run(202602);
    expect((await api.detail({ id })).card).toMatchObject({
      depreciation: 150000,
      work_e6: 25000000,
      months: 1,
    });
    await api.cancel({ id: b, confirm: true });
    expect((await api.detail({ id })).card).toMatchObject({
      depreciation: 0,
      work_e6: 0,
      months: 0,
    });
  });
  it('w_zjjs：缺年限需跳过，原值链错误阻止，预览失效拒绝', async () => {
    const id = await api.save({ data });
    await app.svc.db
      .withTables<FixedAssetsTables>()
      .updateTable('fixed_assets_card')
      .set({ life_months: 0 })
      .where('id', '=', id)
      .execute();
    const p = await api.preview({ period: 202602 });
    expect(p.rows[0]!.issue).toContain('年限');
    await run(202602, true);
    await app.svc.db
      .withTables<FixedAssetsTables>()
      .updateTable('fixed_assets_card')
      .set({ base_original: 600001 })
      .where('id', '=', id)
      .execute();
    expect((await code(api.preview({ period: 202603 }))).code).toBe('FIXED_ASSETS_CHAIN');
  });
  it('w_zcgl_yztz：调整链、残值下限、删除确认和逆序恢复', async () => {
    const id = await api.save({ data });
    const a = await api.adjust({
      id,
      date: '2026-02-01',
      value: 660000,
      note: '增值',
      expectedOriginal: 600000,
      expectedChain: 600000,
      confirmMismatch: false,
    });
    expect((await api.detail({ id })).card.original).toBe(660000);
    expect((await code(api.removeAdjustment({ id: a, confirm: false }))).code).toBe(
      'FIXED_ASSETS_CONFIRM',
    );
    await api.removeAdjustment({ id: a, confirm: true });
    expect((await api.detail({ id })).card.original).toBe(600000);
    const b = await api.adjust({
      id,
      date: '2026-02-01',
      value: 660000,
      note: '增值',
      expectedOriginal: 600000,
      expectedChain: 600000,
      confirmMismatch: false,
    });
    await run(202602);
    expect((await code(api.removeAdjustment({ id: b, confirm: true }))).code).toBe(
      'FIXED_ASSETS_ADJUST_HISTORY',
    );
  });
  it('w_zcgl_yztz：差异必须确认、低于已提金额拒绝', async () => {
    const id = await api.save({ data });
    await app.svc.db
      .withTables<FixedAssetsTables>()
      .updateTable('fixed_assets_card')
      .set({ original: 610000 })
      .where('id', '=', id)
      .execute();
    expect(
      (
        await code(
          api.adjust({
            id,
            date: '2026-02-01',
            value: 620000,
            note: '核对',
            expectedOriginal: 610000,
            expectedChain: 600000,
            confirmMismatch: false,
          }),
        )
      ).code,
    ).toBe('FIXED_ASSETS_CHAIN_CONFIRM');
    await api.adjust({
      id,
      date: '2026-02-01',
      value: 620000,
      note: '核对',
      expectedOriginal: 610000,
      expectedChain: 600000,
      confirmMismatch: true,
    });
    await run(202602);
    expect(
      (
        await code(
          api.adjust({
            id,
            date: '2026-03-01',
            value: 1,
            note: '减少',
            expectedOriginal: 620000,
            expectedChain: 620000,
            confirmMismatch: false,
          }),
        )
      ).code,
    ).toBe('FIXED_ASSETS_ADJUST_MIN');
  });
  it('w_zcgl_delete：日期截止、默认隐藏与历史保留、清理凭证原子关联', async () => {
    const id = await api.save({ data });
    await run(202602);
    expect(
      (await code(api.disposalPreview({ id, date: '2026-01-31', reasonId, generate: false }))).code,
    ).toBe('FIXED_ASSETS_DISPOSAL_DATE');
    const p = await api.disposalPreview({ id, date: '2026-02-28', reasonId, generate: true });
    const v = await api.dispose({
      id,
      date: '2026-02-28',
      reasonId,
      generate: true,
      token: p.token,
      confirm: true,
    });
    expect(v).toBeTruthy();
    expect((await app.svc.vouchers.get(v!))!.source?.type).toBe('disposal');
    expect(
      (await app.svc.vouchers.get(v!))!.lines.map((l) => [l.accountCode, l.debit, l.credit]),
    ).toEqual([
      ['1606', 590000, 0],
      ['1602', 10000, 0],
      ['1601', 0, 600000],
    ]);
    expect(await api.list({})).toHaveLength(0);
    expect(await api.list({ includeDisposed: true })).toHaveLength(1);
    await api.undoDisposal({ id, confirm: true });
    expect(await api.list({})).toHaveLength(1);
    expect(await app.svc.vouchers.get(v!)).toBeNull();
  });
  it('w_pz_build：缺设置、无折旧、日期不属于来源月份、停用科目拦截', async () => {
    await api.save({ data });
    const b = await run(202601);
    expect((await code(api.voucherPreview({ id: b }))).code).toBe('FIXED_ASSETS_NO_DEPRECIATION');
    const id = await run(202602);
    expect((await code(api.voucherPreview({ id, date: '2026-01-01' }))).code).toBe(
      'FIXED_ASSETS_VOUCHER_DATE',
    );
    await app.svcFor('fixed-assets').settings.set('voucher', null);
    expect((await code(api.voucherPreview({ id }))).code).toBe('FIXED_ASSETS_SETTINGS');
  });
  it('w_zjgl/w_zjgl_cx/w_zjgl_fb：分布合计、白名单/数字/日期/含有校验', async () => {
    await api.save({ data });
    await run(202602);
    const q = await api.query({ from: 202601, to: 202612 });
    expect(q.total).toBe(10000);
    expect(q.distribution.reduce((n, r) => n + r.amount, 0)).toBe(q.total);
    for (const [field, op, value, expected] of [
      ['amount', 'eq', 'abc', 'QUERY_NUMBER'],
      ['useDate', 'eq', '2026-02-30', 'QUERY_DATE'],
      ['amount', 'contains', '1', 'QUERY_OPERATOR'],
    ] as const)
      expect(
        (await code(api.query({ from: 202601, to: 202612, conditions: [{ field, op, value }] })))
          .code,
      ).toBe(`FIXED_ASSETS_${expected}`);
    await expect(
      api.query({
        from: 202601,
        to: 202612,
        conditions: [{ field: 'id; drop table' as 'code', op: 'eq', value: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('w_xt_kgzb_zc：导入逐行错误、整批回滚、重导幂等、禁止重置', async () => {
    const rows = [
      {
        row: 2,
        data: {
          ...data,
          useDate: '2025-01-01',
          acquired: '2025-01-01',
          openingDepreciation: 120000,
          openingMonths: 12,
        },
      },
    ];
    const p = await api.importPreview({ rows });
    expect(p.valid).toBe(true);
    expect((await api.importConfirm({ rows, token: p.token, confirm: true })).imported).toBe(1);
    const again = await api.importPreview({ rows });
    expect((await api.importConfirm({ rows, token: again.token, confirm: true })).skipped).toBe(1);
    const bad = [{ row: 2, data: { ...data, code: 'B', openingDepreciation: 999999 } }];
    expect((await api.importPreview({ rows: bad })).valid).toBe(false);
    expect((await code(api.importConfirm({ rows: bad, token: '', confirm: true }))).code).toBe(
      'FIXED_ASSETS_IMPORT_ERRORS',
    );
    expect(await api.list({ code: 'B' })).toHaveLength(0);
    expect((await code(api.reset())).code).toBe('FIXED_ASSETS_RESET_UNAVAILABLE');
  });
  it('w_xt_kgzb_zc/w_zcgl_kp_fssb：双表期初入库、精确附属金额、重导及变更拒绝保留旧账', async () => {
    const workbook = await createOpeningWorkbook([
      {
        values: [
          '0001',
          '期初服务器',
          '01',
          '01',
          '01',
          '01',
          '2025-01-01',
          '2025-01-01',
          '6000',
          '0',
          '1',
          '60',
          '100',
          '1',
          '0',
          '0',
          '',
          '台',
          '1',
          '否',
          '',
          '参考01',
        ],
        accessories: [
          { code: '000A', name: '硬盘', quantity: '0.1', unitPrice: '0.2', note: '历史说明' },
        ],
      },
    ]);
    const { rows } = readOpeningWorkbook(workbook, {
      masters: await api.masters(),
      departments: await app.svc.dimensions.items('department'),
    });
    const preview = await api.importPreview({ rows });
    expect(preview.valid).toBe(true);
    expect(await api.importConfirm({ rows, token: preview.token, confirm: true })).toEqual({
      imported: 1,
      skipped: 0,
    });
    const id = (await api.list({}))[0]!.id;
    const original = await api.detail({ id });
    expect(original.card).toMatchObject({ code: '0001', depreciation: 10000, is_opening: 1 });
    expect(original.accessories[0]).toMatchObject({
      code: '000A',
      amount: 2,
      quantity: '0.1',
      unit_price: '0.2',
      note: '历史说明',
    });
    const exported = await api.exportOpening();
    expect(exported.cards[0]).toMatchObject({ id, code: '0001', opening_depreciation: 10000 });
    expect(exported.accessories[0]).toMatchObject({
      asset_id: id,
      code: '000A',
      amount: 2,
      note: '历史说明',
    });
    const noView = caller(app, await app.addUser('no-asset-view'));
    expect((await code(noView.exportOpening())).code).toBe('FORBIDDEN');
    const again = await api.importPreview({ rows });
    expect(await api.importConfirm({ rows, token: again.token, confirm: true })).toEqual({
      imported: 0,
      skipped: 1,
    });
    const changed = structuredClone(rows);
    changed[0]!.data.accessories![0]!.unitPrice = '0.3';
    const difference = await api.importPreview({ rows: changed });
    expect(difference.valid).toBe(false);
    expect(difference.rows[0]!.error).toContain('禁止覆盖');
    await expect(
      api.importConfirm({ rows: changed, token: again.token, confirm: true }),
    ).rejects.toThrow();
    // 旧单表不能在重导时悄悄删除已有附属设备。
    changed[0]!.data.accessories = [];
    expect((await api.importPreview({ rows: changed })).valid).toBe(false);
    expect((await code(api.reset())).code).toBe('FIXED_ASSETS_RESET_UNAVAILABLE');
    expect(await api.detail({ id })).toEqual(original);
  });
  it('w_xt_kgzb_zc/w_zcgl_kp_fssb：第二张卡片附属写入失败，整批卡片/附属/启用设置/日志回滚', async () => {
    const oldId = await api.save({
      data: {
        ...data,
        code: 'OLD',
        accessories: [{ code: 'OLD-A', name: '旧配件', quantity: '1', unitPrice: '10' }],
      },
    });
    const old = await api.detail({ id: oldId });
    const rows = ['NEW1', 'NEW2'].map((code, index) => ({
      row: index + 2,
      data: {
        ...data,
        code,
        accessories: [
          { code: 'A', name: index ? '模拟失败附属' : '新配件', quantity: '0.1', unitPrice: '0.2' },
        ],
      },
    }));
    const logsBefore = await app.svc.db.selectFrom('operation_log').selectAll().execute();
    await sql`CREATE TRIGGER fixed_assets_fail_opening BEFORE INSERT ON fixed_assets_accessory WHEN NEW.name = '模拟失败附属' BEGIN SELECT RAISE(ABORT,'模拟导入中途失败'); END`.execute(
      app.svc.db,
    );
    const preview = await api.importPreview({ rows });
    expect(preview.valid).toBe(true);
    await expect(
      api.importConfirm({ rows, token: preview.token, confirm: true }),
    ).rejects.toThrow();
    expect((await api.list({ includeDisposed: true })).map((c) => c.code)).toEqual(['OLD']);
    expect(await api.detail({ id: oldId })).toEqual(old);
    expect(await app.svcFor('fixed-assets').settings.get('enabled', false)).toBe(false);
    expect(await app.svc.db.selectFrom('operation_log').selectAll().execute()).toEqual(logsBefore);
  });
  it('w_xt_kgzb_zc/w_zcgl_kp_fssb：附属变更使预览失效、只读用户不能预览或确认导入', async () => {
    const rows = [
      {
        row: 2,
        data: {
          ...data,
          accessories: [{ code: 'A', name: '配件', quantity: '0.1', unitPrice: '0.2' }],
        },
      },
    ];
    const preview = await api.importPreview({ rows });
    rows[0]!.data.accessories[0]!.quantity = '0.2';
    expect(
      (await code(api.importConfirm({ rows, token: preview.token, confirm: true }))).code,
    ).toBe('FIXED_ASSETS_PREVIEW_CHANGED');
    const readOnly = caller(
      app,
      await app.addUser('import-viewer', { permissions: ['fixed-assets.view'] }),
    );
    expect((await code(readOnly.importPreview({ rows }))).code).toBe('FORBIDDEN');
    expect(
      (await code(readOnly.importConfirm({ rows, token: preview.token, confirm: true }))).code,
    ).toBe('FORBIDDEN');
    expect(await api.list({})).toEqual([]);
  });
  it('w_zcgl_zs：补零冲突跳过、数字日期校验、确认和锁资产', async () => {
    const id = await api.save({ data: { ...data, code: '1' } });
    await api.save({ data: { ...data, code: '01' } });
    const p = await api.batchPreview({ filter: {}, field: 'padCode', value: '2' });
    expect(p.rows.find((r) => r.id === id)?.error).toContain('已存在');
    await api.batchApply({
      data: { filter: {}, field: 'padCode', value: '2' },
      token: p.token,
      confirm: true,
    });
    expect((await api.detail({ id })).card.code).toBe('1');
    expect(
      (await code(api.batchPreview({ filter: {}, field: 'lifeMonths', value: 'abc' }))).code,
    ).toBe('FIXED_ASSETS_BATCH_NUMBER');
    expect(
      (await code(api.batchPreview({ filter: {}, field: 'acquired', value: '2026-02-30' }))).code,
    ).toBe('FIXED_ASSETS_BATCH_DATE');
  });
  it('w_zcgl_prtmxz/w_zcgl_label/w_zcgl_nd/w_zcgl_fb：报表空态、历史截止与合计', async () => {
    const filter = { year: 2026, cutoff: '2026-12-31' };
    expect((await api.reports({ ...filter, kind: 'labels' })).rows).toHaveLength(0);
    expect((await api.reports({ ...filter, kind: 'reductions' })).empty).toContain('无资产减少');
    const id = await api.save({
      data: {
        ...data,
        accessories: [{ code: '1', name: '配件', quantity: '2', unitPrice: '1.23' }],
      },
    });
    await run(202602);
    const r = await api.reports({
      ...filter,
      kind: 'distribution',
      cutoff: '2026-01-31',
      measure: 'net',
    });
    expect(r.total).toBe(600000);
    expect((await api.reports({ ...filter, kind: 'accessories' })).total).toBe(246);
    expect((await api.reports({ ...filter, kind: 'list' })).rows[0]!.depreciation).toBe(10000);
    expect((await api.detail({ id })).card.original).toBe(600000);
  });
  it('权限：所有写入口拒绝只读用户，敏感读需要权限', async () => {
    const token = await app.addUser('viewer', { permissions: ['fixed-assets.view'] }),
      v = caller(app, token);
    expect(await v.list({})).toEqual([]);
    const denied = [
      v.save({ data }),
      v.saveMaster({ data: { kind: 'reason', code: 'x', name: 'x' } }),
      v.enable(),
      v.reset(),
      v.saveSettings({ depreciationAccountId: 1, clearingAccountId: 1, voucherTypeId: 1 }),
      v.depreciate({ period: 202602, token: '', confirm: true }),
      v.cancel({ id: 1, confirm: true }),
      v.importConfirm({ rows: [{ row: 1, data }], token: '', confirm: true }),
      v.batchApply({ data: { filter: {}, field: 'unit', value: 'x' }, token: '', confirm: true }),
    ];
    for (const p of denied) expect((await code(p)).code).toBe('FORBIDDEN');
    expect((await code(v.getSettings())).code).toBe('FORBIDDEN');
  });
  it('账套隔离：同ID在两个账套只解析本账套卡片，不能携带bookId串库', async () => {
    const id = await api.save({ data });
    const other = await createTestApp({ modules: [server], product: 'minfei' });
    try {
      const b = caller(other);
      expect(await b.list({})).toEqual([]);
      await expect(b.detail({ id })).rejects.toThrow();
      const category = await b.saveMaster({
        data: { kind: 'category', code: '01', name: '另账套类别' },
      });
      const purpose = await b.saveMaster({
        data: { kind: 'purpose', code: '01', name: '另账套用途' },
      });
      const status = await b.saveMaster({
        data: { kind: 'status', code: '01', name: '另账套状态' },
      });
      const otherData = {
        ...data,
        name: '另一账套设备',
        categoryId: category,
        purposeId: purpose,
        statusId: status,
        departmentId: (await other.svc.dimensions.getByCode('department', '01'))!.id,
      };
      expect(await b.save({ data: otherData })).toBe(id);
      expect((await b.detail({ id })).card.name).toBe('另一账套设备');
      await b.save({ id, revision: 1, data: { ...otherData, name: '另一账套已修改' } });
      await expect(b.list({ bookId: app.book.id } as never)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect((await api.detail({ id })).card.name).toBe('服务器');
    } finally {
      await other.close();
    }
  });
  it('w_zcgl_kp_fssb：保存中途附属设备写入失败，卡片、附属和修订全部回滚', async () => {
    const accessory = { code: '01', name: '原设备', quantity: '1', unitPrice: '1' };
    const id = await api.save({ data: { ...data, accessories: [accessory] } });
    await sql`CREATE TRIGGER fixed_assets_fail_accessory BEFORE INSERT ON fixed_assets_accessory BEGIN SELECT RAISE(ABORT,'模拟附属写入失败'); END`.execute(
      app.svc.db,
    );
    await expect(
      api.save({
        id,
        revision: 1,
        data: { ...data, name: '失败新名称', accessories: [{ ...accessory, name: '失败附属' }] },
      }),
    ).rejects.toThrow();
    const d = await api.detail({ id });
    expect(d.card).toMatchObject({ name: '服务器', revision: 1 });
    expect(d.accessories[0]!.name).toBe('原设备');
  });
  it('w_pz_build：来源关联写入失败时，core凭证和分录同事务回滚，可原样重试', async () => {
    await api.save({ data });
    const id = await run(202602),
      p = await api.voucherPreview({ id });
    await sql`CREATE TRIGGER fixed_assets_fail_link BEFORE UPDATE OF voucher_id ON fixed_assets_batch WHEN NEW.voucher_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'模拟关联失败'); END`.execute(
      app.svc.db,
    );
    await expect(api.generateVoucher({ id, token: p.token })).rejects.toThrow();
    expect((await app.svc.vouchers.list({ sourceModule: 'fixed-assets' })).total).toBe(0);
    expect((await api.batches())[0]!.voucher_id).toBeNull();
    await sql`DROP TRIGGER fixed_assets_fail_link`.execute(app.svc.db);
    const v = await api.generateVoucher({ id, token: p.token });
    expect(v.lines).toHaveLength(2);
  });
  it('w_zc_qxfz：core删除后恢复卡片失败，凭证、关联和折旧全部回滚，重试成功且ID不复用', async () => {
    const asset = await api.save({ data }),
      id = await run(202602),
      v = await voucher(id);
    await sql`CREATE TRIGGER fixed_assets_fail_cancel BEFORE UPDATE OF depreciation ON fixed_assets_card WHEN NEW.depreciation < OLD.depreciation BEGIN SELECT RAISE(ABORT,'模拟恢复失败'); END`.execute(
      app.svc.db,
    );
    await expect(api.cancel({ id, confirm: true })).rejects.toThrow();
    expect(await app.svc.vouchers.get(v.id)).not.toBeNull();
    expect((await api.batches())[0]!.voucher_id).toBe(v.id);
    expect((await api.detail({ id: asset })).card.depreciation).toBe(10000);
    await sql`DROP TRIGGER fixed_assets_fail_cancel`.execute(app.svc.db);
    await api.cancel({ id, confirm: true });
    const next = await run(202602);
    expect(next).not.toBe(id);
    await api.cancel({ id, confirm: true });
    expect((await api.batches())[0]!.id).toBe(next);
  });
  it('w_zjjs / w_pz_build：并发重复确认仅生成一个批次、一张来源凭证', async () => {
    await api.save({ data });
    const p = await api.preview({ period: 202602 });
    const ids = await Promise.all(
      Array.from({ length: 5 }, () =>
        api.depreciate({ period: 202602, token: p.token, confirm: true }),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    const id = ids[0]!,
      vp = await api.voucherPreview({ id });
    const vouchers = await Promise.all(
      Array.from({ length: 5 }, () => api.generateVoucher({ id, token: vp.token })),
    );
    expect(new Set(vouchers.map((v) => v.id)).size).toBe(1);
    expect((await app.svc.vouchers.list({ sourceModule: 'fixed-assets' })).total).toBe(1);
  });
  it('w_zcgl_kp：所有必填字段逐项拦截，日期/数量格式和未核实方法拒绝', async () => {
    for (const field of [
      'code',
      'name',
      'categoryId',
      'statusId',
      'purposeId',
      'departmentId',
      'useDate',
      'original',
      'method',
      'lifeMonths',
    ]) {
      const raw = { ...data } as Record<string, unknown>;
      delete raw[field];
      await expect(api.save({ data: raw as CardInput })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    await expect(api.save({ data: { ...data, useDate: '2026-02-30' } })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(api.save({ data: { ...data, quantity: '1.1234567' } })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(api.save({ data: { ...data, method: '3' as '1' } })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(
      await api.save({ data: { ...data, lifeMonths: 24, confirmShortLife: true } }),
    ).toBeGreaterThan(0);
  });
  it('w_zjjs：非法原值/累计折旧和超工作量均阻止，首月不能跨过应提月', async () => {
    expect(() =>
      calculateDepreciation(
        {
          original: 100,
          residual: 10,
          depreciation: 101,
          months: 0,
          lifeMonths: 60,
          method: '1',
          totalWorkE6: 0,
          workE6: 0,
        },
        0,
      ),
    ).toThrow(/原值/);
    expect(() =>
      calculateDepreciation(
        {
          original: 100,
          residual: 0,
          depreciation: 0,
          months: 0,
          lifeMonths: 0,
          method: '2',
          totalWorkE6: 100,
          workE6: 90,
        },
        11,
      ),
    ).toThrow(/工作量/);
    await api.save({ data });
    expect((await code(api.preview({ period: 202603 }))).code).toBe('FIXED_ASSETS_MONTH_GAP');
    const p = await api.preview({ period: 202602 });
    await api.save({ data: { ...data, code: 'B' } });
    expect(
      (await code(api.depreciate({ period: 202602, token: p.token, confirm: true }))).code,
    ).toBe('FIXED_ASSETS_PREVIEW_CHANGED');
  });
  it('w_zjjs：缺失工作量跳过会保存具体原因；实际零工作量明确记录而非缺失', async () => {
    const id = await api.save({ data: { ...data, method: '2', lifeMonths: 0, totalWork: '100' } });
    await run(202602, true);
    const q = await api.query({ from: 202602, to: 202602, showZero: true });
    expect(q.rows[0]!.issue).toBe('缺少当月工作量');
    await api.setWork({ id, period: 202603, quantity: '0' });
    const p = await api.preview({ period: 202603 });
    expect(p.rows[0]!.skip).toBe(false);
    expect(p.total).toBe(0);
  });
  it('w_zcgl_delete：先计提注销月、缺原因和日期拒绝；审核清理凭证无法撤销注销', async () => {
    const id = await api.save({ data });
    expect(
      (await code(api.disposalPreview({ id, date: '2026-02-28', reasonId, generate: false }))).code,
    ).toBe('FIXED_ASSETS_DISPOSAL_DEPRECIATION');
    await expect(
      api.disposalPreview({ id, date: '', reasonId, generate: false }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      api.disposalPreview({ id, date: '2026-01-31', reasonId: 0, generate: false }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await run(202602);
    const p = await api.disposalPreview({ id, date: '2026-02-28', reasonId, generate: true });
    const vid = await api.dispose({
      id,
      date: '2026-02-28',
      reasonId,
      generate: true,
      token: p.token,
      confirm: true,
    });
    await app.svc.vouchers.changeStatus({ ids: [vid!], to: 'audited' });
    expect((await code(api.undoDisposal({ id, confirm: true }))).code).toBe('VOUCHER_LOCKED');
    expect((await api.detail({ id })).card.disposal_date).toBe('2026-02-28');
  });
  it('w_pz_build：科目缺失/停用/非末级、用途无映射、必填辅助项与开账边界给修复入口', async () => {
    await api.save({ data });
    const id = await run(202602);
    await api.saveMaster({
      id: purposeId,
      data: { kind: 'purpose', code: '01', name: '管理用', accountId: null },
    });
    const e = await code(api.voucherPreview({ id }));
    expect(e.code).toBe('FIXED_ASSETS_ACCOUNT_MISSING');
    expect(e.actions?.[0]?.to).toBe('/m/fixed-assets/settings');
    await api.saveMaster({
      id: purposeId,
      data: {
        kind: 'purpose',
        code: '01',
        name: '管理用',
        accountId: (await app.svc.accounts.require('1122')).id,
      },
    });
    expect((await code(api.voucherPreview({ id }))).code).toBe('FIXED_ASSETS_ACCOUNT_DIMENSION');
    await expect(api.preview({ period: 202512 })).rejects.toThrow(/早于/);
  });
  it('w_xt_kgzb_zc：期初耗尽/负值/重号/未来日期拒绝，变动字段不冒充相同重导', async () => {
    const rows = [{ row: 2, data: { ...data, openingMonths: 60, openingDepreciation: 0 } }];
    expect((await api.importPreview({ rows })).rows[0]!.error).toContain('年限');
    const valid = [{ row: 2, data }];
    const p = await api.importPreview({ rows: valid });
    await api.importConfirm({ rows: valid, token: p.token, confirm: true });
    const changed = [{ row: 2, data: { ...data, lifeMonths: 120 } }];
    expect((await api.importPreview({ rows: changed })).rows[0]!.error).toContain('不同');
    expect(
      (
        await api.importPreview({
          rows: [{ row: 2, data: { ...data, code: 'C', useDate: '2026-02-01' } }],
        })
      ).valid,
    ).toBe(false);
    expect(
      (
        await api.importPreview({
          rows: [
            { row: 2, data: { ...data, code: 'B' } },
            { row: 3, data: { ...data, code: 'B' } },
          ],
        })
      ).valid,
    ).toBe(false);
  });
  it('w_zcgl_zs：预览变化/未确认拒绝、锁资产不能变、闭月不改历史', async () => {
    const id = await api.save({ data });
    const raw = { filter: {}, field: 'unit' as const, value: '件' },
      p = await api.batchPreview(raw);
    expect((await code(api.batchApply({ data: raw, token: p.token, confirm: false }))).code).toBe(
      'FIXED_ASSETS_CONFIRM',
    );
    await api.save({ id, revision: 1, data: { ...data, name: '新名称' } });
    expect((await code(api.batchApply({ data: raw, token: p.token, confirm: true }))).code).toBe(
      'FIXED_ASSETS_PREVIEW_CHANGED',
    );
    const b = await run(202602);
    await voucher(b);
    expect((await api.batchPreview(raw)).rows[0]!.error).toContain('凭证');
  });
  it('w_zcgl_prtmxz：明细账的新增、原值调整、折旧和注销余额可逆序核对', async () => {
    const id = await api.save({ data });
    await api.adjust({
      id,
      date: '2026-01-15',
      value: 660000,
      note: '增加设备价值',
      expectedOriginal: 600000,
      expectedChain: 600000,
      confirmMismatch: false,
    });
    await run(202602);
    const p = await api.disposalPreview({ id, date: '2026-02-28', reasonId, generate: false });
    await api.dispose({
      id,
      date: '2026-02-28',
      reasonId,
      generate: false,
      token: p.token,
      confirm: true,
    });
    const r = await api.reports({ kind: 'ledger', year: 2026, cutoff: '2026-02-28' });
    expect(r.rows.map((r) => r.description)).toEqual([
      '新增资产',
      '原值调整',
      '计提折旧',
      '注销资产',
    ]);
    expect(r.rows.at(-1)).toMatchObject({ original: 0, depreciation: 0, net: 0 });
    expect(r.total).toBe(0);
  });
  it('w_zcgl_nd_1：月末日期到期按日历截断，含以前年度范围正确', async () => {
    expect(dueDate('2024-01-31', 1)).toBe('2024-02-29');
    expect(dueDate('2025-01-31', 1)).toBe('2025-02-28');
    const events = buildAssetHistory(
      {
        id: 1,
        acquired: '2025-01-01',
        is_opening: 1,
        base_original: 100,
        opening_depreciation: 20,
        disposal_date: null,
      },
      '2026-01-01',
      [],
      [],
    );
    expect(events[0]).toMatchObject({
      date: '2026-01-01',
      originalChange: 100,
      depreciationChange: 20,
    });
  });
});

describe('w_zjjs fast-check 整数分不变量', () => {
  it('随机原值、残值、年限：计满不超上限、整数分、撤销恢复、重算一致', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000000 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 240 }),
        (original, rate, lifeMonths) => {
          const residual = Number(new Decimal(original).mul(rate).div(100).floor());
          const v = {
            original,
            residual,
            depreciation: 0,
            months: 0,
            lifeMonths,
            method: '1',
            totalWorkE6: 0,
            workE6: 0,
          };
          let sum = 0;
          for (let i = 0; i < lifeMonths; i++) {
            const before = { ...v };
            const amount = calculateDepreciation(v, 0);
            expect(Number.isSafeInteger(amount)).toBe(true);
            expect(amount).toBeGreaterThanOrEqual(0);
            v.depreciation += amount;
            v.months++;
            sum += amount;
            expect(sum).toBeLessThanOrEqual(original - residual);
            expect(calculateDepreciation(before, 0)).toBe(amount);
            Object.assign(v, before);
            expect(v.depreciation).toBe(sum - amount);
            v.depreciation += amount;
            v.months++;
          }
          expect(sum).toBe(original - residual);
        },
      ),
      { numRuns: 150 },
    );
  });
  it('随机工作量：最终尾差精确封顶、撤销恢复百万分之一数量', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000000 }),
        fc.integer({ min: 0, max: 100 }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 20 }),
        (original, rate, works) => {
          const residual = Number(new Decimal(original).mul(rate).div(100).floor());
          const v = {
            original,
            residual,
            depreciation: 0,
            months: 0,
            lifeMonths: 0,
            method: '2',
            totalWorkE6: qtyToE6(works.reduce((s, w) => s + w, 0)),
            workE6: 0,
          };
          for (const work of works) {
            const before = { ...v },
              amount = calculateDepreciation(v, qtyToE6(work));
            expect(Number.isSafeInteger(amount)).toBe(true);
            v.depreciation += amount;
            v.workE6 += qtyToE6(work);
            expect(v.depreciation).toBeLessThanOrEqual(original - residual);
            expect({
              ...v,
              depreciation: v.depreciation - amount,
              workE6: v.workE6 - qtyToE6(work),
            }).toEqual(before);
          }
          expect(v.depreciation).toBe(original - residual);
        },
      ),
      { numRuns: 150 },
    );
  });
});
