import { expect } from '@playwright/test';
import { seedVouchers } from '@caiwu/testkit';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { balanceFormula, emptyTemplate, type Report } from '../../shared';
import { test } from '../../test/shared/e2e-fixture';

test('w_bb_def_help 可选父科目1002并按末级分向，不能悄悄选择首个下级100201', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, async (svc) => {
    await seedVouchers(svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '100201', debit: 301, dims: { cashflow: 'CF01' } },
          { account: '6001', credit: 301 },
        ],
      },
      {
        date: '2026-01-06',
        status: 'posted',
        lines: [
          { account: '100202', credit: 103, currency: 'USD', rate: '1', fcAmount: 103 },
          { account: '4001', debit: 103 },
        ],
      },
    ]);
  });
  const base = {
    account: '1002',
    metric: 'closing' as const,
    unit: 'cents' as const,
    currency: 'CNY',
    direction: 'signed' as const,
    dimension: 'none' as const,
    item: '',
  };
  const template = emptyTemplate({ code: '101', name: '父科目分向', rows: 2, cols: 1 });
  template.cells = [
    {
      address: 'A2',
      source: balanceFormula(base),
      kind: 'formula',
      unit: 'cents',
      currency: 'CNY',
    },
  ];
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', template, {
    token,
    method: 'POST',
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  await page.getByRole('textbox', { name: 'A1', exact: true }).focus();
  await page.keyboard.press('F8');
  const wizard = page.getByRole('dialog', { name: '报表函数向导（F8）' });
  await wizard.getByRole('combobox').first().fill('1002');
  await page.keyboard.press('Enter');
  await wizard.getByRole('checkbox', { name: '使用扩展取数口径（第八参数）' }).check();
  await wizard.getByLabel('余额分向', { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .filter({ hasText: /^逐末级及辅助分组取正借方余额$/ })
    .click();
  await wizard.getByRole('button', { name: '插入到当前单元格' }).click();
  const source = balanceFormula({
    ...base,
    options: { from: 'current', to: 'current', closing: 'include', side: 'debit', groupBy: [] },
  });
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue(source);
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${r.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '301',
  );
  await expect(page.getByTestId('result-A2').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '198',
  );
});
