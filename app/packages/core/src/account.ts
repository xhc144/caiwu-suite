import type { DimensionTypeId } from './dimensions';

export type BalanceDirection = 'debit' | 'credit';

/** 科目结转用途；null/未提供表示旧账未声明，不从名称或来源文字推断。 */
export const ACCOUNT_CLOSING_RULES = [
  'none',
  'profit',
  'retained-earnings',
  'year-retained-earnings',
  'clearing',
  'seasonal-allocation',
] as const;
export type AccountClosingRule = (typeof ACCOUNT_CLOSING_RULES)[number];

export const DIRECTION_LABELS: Record<BalanceDirection, string> = { debit: '借', credit: '贷' };

export interface AccountCategory {
  id: string;
  name: string;
  direction: BalanceDirection;
  isPnl: boolean;
  sort: number;
}

export interface AccountDimensionConfig {
  type: DimensionTypeId;
  required: boolean;
  defaultItemId: number | null;
}

/** 科目（接口返回的形态）。 */
export interface Account {
  isContra?: boolean;
  balanceNature?: 'debit' | 'credit' | 'both' | 'no-closing-balance' | null;
  closingRule?: AccountClosingRule | null;
  source?: string | null;
  sourceVersion?: string | null;
  id: number;
  code: string;
  name: string;
  /** 带上级的全名："银行存款/工商银行" */
  fullName: string;
  parentId: number | null;
  level: number;
  categoryId: string;
  direction: BalanceDirection;
  isLeaf: boolean;
  disabled: boolean;
  isCash: boolean;
  isBank: boolean;
  /** 现金流量标志：凭证上要填现金流量项目 */
  cashflowRequired: boolean;
  isPartner: boolean;
  /** 外币核算币种；null 表示只核算本位币 */
  currency: string | null;
  /** 数量核算单位；null 表示不核算数量 */
  quantityUnit: string | null;
  /** 名称拼音首字母（小写），用于模糊搜索 */
  pinyin: string;
  /** 助记码 */
  mnemonic: string | null;
  dimensions: AccountDimensionConfig[];
}

export interface DimensionItem {
  revision?: number;
  id: number;
  typeId: DimensionTypeId;
  code: string;
  name: string;
  parentId: number | null;
  isLeaf: boolean;
  pinyin: string;
  disabled: boolean;
  /** 维度自己的扩展字段，例如客供的联系人、税号；部门的负责人 */
  attrs: Record<string, unknown>;
}

/** 有符号余额（借正贷负）换算成"方向 + 金额"用于显示。 */
export function balanceSide(signed: number, accountDirection: BalanceDirection) {
  if (signed === 0) return { side: '平' as const, amount: 0 };
  if (accountDirection === 'debit') {
    return signed > 0
      ? { side: '借' as const, amount: signed }
      : { side: '贷' as const, amount: -signed };
  }
  return signed < 0
    ? { side: '贷' as const, amount: -signed }
    : { side: '借' as const, amount: signed };
}

/** 有符号余额（借正贷负）按科目方向取正负："贷方科目余额 1000" → 1000。 */
export function balanceInDirection(signed: number, direction: BalanceDirection): number {
  return direction === 'debit' ? signed : -signed;
}
