import { writeFile } from 'node:fs/promises';
import { cashflowTemplate } from './templates';
import {
  extendedAnnualCashflowTemplate,
  extendedBalanceSheetTemplate,
  extendedIncomeTemplate,
} from './extended';

// 从app运行：node --import tsx modules/report-engine/templates/small-business/write-templates.ts
for (const [name, template] of [
  ['301.json', extendedBalanceSheetTemplate()],
  ['302-monthly.json', extendedIncomeTemplate()],
  ['302-annual.json', extendedIncomeTemplate('annual')],
  ['303-monthly.json', cashflowTemplate()],
  ['303-annual.json', extendedAnnualCashflowTemplate()],
] as const)
  await writeFile(new URL(name, import.meta.url), `${JSON.stringify(template, null, 2)}\n`);
