import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import {
  assertRenderedPrintFits,
  buildLedgerView,
  buildTemplateView,
  buildVoucherView,
  defaultLayout,
  renderPrintDocument,
  viewToPrintJob,
  wrapPrintText,
  type PrintLayout,
  type PrintView,
} from '@caiwu/print';

// 每张实体的第一分片只出现一次，且所有预分片在实际浏览器里都只能占一行。
async function inspectAndPdf(page: Page, view: PrintView, info: TestInfo, name: string) {
  await page.setContent(renderPrintDocument(viewToPrintJob(view)), { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(`(${assertRenderedPrintFits.toString()})(document)`);
  const fragments = await page.locator('tr[data-line]').evaluateAll((rows) =>
    rows.map((row) => ({
      id: Number(row.getAttribute('data-line')),
      part: Number(row.getAttribute('data-fragment')),
      summary: row.children[0]!.textContent!,
      account: row.children[1]!.textContent!,
    })),
  );
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
    path: info.outputPath(`${name}.pdf`),
  });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('%%EOF');
  const objects = [...pdf.toString('latin1').matchAll(/\b\d+\s+\d+\s+obj\b[\s\S]*?endobj/g)].map(
    (x) => x[0],
  );
  const pdfPages = objects.filter((x) => /\/Type\s*\/Page\b/.test(x));
  expect(pdfPages).toHaveLength(view.pages.length);
  // 遍历实际 PDF 的每个物理页对象，确认引用了页面内容；再由 Chromium 单页导出核对。
  for (let i = 0; i < pdfPages.length; i++) {
    expect(pdfPages[i]).toMatch(/\/Contents\s+(?:\d+\s+\d+\s+R|\[)/);
    const single = await page.pdf({ preferCSSPageSize: true, pageRanges: String(i + 1) });
    expect([...single.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)]).toHaveLength(1);
  }
  await page
    .locator('.print-sheet')
    .first()
    .screenshot({ path: info.outputPath(`${name}.png`) });
  return fragments;
}
async function wideVoucher(book: TestBook, summary: string, longAccount = false) {
  const account = longAccount ? '6604' : '6603';
  if (longAccount)
    await book.svc.accounts.create(
      { code: account, name: '科目WM👩‍💻'.repeat(7), categoryId: 'pnl' },
      book.info.codeScheme,
    );
  const [v] = await seedVouchers(book.svc, [
    {
      date: '2026-01-05',
      lines: Array.from({ length: 8 }, (_, i) => ({
        account: i % 2 ? account : '1001',
        summary,
        debit: i % 2 ? 0 : 10001,
        credit: i % 2 ? 10001 : 0,
      })),
    },
  ]);
  return { ...v!, auxiliary: v!.lines.map(() => '') };
}
for (const [name, summary, longAccount] of [
  ['W23', 'W'.repeat(23), false],
  ['M23', 'M'.repeat(23), false],
  ['mixed', '中文WM中'.repeat(12), true],
  ['emoji', '👨‍👩‍👧‍👦🇨🇳W👩‍💻M'.repeat(5), true],
  ['tabs', 'WW\tMM\t中W'.repeat(6), true],
] as const) {
  test(`w_pz_prn_1 ${name}：A4 三张槽位无二次折行、跨槽覆盖、丢行或重行`, async ({
    page,
  }, info) => {
    const book = await createTestBook();
    try {
      const v = await wideVoucher(book, summary, longAccount);
      const [next] = await seedVouchers(book.svc, [
        {
          date: '2026-01-06',
          summary: '下一凭证独立签名',
          lines: [
            { account: '1001', debit: 789 },
            { account: '6603', credit: 789 },
          ],
        },
      ]);
      const view = buildVoucherView(
        { unit: '测试单位', vouchers: [v, { ...next!, auxiliary: ['', ''] }] },
        { ...defaultLayout, perPage: 3 },
      );
      if (name === 'W23' || name === 'M23') expect(view.pages).toHaveLength(2);
      const rows = await inspectAndPdf(page, view, info, name);
      expect(rows.filter((r) => r.part === 0).map((r) => r.id)).toEqual(
        [...v.lines, ...next!.lines].map((l) => l.id),
      );
      for (const line of v.lines) {
        expect(
          rows
            .filter((r) => r.id === line.id)
            .map((r) => r.summary)
            .join(''),
        ).toBe(summary.replace(/\t/g, '    '));
        expect(
          rows
            .filter((r) => r.id === line.id)
            .map((r) => r.account)
            .join(''),
        ).toBe(`${line.accountCode} ${line.accountName}`);
      }
    } finally {
      await book.close();
    }
  });
}
test('w_preview_zc / w_bb_def_gs 宽文字和长页眉页脚的真实物理分页', async ({ page }, info) => {
  const summary = 'WMWM中文\t👩‍💻'.repeat(10);
  const layout: PrintLayout = {
    ...defaultLayout,
    rows: 6,
    font: 'sans-serif',
    unitName: '单位WMWM'.repeat(10),
    supervisor: '主管WMWM'.repeat(7),
  };
  const ledger = buildLedgerView(
    {
      unit: '单位',
      title: '长账簿名WMWM'.repeat(6),
      kind: 'cash',
      period: '2026年01月',
      account: '1001 ' + '科目WMWM'.repeat(10),
      opening: 100,
      debit: 80008,
      credit: 0,
      ytdDebit: 80008,
      ytdCredit: 0,
      rows: Array.from({ length: 8 }, (_, i) => ({
        id: String(i + 1),
        date: '2026-01-05',
        voucherNo: `记-${i + 1}`,
        summary,
        debit: 10001,
        credit: 0,
        balance: 100 + (i + 1) * 10001,
        counterpart: '对方WMWM'.repeat(8),
        refNo: '',
        quantity: null,
      })),
    },
    layout,
  );
  await inspectAndPdf(page, ledger, info, 'ledger-wide');
  const first = await page
    .locator('tr[data-ledger-line][data-fragment="0"]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-ledger-line')));
  expect(first).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  expect(await page.locator('footer').count()).toBe(ledger.pages.length);
  expect(
    await page
      .locator('td')
      .filter({ hasText: /^承前页$/ })
      .count(),
  ).toBe(ledger.pages.length - 1);
  const template = buildTemplateView(
    {
      name: '格式WMWM'.repeat(12),
      rows: 8,
      cols: 1,
      rowHeight: 6,
      colWidth: 40,
      cells: Array.from({ length: 8 }, (_, i) => ({
        row: i + 1,
        col: 1,
        text: summary,
        align: 'left',
      })),
    },
    layout,
  );
  await inspectAndPdf(page, template, info, 'template-wide');
  // 宽字符不是依赖自动折行撑高，而是在分页前被拆成独立可追踪分片。
  expect(wrapPrintText('W'.repeat(23), 60.8, 10).length).toBeGreaterThan(1);
});
test('w_pz_prn_1 小字体高行数也计入内边距和边框，不把物理行高低估', async ({ page }, info) => {
  const book = await createTestBook();
  try {
    const [v] = await seedVouchers(book.svc, [
      {
        date: '2026-01-05',
        summary: 'W'.repeat(23),
        lines: Array.from({ length: 120 }, (_, i) => ({
          account: i % 2 ? '6603' : '1001',
          debit: i % 2 ? 0 : 10001,
          credit: i % 2 ? 10001 : 0,
        })),
      },
    ]);
    const view = buildVoucherView(
      { unit: '测试单位', vouchers: [{ ...v!, auxiliary: v!.lines.map(() => '') }] },
      { ...defaultLayout, fontSize: 6, rows: 100 },
    );
    const rows = await inspectAndPdf(page, view, info, 'dense');
    expect(rows.filter((r) => r.part === 0).map((r) => r.id)).toEqual(v!.lines.map((l) => l.id));
    expect(rows.map((r) => r.summary).join('')).toBe('W'.repeat(23 * 120));
  } finally {
    await book.close();
  }
});
