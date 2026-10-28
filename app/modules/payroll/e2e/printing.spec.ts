import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category, type Employee } from '../shared';
import type { PayrollPrintLayout, PayrollPrintMode } from '../shared-print';

test.describe.configure({ retries: 0 });
test.setTimeout(60000);
test('w_xt_dysz/w_gz_prt_gzb 独立设置保存刷新，工资表预览缩放、重选和真实打印HTML', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '合成打印类别', fields: DEFAULT_FIELDS },
    { token },
  );
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const employee = await callApi<Employee>(
    request,
    'm.payroll.saveEmployee',
    {
      code: 'P1',
      name: '合成打印人员甲乙丙丁戊己庚辛壬癸',
      departmentId: departments[0]!.id,
      startDate: '2026-01-01',
    },
    { token },
  );
  await callApi(request, 'm.payroll.confirmTax', undefined, { token });
  const batch = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      categoryId: category.id,
      categoryRevision: category.revision,
      period: 202601,
      rows: [{ employeeId: employee.id, values: { base: 1234567 }, tax: { confirmed: true } }],
    },
    { token },
  );
  await callApi(
    request,
    'm.payroll.calculate',
    { id: batch.id, revision: batch.revision },
    { token },
  );
  await page.goto(
    `/m/payroll/reports?category=${category.id}&from=202601&to=202601&persons=${employee.id}&kind=table&run=1`,
  );
  await expect(page.getByRole('button', { name: '预览报表', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '设置独立打印格式', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '工资表独立打印格式', exact: true });
  await editor.getByLabel('打印标题', { exact: true }).fill('合成工资表');
  await editor.getByLabel('打印单位名称', { exact: true }).fill('合成单位');
  await editor.getByLabel('打印页脚', { exact: true }).fill('制表：测试　复核：合成');
  await editor.getByLabel('gross小数位', { exact: true }).fill('0');
  await editor.getByRole('button', { name: 'net上移', exact: true }).click();
  await editor.getByRole('button', { name: '保存打印格式', exact: true }).click();
  const read = () =>
    callApi<{ layouts: Record<PayrollPrintMode, PayrollPrintLayout> }>(
      request,
      'm.payroll.printLayouts',
      { categoryId: category.id },
      { token, method: 'GET' },
    );
  await expect.poll(async () => (await read()).layouts.table.revision).toBe(1);
  expect((await read()).layouts.slips.revision).toBe(0);
  expect((await read()).layouts.table.columns.map((column) => column.key)).toEqual([
    'gross',
    'deductions',
    'net',
    'taxAmount',
  ]);
  await editor
    .locator('.ant-modal-footer')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.reload();
  await expect(page.getByRole('button', { name: '预览报表', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '预览报表', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '合成工资表预览', exact: true });
  const frame = preview.frameLocator('iframe[title="工资打印预览"]');
  await expect(frame.locator('body')).toContainText('12346');
  await expect(frame.locator('body')).toContainText('合成单位');
  await expect(frame.locator('body')).toContainText('制表：测试');
  await preview.getByRole('slider', { name: '打印预览缩放' }).press('End');
  await expect(preview.getByText('屏幕缩放 150%', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html: string) => {
        document.body.dataset.payrollPrinted = html;
      },
      printToPdf: async () => null,
    };
  });
  await expect(preview.getByRole('button', { name: '打印预览内容', exact: true })).toBeEnabled();
  await preview.getByRole('button', { name: '打印预览内容', exact: true }).click();
  await expect
    .poll(async () => page.locator('body').getAttribute('data-payroll-printed'))
    .toContain('合成工资表');
  const printed = await page.locator('body').getAttribute('data-payroll-printed');
  expect(printed).toContain('12346');
  expect(printed).toContain('第 1 / 1 页');
  await preview.getByRole('button', { name: '重选人员及期间', exact: true }).click();
  await expect(preview).not.toBeVisible();
  await expect(page.getByRole('combobox', { name: '报告人员' })).toBeVisible();
  await page.getByRole('combobox', { name: '工资打印格式', exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').getByText('工资条', { exact: true }).click();
  await page.getByRole('button', { name: '预览报表', exact: true }).click();
  const slips = page.getByRole('dialog', { name: '工资条预览', exact: true });
  await expect(slips.frameLocator('iframe[title="工资打印预览"]').locator('body')).toContainText(
    '12345.67',
  );
  await expect(slips.getByRole('button', { name: '打印预览内容', exact: true })).toBeEnabled();
});

