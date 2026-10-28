import {
  DIMENSION_TYPE_IDS,
  parentCodeOf,
  parseCodeScheme,
  parseTemplate,
  type Account,
  type AccountingTemplate,
} from '@caiwu/core';
import templatesServer from '../server';

export const registeredTemplates = () => templatesServer.templates.map((raw) => parseTemplate(raw));

/** 核对加载器应保留的模板字段；法定名称集合由各独立原文测试另行核对。 */
export function loadedAccountSnapshot(template: AccountingTemplate, rows: Account[]) {
  const scheme = parseCodeScheme(template.codeScheme);
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const definitions = new Map(template.accounts.map((row) => [row.code, row]));
  const fullName = (code: string): string => {
    const parent = parentCodeOf(code, scheme);
    return (parent ? fullName(parent) + '/' : '') + definitions.get(code)!.name;
  };
  return [...template.accounts]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => {
      const parent = parentCodeOf(a.code, scheme);
      return {
        code: a.code,
        name: a.name,
        fullName: fullName(a.code),
        parentId: parent ? byCode.get(parent)!.id : null,
        level:
          scheme.findIndex(
            (_, i) => scheme.slice(0, i + 1).reduce((sum, n) => sum + n, 0) === a.code.length,
          ) + 1,
        categoryId: a.category,
        direction: a.direction ?? template.categories.find((c) => c.id === a.category)!.direction,
        isLeaf: !template.accounts.some((child) => parentCodeOf(child.code, scheme) === a.code),
        disabled: a.disabled ?? false,
        isCash: a.cash ?? false,
        isBank: a.bank ?? false,
        cashflowRequired: a.cashflow ?? false,
        isPartner: a.partner ?? false,
        currency: a.currency ?? null,
        quantityUnit: a.quantityUnit ?? null,
        dimensions: [...a.dimensions]
          .sort((x, y) => DIMENSION_TYPE_IDS.indexOf(x.type) - DIMENSION_TYPE_IDS.indexOf(y.type))
          .map((d) => ({ ...d, defaultItemId: null })),
        isContra: a.isContra ?? false,
        balanceNature: a.balanceNature ?? null,
        closingRule: a.closingRule ?? null,
        sourceVersion: a.sourceVersion ?? template.version,
      };
    });
}
