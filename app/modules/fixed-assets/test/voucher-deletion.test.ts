import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import type { CardInput } from '../shared';
import server from '../server';

let app: TestApp;
const caller = (testApp: TestApp) => testApp.call(server);
let api: ReturnType<typeof caller>;
let data: CardInput;
let voucherTypeId: number;
let reasonId: number;
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'minfei' });
  api = caller(app);
  const id = async (code: string) => (await app.svc.accounts.require(code)).id;
  voucherTypeId = (await app.svc.reference.voucherTypes())[0]!.id;
  data = {
    code: 'DEL001',
    name: '删除保护设备',
    categoryId: await api.saveMaster({
      data: { kind: 'category', code: '01', name: '办公设备', accountId: await id('1601') },
    }),
    purposeId: await api.saveMaster({
      data: { kind: 'purpose', code: '01', name: '管理用', accountId: await id('6602') },
    }),
    statusId: await api.saveMaster({ data: { kind: 'status', code: '01', name: '在用' } }),
    departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
    acquired: '2026-01-01',
    useDate: '2026-01-01',
    original: 600000,
    rate: '0',
    method: '1',
    lifeMonths: 60,
  };
  reasonId = await api.saveMaster({ data: { kind: 'reason', code: '01', name: '报废' } });
  await api.saveSettings({
    depreciationAccountId: await id('1602'),
    clearingAccountId: await id('1601'),
    voucherTypeId,
  });
  await app.svc.voucherPolicy.set({
    numbering: 'automatic',
    renumberAfterDelete: true,
    allowModifyOthers: true,
  });
});
afterEach(async () => app.close());

async function depreciate() {
  const assetId = await api.save({ data });
  const preview = await api.preview({ period: 202602 });
  const batchId = await api.depreciate({ period: 202602, token: preview.token, confirm: true });
  const voucher = await api.voucherPreview({ id: batchId });
  const saved = await api.generateVoucher({ id: batchId, token: voucher.token });
  return { assetId, batchId, voucherId: saved.id };
}
async function manualVoucher() {
  return app.svc.vouchers.create({
    date: '2026-02-28',
    voucherTypeId,
    lines: [
      {
        summary: '后续凭证',
        accountId: (await app.svc.accounts.require('1001')).id,
        debit: 100,
        credit: 0,
      },
      {
        summary: '后续凭证',
        accountId: (await app.svc.accounts.require('6001')).id,
        debit: 0,
        credit: 100,
      },
    ],
  });
}

