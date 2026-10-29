import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import { test, expect } from './fixture';

test('w_fx_demo_tx：真实图形选择、坐标转换、彩色/黑白独立打印与负数饼图保护', async ({
  page,
  isolated,
}) => {
  const { bookId } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(bookId, async (svc) => {
    await seedVouchers(svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '1122', debit: 12345, dims: { partner: 'C001' } },
          { account: '6001', credit: 12345 },
        ],
      },
    ]);
  });
  await page.goto(
    `${isolated.origin}/m/analysis?accountCode=1122&period=202601&mode=monthly&metric=debit`,
  );
  await expect(page.getByRole('img', { name: /图表类型是柱状图/ })).toBeVisible();
  await page.getByRole('button', { name: '坐标转换', exact: true }).click();
  await expect(page.getByText('数值横轴、项目纵轴', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复坐标', exact: true })).toBeVisible();
  await page.getByLabel('图形', { exact: true }).click();
  await page.getByText('折线图', { exact: true }).click();
  await expect(page.getByRole('img', { name: /图表类型是折线图/ })).toBeVisible();
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.chartPrinted = html;
      },
      printToPdf: async () => null,
    };
  });
  const permission = page.waitForResponse((response) =>
    response.url().includes('m.analysis.printAllowed'),
  );
  await page.getByRole('button', { name: '独立打印图形', exact: true }).click();
  const choice = page.getByRole('dialog', { name: '选择图形打印颜色' });
  await choice.getByRole('radio', { name: '彩色', exact: true }).check();
  await choice.getByRole('button', { name: '打印图形', exact: true }).click();
  expect((await permission).ok()).toBe(true);
  await expect(choice).toHaveCount(0);
  const color = await page.locator('body').getAttribute('data-chart-printed');
  expect(color).toContain('data-color-mode="color"');
  expect(color).toContain('条形图形打印');
  expect(color).toContain('折线图（坐标已转换）');
  expect(color).toContain('123.45');
  expect(color).toContain('background:#1765b3');
  expect(color).not.toMatch(/<(?:svg|img|script|canvas)\b/);
  expect(color).toContain("default-src 'none'");
  await page.getByRole('button', { name: '独立打印图形', exact: true }).click();
  await choice.getByRole('radio', { name: '黑白', exact: true }).check();
  await choice.getByRole('button', { name: '打印图形', exact: true }).click();
  await expect(choice).toHaveCount(0);
  const monochrome = await page.locator('body').getAttribute('data-chart-printed');
  expect(monochrome).toContain('data-color-mode="monochrome"');
  expect(monochrome).toContain('background:#333');
  expect(monochrome).not.toMatch(/#1765b3|#c75b16/);
  await page.getByRole('button', { name: '独立打印图形', exact: true }).click();
  await choice.getByRole('button', { name: '取消', exact: true }).click();
  await expect(choice).toHaveCount(0);
  expect(await page.locator('body').getAttribute('data-chart-printed')).toBe(monochrome);
  await page.getByRole('button', { name: '恢复坐标', exact: true }).click();
  await expect(page.getByText('项目横轴、数值纵轴', { exact: true })).toBeVisible();
  await page.getByLabel('图形', { exact: true }).click();
  await page.getByText('饼图', { exact: true }).click();
  await expect(page.getByRole('button', { name: '坐标转换', exact: true })).toBeDisabled();
  await page.goto(
    `${isolated.origin}/m/analysis?accountCode=6001&period=202601&mode=monthly&metric=balance`,
  );
  await page.getByLabel('图形', { exact: true }).click();
  await page.getByText('饼图', { exact: true }).click();
  await expect(page.getByText('含负数时无法绘制饼图，请选择柱图或折线图')).toBeVisible();
  await expect(page.getByRole('button', { name: '独立打印图形', exact: true })).toBeDisabled();
});
