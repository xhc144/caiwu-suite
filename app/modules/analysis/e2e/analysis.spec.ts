import ExcelJS from 'exceljs';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import { test, expect } from './fixture';

const { Workbook } = ExcelJS;

test('w_fx_zl：真实三笔应收→部分回款→FIFO分桶核对→改区间→含未过账→Excel→穿透明细', async ({
  page,
  isolated,
}, testInfo) => {
  const { bookId } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(bookId, async (svc) => {
    for (const [date, amount] of [
      ['2026-01-15', 10000],
      ['2026-03-01', 20000],
      ['2026-04-01', 30000],
    ] as const) {
      const input = await voucherInputFromSpec(svc, {
        date: '2026-04-01',
        lines: [
          { account: '1122', debit: amount, dims: { partner: 'C001' } },
          { account: '6001', credit: amount },
        ],
      });
      const v = await svc.vouchers.create({
        ...input,
        lines: input.lines.map((l, i) => ({ ...l, bizDate: i === 0 ? date : null })),
      });
      await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
      await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
    }
    await seedVouchers(svc, [
      {
        date: '2026-04-10',
        status: 'posted',
        lines: [
          { account: '1122', credit: 15000, dims: { partner: 'C001' } },
          { account: '6001', debit: 15000 },
        ],
      },
      {
        date: '2026-04-14',
        status: 'pending',
        lines: [
          { account: '1122', debit: 5000, dims: { partner: 'C001' } },
          { account: '6001', credit: 5000 },
        ],
      },
      {
        date: '2026-04-30',
        status: 'posted',
        lines: [
          { account: '1122', debit: 99000, dims: { partner: 'C001' } },
          { account: '6001', credit: 99000 },
        ],
      },
    ]);
  });
  await page.goto(`${isolated.origin}/m/analysis/aging`);
  await expect(page.getByRole('heading', { name: '账龄分析' })).toBeVisible();
  await page.getByLabel('科目', { exact: true }).fill('1122');
  await page.keyboard.press('Enter');
  await page.getByLabel('截止日期').fill('2026-04-15');
  await page.getByLabel('区间上限（天）').fill('30,60,90');
  await page.getByRole('button', { name: '查询' }).click();
  const row = page.locator('.cw-data-table').first().getByRole('row').filter({ hasText: 'C001' });
  await expect(row).toContainText('300.00');
  await expect(row).toContainText('150.00');
  await expect(row).toContainText('450.00');
  await expect(row.getByRole('cell').nth(3)).toHaveText('300.00');
  await expect(row.getByRole('cell').nth(4)).toHaveText('150.00');
  await expect(row.getByRole('cell').nth(5)).toHaveText('0.00');
  await expect(page.getByTestId('aging-reconciliation')).toContainText(
    '同截止日总账：450.00；账龄合计：450.00；核对差额：0.00',
  );
  await page.getByLabel('区间上限（天）').fill('10,40,90');
  await page.getByRole('button', { name: '查询' }).click();
  await expect(row.getByRole('cell').nth(3)).toHaveText('0.00');
  await expect(row.getByRole('cell').nth(4)).toHaveText('300.00');
  await expect(row.getByRole('cell').nth(5)).toHaveText('150.00');
  await expect(page.getByTestId('aging-reconciliation')).toContainText('账龄合计：450.00');
  await page.getByRole('button', { name: '保存当前区间为默认' }).click();
  await expect(page.getByRole('button', { name: '保存当前区间为默认' })).not.toHaveClass(
    /ant-btn-loading/,
  );
  await page.getByLabel('包含未过账', { exact: true }).check();
  await page.getByRole('button', { name: '查询' }).click();
  await expect(row.getByRole('cell').nth(3)).toHaveText('50.00');
  await expect(page.getByTestId('aging-reconciliation')).toContainText(
    '同截止日总账：500.00；账龄合计：500.00；核对差额：0.00',
  );
  await page.getByLabel('区间上限（天）').fill('40,10');
  await page.getByRole('button', { name: '查询' }).click();
  await expect(page.getByText('筛选条件无效', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存当前区间为默认' })).toBeDisabled();
  await page.getByLabel('区间上限（天）').fill('10,40,90');
  await page.getByRole('button', { name: '查询' }).click();
  await expect(page.getByTestId('aging-reconciliation')).toContainText('账龄合计：500.00');
  // 原生打印可能在 click 返回前完成；在 beforeprint 中保存实际输出，不延长 iframe 生命周期。
  const printed = await page.evaluateHandle(() => {
    const events: {
      phase: string;
      trusted: boolean;
      html: string;
      text: string;
      pageCss: string;
    }[] = [];
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations)
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLIFrameElement)) continue;
          node.addEventListener(
            'load',
            () => {
              for (const phase of ['beforeprint', 'afterprint'])
                node.contentWindow!.addEventListener(
                  phase,
                  (event) => {
                    const doc = node.contentDocument!;
                    events.push({
                      phase,
                      trusted: event.isTrusted,
                      html: doc.documentElement.outerHTML,
                      text: doc.body.textContent!,
                      pageCss: Array.from(doc.styleSheets)
                        .flatMap((sheet) => Array.from(sheet.cssRules))
                        .filter((rule) => rule.type === CSSRule.PAGE_RULE)
                        .map((rule) => rule.cssText)
                        .join('\n'),
                    });
                    if (phase === 'afterprint') observer.disconnect();
                  },
                  { once: true },
                );
            },
            { capture: true, once: true },
          );
        }
    });
    observer.observe(document.body, { childList: true });
    return events;
  });
  await page.getByRole('button', { name: '打印', exact: true }).click();
  await expect
    .poll(() => printed.evaluate((events) => events.map((event) => event.phase)))
    .toEqual(['beforeprint', 'afterprint']);
  const printEvents = await printed.jsonValue();
  expect(printEvents.every((event) => event.trusted)).toBe(true);
  expect(printEvents[0]!.text).toContain('500.00');
  expect(printEvents[0]!.html).toContain('500.00');
  expect(printEvents[0]!.pageCss).toMatch(/size:\s*a4 landscape/i);
  await expect(page.locator('iframe')).toHaveCount(0);
  await printed.dispose();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('账龄分析-2026-04-15.xlsx');
  const file = testInfo.outputPath('账龄分析.xlsx');
  await download.saveAs(file);
  const wb = new Workbook();
  await wb.xlsx.readFile(file);
  expect(wb.getWorksheet('账龄分析')!.getRow(5).getCell(5).value).toBe(50);
  expect(wb.getWorksheet('账龄分析')!.getRow(5).getCell(6).value).toBe(300);
  expect(wb.getWorksheet('总账核对')!.getRow(2).getCell(4).value).toBe(500);
  const href = await row.getByRole('link', { name: '明细账' }).getAttribute('href');
  const target = new URL(href!, isolated.origin);
  expect(target.pathname).toBe('/m/ledgers/detail');
  expect(Object.fromEntries(target.searchParams)).toMatchObject({
    account: '1122',
    from: '202601',
    to: '202604',
    cutoff: '2026-04-15',
    includeUnposted: '1',
  });
  expect(JSON.parse(target.searchParams.get('dims')!)).toHaveProperty('partner');
  await row.getByRole('button', { name: /核销明细/ }).click();
  const drawer = page.getByRole('dialog', { name: 'FIFO 核销明细' });
  await expect(drawer).toContainText('2026-01-15');
  await expect(drawer).toContainText('2026-03-01');
  await expect(drawer).toContainText('原始业务日期');
  await expect(drawer).toContainText('业务日期缺失，取凭证日期');
  await expect(drawer).toContainText('原始到期日 / 逾期天数');
  const voucherHref = await drawer.getByRole('link').first().getAttribute('href');
  expect(voucherHref).toMatch(/^\/m\/voucher-entry\/edit\?id=\d+$/);
});