describe('w_zc_qxfz / w_pz_build / w_zcgl_delete：来源凭证删除与重排', () => {
  it('预览无来源后新生成凭证时拒绝旧确认；重新预览后才能取消折旧', async () => {
    await app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    const assetId = await api.save({ data });
    const depreciation = await api.preview({ period: 202602 });
    const batchId = await api.depreciate({
      period: 202602,
      token: depreciation.token,
      confirm: true,
    });
    const emptyCancel = await api.cancelPreview({ id: batchId });
    const emptyDelete = await api.voucherDeletePreview({ id: batchId });
    expect(emptyCancel.voucherDeletion).toBeNull();
    expect(emptyDelete.voucherId).toBeNull();
    const voucherPreview = await api.voucherPreview({ id: batchId });
    const voucher = await api.generateVoucher({ id: batchId, token: voucherPreview.token });
    await expect(
      api.cancel({ id: batchId, confirm: true, expectedVoucherId: emptyCancel.batch.voucher_id }),
    ).rejects.toThrow(/关联已变化/);
    await expect(
      api.deleteVoucher({ id: batchId, confirm: true, expectedVoucherId: emptyDelete.voucherId }),
    ).rejects.toThrow(/关联已变化/);
    expect((await api.detail({ id: assetId })).card.depreciation).toBe(10000);
    expect((await api.batches())[0]!.voucher_id).toBe(voucher.id);
    expect(await app.svc.vouchers.get(voucher.id)).not.toBeNull();
    const fresh = await api.cancelPreview({ id: batchId });
    await api.cancel({
      id: batchId,
      confirm: true,
      expectedVoucherId: fresh.batch.voucher_id,
      voucherDeletion: fresh.voucherDeletion!,
    });
    expect((await api.detail({ id: assetId })).card.depreciation).toBe(0);
    expect(await api.batches()).toEqual([]);
    expect(await app.svc.vouchers.get(voucher.id)).toBeNull();
  });

  it('未确认编号计划时保留全部数据；展示影响并确认后取消折旧、恢复累计数并重排', async () => {
    const { assetId, batchId, voucherId } = await depreciate();
    const later = await manualVoucher();
    await expect(api.cancel({ id: batchId, confirm: true })).rejects.toThrow(/预览/);
    expect((await api.detail({ id: assetId })).card.depreciation).toBe(10000);
    expect((await app.svc.vouchers.get(later.id))!.number).toBe(2);
    const preview = await api.cancelPreview({ id: batchId });
    expect(preview.voucherDeletion?.ids).toEqual([voucherId]);
    expect(preview.voucherDeletion?.targets[0]?.displayNo).toBe('记-0001');
    expect(preview.voucherDeletion?.impacts).toMatchObject([
      { id: later.id, oldNumber: 2, number: 1, displayNo: '记-0002' },
    ]);
    await api.cancel({
      id: batchId,
      confirm: true,
      voucherDeletion: preview.voucherDeletion!,
    });
    expect((await api.detail({ id: assetId })).card).toMatchObject({
      depreciation: 0,
      months: 0,
    });
    expect(await api.batches()).toEqual([]);
    expect(await app.svc.vouchers.get(voucherId)).toBeNull();
    expect((await app.svc.vouchers.get(later.id))!.number).toBe(1);
  });

  it('删除凭证预览过期或编号集合改变时不删除来源、不解除关联', async () => {
    const { batchId, voucherId } = await depreciate();
    const preview = await api.voucherDeletePreview({ id: batchId });
    await manualVoucher();
    await expect(
      api.deleteVoucher({ id: batchId, confirm: true, voucherDeletion: preview.voucherDeletion! }),
    ).rejects.toThrow(/变化/);
    expect((await api.batches())[0]!.voucher_id).toBe(voucherId);
    expect(await app.svc.vouchers.get(voucherId)).not.toBeNull();
    const fresh = await api.voucherDeletePreview({ id: batchId });
    await expect(
      api.deleteVoucher({
        id: batchId,
        confirm: true,
        voucherDeletion: { ...fresh.voucherDeletion!, expiresAt: 1 },
      }),
    ).rejects.toThrow(/过期/);
    await api.deleteVoucher({
      id: batchId,
      confirm: true,
      voucherDeletion: fresh.voucherDeletion!,
    });
    expect((await api.batches())[0]!.voucher_id).toBeNull();
  });

  it('不能用其他凭证的有效计划删除并解除本资产来源', async () => {
    const { batchId, voucherId } = await depreciate();
    const other = await manualVoucher();
    const otherPlan = await app.svc.vouchers.previewDelete([other.id]);
    await expect(
      api.deleteVoucher({ id: batchId, confirm: true, voucherDeletion: otherPlan }),
    ).rejects.toThrow(/不一致/);
    expect((await api.batches())[0]!.voucher_id).toBe(voucherId);
    expect(await app.svc.vouchers.get(other.id)).not.toBeNull();
  });

  it('删除计划确认仍须显式confirm，拒绝后来源与编号保持', async () => {
    const { batchId, voucherId } = await depreciate();
    const preview = await api.voucherDeletePreview({ id: batchId });
    await expect(
      api.deleteVoucher({ id: batchId, confirm: false, voucherDeletion: preview.voucherDeletion! }),
    ).rejects.toThrow(/确认/);
    expect(await app.svc.vouchers.get(voucherId)).not.toBeNull();
    expect((await api.batches())[0]!.voucher_id).toBe(voucherId);
  });

  it('受影响的后续凭证已审核时禁止预览；计划后审核也拒绝并完整回滚', async () => {
    const { assetId, batchId, voucherId } = await depreciate();
    const later = await manualVoucher();
    const preview = await api.cancelPreview({ id: batchId });
    await app.svc.vouchers.changeStatus({ ids: [later.id], to: 'audited' });
    await expect(api.cancelPreview({ id: batchId })).rejects.toThrow(/审核/);
    await expect(
      api.cancel({ id: batchId, confirm: true, voucherDeletion: preview.voucherDeletion! }),
    ).rejects.toThrow(/审核/);
    expect((await api.detail({ id: assetId })).card.depreciation).toBe(10000);
    expect((await api.batches())[0]!.voucher_id).toBe(voucherId);
    expect((await app.svc.vouchers.get(later.id))!.number).toBe(2);
  });

  it('撤销注销先预览清理凭证删除及重排，再恢复卡片并删除凭证', async () => {
    const assetId = await api.save({ data });
    const dep = await api.preview({ period: 202602 });
    await api.depreciate({ period: 202602, token: dep.token, confirm: true });
    const preview = await api.disposalPreview({
      id: assetId,
      date: '2026-02-28',
      reasonId,
      generate: true,
    });
    const voucherId = await api.dispose({
      id: assetId,
      date: '2026-02-28',
      reasonId,
      generate: true,
      confirm: true,
      token: preview.token,
    });
    const later = await manualVoucher();
    await expect(api.undoDisposal({ id: assetId, confirm: true })).rejects.toThrow(/预览/);
    expect((await api.detail({ id: assetId })).card.disposal_date).toBe('2026-02-28');
    const undo = await api.undoDisposalPreview({ id: assetId });
    expect(undo.voucherDeletion?.ids).toEqual([voucherId]);
    expect(undo.voucherId).toBe(voucherId);
    await expect(
      api.undoDisposal({ id: assetId, confirm: true, expectedVoucherId: null }),
    ).rejects.toThrow(/关联已变化/);
    expect((await api.detail({ id: assetId })).card.disposal_date).toBe('2026-02-28');
    await api.undoDisposal({
      id: assetId,
      confirm: true,
      expectedVoucherId: undo.voucherId,
      voucherDeletion: undo.voucherDeletion!,
    });
    expect((await api.detail({ id: assetId })).card).toMatchObject({
      disposal_date: null,
      voucher_id: null,
      depreciation: 10000,
    });
    expect(await app.svc.vouchers.get(voucherId!)).toBeNull();
    expect((await app.svc.vouchers.get(later.id))!.number).toBe(1);
  });
});
