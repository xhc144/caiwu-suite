import { readFileSync } from 'node:fs';
import { parseTemplate, type AccountClosingRule, type AccountingTemplateInput } from '@caiwu/core';

type RawAccount = Omit<AccountingTemplateInput['accounts'][number], 'balanceNature'> & {
  contra: boolean;
  balanceNature: 'one-sided' | 'two-sided';
  closingRule: AccountClosingRule;
};

/**
 * 仅测试用只读适配器。读取任务允许的既有企业科目数据，不 import books 模块代码。
 * 对应 books/chart.ts 已有的2006.18+2026.2原生基表组装，生产调用方必须传入登记基表。
 */
export function readOnlyEnterpriseBase() {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../books/templates/${name}`, import.meta.url), 'utf8'),
    );
  const primary = read('enterprise.json') as Omit<AccountingTemplateInput, 'accounts'> & {
    accounts: RawAccount[];
  };
  const updates = read('enterprise-updates.json') as RawAccount[];
  const details = read('enterprise-details.json') as RawAccount[];
  return parseTemplate({
    ...primary,
    version: '2006.18+2026.2',
    accounts: [
      ...primary.accounts.map((account) => ({ ...account, sourceVersion: '财会〔2006〕18号附录' })),
      ...updates.map((account) => ({
        ...account,
        sourceVersion: '正式后续增补（截至2026年10月）',
      })),
      ...details.map((account) => ({ ...account, sourceVersion: '原版a01/a02常用明细' })),
    ].map((account) => ({
      ...account,
      name: account.code === '6403' ? '税金及附加' : account.name,
      isContra: account.contra,
      balanceNature: ['profit', 'retained-earnings', 'year-retained-earnings', 'clearing'].includes(
        account.closingRule,
      )
        ? 'no-closing-balance'
        : account.balanceNature === 'two-sided'
          ? 'both'
          : account.direction,
    })),
  });
}