test('w_fx_km / w_fx_nd：年度月度真实查询、图形切换、零基数和区间持久化', async ({
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
          { account: '1122', debit: 12000, dims: { partner: 'C001' } },
          { account: '6001', credit: 12000 },
        ],
      },
    ]);
  });
  await page.goto(
    `${isolated.origin}/m/analysis?accountCode=1122&period=202601&mode=monthly&metric=debit`,
  );
  await expect(page.getByRole('heading', { name: '科目年度 / 月度分析' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '1122' });
  await expect(row).toContainText('120.00');
  await expect(row).toContainText('100.00%');
  await expect(page.getByRole('img', { name: /图表类型是柱状图/ })).toBeVisible();
  await page.getByLabel('图形', { exact: true }).click();
  await page.getByText('折线图', { exact: true }).click();
  await expect(page.getByRole('img', { name: /图表类型是折线图/ })).toBeVisible();
  await page.goto(`${isolated.origin}/m/analysis?accountCode=2202&period=202601`);
  await expect(page.getByRole('row').filter({ hasText: '2202' })).toContainText(
    '无法计算：基数为零',
  );
  await page.goto(
    `${isolated.origin}/m/analysis/aging?accountCode=1122&cutoff=2026-01-31&bounds=10,40`,
  );
  await page.getByRole('button', { name: '保存当前区间为默认' }).click();
  await expect(page.getByRole('button', { name: '保存当前区间为默认' })).not.toHaveClass(
    /ant-btn-loading/,
  );
  await page.goto(`${isolated.origin}/m/analysis/aging?accountCode=1122&cutoff=2026-01-31`);
  await expect(page.getByLabel('区间上限（天）')).toHaveValue('10,40');
  await expect(page.getByRole('columnheader', { name: '0–10天' })).toBeVisible();
});
