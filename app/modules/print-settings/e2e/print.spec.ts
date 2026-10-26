import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { openDatabase } from '@caiwu/db';
import {
  createCoreServices,
  emptyModuleLookup,
  loadServiceUser,
  type CoreDB,
} from '@caiwu/core/server';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { defaultSettings, type Settings } from '../shared';

async function seedBook(bookId: string, specs: VoucherSpec[]) {
  const dirs = readdirSync(os.tmpdir()).filter((d) => d.startsWith('caiwu-e2e-'));
  const file = dirs
    .map((d) => path.join(os.tmpdir(), d, 'books', `${bookId}.caiwu`))
    .find(existsSync);
  if (!file) throw new Error('独立 E2E 账套文件不存在');
  const opened = openDatabase<CoreDB>(file);
  try {
    const user = await loadServiceUser(opened.db, 1);
    if (!user) throw new Error('管理员不存在');
    const svc = createCoreServices({
      db: opened.db,
      user,
      moduleId: null,
      now: () => new Date(),
      modules: emptyModuleLookup,
    });
    return await seedVouchers(svc, specs);
  } finally {
    await opened.close();
  }
}
async function installBridge(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as { __printHtml?: string; caiwuDesktop: unknown };
    target.caiwuDesktop = {
      print: async (html: string) => {
        target.__printHtml = html;
      },
      printToPdf: async (html: string) => {
        target.__printHtml = html;
        return null;
      },
    };
  });
}
async function actualPdf(page: Page, context: BrowserContext, expectedPages: number | null) {
  await page.evaluate(() => {
    delete (window as unknown as { __printHtml?: string }).__printHtml;
  });
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __printHtml?: string }).__printHtml ?? ''),
    )
    .toContain('<!doctype html>');
  const html = await page.evaluate(
    () => (window as unknown as { __printHtml: string }).__printHtml,
  );
  const printPage = await context.newPage();
  try {
    await printPage.setContent(html, { waitUntil: 'load' });
    await printPage.emulateMedia({ media: 'print' });
    const pdf = await printPage.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
    // Chromium 的 Page 对象直接写在实际 PDF 文件中；不使用预览数组作为页数依据。
    const objects = [...pdf.toString('latin1').matchAll(/\b\d+\s+\d+\s+obj\b[\s\S]*?endobj/g)].map(
      (m) => m[0],
    );
    const actualPages = objects.filter((o) => /\/Type\s*\/Page\b/.test(o)).length;
    if (expectedPages == null) expect(actualPages).toBeGreaterThan(1);
    else expect(actualPages).toBe(expectedPages);
    const sheets = await printPage
      .locator('.print-sheet')
      .evaluateAll((els) =>
        els.map((el) => ({ height: el.getBoundingClientRect().height, content: el.scrollHeight })),
      );
    expect(sheets.every((s) => s.content <= s.height + 1)).toBe(true);
    const vouchers = await printPage.locator('.voucher').evaluateAll((els) =>
      els.map((el) => ({
        slot: el.getBoundingClientRect().bottom,
        content: el.firstElementChild!.getBoundingClientRect().bottom,
      })),
    );
    expect(vouchers.every((v) => v.content <= v.slot + 1)).toBe(true);
    const amounts = await printPage
      .locator('td.num')
      .evaluateAll((els) => els.map((el) => ({ width: el.clientWidth, content: el.scrollWidth })));
    expect(amounts.every((v) => v.content <= v.width + 1)).toBe(true);
    if (!test.info().attachments.length)
      await test.info().attach('打印首页', {
        body: await printPage.locator('.print-sheet').first().screenshot(),
        contentType: 'image/png',
      });
  } finally {
    await printPage.close();
  }
  await expect(page.getByText('已取消 PDF 保存', { exact: true }).first()).toBeVisible();
}
const simple = (i: number): VoucherSpec => ({
  date: '2026-01-05',
  status: 'posted',
  attachments: 2,
  summary: `真实打印业务${i}`,
  lines: [
    { account: '1001', debit: 12345 },
    { account: '6603', credit: 12345 },
  ],
});
test('w_pz_prn_1 / w_print_zc：真实凭证与明细账实际 PDF 各一页；三凭证两张一页为两页', async ({
  page,
  request,
  context,
}) => {
  const book = await loginWithNewBook(page, request);
  const vouchers = await seedBook(book.bookId, [simple(1), simple(2), simple(3)]);
  await installBridge(page);
  await page.goto(`/m/print-settings/preview?voucherId=${vouchers[0]!.id}`);
  const frame = page.frameLocator('iframe[title="当前打印页"]');
  await expect(frame.getByText('真实打印业务1', { exact: true }).first()).toBeVisible();
  await expect(frame.getByText('123.45', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('page-count')).toHaveText('共 1 页');
  await actualPdf(page, context, 1);
  await page.goto(
    '/m/print-settings/preview?mode=ledger&from=202601&to=202601&account=1001&kind=detail&queried=1',
  );
  await expect(
    page.frameLocator('iframe[title="当前打印页"]').getByText('本期合计', { exact: true }),
  ).toBeVisible();
  await actualPdf(page, context, 1);
  const s = structuredClone(defaultSettings);
  s.voucher.perPage = 2;
  await callApi(request, 'm.print-settings.saveSettings', s, { token: book.token });
  await page.goto('/m/print-settings/preview?from=202601&to=202601&queried=1');
  await expect(page.getByTestId('page-count')).toHaveText('共 2 页');
  await actualPdf(page, context, 2);
  await page.getByLabel('屏幕缩放', { exact: true }).selectOption('50');
  await page.evaluate(() => {
    delete (window as unknown as { __printHtml?: string }).__printHtml;
  });
  await actualPdf(page, context, 2);
  const stored = await callApi<Settings>(request, 'm.print-settings.settings', undefined, {
    token: book.token,
    method: 'GET',
  });
  expect(stored.voucher.perPage).toBe(2);
});
test('w_preview_zc：多页账簿承前过次不重复累计，PDF 实际分页；奇偶页翻面取消', async ({
  page,
  request,
  context,
}) => {
  const book = await loginWithNewBook(page, request);
  await seedBook(
    book.bookId,
    Array.from({ length: 8 }, (_, i) => simple(i + 1)),
  );
  await installBridge(page);
  const s = structuredClone(defaultSettings);
  s.ledger.rows = 3;
  s.ledger.startPage = 7;
  await callApi(request, 'm.print-settings.saveSettings', s, { token: book.token });
  await page.goto(
    '/m/print-settings/preview?mode=ledger&from=202601&to=202601&account=1001&kind=detail&queried=1',
  );
  await expect(page.getByTestId('page-count')).toHaveText('共 3 页');
  await expect(
    page.frameLocator('iframe[title="当前打印页"]').getByText('过次页', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '下页', exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="当前打印页"]').getByText('承前页', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '下页', exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="当前打印页"]').getByText('987.60', { exact: true }).first(),
  ).toBeVisible();
  await actualPdf(page, context, 3);
  await page.getByLabel('奇偶页分次打印（手动翻面）').check();
  await page.getByRole('button', { name: '打印全部', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /现在打印奇页/ })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '继续打印', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /请翻面，现在打印偶页/ })).toBeVisible();
  await page
    .getByRole('dialog', { name: /请翻面，现在打印偶页/ })
    .getByRole('button', { name: '取消后续', exact: true })
    .click();
  await expect(page.getByText('已停止后续打印，已提交 2 页', { exact: true })).toBeVisible();
});
test('w_xt_tz_zc / w_bb_def_gs：设置立即生效与恢复确认，模板未保存关闭保存/放弃/取消', async ({
  page,
  request,
  context,
}) => {
  await loginWithNewBook(page, request);
  await installBridge(page);
  await page.goto('/m/print-settings/preview');
  await page.getByRole('button', { name: '打印格式设置', exact: true }).click();
  await page.getByLabel('打印单位名称', { exact: true }).fill('保存后立即生效');
  await page.getByLabel('每页凭证张数', { exact: true }).selectOption('3');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByText('打印设置已保存并立即生效', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '打印格式设置', exact: true }).click();
  await expect(page.getByLabel('打印单位名称', { exact: true })).toHaveValue('保存后立即生效');
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('打印单位名称', { exact: true })).toHaveValue('保存后立即生效');
  await page.getByRole('link', { name: '特殊打印格式', exact: true }).click();
  await expect(page).toHaveURL(/\/formats/);
  await page.getByRole('button', { name: '新建格式', exact: true }).click();
  await page.getByLabel('格式名称', { exact: true }).fill('我的模板');
  await page.getByRole('button', { name: '关闭定义', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('格式名称', { exact: true })).toHaveValue('我的模板');
  await page.getByRole('button', { name: '关闭定义', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '我的模板' })).toBeVisible();
  await page.getByRole('button', { name: '新建格式', exact: true }).click();
  await page.getByLabel('格式名称', { exact: true }).fill('应被放弃');
  await page.getByRole('button', { name: '关闭定义', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByLabel('格式名称', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '应被放弃' })).toHaveCount(0);
  await page
    .getByRole('row')
    .filter({ hasText: '我的模板' })
    .getByRole('button', { name: '预览', exact: true })
    .click();
  await actualPdf(page, context, 1);
});

