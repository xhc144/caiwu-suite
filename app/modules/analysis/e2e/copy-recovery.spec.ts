import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import type { AnalysisSheet, Definition } from '../custom';
import { test, expect } from './fixture';

test('w_fx_copy 跨账套认证、复制、目标重复失败保留输入、重新登录回读', async ({
  page,
  isolated,
}) => {
  const source = await loginWithNewBook(page, isolated.request);
  await callApi(
    isolated.request,
    'm.analysis.definitions.save',
    {
      code: '1',
      name: '来源现金定义',
      expectedRevision: 0,
      rows: [{ key: 1, name: '现金余额', formula: '余额("1001")', unit: 'money', subtotal: false }],
    },
    { token: source.token },
  );
  const target = await loginWithNewBook(page, isolated.request);
  await callApi(
    isolated.request,
    'm.analysis.definitions.save',
    {
      code: '8',
      name: '已有目标分析',
      expectedRevision: 0,
      rows: [{ key: 1, name: '已有项目', formula: '1', unit: 'money', subtotal: false }],
    },
    { token: target.token },
  );
  await page.goto(`${isolated.origin}/m/analysis/custom`);
  await page.getByRole('button', { name: '从账套复制分析表', exact: true }).click();
  const copy = page.getByRole('dialog', { name: '从账套复制分析表', exact: true });
  const bookSelect = copy.getByRole('combobox', { name: '来源账套', exact: true });
  await bookSelect.click();
  await page.locator('.ant-select-item-option').filter({ hasText: source.bookName }).click();
  await copy.getByRole('textbox', { name: '来源操作员编号' }).fill('admin');
  await copy.getByLabel('来源操作员密码').fill('wrong');
  await copy.getByRole('button', { name: '读取来源分析表' }).click();
  await expect(copy.getByText('来源账套无法访问，或操作员没有查看分析表的权限')).toBeVisible();
  await copy.getByLabel('来源操作员密码').fill('admin');
  await copy.getByRole('button', { name: '读取来源分析表' }).click();
  const definitionSelect = copy.getByRole('combobox', { name: '来源分析表' });
  await definitionSelect.click();
  await page.locator('.ant-select-item-option').filter({ hasText: '001 来源现金定义' }).click();
  await copy.getByRole('textbox', { name: '复制后分析编号' }).fill('8');
  await copy.getByRole('textbox', { name: '复制后分析名称' }).fill('本账套现金定义');
  await copy.getByRole('button', { name: '确认复制到当前账套' }).click();
  await expect(copy.getByText('财务分析编号重复', { exact: true })).toBeVisible();
  await expect(copy.getByRole('textbox', { name: '复制后分析名称' })).toHaveValue('本账套现金定义');
  await copy.getByRole('textbox', { name: '复制后分析编号' }).fill('9');
  await copy.getByRole('button', { name: '确认复制到当前账套' }).click();
  await expect(copy).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '009' })).toContainText('本账套现金定义');
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: '009' })).toContainText('本账套现金定义');
  const list = await callApi<{ code: string }[]>(
    isolated.request,
    'm.analysis.definitions.list',
    undefined,
    { token: target.token },
  );
  expect(list.map((d) => d.code)).toEqual(['008', '009']);
  const sourceList = await callApi<{ code: string }[]>(
    isolated.request,
    'm.analysis.definitions.list',
    undefined,
    { token: source.token },
  );
  expect(sourceList.map((d) => d.code)).toEqual(['001']);
});

test('w_fx_def/w_fx_nd_1 错误公式草稿与金额修改在刷新后可恢复，保存重开保留原数', async ({
  page,
  isolated,
}) => {
  const book = await loginWithNewBook(page, isolated.request);
  await page.goto(`${isolated.origin}/m/analysis/custom`);
  await page.getByRole('button', { name: '新增分析表' }).click();
  let editor = page.getByRole('dialog', { name: '自定义分析定义', exact: true });
  await editor.getByLabel('分析编号', { exact: true }).fill('9');
  await editor.getByLabel('分析名称', { exact: true }).fill('恢复中的分析稿');
  await editor.getByLabel('项目1名称', { exact: true }).fill('现金余额');
  await editor.getByLabel('项目1公式', { exact: true }).fill('(1 +');
  await editor.getByRole('button', { name: '保存分析定义' }).click();
  await expect(editor.getByText('分析定义未保存，输入仍保留')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((k) => k.includes('.definition.new'))
          .map((k) => localStorage.getItem(k))
          .join(''),
      ),
    )
    .toContain('恢复中的分析稿');
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.getByRole('button', { name: '新增分析表' }).click();
  editor = page.getByRole('dialog', { name: '自定义分析定义', exact: true });
  await editor.getByRole('button', { name: '恢复上次草稿' }).click();
  await expect(editor.getByLabel('项目1公式', { exact: true })).toHaveValue('(1 +');
  await editor.getByLabel('项目1公式', { exact: true }).fill('余额("1001")');
  await editor.getByRole('button', { name: '保存分析定义' }).click();
  await expect(editor.getByText('已保存版本 1', { exact: false })).toBeVisible();
  await editor.getByRole('button', { name: '关闭定义' }).click();
  await page
    .getByRole('row')
    .filter({ hasText: '009' })
    .getByRole('button', { name: '分析', exact: true })
    .click();
  let result = page.getByRole('dialog', { name: '分析结果编辑与保存' });
  const original = await result.getByLabel('1-202601', { exact: true }).inputValue();
  await result.getByLabel('结果名称', { exact: true }).fill('待恢复金额稿');
  await result.getByRole('button', { name: '保存分析结果', exact: true }).click();
  await expect(result.getByText('已保存版本 1', { exact: false })).toBeVisible();
  await result.getByLabel('1-202601', { exact: true }).fill('123.45');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((k) => k.includes('.result.'))
          .map((k) => localStorage.getItem(k))
          .join(''),
      ),
    )
    .toContain('123.45');
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.goto(`${isolated.origin}/m/analysis/results`);
  await page
    .getByRole('row')
    .filter({ hasText: '待恢复金额稿' })
    .getByRole('button', { name: '打开结果' })
    .click();
  result = page.getByRole('dialog', { name: '分析结果编辑与保存' });
  await result.getByRole('button', { name: '恢复上次草稿' }).click();
  await expect(result.getByLabel('1-202601', { exact: true })).toHaveValue('123.45');
  await result.getByRole('button', { name: '保存分析结果', exact: true }).click();
  await expect(result.getByText('已保存版本 2', { exact: false })).toBeVisible();
  const saved = await callApi<{ id: number }[]>(
    isolated.request,
    'm.analysis.results.list',
    undefined,
    { token: book.token },
  );
  const reopened = await callApi<{
    sheet: { rows: { values: number[]; originalValues: number[] }[] };
  }>(isolated.request, 'm.analysis.results.get', { id: saved[0]!.id }, { token: book.token });
  expect(reopened.sheet.rows[0]!.values[0]).toBe(12345);
  expect(reopened.sheet.rows[0]!.originalValues[0]).toBe(Math.round(Number(original) * 100));
});

