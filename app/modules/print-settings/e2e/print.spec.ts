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
  // 取消提示是短暂通知；先验证 bridge 结果，再执行可能超过通知展示时长的 PDF 检查。
  await expect(page.getByText('已取消 PDF 保存', { exact: true }).first()).toBeVisible();
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
  await expect(page.getByRole('dialog')).not.toHaveClass(/ant-zoom-(appear|enter)/);
  await page.getByRole('dialog').getByRole('button', { name: '继续打印', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /请翻面，现在打印偶页/ })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toHaveClass(/ant-zoom-(appear|enter)/);
  await page
    .getByRole('dialog', { name: /请翻面，现在打印偶页/ })
    .getByRole('button', { name: '取消后续', exact: true })
    .click();
  await expect(page.getByText('已停止后续打印，已提交 2 页', { exact: true })).toBeVisible();
});
test('w_xt_tz_zc：设置立即生效、刷新持久化与恢复默认取消', async ({ page, request }) => {
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
});

test('w_bb_def_gs：未保存关闭取消/保存/放弃与保存模板实际 PDF', async ({
  page,
  request,
  context,
}) => {
  await loginWithNewBook(page, request);
  await installBridge(page);
  await page.goto('/m/print-settings/formats');
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

// 每种纸张布局、实际比例及复杂续页分别使用独立账套和原有 30 秒预算。
for (const perPage of [1, 2, 3] as const) {
  test(`w_pz_prn_1_a4：每页 ${perPage} 张的实际 PDF 页数与内容边界`, async ({
    page,
    request,
    context,
  }) => {
    const book = await loginWithNewBook(page, request);
    await seedBook(
      book.bookId,
      Array.from({ length: 3 }, (_, i) => simple(i + 1)),
    );
    await installBridge(page);
    const s = structuredClone(defaultSettings);
    s.voucher.perPage = perPage;
    await callApi(request, 'm.print-settings.saveSettings', s, { token: book.token });
    await page.goto('/m/print-settings/preview?from=202601&to=202601&queried=1');
    await expect(page.getByTestId('page-count')).toHaveText(`共 ${Math.ceil(3 / perPage)} 页`);
    await actualPdf(page, context, Math.ceil(3 / perPage));
  });
}

test('w_pz_prn_1_a4：实际比例 50% 保存后刷新，三张同页实际 PDF', async ({
  page,
  request,
  context,
}) => {
  const book = await loginWithNewBook(page, request);
  await seedBook(
    book.bookId,
    Array.from({ length: 3 }, (_, i) => simple(i + 1)),
  );
  await installBridge(page);
  const s = structuredClone(defaultSettings);
  s.voucher.perPage = 3;
  await callApi(request, 'm.print-settings.saveSettings', s, { token: book.token });
  await page.goto('/m/print-settings/preview?from=202601&to=202601&queried=1');
  await expect(page.getByTestId('page-count')).toHaveText('共 1 页');
  const scaled = structuredClone(defaultSettings);
  scaled.voucher.scale = 50;
  scaled.voucher.perPage = 3;
  await callApi(request, 'm.print-settings.saveSettings', scaled, { token: book.token });
  await page.reload();
  await expect(page.getByTestId('page-count')).toHaveText('共 1 页');
  await actualPdf(page, context, 1);
});

test('w_pz_prn_1_a4：复杂凭证续页实际 PDF，无跨号、丢行或金额覆盖', async ({
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
test('w_pz_prn_1 实际字体检查失败时拦截 bridge、显示原因并清理 iframe', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  const [v] = await seedBook(book.bookId, [simple(1)]);
  await installBridge(page);
  await page.goto(`/m/print-settings/preview?voucherId=${v!.id}`);
  await expect(page.getByTestId('page-count')).toHaveText('共 1 页');
  await page.evaluate(() => {
    const create = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (tag === 'iframe')
        element.addEventListener('load', () => {
          if (!element.classList.contains('cw-print-check')) return;
          const doc = (element as HTMLIFrameElement).contentDocument!;
          const style = create('style');
          style.textContent = 'tbody td{font-size:80pt!important;padding:20mm!important}';
          doc.head.appendChild(style);
        });
      return element;
    }) as typeof document.createElement;
  });
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(page.getByText(/打印内容超出纸张或凭证槽位/)).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __printHtml?: string }).__printHtml),
  ).toBeUndefined();
  await expect(page.locator('.cw-print-check')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeEnabled();
});

