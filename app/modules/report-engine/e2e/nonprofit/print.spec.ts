import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createTestBook } from '@caiwu/testkit';
import { chart } from '../../test/nonprofit/chart';
import { annual, seedFullYear, confirmFixture } from '../../test/nonprofit/fixture';
import { generateNonprofit } from '../../templates/nonprofit/statutory.server';
import { statementSnapshot } from '../../templates/nonprofit/layout';
import { nonprofitPrintHtml } from '../../templates/nonprofit/print';

/** 本域打印验收；公共目录/保存/生成HTTP入口的系统验收另由接线后真实页面流程完成。 */
test('w_bb_saveas 三表由同一快照真实打印PDF，核对A4尺寸、首尾项目与活动表全部分类列', async ({
  page,
}, info) => {
  const book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  try {
    const c = await confirmFixture(book.svc, await seedFullYear(book.svc));
    for (const code of ['401', '402', '403'] as const) {
      const { statement } = await generateNonprofit(book.svc, { ...annual, code }, c);
      const snapshot = statementSnapshot(statement, {
        id: 1,
        reportId: Number(code),
        revision: 1,
        generatedAt: '2026-12-31T23:59:59Z',
      });
      await page.setContent(nonprofitPrintHtml(snapshot));
      await page.evaluate(() => document.fonts.ready);
      const path = info.outputPath(`${code}.pdf`);
      await writeFile(path, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
      const metadata = execFileSync('pdfinfo', [path], { encoding: 'utf8' });
      const text = execFileSync('pdftotext', ['-raw', path, '-'], { encoding: 'utf8' }).replace(
        /\s+/g,
        '',
      );
      expect(metadata).toMatch(
        code === '402' ? /841\.\d+ x 594\.\d+ pts \(A4\)/ : /594\.\d+ x 841\.\d+ pts \(A4\)/,
      );
      const pages = Number(/Pages:\s+(\d+)/.exec(metadata)?.[1]);
      expect(pages).toBeGreaterThan(0);
      expect(pages).toBeLessThanOrEqual(4);
      expect(text).toContain('编制单位：测试单位有限公司');
      expect(text).toContain(
        statement.rows.filter((r) => !r.section)[0]!.label.replace(/\s+/g, ''),
      );
      expect(text).toContain(statement.rows.at(-1)!.label.replace(/\s+/g, ''));
      for (const row of statement.rows.filter((r) => !r.section)) {
        const printed =
          row.label.replace(/\s+/g, '') +
          row.values
            .map((n) => (typeof n === 'number' ? (n / 100).toFixed(2) : n.replace(/\s+/g, '')))
            .join('');
        expect(text, `${code} ${row.label}全部金额列`).toContain(printed);
      }
      const boxes = execFileSync('pdftotext', ['-bbox-layout', path, '-'], { encoding: 'utf8' });
      for (const pageBox of boxes.matchAll(
        /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g,
      )) {
        const width = Number(pageBox[1]);
        for (const word of pageBox[3]!.matchAll(
          /<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)"/g,
        )) {
          expect(Number(word[1])).toBeGreaterThanOrEqual(0);
          expect(Number(word[2])).toBeLessThanOrEqual(width);
        }
      }

      if (code === '402')
        for (const col of statement.columns) expect(text).toContain(col.replace(/\s+/g, ''));
      if (code === '403') expect(text).toContain('不要求填列（2026年首次执行）');
      await info.attach(`${code}真实打印PDF`, { path, contentType: 'application/pdf' });
    }
  } finally {
    await book.close();
  }
});
