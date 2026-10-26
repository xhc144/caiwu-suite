import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { balanceSheetSlots } from '../../templates/enterprise';
import { test } from './fixture';

test('w_bb_get→w_bb_proc→w_bb_saveas采购201：独立黄金合成账套，两行两列真实生成及Excel读回', async ({
  page,
  enterprise,
}) => {
  const { bookId } = await loginWithNewBook(page, enterprise.request, {
    product: 'qingsong',
    startYear: 2025,
  });
  const { balance: template } = await enterprise.seed(bookId, 'purchase');
  await page.goto(`${enterprise.baseURL}/m/report-engine`);
  await page.getByLabel('引入JSON模板').setInputFiles({
    name: '201-purchase.json',
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
  // 独立手算：本期借8000+3000+2000，贷4000；上年借4000+1500，贷3000+12000。
  const expected = [
    [balanceSheetSlots.prepayments!.current, '13000', 130],
    [balanceSheetSlots.prepayments!.comparative, '5500', 55],
    [balanceSheetSlots.accountsPayable!.current, '4000', 40],
    [balanceSheetSlots.accountsPayable!.comparative, '15000', 150],
  ] as const;
  for (const [address, cents] of expected)
    await expect(page.getByTestId(`result-${address}`).locator('[data-cents]')).toHaveAttribute(
      'data-cents',
      cents,
    );
  await expect(page.getByTestId('result-A2')).toContainText('不可作为完整法定报表');
  await expect(page.getByTestId('result-A3')).toContainText('202512');
  await expect(page.getByTestId(`result-${balanceSheetSlots.assetsTotal!.current}`)).toContainText(
    '待配置',
  );
  const excluded = template.cells.find((c) =>
    c.source.includes('上年年末 202512 190101/S001：借方排除'),
  )!;
  await expect(page.getByTestId(`result-${excluded.address}`)).toContainText('其他非流动资产');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await downloadPromise).path())!);
  const sheet = wb.worksheets[0]!;
  for (const [address, , yuan] of expected) expect(sheet.getCell(address).value).toBe(yuan);
  expect(sheet.getCell(excluded.address).value).toContain('其他非流动资产');
  expect(sheet.getCell('A2').value).toContain('不可作为完整法定报表');
});
