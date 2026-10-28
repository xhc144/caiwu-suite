import { readFileSync } from 'node:fs';
import { parseTemplate, type AccountingTemplateInput, type TemplateAccount } from '@caiwu/core';
import { PAWN_BASE_VERSION } from '..';

type RawAccount = Omit<TemplateAccount, 'balanceNature' | 'isContra' | 'sourceVersion'> & {
  contra: boolean;
  balanceNature: 'one-sided' | 'two-sided';
  scope: string;
};

/** 测试只读当前企业基表JSON，遵循既有chart-meaning映射；不import或复制books模块。 */
export function getPawnBaseTemplate() {
  const read = (file: string): unknown =>
    JSON.parse(
      readFileSync(new URL(`../../../../books/templates/${file}`, import.meta.url), 'utf8'),
    );
  const base = read('enterprise.json') as AccountingTemplateInput & { accounts: RawAccount[] };
  const updates = read('enterprise-updates.json') as RawAccount[];
  const details = read('enterprise-details.json') as RawAccount[];
  const rows = [
    [base.accounts, '财会〔2006〕18号附录'],
    [updates, '正式后续增补（截至2026年10月）'],
    [details, '原版a01/a02常用明细'],
  ] as const;
  return parseTemplate({
    ...base,
    version: PAWN_BASE_VERSION,
    accounts: rows.flatMap(([accounts, sourceVersion]) =>
      accounts.map(({ contra, balanceNature, scope: _scope, ...account }) => ({
        ...account,
        name: account.code === '6403' ? '税金及附加' : account.name,
        isContra: contra,
        balanceNature: [
          'profit',
          'retained-earnings',
          'year-retained-earnings',
          'clearing',
        ].includes(account.closingRule ?? '')
          ? 'no-closing-balance'
          : balanceNature === 'two-sided'
            ? 'both'
            : account.direction,
        sourceVersion,
      })),
    ),
  });
}
