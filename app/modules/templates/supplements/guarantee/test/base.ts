import { readFileSync } from 'node:fs';
import { parseTemplate } from '@caiwu/core';
import { baseTemplateId, baseVersion } from '../presets';

/** 仅测试只读现有JSON数据；不import books模块代码，不复制或注册基表。 */
export function readEnterpriseBaseForTest() {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../books/templates/${name}.json`, import.meta.url), 'utf8'),
    );
  const raw = read('enterprise');
  return parseTemplate({
    ...raw,
    id: baseTemplateId,
    version: baseVersion,
    status: 'current',
    devOnly: false,
    accounts: [
      ...raw.accounts.map((a: Record<string, unknown>) => ({
        ...a,
        sourceVersion: '财会〔2006〕18号附录',
      })),
      ...read('enterprise-updates').map((a: Record<string, unknown>) => ({
        ...a,
        sourceVersion: '正式后续增补（截至2026年10月）',
      })),
      ...read('enterprise-details').map((a: Record<string, unknown>) => ({
        ...a,
        sourceVersion: '原版a01/a02常用明细',
      })),
    ].map((a: Record<string, unknown>) => ({
      ...a,
      name: a.code === '6403' ? '税金及附加' : a.name,
      isContra: a.contra,
      balanceNature: ['profit', 'retained-earnings', 'year-retained-earnings', 'clearing'].includes(
        String(a.closingRule),
      )
        ? 'no-closing-balance'
        : a.balanceNature === 'two-sided'
          ? 'both'
          : a.direction,
    })),
  });
}
