import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi } from '@caiwu/testkit/e2e';
import type { Report, ReportSnapshot } from '../../shared';
import { activity402ClassifiedTemplate } from '../../templates/nonprofit/activity-classified';
import { classifiedMapping } from '../../test/nonprofit/activity-classified-fixture';
import { test } from './fixture';

// 浏览器侧独立列出手算值，不从模板公式或单测golden计算期望。
const hand: Readonly<Record<number, readonly [number, number, number, number]>> = {
  6: [-0.75, 1.25, 9.25, 21.25],
  7: [2, 4, 22, 44],
  8: [3, 6, 33, 66],
  9: [4, 8, 44, 88],
  10: [5, 10, 55, 110],
  11: [6, 12, 66, 132],
  12: [-3, 14, 67, 154],
  13: [8, 16, 88, 176],
  14: [24.25, 71.25, 384.25, 791.25],
  16: [7.65, 17.4, 97.65, 197.4],
  19: [10, 20, 110, 220],
  20: [11, 22, 121, 242],
  21: [12, 24, 132, 264],
  23: [13, 26, 143, 286],
  24: [14, 28, 154, 308],
  25: [-5, 30, 145, 330],
  26: [62.65, 167.4, 902.65, 1847.4],
};

for (const kind of ['classified', 'classified-closed'] as const)
  test(`w_bb_get/proc/saveas 402独立${kind}：实际15×4格、退款与小计真实生成和xlsx读回`, async ({
    page,
    nonprofit,
  }) => {
    const bookId = await nonprofit.createBook(kind);
    const login = await callApi<{ token: string; user: unknown; book: unknown }>(
      nonprofit.request,
      'core.auth.login',
      { bookId, userCode: 'admin', password: 'admin' },
    );
    await page.addInitScript(
      (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
      { token: login.token, bookId, user: login.user, book: login.book },
    );
    const report = await callApi<Report>(
      nonprofit.request,
      'm.report-engine.importTemplate',
      activity402ClassifiedTemplate(classifiedMapping()),
      { token: login.token, method: 'POST' },
    );
    await page.goto(`${nonprofit.baseURL}/m/report-engine/view?id=${report.id}&period=202602`);
    await page.getByRole('button', { name: '生成/重算' }).click();
    await expect(page.getByTestId('result-A1')).toContainText('收入费用分类取数切片');
    const snapshot = await callApi<ReportSnapshot>(
      nonprofit.request,
      'm.report-engine.snapshot',
      { id: report.id, period: 202602 },
      { token: login.token, method: 'GET' },
    );
    expect(snapshot.checks).toHaveLength(34);
    expect(snapshot.checks.every((c) => c.status === 'pass' && c.difference === '0')).toBe(true);
    const values = new Map(snapshot.cells.map((c) => [c.address, c.value]));
    for (const [row, amounts] of Object.entries(hand)) {
      for (const [index, col] of ['B', 'C', 'E', 'F'].entries()) {
        const expected = amounts[index]!;
        expect(values.get(`${col}${row}`)).toBe(String(Math.round(expected * 100)));
        await expect(page.getByTestId(`result-${col}${row}`)).toHaveText(
          expected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        );
      }
    }
    for (const row of [27, 28, 29, 30])
      for (const col of ['B', 'C', 'D', 'E', 'F', 'G'])
        expect(values.get(`${col}${row}`)).toBe('待接入真实取数');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Excel' }).click();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await (await download).path())!);
    const ws = wb.worksheets[0]!;
    for (const [row, amounts] of Object.entries(hand))
      for (const [index, col] of ['B', 'C', 'E', 'F'].entries())
        expect(ws.getCell(`${col}${row}`).value, `${col}${row}`).toBe(amounts[index]);
    expect(ws.getCell('D14').value).toBe(95.5);
    expect(ws.getCell('G14').value).toBe(1175.5);
    expect(ws.getCell('D26').value).toBe(230.05);
    expect(ws.getCell('G26').value).toBe(2750.05);
    expect(ws.getCell('G30').value).toBe('待接入真实取数');
    expect(ws.getCell('A3').value).toContain('公共原子门禁未接通');
  });
