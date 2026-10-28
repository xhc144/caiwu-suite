import { test, expect } from '@playwright/test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { seedVouchers } from '@caiwu/testkit';
import { completeCoreBook } from '../../test/small-business/core-fixture';
import { smallBusinessApp } from '../../test/small-business/fixture';
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
  loadConfiguration,
} from '../../templates/small-business/statutory.server';
import { statementPrintJob, statementWorkbook } from '../../templates/small-business/output';
import {
  rowKey,
  entrySignature,
  type Configuration,
} from '../../templates/small-business/configuration';

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

test('w_bb_get/proc 复合转账在界面选择内部转存并保存出表，现金流只保留手续费', async ({ page }) => {
  const app = await smallBusinessApp();
  const svc = app.svcFor('report-engine');
  try {
    for (const [code, balance] of [
      ['1001', 200000],
      ['3001', -200000],
    ] as const)
      await svc.opening.upsert({
        year: 2026,
        accountId: (await svc.accounts.require(code)).id,
        balance,
      });
    const config = await loadConfiguration(svc);
    config.details['5603'] = { line: null, reason: '银行转存手续费，不属于利息' };
    config.cashScope = ['1001', '100201', '1012'].map((account) => ({
      account,
      from: '2026-01-01',
      to: '2026-12-31',
      available: account !== '1012',
      reason: account === '1012' ? '受限资金' : '可随时支付',
    }));
    for (const period of [202512, 202601])
      config.facts.push({
        period,
        key: rowKey({ accountCode: '3001', dimensions: {} }),
        balance: -200000,
        allocations: [{ role: 'capital', amount: -200000 }],
        reason: '合成企业实缴资本',
      });
    await svc.tx((t) => saveConfiguration(t, config, config.revision));
    const prepared = await svc.tx((t) =>
      prepareSmallBusiness(t, { period: 202601, mode: 'monthly' }),
    );
    assertSmallBusinessOutput(prepared);
    const [oldTransfer] = await seedVouchers(svc, [
      {
        date: '2026-01-04',
        status: 'posted',
        summary: '旧纯现金转存',
        lines: [
          { account: '100201', debit: 20000 },
          { account: '1001', credit: 20000 },
        ],
      },
    ]);
    const oldEntries = await svc.ledger.entries({ periodFrom: 202601, periodTo: 202601 });
    const oldConfig = await loadConfiguration(svc);
    for (const entry of oldEntries)
      oldConfig.cashAllocations[String(entry.lineId)] = {
        signature: entrySignature(entry, oldEntries),
        reason: '旧版人工外部项目分类',
        parts: [
          { line: entry.accountCode === '100201' ? 1 : 11, amount: entry.debit - entry.credit },
        ],
      };
    await svc.tx((t) => saveConfiguration(t, oldConfig, oldConfig.revision));
    await expect(
      svc.tx((t) => prepareSmallBusiness(t, { period: 202601, mode: 'monthly' })),
    ).rejects.toThrow(/请全部归入内部转存/);
    await seedVouchers(svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        summary: '银行转存及手续费',
        lines: [
          { account: '100201', debit: 99500 },
          { account: '5603', debit: 500 },
          { account: '1001', credit: 100000 },
        ],
      },
    ]);
    const configurationData = await smallBusinessConfigurationData(svc, 202601);
    await page.setContent('<html lang="zh-CN"><body><div id="root"></div></body></html>');
    await page.addScriptTag({ path: bundle });
    await page.evaluate((data) => window.mountSmallBusiness(data, 'configuration'), {
      prepared: { ...prepared, configuration: configurationData.configuration },
      workbooks: [],
      jobs: [],
      configurationData,
    });
    await page.getByRole('tab', { name: '现金分录分类', exact: true }).click();
    const cashEntries = configurationData.entries.filter((entry) =>
      ['1001', '100201'].includes(entry.accountCode),
    );
    expect(cashEntries).toHaveLength(4);
    const chooseProject = async (lineId: number, part: number, label: string) => {
      const project = page.getByLabel(`分录${lineId}项目${part}`, { exact: true });
      await project.focus();
      await project.press('ArrowDown');
      const listId = await project.getAttribute('aria-controls');
      expect(listId).not.toBeNull();
      const dropdown = page
        .locator(`[id="${listId}"]`)
        .locator(
          'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select-dropdown ")]',
        );
      await expect(dropdown).toBeVisible();
      const activeOption = dropdown.locator('.ant-select-item-option-active');
      for (let step = 0; step < 18; step++) {
        if ((await activeOption.textContent()) === label) break;
        await project.press('ArrowUp');
      }
      await expect(activeOption).toHaveText(label);
      await project.press('Enter');
    };
    for (const entry of cashEntries) {
      const isOldTransfer = entry.voucherId === oldTransfer!.id;
      const row = page
        .getByLabel(`分录${entry.lineId}分类依据`, { exact: true })
        .locator('xpath=ancestor::tr');
      if (!isOldTransfer)
        await row.getByRole('button', { name: '增加项目分配', exact: true }).click();
      await chooseProject(entry.lineId, 1, '内部转存');
      await row
        .getByLabel('现金分配金额（元，流入为正流出为负）', { exact: true })
        .first()
        .fill(`${entry.accountCode === '100201' ? '' : '-'}${isOldTransfer ? '200' : '995'}`);
      if (!isOldTransfer && entry.accountCode === '1001') {
        await row.getByRole('button', { name: '增加项目分配', exact: true }).click();
        await chooseProject(entry.lineId, 2, '支付其他与经营活动有关的现金');
        await row
          .getByLabel('现金分配金额（元，流入为正流出为负）', { exact: true })
          .nth(1)
          .fill('-5');
      }
      await page
        .getByLabel(`分录${entry.lineId}分类依据`, { exact: true })
        .fill(
          isOldTransfer ? '修正旧纯转存为内部项目200元' : '账户内部转存995元，另付银行手续费5元',
        );
    }
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    const saved = await page.evaluate(() => window.smallSavedConfiguration!);
    const incoming = cashEntries.find(
      (entry) => entry.accountCode === '100201' && entry.voucherId !== oldTransfer!.id,
    )!;
    const outgoing = cashEntries.find(
      (entry) => entry.accountCode === '1001' && entry.voucherId !== oldTransfer!.id,
    )!;
    for (const entry of oldEntries)
      expect(saved.cashAllocations[String(entry.lineId)]!.parts).toEqual([
        { line: 0, amount: entry.debit - entry.credit },
      ]);
    expect(saved.cashAllocations[String(incoming.lineId)]!.parts).toEqual([
      { line: 0, amount: 99500 },
    ]);
    expect(saved.cashAllocations[String(outgoing.lineId)]!.parts).toEqual([
      { line: 0, amount: -99500 },
      { line: 6, amount: -500 },
    ]);
    await svc.tx((t) => saveConfiguration(t, saved as Configuration, saved.revision));
    const persisted = await loadConfiguration(svc);
    expect(persisted.cashAllocations).toEqual(saved.cashAllocations);
    const result = await svc.tx((t) =>
      prepareSmallBusiness(t, { period: 202601, mode: 'monthly' }),
    );
    assertSmallBusinessOutput(result);
    for (const column of [0, 1])
      expect(result.statements[2].rows.map((row) => row.amounts[column]?.value)).toEqual([
        0, 0, 0, 0, 0, 500, -500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -500, 200000, 199500,
      ]);
    await page.setContent('<html lang="zh-CN"><body><div id="root"></div></body></html>');
    await page.evaluate((data) => window.mountSmallBusiness(data), {
      prepared: result,
      workbooks: [],
      jobs: [],
    });
    await page.getByRole('button', { name: '小企业现金流量表', exact: true }).click();
    await expect(page.locator('#small-303-1 [data-cents="0"]')).toHaveCount(2);
    await expect(page.locator('#small-303-6 [data-cents="500"]')).toHaveCount(2);
    await expect(page.locator('#small-303-20 [data-cents="-500"]')).toHaveCount(2);
  } finally {
    await app.close();
  }
});
