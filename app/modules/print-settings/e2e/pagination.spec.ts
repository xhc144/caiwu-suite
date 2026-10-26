import { expect, test, type Page } from '@playwright/test';
import { createTestApp, seedVouchers } from '@caiwu/testkit';
import {
  buildLedgerBookView,
  buildVoucherView,
  defaultLayout,
  renderPrintDocument,
  viewToPrintJob,
  assertRenderedPrintFits,
  type PrintView,
  type PrintJob,
  planManualDuplex,
  duplexStepToPrintJob,
  manualDuplexPdfJob,
} from '@caiwu/print';
import server from '../server';

async function physicalPdf(
  page: Page,
  view: PrintView | PrintJob,
  name: string,
  expected: { pages: number; width: number; height: number },
) {
  await page.setContent(renderPrintDocument('pages' in view ? viewToPrintJob(view) : view), {
    waitUntil: 'load',
  });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(`(${assertRenderedPrintFits.toString()})(document)`);
  const file = test.info().outputPath(`${name}.pdf`);
  const pdf = await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('%%EOF');
  const pages = [...pdf.toString('latin1').matchAll(/\b\d+\s+\d+\s+obj\b[\s\S]*?endobj/g)]
    .map((m) => m[0])
    .filter((o) => /\/Type\s*\/Page\b/.test(o));
  expect(pages).toHaveLength(expected.pages);
  for (const physical of pages) {
    expect(physical).toMatch(/\/Contents\s+(?:\d+\s+\d+\s+R|\[)/);
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(physical);
    expect(box).not.toBeNull();
    expect(Math.abs((Number(box![1]) * 25.4) / 72 - expected.width)).toBeLessThan(0.5);
    expect(Math.abs((Number(box![2]) * 25.4) / 72 - expected.height)).toBeLessThan(0.5);
  }
  await test.info().attach(name, { path: file, contentType: 'application/pdf' });
}

for (const [a, start, physicalPages] of [
  [3, 1, 6],
  [1, 1, 4],
  [3, 2, 8],
  [1, 5, 4],
] as const) {
  test(`w_preview_zc 手动双面 A${a}+B2 起点${start}：各科目正反 PDF 纸槽及空白背页真实保留`, async ({
    page,
  }) => {
    const app = await createTestApp({ modules: [server] });
    try {
      await seedVouchers(
        app.svc,
        [
          ...Array.from({ length: a }, (_, i) => ({ account: '1001', summary: `双面A${i + 1}` })),
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
      const models = await app
        .call(server)
        .ledgerBook({ from: 202601, to: 202601, account: '1001,100201', kind: 'detail' });
      const view = buildLedgerBookView(models, {
        ...defaultLayout,
        rows: 1,
        startPage: start,
        continuousPage: false,
      });
      expect(view.pages).toHaveLength(a + 2);
      const selected = view.pages.map((_, i) => i + 1),
        steps = planManualDuplex(view, selected);
      expect(steps).toHaveLength(4);
      for (const [i, step] of steps.entries()) {
        await physicalPdf(
          page,
          duplexStepToPrintJob(view, step),
          `duplex-A${a}-start${start}-step${i}`,
          { pages: step.slots.length, width: 210, height: 297 },
        );
        const actual = await page
          .locator('[data-duplex-source]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-duplex-source')));
        expect(actual).toEqual(step.slots.map((p) => String(p ?? 'blank')));
        for (const [j, p] of step.slots.entries()) {
          const text = await page.locator('.print-sheet').nth(j).textContent();
          if (p == null) expect(text?.trim()).toBe('');
          else expect(text).toContain(view.pages[p - 1]!.account!);
        }
      }
      const job = manualDuplexPdfJob(view, selected);
      const slots = steps.reduce((n, s) => n + s.slots.length, 0);
      expect(slots).toBe(physicalPages);
      await physicalPdf(page, job, `duplex-A${a}-start${start}-booklet`, {
        pages: physicalPages,
        width: 210,
        height: 297,
      });
      if (a === 3 && start === 1)
        expect([...job.html.matchAll(/data-duplex-source="([^"]+)"/g)].map((m) => m[1])).toEqual([
          '1',
          '2',
          '3',
          'blank',
          '4',
          '5',
        ]);
    } finally {
      await app.close();
    }
  });
}