test('w_fx_demo 来源定义变化后旧手工稿仍可导出，不能覆盖新版本', async ({ page, isolated }) => {
  const book = await loginWithNewBook(page, isolated.request);
  const definition = await callApi<Definition>(
    isolated.request,
    'm.analysis.definitions.save',
    {
      code: '1',
      name: '来源变化分析',
      expectedRevision: 0,
      rows: [{ key: 1, name: '原项目', formula: '1', unit: 'money' }],
    },
    { token: book.token },
  );
  await page.goto(`${isolated.origin}/m/analysis/custom`);
  await page
    .getByRole('row')
    .filter({ hasText: '001' })
    .getByRole('button', { name: '分析', exact: true })
    .click();
  let result = page.getByRole('dialog', { name: '分析结果编辑与保存' });
  await result.getByLabel('1-202601', { exact: true }).fill('123.45');
  await expect
    .poll(() => page.evaluate(() => Object.values(localStorage).join('')))
    .toContain('123.45');
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await callApi(
    isolated.request,
    'm.analysis.definitions.save',
    {
      ...definition,
      expectedRevision: 1,
      rows: [...definition.rows, { key: 2, name: '新增项目', formula: '2', unit: 'money' }],
    },
    { token: book.token },
  );
  await page.reload();
  await page
    .getByRole('row')
    .filter({ hasText: '001' })
    .getByRole('button', { name: '分析', exact: true })
    .click();
  result = page.getByRole('dialog', { name: '分析结果编辑与保存' });
  await expect(result.getByText('发现上次未保存的分析草稿')).toBeVisible();
  await expect(result.getByRole('button', { name: '恢复上次草稿' })).toBeDisabled();
  await expect(result.getByLabel('1-202601', { exact: true })).toHaveValue('1.00');
  await expect(result.getByLabel('2-202601', { exact: true })).toHaveValue('2.00');
  const downloading = page.waitForEvent('download');
  await result.getByRole('button', { name: '导出恢复副本' }).click();
  const downloaded = await downloading;
  const recovered = JSON.parse(await readFile((await downloaded.path())!, 'utf8')) as {
    values: string[][];
    sheet: AnalysisSheet;
  };
  expect(recovered.values[0]![0]).toBe('123.45');
  expect(recovered.sheet.rows).toHaveLength(1);
  expect(recovered.sheet.definitionRevision).toBe(1);
  await expect
    .poll(() => page.evaluate(() => Object.values(localStorage).join('')))
    .toContain('123.45');
});

test('w_fx_demo 大分析稿通过请求体导出，六位数量保持精确文本', async ({ page, isolated }) => {
  const book = await loginWithNewBook(page, isolated.request);
  const definition = await callApi<Definition>(
    isolated.request,
    'm.analysis.definitions.save',
    {
      code: '1',
      name: '大稿精确导出',
      expectedRevision: 0,
      rows: Array.from({ length: 100 }, (_, i) => ({
        key: i + 1,
        name: `合成数量项目${i + 1}保留小数及完整中文项目名称`,
        formula: '1.234567',
        unit: 'number',
        decimalPlaces: 6,
      })),
    },
    { token: book.token },
  );
  const sheet = await callApi<AnalysisSheet>(
    isolated.request,
    'm.analysis.definitions.calculate',
    {
      definitionId: definition.id,
      periodFrom: 202601,
      periodTo: 202601,
    },
    { token: book.token, method: 'GET' },
  );
  expect(JSON.stringify(sheet).length).toBeGreaterThan(20_000);
  const exported = await callApi<{ base64: string }>(
    isolated.request,
    'm.analysis.results.export',
    {
      name: '大稿精确导出',
      sheet,
    },
    { token: book.token, method: 'POST' },
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(Buffer.from(exported.base64, 'base64')).buffer);
  const result = workbook.getWorksheet('分析结果')!;
  expect(result.rowCount).toBe(104);
  expect(result.getRow(5).getCell(4).value).toBe('1.234567');
  expect(result.getRow(104).getCell(4).value).toBe('1.234567');
});
