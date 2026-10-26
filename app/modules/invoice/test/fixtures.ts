import ExcelJS from 'exceljs';
import type { CoreServices } from '@caiwu/core/server';
import type { Direction, InvoiceInput, Settings } from '../shared';
import { sampleHeaders, sampleRows } from '../samples';

export async function sampleFile(
  direction: Direction = 'input',
  rows: unknown[][] = sampleRows,
  headers = sampleHeaders,
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('合成数据');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return {
    direction,
    fileName: '合成5票.xlsx',
    base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
  };
}
export const single = (overrides: Partial<InvoiceInput> = {}): InvoiceInput => ({
  direction: 'input',
  number: '00001',
  date: '2026-01-05',
  confirmDate: '2026-02-05',
  sellerName: '合成销方',
  sellerTaxId: 'TEST-S',
  buyerName: '合成购方',
  kind: '合成测试票',
  amount: 10000,
  tax: 1000,
  total: 11000,
  ...overrides,
});
export async function mapping(
  svc: CoreServices,
  direction: Direction = 'input',
): Promise<Settings> {
  // Create required tax and auxiliary accounts directly via core; do not rely on another module.
  const account = await svc.accounts.create(
    {
      code: direction === 'input' ? '9901' : '9902',
      name: direction === 'input' ? '合成进项税' : '合成销项税',
      categoryId: 'liability',
      direction: direction === 'input' ? 'debit' : 'credit',
    },
    (await svc.book.info()).codeScheme,
  );
  const business = await svc.accounts.require(direction === 'input' ? '6602' : '6001');
  const settlement = await svc.accounts.require(direction === 'input' ? '2202' : '1122');
  const department = (await svc.dimensions.getByCode('department', '01'))!;
  const partner = (await svc.dimensions.getByCode(
    'partner',
    direction === 'input' ? 'S001' : 'C001',
  ))!;
  const expense = await svc.accounts.require('6603');
  return {
    direction,
    expectedRevision: 0,
    taxpayerBasis: 'other',
    inputTaxTreatment: 'separate',
    settlementMode: 'unified',
    business: {
      accountId: business.id,
      dimensions: direction === 'input' ? { department: department.id } : {},
    },
    tax: { accountId: account.id, dimensions: {} },
    settlement: { accountId: settlement.id, dimensions: { partner: partner.id } },
    nonDeductible: { accountId: expense.id, dimensions: {} },
  };
}

/** 合成账票数据：3月启用，确认跨月、红字、跨年确认，税额独立手算。 */
export function midyearInvoices(): InvoiceInput[] {
  return [
    single({ number: 'MID-NORMAL', date: '2026-03-31', confirmDate: '2026-04-01' }),
    single({
      number: 'MID-RED',
      date: '2026-04-02',
      confirmDate: '2026-04-02',
      amount: -2000,
      tax: -200,
      total: -2200,
    }),
    single({
      number: 'MID-CROSS-YEAR',
      date: '2026-12-31',
      confirmDate: '2027-01-01',
      amount: 3000,
      tax: 300,
      total: 3300,
    }),
    single({
      direction: 'output',
      number: 'MID-OUT',
      date: '2026-03-15',
      confirmDate: null,
      amount: 5000,
      tax: 500,
      total: 5500,
    }),
    single({
      direction: 'output',
      number: 'MID-OUT-RED',
      date: '2026-03-20',
      confirmDate: null,
      amount: -1000,
      tax: -100,
      total: -1100,
    }),
  ];
}
