import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi } from '@caiwu/testkit/e2e';
import type { StatutoryProfile, StatutorySnapshot } from '../shared';
import { statutoryIdentity } from '../test/statutory-fixture';
import { test } from './fixture';

test('w_bb_main → 真实配置保存 → 法定生成快照 → 授权xlsx与A4打印', async ({ page, isolated }) => {
  const { bookId, configuration } = await isolated.prepareStatutoryBook();
  const login = await callApi<{ token: string; user: unknown; book: unknown }>(
    isolated.request,
    'core.auth.login',
    { bookId, userCode: 'admin', password: 'admin' },
    { method: 'POST' },
  );
  await page.addInitScript(
    (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
    { token: login.token, bookId, user: login.user, book: login.book },
  );
  const p = await callApi<StatutoryProfile>(
    isolated.request,
    'm.report-engine.statutory.save',
    {
      ...statutoryIdentity,
      code: '201',
      name: '公共入口合成资产负债表',
      configuration,
    },
    { token: login.token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine`);
  await expect(
    page
      .getByRole('region', { name: '法定报表管理' })
      .getByText('公共入口合成资产负债表', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '配置/生成/查看' }).click();
  await expect(
    page.getByRole('heading', { name: '法定报表：公共入口合成资产负债表' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: '依据来源', exact: true })
    .first()
    .fill('通过真实配置页面再次核实政策');
  await page.getByRole('button', { name: '保存并确认来源' }).click();
  await expect(page.getByText('已保存配置版本 2；', { exact: false })).toBeVisible();
  const saved = await callApi<StatutoryProfile>(
    isolated.request,
    'm.report-engine.statutory.get',
    { id: p.id },
    { token: login.token, method: 'GET' },
  );
  expect((saved.configuration as typeof configuration).adoption.source).toBe(
    '通过真实配置页面再次核实政策',
  );
  await page.reload();
  await expect(page.getByRole('textbox', { name: '依据来源', exact: true }).first()).toHaveValue(
    '通过真实配置页面再次核实政策',
  );
  const interimRead = page.waitForResponse(
    (response) =>
      response.url().includes('statutory.editor') &&
      decodeURIComponent(response.url()).includes('"scope":"yearToDate"'),
  );
  await page.getByRole('combobox', { name: '比较口径', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: '年初至今及上年同期' })
    .click();
  expect((await interimRead).ok()).toBe(true);
  for (const period of [202511, 202512]) {
    const reread = page.waitForResponse(
      (response) =>
        response.url().includes('statutory.editor') &&
        decodeURIComponent(response.url()).includes(`"period":${period}`),
    );
    await page.getByRole('combobox', { name: '报告期间', exact: true }).click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: String(period) })
      .click();
    expect((await reread).ok()).toBe(true);
    await expect(page.getByRole('textbox', { name: '依据来源', exact: true }).first()).toHaveValue(
      '通过真实配置页面再次核实政策',
    );
  }
  const annualRead = page.waitForResponse(
    (response) =>
      response.url().includes('statutory.editor') &&
      decodeURIComponent(response.url()).includes('"scope":"annual"'),
  );
  await page.getByRole('combobox', { name: '比较口径', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: '完整年度及上年度' })
    .click();
  expect((await annualRead).ok()).toBe(true);
  await page.getByRole('button', { name: '保存并确认来源' }).click();
  await expect(page.getByText('已保存配置版本 3；', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '生成法定报表', exact: true }).click();
  await expect(page.getByRole('tab', { name: '生成结果', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('成功结果：', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '资产负债表 · 1', exact: true })).toBeVisible();
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出法定报表 Excel' }).click();
  const download = await downloadWait;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await download.path())!);
  expect(wb.worksheets[0]!.getCell('B5').value).toBe(1000);
  expect(wb.worksheets[0]!.pageSetup.paperSize).toBe(9);
  const printed = await page.evaluateHandle(() => {
    const events: { phase: string; trusted: boolean; text: string; css: string }[] = [];
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
                    events.push({
                      phase,
                      trusted: event.isTrusted,
                      text: node.contentDocument!.body.textContent!,
                      css: node.contentDocument!.head.textContent!,
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
  await page.getByRole('button', { name: 'A4 打印' }).click();
  await expect
    .poll(() => printed.evaluate((events) => events.map((e) => e.phase)))
    .toEqual(['beforeprint', 'afterprint']);
  const events = await printed.jsonValue();
  expect(events.every((e) => e.trusted)).toBe(true);
  expect(events[0]!.text).toContain('公共报表界面合成单位');
  expect(events[0]!.text).toContain('1000.00');
  expect(events[0]!.css).toContain('A4');
  await expect(page.locator('iframe')).toHaveCount(0);
  await printed.dispose();
  // B窗口通过真实接口更新配置并生成；A仍显示旧快照，输出必须提示刷新。
  const displayed = await callApi<StatutorySnapshot>(
    isolated.request,
    'm.report-engine.statutory.snapshot',
    { id: p.id, period: 202512 },
    { token: login.token, method: 'GET' },
  );
  const latestProfile = await callApi<StatutoryProfile>(
    isolated.request,
    'm.report-engine.statutory.get',
    { id: p.id },
    { token: login.token, method: 'GET' },
  );
  const nextConfiguration = latestProfile.configuration as typeof configuration;
  const nextProfile = await callApi<StatutoryProfile>(
    isolated.request,
    'm.report-engine.statutory.save',
    {
      ...statutoryIdentity,
      id: p.id,
      expectedRevision: latestProfile.revision,
      code: p.code,
      name: p.name,
      configuration: {
        ...nextConfiguration,
        adoption: { ...nextConfiguration.adoption, version: 'B窗口再次核实' },
      },
    },
    { token: login.token, method: 'POST' },
  );
  const next = await callApi<{ kind: 'generated'; snapshot: StatutorySnapshot }>(
    isolated.request,
    'm.report-engine.statutory.generate',
    {
      id: p.id,
      expectedRevision: nextProfile.revision,
      period: 202512,
      requestId: crypto.randomUUID(),
    },
    { token: login.token, method: 'POST' },
  );
  expect(next.snapshot.id).not.toBe(displayed.id);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  const staleResponse = page.waitForResponse((response) =>
    response.url().includes('statutory.output'),
  );
  await page.getByRole('button', { name: '导出法定报表 Excel' }).click();
  const sent = decodeURIComponent((await staleResponse).url());
  expect(sent).toContain(`"snapshotId":${displayed.id}`);
  expect(sent).toContain(`"expectedRevision":${displayed.profile.revision}`);
  await expect(page.locator('.ant-alert').filter({ hasText: '刷新' }).first()).toBeVisible();
  expect(downloads).toEqual([]);
  await page.getByRole('button', { name: 'A4 打印' }).click();
  await expect(page.locator('.ant-alert').filter({ hasText: '刷新' }).first()).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: '生成结果', exact: true }).click();
  await expect(
    page.getByText(`配置版本 ${nextProfile.revision}`, { exact: false }).last(),
  ).toBeVisible();
  const freshDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出法定报表 Excel' }).click();
  await freshDownload;
  expect(downloads).toHaveLength(1);
});
