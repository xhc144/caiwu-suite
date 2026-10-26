import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { balanceSheetSlots, cashflowSlots, profitSlots } from '../../templates/enterprise';
import { test } from './fixture';

const cases = [
  {
    key: 'balance',
    label: '201资产期末/上年末',
    current: balanceSheetSlots.cash!.current,
    previous: balanceSheetSlots.cash!.comparative,
    expected: '176995',
    comparison: '152800',
  },
  {
    key: 'profit',
    label: '202结转前利润/上年同月',
    current: profitSlots.netProfit!.current,
    previous: profitSlots.netProfit!.comparative,
    expected: '10195',
    comparison: '800',
  },
  {
    key: 'cashflow',
    label: '203现金项目/上年同月',
    current: cashflowSlots.operatingReceipts!.current,
    previous: cashflowSlots.operatingReceipts!.comparative,
    expected: '16500',
    comparison: '1000',
  },
] as const;

for (const c of cases)
  test(`W2-02 联合共享契约 ${c.label}：独立账套→UI引入→真实生成→Excel`, async ({
    page,
    enterprise,
  }) => {
    const { bookId } = await loginWithNewBook(page, enterprise.request, {
      product: 'qingsong',
      startYear: 2025,
    });
    const templates = await enterprise.seed(bookId, 'comparative');
    const template = templates[c.key]!;
    await page.goto(`${enterprise.baseURL}/m/report-engine`);
    await page.getByLabel('引入JSON模板').setInputFiles({
      name: `${template.code}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(template)),
    });
    await page
      .getByRole('row')
      .filter({ hasText: template.name })
      .getByRole('button', { name: '生成/查看', exact: true })
      .click();
    await expect(page).toHaveURL(/\/view\?id=/);
    const id = new URL(page.url()).searchParams.get('id');
    await page.goto(`${enterprise.baseURL}/m/report-engine/view?id=${id}&period=202601`);
    await page.getByRole('button', { name: '生成/重算', exact: true }).click();
    await expect(page.getByTestId(`result-${c.current}`).locator('[data-cents]')).toHaveAttribute(
      'data-cents',
      c.expected,
    );
    await expect(page.getByTestId(`result-${c.previous}`).locator('[data-cents]')).toHaveAttribute(
      'data-cents',
      c.comparison,
    );
    await expect(page.getByTestId('result-A2')).toContainText('禁止用它核对比较数');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await (await downloadPromise).path())!);
    expect(wb.worksheets[0]!.getCell(c.current).value).toBe(Number(c.expected) / 100);
    expect(wb.worksheets[0]!.getCell(c.previous).value).toBe(Number(c.comparison) / 100);
    expect(wb.worksheets[0]!.getCell('A2').value).toContain('不可作为完整法定报表');
  });
