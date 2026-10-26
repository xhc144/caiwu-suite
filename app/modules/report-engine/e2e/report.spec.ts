import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { stat } from 'node:fs/promises';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { BalanceRow } from '@caiwu/core';
import { balanceFormula, emptyTemplate, type Report } from '../shared';
import { test } from './fixture';

const source = balanceFormula({
  account: '1001',
  metric: 'closing',
  unit: 'cents',
  currency: 'CNY',
  direction: 'signed',
  dimension: 'none',
  item: '',
});
const cash = (amount: number, status: 'posted' | 'pending' = 'posted') => ({
  date: '2026-01-05',
  status,
  lines: [
    { account: '1001', debit: amount, dims: { cashflow: 'CF01' } },
    { account: '6001', credit: amount },
  ],
});

test('w_bb_add → w_bb_def/F8 → 保存刷新 → 指定期间生成/重算 → w_bb_saveas真实xlsx', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(bookId, [cash(12345)]);
  await page.goto(`${isolated.baseURL}/m/report-engine`);
  await page.getByRole('button', { name: '新增报表', exact: true }).click();
  const add = page.getByRole('dialog', { name: '新增报表' });
  await add.getByLabel('报表编码').fill('101');
  await add.getByLabel('报表名称').fill('现金报表');
  await add.getByLabel('行数').fill('3');
  await add.getByLabel('列数').fill('2');
  await add.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '报表定义：现金报表' })).toBeVisible();
  const id = Number(new URL(page.url()).searchParams.get('id'));
  await page.getByRole('textbox', { name: 'A1', exact: true }).fill(`=${source}`);
  await page.getByRole('textbox', { name: 'B1', exact: true }).focus();
  await page.keyboard.press('F8');
  const wizard = page.getByRole('dialog', { name: '报表函数向导（F8）' });
  await expect(wizard).toBeVisible();
  await wizard.getByRole('combobox').first().fill('1001');
  await page.keyboard.press('Enter');
  await wizard.getByRole('button', { name: '校验', exact: true }).click();
  await expect(wizard.getByText('语法校验通过；实际引用与单位将在生成时校验')).toBeVisible();
  await wizard.getByRole('button', { name: '插入到当前单元格' }).click();
  await expect(page.getByRole('textbox', { name: 'B1', exact: true })).toHaveValue(source);
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue(`=${source}`);
  await expect(page.getByRole('textbox', { name: 'B1', exact: true })).toHaveValue(source);
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  const result = page.getByTestId('result-A1');
  await expect(result).toContainText('123.45');
  await expect(result.locator('[data-cents]')).toHaveAttribute('data-cents', '12345');
  const core = await callApi<BalanceRow[]>(
    isolated.request,
    'core.ledger.balances',
    { periodFrom: 202601, periodTo: 202601, accountCodes: ['1001'], rollup: false },
    { token },
  );
  expect(core[0]!.closing).toBe(12345);
  expect(await result.locator('[data-cents]').getAttribute('data-cents')).toBe(
    String(core[0]!.closing),
  );
  const detail = page.getByRole('link', { name: 'A1 查看科目 1001 明细' });
  expect(await detail.getAttribute('href')).toBe(
    '/m/ledgers/detail?account=1001&from=202601&to=202601',
  );
  await isolated.seed(bookId, [cash(55)]);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(result.locator('[data-cents]')).toHaveAttribute('data-cents', '12400');
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  const download = await downloadWait;
  const file = (await download.path())!;
  expect((await stat(file)).size).toBeGreaterThan(1000);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  expect(wb.worksheets[0]!.getCell('A1').value).toBe(124);
  expect(wb.worksheets[0]!.getCell('B1').value).toBe(124);
  expect(wb.worksheets[0]!.getCell('A1').note).toContain(source);
  // 原生打印可在 click 返回前清理 iframe；在 beforeprint 中保存真正提交打印的文档。
  const printed = await page.evaluateHandle(() => {
    const events: {
      phase: string;
      trusted: boolean;
      html: string;
      text: string;
      headings: string[];
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
                      headings: Array.from(doc.querySelectorAll('h1')).map(
                        (heading) => heading.textContent!,
                      ),
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
  expect(printEvents[0]!.headings).toEqual(['现金报表']);
  expect(printEvents[0]!.text).toContain('124.00');
  expect(printEvents[0]!.html).toContain('124.00');
  expect(printEvents[0]!.pageCss).toContain('@page');
  await expect(page.locator('iframe')).toHaveCount(0);
  await printed.dispose();
});

test('w_bb_def 未保存取消保留编辑；w_bb_proc 未过账取消/继续/显式纳入', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(bookId, [cash(100), cash(20, 'pending')]);
  const template = emptyTemplate({ code: '101', name: '确认规则', rows: 2, cols: 2 });
  template.cells = [{ address: 'A1', kind: 'formula', source, unit: 'cents', currency: 'CNY' }];
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', template, {
    token,
    method: 'POST',
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  await page.getByRole('textbox', { name: 'A1', exact: true }).fill(`=${source}*2`);
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: '返回列表' }).click();
  await expect(page).toHaveURL(/\/designer\?id=/);
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue(`=${source}*2`);
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await page.getByRole('button', { name: '生成/查看', exact: true }).click();
  await page.getByRole('button', { name: '生成/重算' }).click();
  const warning = page.getByRole('dialog', { name: '生成前发现未过账凭证' });
  await expect(warning).toContainText('1 张未过账凭证');
  expect(await warning.getByRole('link', { name: '待审核凭证' }).getAttribute('href')).toBe(
    '/m/voucher-book?period=202601&status=pending',
  );
  await warning.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByTestId('result-A1')).toHaveCount(0);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await warning.getByRole('button', { name: '按所选口径继续生成' }).click();
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '200',
  );
  await page.getByRole('checkbox', { name: '显式包含未过账（待审核/已审核）' }).check();
  await page.getByRole('button', { name: /查询$/ }).click();
  await page.getByRole('button', { name: '生成/重算' }).click();
  await warning.getByRole('button', { name: '按所选口径继续生成' }).click();
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '240',
  );
  await expect(page.getByText('本结果包含待审核和已审核凭证，不含草稿与作废凭证')).toBeVisible();
});
