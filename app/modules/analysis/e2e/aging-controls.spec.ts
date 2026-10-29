import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import { test, expect } from './fixture';
import { ORIGINAL_AGING_BOUNDS } from '../shared';

test('w_fx_zl 15桶保存刷新、列宽左右调整恢复与失败提示、年份保留月日及闰日', async ({
  page,
  isolated,
}) => {
  const { bookId } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(bookId, async (svc) => {
    await svc.periods.ensureYear(2027);
    await seedVouchers(svc, [
      {
        date: '2026-01-15',
        status: 'posted',
        lines: [
          { account: '1122', debit: 12345, dims: { partner: 'C001' } },
          { account: '6001', credit: 12345 },
        ],
      },
    ]);
  });
  const url = `${isolated.origin}/m/analysis/aging?accountCode=1122&cutoff=2026-04-15`;
  await page.goto(url);
  await page.getByRole('button', { name: '使用原版15个账龄区间' }).click();
  await expect(page.getByRole('columnheader', { name: /^0–30天(?:\s|$)/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^31–60天(?:\s|$)/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^1096天及以上(?:\s|$)/ })).toBeVisible();
  const saved = page.waitForResponse(
    (r) => r.url().includes('m.analysis.saveConfig') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存当前区间为默认' }).click();
  expect((await saved).status()).toBe(200);
  await page.goto(url);
  await expect(page.getByLabel('区间上限（天）')).toHaveValue(ORIGINAL_AGING_BOUNDS.join(','));
  await expect(page.getByRole('columnheader', { name: /^1096天及以上(?:\s|$)/ })).toBeVisible();
  const table = page.locator('.cw-data-table').first();
  const header = table.getByRole('columnheader', { name: /^科目(?:\s|$)/ });
  await page.getByRole('button', { name: '选中列加宽10像素' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('caiwu.table.analysis.aging.widths') ?? '{}').account,
      ),
    )
    .toBe(180);
  await expect
    .poll(() => header.evaluate((cell) => Math.round(cell.getBoundingClientRect().width)))
    .toBe(180);
  await page.reload();
  await expect
    .poll(() => header.evaluate((cell) => Math.round(cell.getBoundingClientRect().width)))
    .toBe(180);
  await page.getByRole('button', { name: '选中列缩窄10像素' }).click();
  await expect
    .poll(() => header.evaluate((cell) => Math.round(cell.getBoundingClientRect().width)))
    .toBe(170);
  await page.getByRole('button', { name: '恢复默认列宽' }).click();
  expect(
    await page.evaluate(() => localStorage.getItem('caiwu.table.analysis.aging.widths')),
  ).toBeNull();
  await page.evaluate(() => {
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true,
      value: () => {
        throw new DOMException('本次测试拒绝写入', 'QuotaExceededError');
      },
    });
    Object.defineProperty(Storage.prototype, 'removeItem', {
      configurable: true,
      value: () => {
        throw new DOMException('本次测试拒绝删除', 'SecurityError');
      },
    });
  });
  await page.getByRole('button', { name: '选中列加宽10像素' }).click();
  await expect(page.getByText(/列宽未保存，当前显示保持不变/)).toBeVisible();
  await page.getByRole('button', { name: '恢复默认列宽' }).click();
  await expect(page.getByText(/列宽未恢复，当前显示保持不变/)).toBeVisible();
  await page.reload();
  await page.getByLabel('截止日期').fill('2028-02-29');
  await page.getByRole('button', { name: '选择截止年份' }).click();
  const dialog = page.getByRole('dialog', { name: '选择账龄分析年份' });
  await dialog.getByRole('spinbutton', { name: '截止年份' }).fill('2025');
  await dialog.getByRole('button', { name: '应用年份并查询' }).click();
  await expect(dialog.getByText(/早于账套启用年份/)).toBeVisible();
  await expect(page.getByLabel('截止日期')).toHaveValue('2028-02-29');
  await dialog.getByRole('spinbutton', { name: '截止年份' }).fill('2027');
  await dialog.getByRole('button', { name: '应用年份并查询' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('截止日期')).toHaveValue('2027-02-28');
  await expect(page.getByText('目标年份没有2月29日，截止日期已调整为2027-02-28')).toBeVisible();
  await header.dblclick();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('spinbutton', { name: '截止年份' }).fill('2026');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('截止日期')).toHaveValue('2027-02-28');
});

test('m_work_fx_zl Ctrl+P 使用当前账龄快照真实调用打印桥，详情窗口不截获', async ({
  page,
  isolated,
}) => {
  const { bookId } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(bookId, async (svc) => {
    await seedVouchers(svc, [
      {
        date: '2026-01-15',
        status: 'posted',
        lines: [
          { account: '1122', debit: 12345, dims: { partner: 'C001' } },
          { account: '6001', credit: 12345 },
        ],
      },
    ]);
  });
  await page.goto(`${isolated.origin}/m/analysis/aging?accountCode=1122&cutoff=2026-04-15`);
  await expect(page.getByTestId('aging-reconciliation')).toContainText('账龄合计：123.45');
  await expect(page.getByRole('button', { name: '打印', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    document.body.dataset.agingPrintCount = '0';
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.agingPrint = html;
        document.body.dataset.agingPrintCount = String(
          Number(document.body.dataset.agingPrintCount) + 1,
        );
      },
      printToPdf: async () => null,
    };
  });
  await page.keyboard.press('Control+p');
  await expect.poll(() => page.locator('body').getAttribute('data-aging-print-count')).toBe('1');
  const printed = await page.locator('body').getAttribute('data-aging-print');
  expect(printed).toContain('账龄分析');
  expect(printed).toContain('123.45');
  expect(printed).toContain('2026-04-15');
  await page.getByRole('button', { name: /核销明细 C001/ }).click();
  await expect(page.getByRole('dialog', { name: 'FIFO 核销明细' })).toBeVisible();
  const canceled = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      code: 'KeyP',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(canceled).toBe(false);
  expect(await page.locator('body').getAttribute('data-aging-print-count')).toBe('1');
});
