import { BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';

export type AssetVoucherDeletionPlan = {
  ids: number[];
  expiresAt: number;
  fingerprint: string;
};

/** 预览只通过共享凭证服务取数，签名由共享服务持有。 */
export async function previewAssetVoucherDeletion(svc: CoreServices, voucherId: number | null) {
  if (voucherId == null) return null;
  svc.permissions.require('fixed-assets.voucher');
  const plan = await svc.vouchers.previewDelete([voucherId]);
  const target = await svc.vouchers.get(voucherId);
  const impacts = await Promise.all(
    plan.impacts.map(async (impact) => {
      const voucher = await svc.vouchers.get(impact.id);
      return { ...impact, displayNo: voucher?.displayNo ?? '', date: voucher?.date ?? '' };
    }),
  );
  return {
    ...plan,
    targets: target ? [{ id: target.id, displayNo: target.displayNo, date: target.date }] : [],
    impacts,
  };
}

/** 必须在业务事务内调用；只允许删除当前业务仍关联的那张凭证。 */
export async function deleteAssetVoucher(
  svc: CoreServices,
  voucherId: number | null,
  plan?: AssetVoucherDeletionPlan,
  expectedVoucherId?: number | null,
) {
  if (expectedVoucherId !== undefined && expectedVoucherId !== voucherId)
    throw new BusinessError({
      code: 'FIXED_ASSETS_DELETION_CHANGED',
      message: '来源凭证关联已变化',
      hint: '请重新预览当前资产业务后确认',
    });
  if (voucherId == null) {
    if (plan)
      throw new BusinessError({
        code: 'FIXED_ASSETS_DELETION_CHANGED',
        message: '来源凭证关联已变化',
        hint: '请重新预览后确认',
      });
    return;
  }
  svc.permissions.require('fixed-assets.voucher');
  if (plan) {
    if (plan.ids.length !== 1 || plan.ids[0] !== voucherId)
      throw new BusinessError({
        code: 'FIXED_ASSETS_DELETION_CHANGED',
        message: '删除预览与当前来源凭证不一致',
        hint: '请重新预览当前资产业务后确认',
      });
    await svc.vouchers.deleteBatch(plan, true);
    return;
  }
  // 保留旧接口关闭重排时的明确删除确认；启用重排时必须先展示签名计划。
  await svc.vouchers.delete(voucherId);
}
