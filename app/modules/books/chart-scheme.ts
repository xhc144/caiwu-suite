import {
  mapTemplateScheme,
  parentCodeOf,
  parseCodeScheme,
  parseTemplate,
  type AccountingTemplate,
} from '@caiwu/core';

export const BOOK_CODE_SCHEMES = ['4-2-2', '4-3-3'] as const;

/** 预览、校验与BookStore.create使用同一个共享转换器。 */
export function mapChart(template: AccountingTemplate, targetText: string): AccountingTemplate {
  return mapTemplateScheme(parseTemplate(template), parseCodeScheme(targetText));
}

export function summarizeChart(template: AccountingTemplate, targetText: string) {
  const mapped = mapChart(template, targetText);
  const scheme = parseCodeScheme(targetText);
  const parents = new Set(
    mapped.accounts.map((account) => parentCodeOf(account.code, scheme)).filter(Boolean),
  );
  return {
    ...mapped,
    primaryCount: mapped.accounts.filter((account) => account.code.length === scheme[0]).length,
    detailCount: mapped.accounts.filter((account) => account.code.length !== scheme[0]).length,
    leafCount: mapped.accounts.filter((account) => !parents.has(account.code)).length,
  };
}