test('w_pz_prn_1_a4：1/2/3 张和复杂凭证续页实际 PDF，无跨号、丢行或金额覆盖', async ({
  page,
  request,
  context,
}) => {
  const book = await loginWithNewBook(page, request);
  const vouchers = await seedBook(
    book.bookId,
    Array.from({ length: 3 }, (_, i) => simple(i + 1)),
  );
  await installBridge(page);
  for (const perPage of [1, 2, 3] as const) {
    const s = structuredClone(defaultSettings);
    s.voucher.perPage = perPage;
    await callApi(request, 'm.print-settings.saveSettings', s, { token: book.token });
    await page.goto('/m/print-settings/preview?from=202601&to=202601&queried=1');
    await expect(page.getByTestId('page-count')).toHaveText(`共 ${Math.ceil(3 / perPage)} 页`);
    await actualPdf(page, context, Math.ceil(3 / perPage));
  }
  const scaled = structuredClone(defaultSettings);
  scaled.voucher.scale = 50;
  scaled.voucher.perPage = 3;
  await callApi(request, 'm.print-settings.saveSettings', scaled, { token: book.token });
  await page.reload();
  await expect(page.getByTestId('page-count')).toHaveText('共 1 页');
  await actualPdf(page, context, 1);
  const complex = await seedBook(book.bookId, [
    {
      date: '2026-01-08',
      summary: '中文长摘要应当完整续页并保留金额'.repeat(10),
      lines: Array.from({ length: 8 }, (_, i) => ({
        account: i % 2 === 0 ? '1001' : '6603',
        debit: i % 2 === 0 ? 10001 : 0,
        credit: i % 2 === 0 ? 0 : 10001,
      })),
    },
  ]);
  const s = structuredClone(defaultSettings);
  s.voucher.perPage = 2;
  s.voucher.rows = 4;
  await callApi(request, 'm.print-settings.saveSettings', s, { token: book.token });
  await page.goto(
    `/m/print-settings/preview?ids=${vouchers[0]!.id},${complex[0]!.id},${vouchers[2]!.id}`,
  );
  await expect(page.getByTestId('page-count')).not.toHaveText('共 1 页');
  await actualPdf(page, context, null);
  const html = await page.evaluate(
    () => (window as unknown as { __printHtml: string }).__printHtml,
  );
  for (const line of complex[0]!.lines)
    expect(html.match(new RegExp(`data-line="${line.id}" data-fragment="0"`, 'g'))).toHaveLength(1);
  expect(html).toContain('400.04');
  expect(html).toContain('记-0004');
});
test('w_print_1 / w_print_2：非法范围不发送，空数据不出空白成功', async ({
  page,
  request,
  context,
}) => {
  const book = await loginWithNewBook(page, request);
  await installBridge(page);
  await page.goto('/m/print-settings/preview?queried=1');
  await expect(
    page
      .getByRole('tabpanel', { name: '打印与导出' })
      .getByText('无记录，无法预览/打印', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDF', exact: true })).toHaveCount(0);
  await seedBook(book.bookId, [simple(1), simple(2), simple(3)]);
  const s = structuredClone(defaultSettings);
  s.voucher.perPage = 2;
  await callApi(request, 'm.print-settings.saveSettings', s, { token: book.token });
  await page.reload();
  await expect(page.getByTestId('page-count')).toHaveText('共 2 页');
  await page.getByLabel('打印范围', { exact: true }).selectOption('range');
  await page.getByLabel('页码范围', { exact: true }).fill('2-1');
  await page.getByRole('button', { name: '打印所选范围', exact: true }).click();
  await expect(page.getByText(/打印范围超出/)).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __printHtml?: string }).__printHtml),
  ).toBeUndefined();
  await page.getByLabel('页码范围', { exact: true }).fill('2');
  await actualPdf(page, context, 1);
});
