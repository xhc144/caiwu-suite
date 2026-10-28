import { expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { emptyTemplate, type Report } from '../shared';
import { test } from './fixture';

async function choose(page: Page, label: string, text: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.click();
  const controls = await input.getAttribute('aria-controls');
  if (!controls) throw new Error(`下拉框${label}没有对应的选项列表`);
  const dropdown = page.locator('.ant-select-dropdown').filter({
    has: page.locator(`[id=${JSON.stringify(controls)}]`),
  });
  await dropdown.getByText(text, { exact: true }).click();
}

/** 观察浏览器真正交给打印系统的 iframe，不替换 print() 或业务输出。 */
async function observePrint(page: Page) {
  return page.evaluateHandle(() => {
    const events: { trusted: boolean; html: string; text: string; pageCss: string }[] = [];
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations)
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLIFrameElement)) continue;
          node.addEventListener(
            'load',
            () => {
              node.contentWindow!.addEventListener(
                'beforeprint',
                (event) => {
                  const doc = node.contentDocument!;
                  events.push({
                    trusted: event.isTrusted,
                    html: doc.body.innerHTML,
                    text: doc.body.textContent!,
                    pageCss: Array.from(doc.styleSheets)
                      .flatMap((sheet) => Array.from(sheet.cssRules))
                      .filter((rule) => rule.type === CSSRule.PAGE_RULE)
                      .map((rule) => rule.cssText)
                      .join('\n'),
                  });
                  observer.disconnect();
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
}

test('w_bb_def 批贴金额、插删行列和整步撤销重做后保存，公式随位置调整并生成', async ({
  page,
  isolated,
}) => {
  const { token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const template = emptyTemplate({ code: '101', name: '编辑器完整操作', rows: 6, cols: 5 });
  template.cells = [
    { address: 'A1', kind: 'text', source: '项目', unit: 'number', currency: 'CNY' },
    { address: 'B2', kind: 'money', source: '0', unit: 'cents', currency: 'CNY' },
    { address: 'C2', kind: 'money', source: '0', unit: 'cents', currency: 'CNY' },
    { address: 'D2', kind: 'formula', source: 'B2+C2', unit: 'cents', currency: 'CNY' },
    { address: 'A4', kind: 'text', source: '保留末行内容', unit: 'number', currency: 'CNY' },
  ];
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    template,
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  await page.getByRole('textbox', { name: 'A1', exact: true }).fill('会计项目');
  await page.getByLabel('B2', { exact: true }).click();
  await page.getByRole('button', { name: '批量粘贴', exact: true }).click();
  await choose(page, '粘贴类型', '金额（元）');
  await page.getByLabel('批量粘贴内容').fill('100.01\t200.02\n300.03\t400.04\n');
  await page.getByRole('button', { name: '应用粘贴', exact: true }).click();
  await expect(page.getByLabel('B2', { exact: true })).toHaveValue('100.01');
  await expect(page.getByLabel('C3', { exact: true })).toHaveValue('400.04');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('B2', { exact: true })).toHaveValue('0.00');
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue('会计项目');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByLabel('B2', { exact: true })).toHaveValue('100.01');

  await page.getByLabel('B2', { exact: true }).click();
  await page.getByRole('button', { name: '插入行', exact: true }).click();
  await expect(page.getByLabel('定义行数')).toHaveValue('7');
  await expect(page.getByRole('textbox', { name: 'D3', exact: true })).toHaveValue('B3+C3');
  await page.getByLabel('B3', { exact: true }).click();
  await page.getByRole('button', { name: '插入列', exact: true }).click();
  await expect(page.getByLabel('定义列数')).toHaveValue('6');
  await expect(page.getByRole('textbox', { name: 'E3', exact: true })).toHaveValue('C3+D3');

  await page.getByRole('textbox', { name: 'B2', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '删除行', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'E2', exact: true })).toHaveValue('C2+D2');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '删除列', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'D2', exact: true })).toHaveValue('B2+C2');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('定义列数')).toHaveValue('6');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByLabel('定义列数')).toHaveValue('5');
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('B2', { exact: true })).toHaveValue('100.01');
  await expect(page.getByRole('textbox', { name: 'A4', exact: true })).toHaveValue('保留末行内容');
  const saved = await callApi<Report>(
    isolated.request,
    'm.report-engine.get',
    { id: report.id },
    { token },
  );
  expect(saved.template.cells.find((c) => c.address === 'B2')).toMatchObject({
    kind: 'money',
    source: '10001',
    unit: 'cents',
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${report.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算', exact: true }).click();
  await expect(page.getByTestId('result-D2').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '30003',
  );
});

test('w_bb_def 字体边框与分页标题随定义保存，真实xlsx和浏览器打印保留设置', async ({
  page,
  isolated,
}) => {
  const { token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const template = emptyTemplate({ code: '101', name: '字体分页报表', rows: 8, cols: 4 });
  template.cells = [
    { address: 'A1', kind: 'text', source: '重复项目标题', unit: 'number', currency: 'CNY' },
    { address: 'B2', kind: 'money', source: '12345', unit: 'cents', currency: 'CNY' },
  ];
  template.colWidths = [1, 2, 3, 4].map((col) => ({ col, width: 120 }));
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    template,
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  await page.getByLabel('B2', { exact: true }).click();
  await choose(page, '字体', '楷体');
  await page.getByLabel('字号', { exact: true }).fill('18');
  await page.getByRole('checkbox', { name: '粗体', exact: true }).check();
  await page.getByRole('checkbox', { name: '斜体', exact: true }).check();
  await page.getByRole('checkbox', { name: '下划线', exact: true }).check();
  await choose(page, '上边框', '双线');
  await choose(page, '右边框', '虚线');
  const cell = page.getByLabel('B2', { exact: true }).locator('..');
  await expect(cell).toHaveCSS('font-size', '24px');
  await expect(cell).toHaveCSS('border-top-style', 'double');
  await page.getByRole('button', { name: '打印设置', exact: true }).click();
  await choose(page, '打印方向', '横向');
  await page.getByLabel('打印页边距', { exact: true }).fill('12');
  await page.getByLabel('重复表头行数', { exact: true }).fill('1');
  await page.getByLabel('分页行', { exact: true }).fill('5');
  await page.getByRole('button', { name: '应用打印设置', exact: true }).click();
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('B2', { exact: true }).locator('..')).toHaveCSS(
    'font-style',
    'italic',
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${report.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算', exact: true }).click();
  await expect(page.getByTestId('result-B2')).toContainText('123.45');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloading;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.getCell('B2').value).toBe(123.45);
  expect(sheet.getCell('B2').font).toMatchObject({
    name: '楷体',
    size: 18,
    bold: true,
    italic: true,
    underline: true,
  });
  expect(sheet.getCell('B2').border).toMatchObject({
    top: { style: 'double' },
    right: { style: 'dashed' },
  });
  expect(sheet.pageSetup).toMatchObject({ orientation: 'landscape', printTitlesRow: '1:1' });
  expect(sheet.pageSetup.margins!.left).toBeCloseTo(12 / 25.4, 6);
  const printed = await observePrint(page);
  await page.getByRole('button', { name: '打印', exact: true }).click();
  await expect.poll(() => printed.evaluate((events) => events.length)).toBe(1);
  const [job] = await printed.jsonValue();
  expect(job!.trusted).toBe(true);
  expect(job!.html.match(/data-report-page=/g)).toHaveLength(2);
  expect(job!.html.match(/重复项目标题/g)).toHaveLength(2);
  expect(job!.html).toContain('font-family:楷体');
  expect(job!.html).toContain('border-top:2pt double');
  expect(job!.pageCss).toContain('landscape');
  expect(job!.pageCss).toContain('12mm');
  await printed.dispose();
});

test('w_bb_def_gs 套打保存真实偏移和原始格宽，只打印计算结果', async ({ page, isolated }) => {
  const { token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const template = emptyTemplate({ code: '101', name: '预印套打报表', rows: 4, cols: 3 });
  template.cells = [
    { address: 'A1', kind: 'text', source: '预印纸已有标题', unit: 'number', currency: 'CNY' },
    { address: 'B2', kind: 'money', source: '12345', unit: 'cents', currency: 'CNY' },
    { address: 'C2', kind: 'formula', source: 'B2*2', unit: 'cents', currency: 'CNY' },
  ];
  template.colWidths = [1, 2, 3].map((col) => ({ col, width: 120 }));
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    template,
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  await page.getByRole('button', { name: '打印设置', exact: true }).click();
  await choose(page, '打印方式', '套打（预印表格）');
  await page.getByLabel('套打横向偏移', { exact: true }).fill('3');
  await page.getByLabel('套打纵向偏移', { exact: true }).fill('4');
  await page.getByRole('button', { name: '应用打印设置', exact: true }).click();
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  const saved = await callApi<Report>(
    isolated.request,
    'm.report-engine.get',
    { id: report.id },
    { token },
  );
  expect(saved.template.print).toMatchObject({ mode: 'overlay', offsetXmm: 3, offsetYmm: 4 });
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${report.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算', exact: true }).click();
  await expect(page.getByTestId('result-C2')).toContainText('246.90');
  const printed = await observePrint(page);
  await page.getByRole('button', { name: '打印', exact: true }).click();
  await expect.poll(() => printed.evaluate((events) => events.length)).toBe(1);
  const [job] = await printed.jsonValue();
  expect(job!.trusted).toBe(true);
  expect(job!.text).toContain('123.45');
  expect(job!.text).toContain('246.90');
  expect(job!.text).not.toContain('预印纸已有标题');
  expect(job!.text).not.toContain('预印套打报表');
  expect(job!.html).toContain('report-print-overlay');
  expect(job!.html).toContain('left:3mm;top:4mm');
  expect(job!.html).toContain('width:31.75mm');
  await printed.dispose();
});

test('w_bb_def 保存后撤销重做与刷新恢复草稿，其他报表引用同事务跟随位置', async ({
  page,
  isolated,
}) => {
  const { token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const template = emptyTemplate({ code: '101', name: '被引用报表', rows: 4, cols: 3 });
  template.cells = [
    { address: 'B2', kind: 'money', source: '10000', unit: 'cents', currency: 'CNY' },
    { address: 'C2', kind: 'formula', source: 'B2*2', unit: 'cents', currency: 'CNY' },
  ];
  const imported = async (t: Report['template']) =>
    callApi<Report>(isolated.request, 'm.report-engine.importTemplate', t, {
      token,
      method: 'POST',
    });
  const source = await imported(template);
  const other = emptyTemplate({ code: '102', name: '引用结果报表', rows: 2, cols: 1 });
  other.cells = [
    {
      address: 'A1',
      kind: 'formula',
      source: 'REF("101","C2")',
      unit: 'cents',
      currency: 'CNY',
    },
  ];
  const reference = await imported(other);
  const referenceFormula = async () => {
    const report = await callApi<Report>(
      isolated.request,
      'm.report-engine.get',
      { id: reference.id },
      { token },
    );
    return report.template.cells[0]!.source;
  };
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${source.id}`);
  await page.getByLabel('B2', { exact: true }).click();
  await page.getByRole('button', { name: '插入列', exact: true }).click();
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  expect(await referenceFormula()).toBe('REF("101","D2")');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('定义列数')).toHaveValue('3');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText(/版本 3 · 已保存/)).toBeVisible();
  expect(await referenceFormula()).toBe('REF("101","C2")');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText(/版本 4 · 已保存/)).toBeVisible();
  expect(await referenceFormula()).toBe('REF("101","D2")');
  await page.getByLabel('C2', { exact: true }).click();
  await page.getByRole('button', { name: '插入行', exact: true }).click();
  await expect(page.getByLabel('定义行数')).toHaveValue('5');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByLabel('定义行数')).toHaveValue('5');
  await expect(page.getByRole('textbox', { name: 'D3', exact: true })).toHaveValue('C3*2');
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText(/版本 5 · 已保存/)).toBeVisible();
  expect(await referenceFormula()).toBe('REF("101","D3")');
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${reference.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算', exact: true }).click();
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '20000',
  );
});

test('w_bb_def 空名称保存失败后刷新仍恢复同版草稿，补全名称即可继续保存', async ({
  page,
  isolated,
}) => {
  const { token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const template = emptyTemplate({ code: '101', name: '保存前名称', rows: 2, cols: 2 });
  template.cells = [
    { address: 'A1', kind: 'text', source: '服务器原文', unit: 'number', currency: 'CNY' },
  ];
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    template,
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  await page.getByRole('textbox', { name: 'A1', exact: true }).fill('保存失败也要保留的编辑');
  await page.getByLabel('定义名称', { exact: true }).fill('');
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText('报表名称不能为空', { exact: true })).toBeVisible();
  const unchanged = await callApi<Report>(
    isolated.request,
    'm.report-engine.get',
    { id: report.id },
    { token },
  );
  expect(unchanged.revision).toBe(1);
  expect(unchanged.template.name).toBe('保存前名称');
  expect(unchanged.template.cells[0]!.source).toBe('服务器原文');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByLabel('定义名称', { exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue(
    '保存失败也要保留的编辑',
  );
  await page.getByLabel('定义名称', { exact: true }).fill('补全名称后保存');
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  const saved = await callApi<Report>(
    isolated.request,
    'm.report-engine.get',
    { id: report.id },
    { token },
  );
  expect(saved.template.name).toBe('补全名称后保存');
  expect(saved.template.cells[0]!.source).toBe('保存失败也要保留的编辑');
});

test('w_bb_def 冲突草稿刷新后锁定保护，导出并保留原始副本才继续编辑服务器新版', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const template = emptyTemplate({ code: '101', name: '冲突前名称', rows: 2, cols: 2 });
  template.cells = [
    { address: 'A1', kind: 'text', source: '服务器初版', unit: 'number', currency: 'CNY' },
  ];
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    template,
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  await page.getByRole('textbox', { name: 'A1', exact: true }).fill('本机独有的旧版草稿');
  const local = await page.evaluate(
    ({ bookId, reportId }) => {
      const key = Object.keys(sessionStorage).find(
        (key) => key.startsWith(`report-engine.draft.${bookId}.`) && key.endsWith(`.${reportId}`),
      );
      return key ? { key, raw: sessionStorage.getItem(key)! } : null;
    },
    { bookId, reportId: report.id },
  );
  expect(local).not.toBeNull();
  const newer = await callApi<Report>(
    isolated.request,
    'm.report-engine.save',
    {
      id: report.id,
      expectedRevision: 1,
      template: {
        ...template,
        name: '服务器新版名称',
        cells: [
          {
            address: 'A1',
            kind: 'text',
            source: '服务器新版内容',
            unit: 'number',
            currency: 'CNY',
          },
        ],
      },
    },
    { token, method: 'POST' },
  );
  expect(newer.revision).toBe(2);
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText(/报表已被其他操作修改，不能覆盖较新版本/).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue(
    '本机独有的旧版草稿',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByText(/发现版本1的本机草稿，服务器已是版本2/)).toBeVisible();
  await expect(page.getByLabel('定义名称', { exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).not.toBeEditable();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出保留草稿', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('报表101-保留草稿.json');
  const exported = await readFile((await download.path())!, 'utf8');
  expect(exported).toBe(local!.raw);
  expect(exported).toContain('本机独有的旧版草稿');
  expect(JSON.parse(exported)).toMatchObject({ revision: 1 });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), local!.key)).toBe(local!.raw);
  await page.getByRole('button', { name: '保留副本并继续', exact: true }).click();
  await expect(page.getByLabel('定义名称', { exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toBeEditable();
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue(
    '服务器新版内容',
  );
  expect(await page.evaluate((key) => sessionStorage.getItem(`${key}.recovery`), local!.key)).toBe(
    local!.raw,
  );
  await page.getByRole('textbox', { name: 'A1', exact: true }).fill('保留副本后继续的新编辑');
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click();
  await expect(page.getByText(/版本 3 · 已保存/)).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(`${key}.recovery`), local!.key)).toBe(
    local!.raw,
  );
});