test('w_xt_dysz 并发格式刷新保留本地草稿，冲突不覆盖；真实保存响应等待期间锁定编辑和关闭', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '并发打印类别', fields: DEFAULT_FIELDS },
    { token },
  );
  await page.goto(`/m/payroll/reports?category=${category.id}`);
  await page.getByRole('button', { name: '设置独立打印格式', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '工资表独立打印格式', exact: true });
  const title = editor.getByLabel('打印标题', { exact: true });
  await title.fill('本地未保存标题');
  await editor.getByLabel('打印页脚', { exact: true }).fill('本地未保存页脚');
  const read = () =>
    callApi<{ categoryRevision: number; layouts: Record<PayrollPrintMode, PayrollPrintLayout> }>(
      request,
      'm.payroll.printLayouts',
      { categoryId: category.id },
      { token, method: 'GET' },
    );
  const original = await read();
  await callApi(
    request,
    'm.payroll.savePrintLayout',
    {
      categoryId: category.id,
      categoryRevision: original.categoryRevision,
      layout: { ...original.layouts.table, title: '其它窗口保存标题' },
    },
    { token },
  );
  await editor.getByRole('button', { name: '检查最新格式', exact: true }).click();
  await expect(
    editor.getByText('已保存的格式或工资结构发生变化，当前草稿已保留；请核对后重新载入。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(title).toHaveValue('本地未保存标题');
  await expect(editor.getByLabel('打印页脚', { exact: true })).toHaveValue('本地未保存页脚');
  await editor.getByRole('button', { name: '保存打印格式', exact: true }).click();
  await expect(editor.getByText(/打印格式已被修改/).first()).toBeVisible();
  await expect(title).toHaveValue('本地未保存标题');
  expect((await read()).layouts.table.title).toBe('其它窗口保存标题');
  await editor.getByRole('button', { name: '重新载入已保存格式', exact: true }).click();
  const confirmation = page.getByRole('dialog', {
    name: '放弃当前修改并重新载入已保存格式？',
    exact: true,
  });
  await confirmation.getByRole('button', { name: '重新载入', exact: true }).click();
  await expect(title).toHaveValue('其它窗口保存标题');
  await title.fill('提交中的标题');
  let release: () => void = () => {},
    seen: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    seen = resolve;
  });
  let writes = 0;
  await page.route('**/trpc/m.payroll.savePrintLayout**', async (route) => {
    writes++;
    const response = await route.fetch();
    seen();
    await gate;
    await route.fulfill({ response });
  });
  await editor.getByRole('button', { name: '保存打印格式', exact: true }).click();
  try {
    await received;
    await expect(title).toBeDisabled();
    await expect(editor.getByLabel('打印页脚', { exact: true })).toBeDisabled();
    await expect(editor.getByRole('combobox', { name: '独立打印栏目' })).toBeDisabled();
    await expect(editor.getByRole('button', { name: 'net上移', exact: true })).toBeDisabled();
    await expect(
      editor.locator('.ant-modal-footer').getByRole('button', { name: '关闭', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(editor).toBeVisible();
    await expect(title).toHaveValue('提交中的标题');
  } finally {
    release();
  }
  await expect(editor.getByRole('button', { name: '保存打印格式', exact: true })).toBeEnabled();
  expect(writes).toBe(1);
  const saved = await read();
  expect(saved.layouts.table.revision).toBe(2);
  expect(saved.layouts.table.title).toBe('提交中的标题');
  await expect(title).toHaveValue('提交中的标题');
});

test('w_gzgl_lshz 明确多选工资类别，累计税额不重复扣除，来源类别、Excel及刷新保持', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const first = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '月工资类别', fields: DEFAULT_FIELDS },
    { token },
  );
  const second = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '补贴类别', fields: DEFAULT_FIELDS },
    { token },
  );
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const employee = await callApi<Employee>(
    request,
    'm.payroll.saveEmployee',
    { code: 'M1', name: '合并甲', departmentId: departments[0]!.id, startDate: '2026-01-01' },
    { token },
  );
  await callApi(request, 'm.payroll.confirmTax', undefined, { token });
  for (const category of [first, second]) {
    const batch = await callApi<Batch>(
      request,
      'm.payroll.saveBatch',
      {
        categoryId: category.id,
        categoryRevision: category.revision,
        period: 202601,
        rows: [{ employeeId: employee.id, values: { base: 1000000 }, tax: { confirmed: true } }],
      },
      { token },
    );
    await callApi(
      request,
      'm.payroll.calculate',
      { id: batch.id, revision: batch.revision },
      { token },
    );
  }
  await page.goto(
    `/m/payroll/reports?category=${first.id}&from=202601&to=202601&persons=${employee.id}&kind=cumulative&run=1`,
  );
  const merge = page.getByRole('combobox', { name: '合并其它工资类别', exact: true });
  await merge.click();
  await page.locator('.ant-select-dropdown:visible').getByText('补贴类别', { exact: true }).click();
  await merge.press('Escape');
  await page.getByRole('button', { name: 'search 查询', exact: true }).click();
  await expect(page).toHaveURL(/additionalCategories=/);
  const row = page.locator('.ant-table-tbody').getByRole('row').filter({ hasText: '合并甲' });
  await expect(row).toContainText('20,000.00');
  await expect(row).toContainText('450.00');
  await expect(row).toContainText('19,550.00');
  await expect(row).toContainText('月工资类别、补贴类别');
  await expect(page.getByRole('link', { name: /补贴类别 202601/ })).toBeVisible();
  await page.reload();
  await expect(row).toContainText('19,550.00');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出报表 Excel', exact: true }).click();
  const download = await downloaded;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  const values = workbook.worksheets[0]!.getRow(2).values;
  expect(values).toContain(450);
  expect(values).toContain(19550);
  expect(values).toContain('月工资类别、补贴类别');
});
