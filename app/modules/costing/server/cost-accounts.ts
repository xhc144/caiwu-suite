import { DIMENSION_TYPE_IDS, type VoucherLineInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { fail } from './math';

export async function requireCostAccount(svc: CoreServices, id: number, label: string) {
  const account = await svc.accounts.get(id);
  if (!account || !account.isLeaf || account.disabled)
    fail('ACCOUNT', `${label}必须选择存在且未停用的明细科目`, '请重新选择明细科目');
  if (account.currency || account.quantityUnit)
    fail('ACCOUNT', `${label}不能使用外币或数量科目`, '请选择本位币金额核算科目');
  return account;
}

export async function stockLine(
  svc: CoreServices,
  id: number | null,
  amount: number,
  quantity: string,
  unit: string,
) {
  const account = id ? await svc.accounts.get(id) : null;
  if (!account || !account.isLeaf || account.disabled || account.currency)
    fail('ACCOUNT', '完工产品必须设置可用的本位币存货明细科目', '请在产品档案补全存货科目');
  if (account.quantityUnit && account.quantityUnit !== unit)
    fail(
      'QUANTITY_UNIT',
      '完工产品计量单位与存货科目数量单位不同',
      '请统一产品和科目单位，不能直接将一种单位的数量记入另一种单位',
    );
  const dimensions: NonNullable<VoucherLineInput['dimensions']> = {};
  for (const config of account.dimensions) {
    if (config.required && !config.defaultItemId)
      fail('DIMENSION', '完工存货科目缺少默认辅助核算项', '请先补全科目的默认辅助项');
    if (config.defaultItemId) dimensions[config.type] = config.defaultItemId;
  }
  return {
    accountId: account.id,
    dimensions,
    debit: amount,
    ...(account.quantityUnit ? { quantity, entrySide: 'debit' as const } : {}),
  };
}

export async function accountBalances(
  svc: CoreServices,
  ids: number[],
  period: number,
  excludeClosing = false,
) {
  const accounts = await Promise.all(ids.map((id) => requireCostAccount(svc, id, '归集科目')));
  const rows = await svc.ledger.balances({
    periodFrom: period,
    periodTo: period,
    accountCodes: accounts.map((a) => a.code),
    groupBy: [...DIMENSION_TYPE_IDS],
    rollup: false,
    includeUnposted: true,
    excludeClosing,
  });
  return rows.filter((row) => ids.includes(row.accountId));
}
