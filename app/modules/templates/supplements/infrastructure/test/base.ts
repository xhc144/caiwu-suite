import { readFileSync } from 'node:fs';
import { parseTemplate, type AccountingTemplateInput } from '@caiwu/core';

type RawAccount = Omit<AccountingTemplateInput['accounts'][number], 'balanceNature'> & {
  contra: boolean;
  balanceNature: 'one-sided' | 'two-sided';
};

/** Read-only integration fixture; no runtime import from another module. */
export function readEnterpriseBase() {
  const read = (file: string): unknown =>
    JSON.parse(
      readFileSync(new URL(`../../../../books/templates/${file}`, import.meta.url), 'utf8'),
    );
  const base = read('enterprise.json') as Omit<AccountingTemplateInput, 'accounts'> & {
    accounts: RawAccount[];
  };
  const all = [
    ...base.accounts,
    ...(read('enterprise-updates.json') as RawAccount[]),
    ...(read('enterprise-details.json') as RawAccount[]),
  ];
  return parseTemplate({
    ...base,
    version: '2006.18+2026.2',
    accounts: all.map((a) => {
      const closing = [
        'profit',
        'retained-earnings',
        'year-retained-earnings',
        'clearing',
      ].includes(a.closingRule ?? 'none');
      return {
        ...a,
        name: a.code === '6403' ? '税金及附加' : a.name,
        isContra: a.contra,
        balanceNature: closing
          ? 'no-closing-balance'
          : a.balanceNature === 'two-sided'
            ? 'both'
            : a.direction,
        sourceVersion: '只读基表合成测试',
      };
    }),
  });
}
