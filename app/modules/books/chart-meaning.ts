import { z } from 'zod';
import { ACCOUNT_CLOSING_RULES, type TemplateAccount } from '@caiwu/core';

/** 原始资料的余额/结转性质与共享字段的明确对应，不限制凭证的借贷侧。 */
export const AccountMeaningSchema = z.object({
  contra: z.boolean(),
  balanceNature: z.enum(['one-sided', 'two-sided']),
  closingRule: z.enum(ACCOUNT_CLOSING_RULES),
  scope: z.string().min(1),
});
export type AccountMeaning = z.infer<typeof AccountMeaningSchema>;
export type RawChartAccount = Omit<TemplateAccount, 'dimensions' | 'balanceNature'> &
  Partial<Pick<TemplateAccount, 'dimensions'>> &
  AccountMeaning;

export function nativeMeaning(raw: AccountMeaning, direction: 'debit' | 'credit') {
  const meaning = AccountMeaningSchema.parse(raw);
  const closes = ['profit', 'retained-earnings', 'year-retained-earnings', 'clearing'].includes(
    meaning.closingRule,
  );
  return {
    isContra: meaning.contra,
    balanceNature: closes
      ? ('no-closing-balance' as const)
      : meaning.balanceNature === 'two-sided'
        ? ('both' as const)
        : direction,
  };
}

export const closingLabels: Record<AccountMeaning['closingRule'], string> = {
  none: '按余额列示',
  profit: '结转本年利润后无余额',
  'retained-earnings': '结转未分配利润后无余额',
  'year-retained-earnings': '年度结转未分配利润后无余额',
  clearing: '结清后无余额',
  'seasonal-allocation': '季节性生产按规定分配结转',
};
