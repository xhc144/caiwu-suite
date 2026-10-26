import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { seedVouchers } from '@caiwu/testkit';
import { centsToYuan, toCents } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { browserRuntime } from './runtime';
import server from '../server';

const spec = (summary: string, amount = 1, date = '2026-01-05') => ({
  date,
  summary,
  lines: [
    { account: '6603', debit: amount },
    { account: '6001', credit: amount },
  ],
});

test('w_pz_tjsh 混合批次真实入口保留逐项状态、跳过原因并导出完整清单', async ({ page }) => {
  const t = await browserRuntime();
  try {
    const [mine] = await seedVouchers(t.app.svc, [spec('本人样本')]);
    await t.app.addUser('maker');
    const userId = (await t.app.svc.users.list()).find((u) => u.code === 'maker')!.id;
    const user = (await loadServiceUser(t.app.svc.db, userId))!;
    const [other] = await seedVouchers(createCoreServices({ ...t.app.svc.ctx, user }), [
      spec('其他制单人'),
    ]);
    await t.login(page, 'admin', 'admin');
    await page.getByText(/当前查询全部结果/).click();
    await page.getByRole('button', { name: '批量审核', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '审核预览', exact: true });
    await expect(dialog).toContainText('可处理 1 张，跳过 1 张');
    await dialog.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(page.getByText('成功 1 张，跳过 1 张', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查看处理清单', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '凭证处理清单', exact: true });
    await expect(dialog.getByRole('row').filter({ hasText: '记-0001' })).toContainText(
      '制单人与审核人相同',
    );
    await expect(dialog.getByRole('row').filter({ hasText: '记-0002' })).toContainText('已审核');
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '导出处理清单 Excel', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('凭证处理清单.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await download.path())!);
    const text = JSON.stringify(wb.worksheets[0]!.getSheetValues());
    expect(text).toContain('制单人与审核人相同');
    expect(text).toContain('已审核');
    expect(text).toContain('待审核');
    expect(wb.worksheets[0]!.rowCount).toBe(4);
    expect((await t.app.svc.vouchers.get(mine!.id))!.status).toBe('pending');
    expect((await t.app.svc.vouchers.get(other!.id))!.status).toBe('audited');
    await dialog.getByRole('button', { name: '2026-01-05 记-0002', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '凭证浏览', exact: true })).toContainText(
      '其他制单人',
    );
  } finally {
    await t.close();
  }
});

test('w_pz_get Excel歧义表头经真实入口阻止且不写库，修正映射后有目标结果清单', async ({ page }) => {
  const t = await browserRuntime();
  let releasePreview = () => {};
  try {
    await seedVouchers(t.app.svc, [spec('Excel映射原件')]);
    const file = await t.app.call(server).export({ filter: {}, format: 'xlsx' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(file.file, 'base64')).buffer);
    const sheet = wb.getWorksheet('凭证')!;
    const extra = sheet.columnCount + 1;
    sheet.getRow(1).getCell(extra).value = 'account';
    sheet.getRow(2).getCell(extra).value = '错误科目';
    await t.login(page, 'admin', 'admin');
    await page.getByRole('button', { name: '导入 / 转入', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '凭证导入 / 转入', exact: true });
    await dialog.getByLabel('选择文件', { exact: true }).setInputFiles({
      name: '重复.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    });
    let previewRequests = 0;
    const responseGate = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    await page.route('**/trpc/m.voucher-book.importPreview*', async (route) => {
      previewRequests++;
      if (previewRequests === 1) await responseGate;
      await route.continue();
    });
    const previewButton = dialog.getByRole('button', { name: '逐凭证预览', exact: true });
    await previewButton.click();
    await expect(previewButton).toHaveAccessibleName('逐凭证预览');
    await expect(previewButton).toHaveAttribute('aria-busy', 'true');
    await expect(previewButton).toBeDisabled();
    releasePreview();
    await expect(page.getByText(/匹配到多个表头/)).toBeVisible();
    await expect(previewButton).toHaveAttribute('aria-busy', 'false');
    await expect(previewButton).toBeEnabled();
    expect((await t.app.svc.vouchers.list({})).total).toBe(1);
    await dialog.getByText('查看或修正字段对应关系', { exact: true }).click();
    await dialog.getByLabel('映射科目编码', { exact: true }).fill('科目编码');
    await dialog.getByRole('button', { name: '逐凭证预览', exact: true }).click();
    await expect(dialog).toContainText('合法 1 张；错误 0 项');
    expect(previewRequests).toBe(2);
    await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
    await page.getByRole('button', { name: '查看处理清单', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '凭证处理清单', exact: true });
    await expect(dialog).toContainText('2026-01-05 记-0002');
    await expect(dialog).toContainText('待审核');
    expect((await t.app.svc.vouchers.list({})).total).toBe(2);
  } finally {
    releasePreview();
    await t.close();
  }
});

test('w_pz_ttsee 红字精确合计、当前范围Excel、原生打印与空范围拒绝', async ({ page, context }) => {
  const t = await browserRuntime();
  try {
    await seedVouchers(t.app.svc, [
      spec('打印 <样本>', Number.MAX_SAFE_INTEGER, '2026-01-01'),
      spec('同向红字', -(Number.MAX_SAFE_INTEGER - 1), '2026-01-20'),
      spec('范围外', 99, '2026-02-01'),
    ]);
    await t.login(page, 'admin', 'admin');
    await page.goto(`${t.address}/m/voucher-book/t-account?period=202601&account=6603`);
    await expect(page.getByRole('heading', { name: '借方 合计 0.01', exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出当前范围', exact: true }).click();
    const downloaded = await downloadPromise;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(await readFile((await downloaded.path())!)).buffer);
    const values = wb.worksheets[0]!.getSheetValues();
    expect(wb.worksheets[0]!.getRow(3).getCell(6).value).toBe(centsToYuan(Number.MAX_SAFE_INTEGER));
    expect(toCents(wb.worksheets[0]!.getRow(4).getCell(6).value as number | string)).toBe(
      -(Number.MAX_SAFE_INTEGER - 1),
    );
    expect(JSON.stringify(values)).toContain('合计');
    expect(JSON.stringify(values)).not.toContain('范围外');
    expect(wb.worksheets[0]!.lastRow!.getCell(6).value).toBe(0.01);
    await page.evaluate(() => {
      const events: { phase: string; html: string; text: string; trusted: boolean }[] = [];
      (window as unknown as { voucherPrintEvents: typeof events }).voucherPrintEvents = events;
      new MutationObserver((mutations) => {
        for (const mutation of mutations)
          for (const node of mutation.addedNodes) {
            if (
              !(node instanceof HTMLIFrameElement) ||
              node.getAttribute('aria-label') !== '系统打印'
            )
              continue;
            node.addEventListener(
              'load',
              () => {
                for (const phase of ['beforeprint', 'afterprint'])
                  node.contentWindow!.addEventListener(phase, (event) =>
                    events.push({
                      phase,
                      html: node.srcdoc,
                      text: node.contentDocument!.body.textContent!,
                      trusted: event.isTrusted,
                    }),
                  );
              },
              { capture: true, once: true },
            );
          }
      }).observe(document.body, { childList: true });
    });
    await page.getByRole('button', { name: '打印当前范围', exact: true }).click();
    const events = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              voucherPrintEvents: { phase: string; html: string; text: string; trusted: boolean }[];
            }
          ).voucherPrintEvents,
      );
    await expect.poll(async () => (await events()).length).toBe(2);
    const printed = await events();
    expect(printed.map((e) => e.phase)).toEqual(['beforeprint', 'afterprint']);
    expect(printed.every((e) => e.trusted)).toBe(true);
    expect(printed[0]!.text).toContain('借方 合计 0.01');
    expect(printed[0]!.text).toContain('打印 <样本>');
    expect(printed[0]!.text).not.toContain('范围外');
    expect(printed[0]!.html).toContain('打印 &lt;样本&gt;');
    await expect(page.locator('iframe[aria-label="系统打印"]')).toHaveCount(0);
    const output = await context.newPage();
    try {
      await output.setViewportSize({ width: 1047, height: 800 });
      await output.setContent(printed[0]!.html);
      await output.emulateMedia({ media: 'print' });
      await output.evaluate(() => document.fonts.ready);
      expect(
        await output
          .locator('td.num')
          .evaluateAll((cells) => cells.every((c) => c.scrollWidth <= c.clientWidth + 1)),
      ).toBe(true);
      const pdf = await output.pdf({ preferCSSPageSize: true });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
    } finally {
      await output.close();
    }
    await page.goto(`${t.address}/m/voucher-book/t-account?period=202603&account=6603`);
    await expect(page.getByText('该条件范围内没有单据输入', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '打印当前范围', exact: true }).click();
    await expect(
      page.getByText('该条件范围内没有单据输入，请调整范围后打印', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('iframe[aria-label="系统打印"]')).toHaveCount(0);
  } finally {
    await t.close();
  }
});

test('w_pz_kmhz 科目汇总打印当前编号范围，缺打印权限无入口且服务器拒绝', async ({ page }) => {
  const t = await browserRuntime();
  try {
    await seedVouchers(t.app.svc, [spec('本次汇总', 2), spec('未选凭证', 99)]);
    await t.login(page, 'admin', 'admin');
    await page.goto(`${t.address}/m/voucher-book/summary?period=202601&numberFrom=1&numberTo=1`);
    await expect(page.getByRole('row').filter({ hasText: '6603' })).toContainText('0.02');
    await page.evaluate(() => {
      new MutationObserver((mutations) => {
        for (const mutation of mutations)
          for (const node of mutation.addedNodes) {
            if (
              !(node instanceof HTMLIFrameElement) ||
              node.getAttribute('aria-label') !== '系统打印'
            )
              continue;
            node.addEventListener(
              'load',
              () =>
                node.contentWindow!.addEventListener('beforeprint', (event) => {
                  (
                    window as unknown as { summaryPrint: { text: string; trusted: boolean } }
                  ).summaryPrint = {
                    text: node.contentDocument!.body.textContent!,
                    trusted: event.isTrusted,
                  };
                }),
              { capture: true, once: true },
            );
          }
      }).observe(document.body, { childList: true });
    });
    await page.getByRole('button', { name: '打印当前范围', exact: true }).click();
    const capture = () =>
      page.evaluate(
        () =>
          (window as unknown as { summaryPrint?: { text: string; trusted: boolean } }).summaryPrint,
      );
    await expect.poll(async () => (await capture())?.trusted).toBe(true);
    expect((await capture())!.text).toContain('凭证科目汇总');
    expect((await capture())!.text).toContain('0.02');
    expect((await capture())!.text).not.toContain('0.99');
    await expect(page.locator('iframe[aria-label="系统打印"]')).toHaveCount(0);
    const token = await t.app.addUser('viewer', {
      password: 'v',
      permissions: ['voucher-book.view', 'voucher-book.export'],
    });
    await t.login(page, 'viewer', 'v');
    await page.goto(`${t.address}/m/voucher-book/summary?period=202601`);
    await expect(page.getByRole('heading', { name: '凭证科目汇总', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '打印当前范围', exact: true })).toHaveCount(0);
    await expect(t.app.call(server, token).summaryPrint({ filter: {} })).rejects.toThrow(/权限/);
  } finally {
    await t.close();
  }
});
