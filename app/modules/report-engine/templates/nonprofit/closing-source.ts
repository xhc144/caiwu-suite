import type { Account, AccountCategory, Voucher } from '@caiwu/core';
import { exactSum } from './model';

/** 仅兼容期末模块真实生成、结构完整的自定义损益结转；正式生成仍须核对结清及资源分类。 */
export function nonprofitClosingKind(
  voucher: Voucher,
  accounts: Account[],
  categories: AccountCategory[],
): string | null {
  const original = voucher.closingKind;
  if (
    !original ||
    !/^period-close:[A-Za-z0-9_-]{1,30}$/.test(original) ||
    voucher.source?.module !== 'period-close' ||
    voucher.source.type !== 'closing' ||
    !new RegExp(`^${voucher.period}:[1-9][0-9]*$`).test(voucher.source.id)
  )
    return original;
  const ruleId = Number(voucher.source.id.split(':')[1]);
  if (!Number.isSafeInteger(ruleId)) return original;
  const pnl = new Set(categories.filter((c) => c.isPnl).map((c) => c.id));
  let hasPnl = false,
    hasNetAssets = false;
  for (const line of voucher.lines) {
    const account = accounts.find((a) => a.id === line.accountId);
    if (!account?.isLeaf || account.code !== line.accountCode) return original;
    if (pnl.has(account.categoryId)) {
      if (line.debit !== 0 || line.credit !== 0) hasPnl = true;
    } else if (
      account.categoryId === 'net-assets' &&
      ['3101', '3102'].includes(account.code.slice(0, 4))
    ) {
      if (line.debit !== 0 || line.credit !== 0) hasNetAssets = true;
    } else return original;
  }
  if (
    !hasPnl ||
    !hasNetAssets ||
    voucher.debitTotal !== voucher.creditTotal ||
    exactSum(voucher.lines.map((l) => l.debit)) !== voucher.debitTotal ||
    exactSum(voucher.lines.map((l) => l.credit)) !== voucher.creditTotal
  )
    return original;
  return 'pnl';
}