test('w_print_2_zw：独立造数后明细科目连续打印，跳过空科目并取消下一科目', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  await seedBook(
    book.bookId,
    Array.from({ length: 5 }, (_, i) => simple(i + 1)),
  );
  const settings = structuredClone(defaultSettings);
  settings.ledger.rows = 2;
  settings.ledger.startPage = 7;
  await callApi(request, 'm.print-settings.saveSettings', settings, { token: book.token });
  await page.addInitScript(() => {
    const target = window as unknown as { __printJobs: string[]; caiwuDesktop: unknown };
    target.__printJobs = [];
    target.caiwuDesktop = {
      print: async (html: string) => {
        target.__printJobs.push(html);
      },
      printToPdf: async () => null,
    };
  });
  await page.goto('/m/print-settings/preview?mode=ledger&accountScope=leaf&queried=1');
  await expect(page.getByTestId('page-count')).toHaveText('共 6 页');
  await expect(page.getByText(/以下科目无符合条件的记录，已跳过/)).toBeVisible();
  await page.getByLabel('每个科目打印前提示', { exact: true }).check();
  await page.getByRole('button', { name: '打印全部', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('1001 库存现金');
  // 确认框的祖先进场动画可能在按钮自身稳定后仍移动命中区域。
  await expect(page.getByRole('dialog')).not.toHaveClass(/ant-zoom-(appear|enter)/);
  await page.getByRole('button', { name: '继续打印', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('6603 财务费用');
  await expect(page.getByRole('dialog')).not.toHaveClass(/ant-zoom-(appear|enter)/);
  await page.getByRole('button', { name: '取消后续', exact: true }).click();
  await expect(page.getByText('已停止后续打印，已提交 3 页', { exact: true })).toBeVisible();
  const jobs = await page.evaluate(
    () => (window as unknown as { __printJobs: string[] }).__printJobs,
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0]!.match(/class="print-sheet"/g)).toHaveLength(3);
  expect(jobs[0]).toContain('1001 库存现金');
  expect(jobs[0]).not.toContain('科目：6603');
  await expect(page.locator('.cw-print-check')).toHaveCount(0);
  await page.getByLabel('打印科目选择', { exact: true }).selectOption('first');
  await expect(page.getByLabel('科目编码（可用逗号选择多个）', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '查询并预览', exact: true }).click();
  await expect(page.getByTestId('page-count')).toHaveText('共 6 页');
});

test('w_preview_zc A3+B2：逐科目双面保留空白背槽，取消后恢复不重印正面，PDF保留纸槽', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  await seedBook(
    book.bookId,
    [
      ...Array.from({ length: 3 }, (_, i) => ({ account: '1001', summary: `双面A${i + 1}` })),
      ...Array.from({ length: 2 }, (_, i) => ({ account: '100201', summary: `双面B${i + 1}` })),
    ].map((x) => ({
      date: '2026-01-05',
      status: 'posted' as const,
      summary: x.summary,
      lines: [
        { account: x.account, debit: 100 },
        { account: '6603', credit: 100 },
      ],
    })),
  );
  const settings = structuredClone(defaultSettings);
  settings.ledger.rows = 1;
  settings.ledger.continuousPage = false;
  await callApi(request, 'm.print-settings.saveSettings', settings, { token: book.token });
  await page.addInitScript(() => {
    const target = window as unknown as {
      __duplexJobs: string[];
      __duplexPdf: string;
      caiwuDesktop: unknown;
    };
    target.__duplexJobs = [];
    target.caiwuDesktop = {
      print: async (html: string) => {
        target.__duplexJobs.push(html);
      },
      printToPdf: async (html: string) => {
        target.__duplexPdf = html;
        return null;
      },
    };
  });
  await page.goto('/m/print-settings/preview?mode=ledger&account=1001,100201&queried=1');
  await expect(page.getByTestId('page-count')).toHaveText('共 5 页');
  await page.getByLabel('奇偶页分次打印（手动翻面）', { exact: true }).check();
  const answer = async (text: string, proceed: boolean) => {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(text);
    await expect(dialog).not.toHaveClass(/ant-zoom-(appear|enter)/);
    await dialog
      .getByRole('button', { name: proceed ? '继续打印' : '取消后续', exact: true })
      .click();
  };
  await page.getByRole('button', { name: '打印全部', exact: true }).click();
  await answer('1001 库存现金', true);
  await answer('请翻面', false);
  await expect(page.getByRole('button', { name: '打印全部', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '恢复后续双面作业', exact: true }).click();
  await answer('含 1 个空白', true);
  await answer('100201', false);
  await page.getByRole('button', { name: '恢复后续双面作业', exact: true }).click();
  await answer('现在打印奇页账册', true);
  await answer('请翻面', true);
  await expect(page.getByRole('button', { name: '恢复后续双面作业', exact: true })).toHaveCount(0);
  const jobs = await page.evaluate(
    () => (window as unknown as { __duplexJobs: string[] }).__duplexJobs,
  );
  expect(
    jobs.map((html) => [...html.matchAll(/data-duplex-source="([^"]+)"/g)].map((m) => m[1])),
  ).toEqual([['1', '3'], ['2', 'blank'], ['4'], ['5']]);
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __duplexPdf?: string }).__duplexPdf ?? ''),
    )
    .toContain('data-duplex-source="blank"');
  const pdf = await page.evaluate(() => (window as unknown as { __duplexPdf: string }).__duplexPdf);
  expect([...pdf.matchAll(/data-duplex-source="([^"]+)"/g)].map((m) => m[1])).toEqual([
    '1',
    '2',
    '3',
    'blank',
    '4',
    '5',
  ]);
});
