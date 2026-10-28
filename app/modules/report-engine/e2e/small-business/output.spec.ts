import { test, expect } from '@playwright/test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { completeCoreBook } from '../../test/small-business/core-fixture';
import {
  fixedYearBook,
  yearOpening,
  yearBalanceMovement,
  yearIncomeUnit,
  yearCashUnit,
} from '../../test/small-business/year-fixture';
import {
  prepareSmallBusiness,
  assertSmallBusinessOutput,
  smallBusinessConfigurationData,
  saveConfiguration,
} from '../../templates/small-business/statutory.server';
import { statementPrintJob, statementWorkbook } from '../../templates/small-business/output';
import type { Configuration } from '../../templates/small-business/configuration';

let temporary: string, bundle: string;
test.beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'caiwu-small-component-'));
  const appRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  await build({
    root: appRoot,
    configFile: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [react()],
    logLevel: 'error',
    build: {
      outDir: temporary,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./component-host.tsx', import.meta.url)),
        formats: ['iife'],
        name: 'smallBusinessComponents',
        fileName: () => 'host.js',
      },
    },
  });
  bundle = join(temporary, 'host.js');
});
test.afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('w_bb_saveas 全年固定账套三表两列逐行下载xlsx并经打印入口渲染A4 PDF', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  const { app, svc } = await fixedYearBook();
  try {
    const prepared = await svc.tx((t) =>
      prepareSmallBusiness(t, { period: 202612, mode: 'annual' }),
    );
    assertSmallBusinessOutput(prepared);
    const workbooks = await Promise.all(
        prepared.statements.map((s) => statementWorkbook(prepared, s)),
      ),
      jobs = prepared.statements.map((s) => statementPrintJob(prepared, s));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.setContent('<html lang="zh-CN"><body><div id="root"></div></body></html>');
    await page.evaluate(() => {
      window.caiwuDesktop = {
        print: async (html) => {
          window.smallPrintedDocument = html;
        },
        printToPdf: async () => null,
      };
    });
    await page.addScriptTag({ path: bundle });
    await page.evaluate((data) => window.mountSmallBusiness(data), { prepared, workbooks, jobs });
    const bs = [234, 156].map((units) =>
      yearOpening.map((value, row) => value + yearBalanceMovement[row]! * units),
    );
    const income = [78, 156].map((units) => yearIncomeUnit.map((value) => value * units));
    const cash = [
      [78, 156],
      [156, 0],
    ].map(([units, before]) => [
      ...yearCashUnit.map((value) => value * units!),
      2100000 + 8381 * before!,
      2100000 + 8381 * (before! + units!),
    ]);
    for (const [index, statement] of prepared.statements.entries()) {
      await page.getByRole('button', { name: statement.name, exact: true }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出Excel', exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`${statement.name}.xlsx`);
      const xlsx = info.outputPath(`${statement.code}.xlsx`);
      await download.saveAs(xlsx);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Uint8Array.from(await readFile(xlsx)).buffer);
      const ws = wb.worksheets[0]!;
      expect(ws.pageSetup.paperSize).toBe(9);
      expect(ws.pageSetup.fitToHeight).toBe(0);
      expect(ws.pageSetup.printTitlesRow).toBe('1:3');
      expect(ws.getCell('A2').value).toContain('测试单位有限公司');
      const expected = [bs, income, cash][index]!;
      for (const [column, values] of expected.entries())
        for (const [row, value] of values.entries())
          expect(
            ws.getCell(row + 4, column + 3).value,
            `${statement.code}行${row + 1}列${column + 1}`,
          ).toBe(value / 100);
      if (index === 0) {
        expect(ws.getCell('A57').value).toBe('减：已归还投资');
        expect(ws.getCell('C57').value).toBe(20);
        expect(ws.getCell('D57').value).toBe(20);
      }
      await page.evaluate(() => {
        window.smallPrintedDocument = undefined;
      });
      await page.getByRole('button', { name: '打印', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.smallPrintedDocument ?? ''))
        .toContain('small-report-page');
      const html = await page.evaluate(() => window.smallPrintedDocument!);
      const printPage = await browser.newPage();
      try {
        await printPage.setContent(html);
        await printPage.emulateMedia({ media: 'print' });
        const pdf = info.outputPath(`${statement.code}.pdf`);
        await printPage.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
        const metadata = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
        expect(metadata).toMatch(new RegExp(`Pages:\\s+${index === 0 ? 3 : 2}\\b`));
        const size = /Page size:\s+([\d.]+) x ([\d.]+) pts \(A4\)/.exec(metadata);
        expect(size).not.toBeNull();
        expect(Math.abs(Number(size![1]) - 595.276)).toBeLessThan(0.5);
        expect(Math.abs(Number(size![2]) - 841.89)).toBeLessThan(0.5);
        const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
        const compact = text.replace(/\s/g, '');
        expect(compact).toContain(statement.rows[0]!.label.replace(/\s/g, ''));
        expect(compact).toContain(statement.rows.at(-1)!.label.replace(/\s/g, ''));
        for (const values of expected) {
          expect(compact).toContain((values[0]! / 100).toFixed(2));
          expect(compact).toContain((values.at(-1)! / 100).toFixed(2));
        }
        for (const part of text.split('\f').filter((p) => p.trim())) {
          expect(part).toContain('测试单位有限公司');
          expect(part).toContain('2026-12-31');
          expect(part).toContain('单位：元');
        }
        await printPage.screenshot({
          path: info.outputPath(`${statement.code}-print.png`),
          fullPage: true,
        });
      } finally {
        await printPage.close();
      }
    }
    await page.evaluate(() => {
      document.body.style.zoom = '1.5';
    });
    for (const name of ['导出Excel', '打印']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(1366);
    }
    expect(await page.evaluate(() => window.smallErrors ?? [])).toEqual([]);
  } finally {
    await app.close();
  }
});
test('w_bb_get 本域配置组件可修复现金范围日期并持久保存（公共安装入口另验）', async ({ page }) => {
  const { app, svc } = await completeCoreBook();
  try {
    const prepared = await svc.tx((t) =>
      prepareSmallBusiness(t, { period: 202612, mode: 'annual' }),
    );
    const configurationData = await smallBusinessConfigurationData(svc, 202612);
    await page.setContent('<html lang="zh-CN"><body><div id="root"></div></body></html>');
    await page.addScriptTag({ path: bundle });
    await page.evaluate((data) => window.mountSmallBusiness(data, 'configuration'), {
      prepared,
      workbooks: [],
      jobs: [],
      configurationData,
    });
    await page.getByRole('tab', { name: '现金范围', exact: true }).click();
    await page.getByLabel('1001 现金范围截止日期', { exact: true }).fill('2028-12-31');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    const saved = await page.evaluate(() => window.smallSavedConfiguration!);
    expect(saved.cashScope.find((s) => s.account === '1001')!.to).toBe('2028-12-31');
    await svc.tx((t) => saveConfiguration(t, saved as Configuration, saved.revision));
    const again = await smallBusinessConfigurationData(svc, 202612);
    expect(again.configuration.cashScope.find((s) => s.account === '1001')!.to).toBe('2028-12-31');
  } finally {
    await app.close();
  }
});