test('w_print_zc / w_preview_zc：跨两科目六张实际 PDF，承前过次、红字和每行内容完整', async ({
  page,
}) => {
  const app = await createTestApp({ modules: [server] });
  try {
    const amounts = [12345, -2345, 1, 9999, -1];
    const vouchers = await seedVouchers(
      app.svc,
      amounts.map((amount, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        status: 'posted' as const,
        summary: `分页核对业务${i + 1}`,
        lines: [
          { account: '1001', debit: amount },
          { account: '6603', credit: amount },
        ],
      })),
    );
    const result = await app
      .call(server)
      .ledgerBatch({ from: 202601, to: 202601, account: '1001,6603', kind: 'detail' });
    const view = buildLedgerBookView(result.models, { ...defaultLayout, rows: 2, startPage: 7 });
    expect(view.pages).toHaveLength(6);
    await physicalPdf(page, view, 'ledger-carry-six-pages', { pages: 6, width: 210, height: 297 });
    const sheets = page.locator('.print-sheet');
    await expect(sheets.nth(0).getByText('过次页', { exact: true })).toHaveCount(1);
    await expect(sheets.nth(1).getByText('承前页', { exact: true })).toHaveCount(1);
    await expect(sheets.nth(2).getByText('本期合计', { exact: true })).toHaveCount(1);
    await expect(sheets.nth(2).getByText('199.99', { exact: true })).not.toHaveCount(0);
    const rows = await page.locator('tr[data-ledger-line]').evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute('data-ledger-line'),
        part: Number(el.getAttribute('data-fragment')),
        text: el.children[2]!.textContent,
      })),
    );
    expect(rows.filter((r) => r.part === 0).map((r) => r.id)).toEqual([
      ...vouchers.map((v) => String(v.lines[0]!.id)),
      ...vouchers.map((v) => String(v.lines[1]!.id)),
    ]);
    for (let i = 0; i < 5; i++)
      expect(rows.filter((r) => r.text === `分页核对业务${i + 1}`)).toHaveLength(2);
    for (const [before, after] of [
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
    ]) {
      const outgoing = await sheets
        .nth(before!)
        .locator('tr')
        .filter({ hasText: '过次页' })
        .locator('td')
        .allTextContents();
      const incoming = await sheets
        .nth(after!)
        .locator('tr')
        .filter({ hasText: '承前页' })
        .locator('td')
        .allTextContents();
      expect(incoming).toEqual(outgoing.map((x) => (x === '过次页' ? '承前页' : x)));
    }
    await expect(sheets.nth(3).locator('footer')).toContainText('第 10 页');
  } finally {
    await app.close();
  }
});

for (const paper of ['A5', 'B5', 'custom'] as const) {
  test(`w_pz_prn_1 / w_pz_prn_3：${paper} 实际 PDF 尺寸、套打偏移和合并间距`, async ({ page }) => {
    const app = await createTestApp({ modules: [server] });
    try {
      await seedVouchers(
        app.svc,
        [1, 2].map((i) => ({
          date: '2026-01-05',
          summary: `纸张核对凭证${i}`,
          lines: [
            { account: '1001', debit: 12345 },
            { account: '6603', credit: 12345 },
          ],
        })),
      );
      const model = await app.call(server).vouchers({ from: 202601, to: 202601 });
      const custom = paper === 'custom';
      const view = buildVoucherView(model, {
        ...defaultLayout,
        paper,
        widthMm: 220,
        heightMm: 160,
        landscape: !custom,
        offsetX: 2,
        offsetY: 3,
        perPage: custom ? 2 : 1,
        voucherGapMm: 8,
      });
      await physicalPdf(page, view, `${paper}-offset-gap`, {
        pages: custom ? 1 : 2,
        width: custom ? 220 : paper === 'A5' ? 210 : 250,
        height: custom ? 160 : paper === 'A5' ? 148 : 176,
      });
      for (const i of [1, 2])
        await expect(page.getByText(`纸张核对凭证${i}`, { exact: true }).first()).toBeVisible();
      const content = await page.locator('.page-content').first().boundingBox();
      expect(Math.abs(content!.x - (12 * 96) / 25.4)).toBeLessThan(1);
      expect(Math.abs(content!.y - (13 * 96) / 25.4)).toBeLessThan(1);
      if (custom) {
        const slots = await page.locator('.voucher').evaluateAll((els) =>
          els.map((el) => ({
            top: el.getBoundingClientRect().top,
            bottom: el.getBoundingClientRect().bottom,
          })),
        );
        expect(Math.abs(slots[1]!.top - slots[0]!.bottom - (8 * 96) / 25.4)).toBeLessThan(1);
      }
    } finally {
      await app.close();
    }
  });
}
