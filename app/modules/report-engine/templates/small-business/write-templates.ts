import { writeFile } from 'node:fs/promises';
import { balanceSheetTemplate, cashflowTemplate, incomeTemplate } from './templates';

// 从app运行：node --import tsx modules/report-engine/templates/small-business/write-templates.ts
for (const [name, template] of [
  ['301.json', balanceSheetTemplate()],
  ['302-monthly.json', incomeTemplate()],
  ['302-annual.json', incomeTemplate('annual')],
  ['303-monthly.json', cashflowTemplate()],
  ['303-annual.json', cashflowTemplate('annual')],
] as const)
  await writeFile(new URL(name, import.meta.url), `${JSON.stringify(template, null, 2)}\n`);
