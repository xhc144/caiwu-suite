import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { downloadBlob } from '@caiwu/ui';
import type { Report, ReportGroup, ReportRow } from '../shared';
import { sumLeaves } from '../server/service';
import { exportReport } from '../web/output';

vi.mock('@caiwu/ui', () => ({ downloadBlob: vi.fn() }));
const download = vi.mocked(downloadBlob);
beforeEach(() => download.mockClear());

// 独立整数分 oracle；不用被测导出转换或 Number 元值来计算期望。
function exactYuan(cents: number) {
  const n = BigInt(cents);
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

function group(cents: number, currency: string, quantity = false): ReportGroup {
  const row: ReportRow = {
    accountId: 1,
    accountCode: '1403',
    accountName: '合成精度样例',
    parentId: null,
    level: 1,
    isLeaf: true,
    direction: 'debit',
    dimensions: {},
    opening: cents,
    debit: cents,
    credit: cents,
    closing: cents,
    ytdDebit: cents,
    ytdCredit: cents,
    fcOpening: cents,
    fcDebit: cents,
    fcCredit: cents,
    fcClosing: cents,
    fcYtdDebit: cents,
    fcYtdCredit: cents,
    qtyYtdDebit: '2.500003',
    qtyYtdCredit: '0',
    qtyOpening: '0.000001',
    qtyDebit: '2.500003',
    qtyCredit: '0',
    qtyClosing: '2.500004',
  };
  return {
    currency,
    rows: [row],
    totals: sumLeaves([row]),
    ...(quantity
      ? {
          unit: '件',
          quantityTotals: {
            qtyOpening: row.qtyOpening,
            qtyDebit: row.qtyDebit,
            qtyCredit: row.qtyCredit,
            qtyClosing: row.qtyClosing,
            qtyYtdDebit: row.qtyYtdDebit,
            qtyYtdCredit: row.qtyYtdCredit,
          },
        }
      : {}),
  };
}

function report(mode: Report['mode'], cents: number): Report {
  return {
    periodFrom: 202601,
    periodTo: 202601,
    orgName: '合成单位',
    baseCurrency: 'CNY',
    dimensions: {},
    includeUnposted: false,
    mode,
    scope: '精度回归',
    groups: [group(cents, mode === 'foreign' ? 'USD' : '', mode === 'quantity')],
  };
}

async function exported(input: Report) {
  await exportReport(input, -1, []);
  expect(download).toHaveBeenCalledTimes(1);
  const [blob, name] = download.mock.calls[0]!;
  expect(name).toMatch(/\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
}

function assertAmount(cell: ExcelJS.Cell, cents: number, numeric: boolean) {
  const expected = exactYuan(cents);
  if (numeric) {
    expect(typeof cell.value).toBe('number');
    expect((cell.value as number).toFixed(2)).toBe(expected);
  } else {
    expect(cell.value).toBe(expected);
    expect(typeof cell.value).toBe('string');
  }
}

const cases = [
  { name: '一分', cents: 1, numeric: true },
  { name: '零', cents: 0, numeric: true },
  { name: '普通正额', cents: 12345, numeric: true },
  { name: '普通红字', cents: -12345, numeric: true },
  { name: '15位分值边界', cents: 999999999999999, numeric: true },
  { name: '15位分值负边界', cents: -999999999999999, numeric: true },
  { name: '16位分值即使恰好可转仍保守文本', cents: 1000000000000000, numeric: false },
  { name: '独审一分偏移正例', cents: 9007199254740901, numeric: false },
  { name: '独审一分偏移负额红字', cents: -9007199254740901, numeric: false },
  { name: '安全整数最大分值', cents: Number.MAX_SAFE_INTEGER, numeric: false },
  { name: '安全整数最小分值', cents: Number.MIN_SAFE_INTEGER, numeric: false },
];

for (const mode of ['summary', 'foreign', 'quantity'] as const) {
  describe(`w_zw_ye/w_zw_wbye/w_zw_slye ${mode} 真实 XLSX 金额回读`, () => {
    it.each(cases)('$name：所有本位币/原币金额列与合计逐分不变', async ({ cents, numeric }) => {
      const wb = await exported(report(mode, cents));
      const ws = wb.worksheets[0]!;
      for (const col of [4, 10]) assertAmount(ws.getRow(5).getCell(col), Math.abs(cents), numeric);
      const signed = mode === 'foreign' ? [5, 6, 7, 8, 11, 12, 13, 14, 15, 16] : [5, 6, 7, 8];
      for (const col of signed) {
        assertAmount(ws.getRow(5).getCell(col), cents, numeric);
        assertAmount(ws.getRow(6).getCell(col), cents, numeric);
      }
      const [whole, fraction] = exactYuan(Math.abs(cents)).split('.');
      const grouped = `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
      const pair = cents < 0 ? `0.00 / ${grouped}` : `${grouped} / 0.00`;
      expect(ws.getCell('D6').value).toBe(pair);
      expect(ws.getCell('J6').value).toBe(pair);
      if (mode === 'quantity') {
        expect(ws.getRow(5).getCell(12).value).toBe('2.500003');
        expect(ws.getRow(6).getCell(14).value).toBe('2.500004');
      }
    });
  });
}

it('w_zw_fhwbye USD/EUR 正负极值独立导出且原币不因回读错一分', async () => {
  const input = report('foreign', 9007199254740901);
  input.auxiliary = true;
  input.groups.push(group(-Number.MAX_SAFE_INTEGER, 'EUR'));
  const wb = await exported(input);
  expect(wb.worksheets.map((ws) => ws.name)).toEqual(['1-USD', '2-EUR']);
  expect(wb.worksheets[0]!.getCell('A2').text).toContain('币种：USD');
  expect(wb.worksheets[1]!.getCell('A2').text).toContain('币种：EUR');
  for (const row of [5, 6]) {
    for (const col of [11, 12, 13, 14, 15, 16]) {
      expect(wb.worksheets[0]!.getRow(row).getCell(col).value).toBe('90071992547409.01');
      expect(wb.worksheets[1]!.getRow(row).getCell(col).value).toBe('-90071992547409.91');
    }
  }
});
