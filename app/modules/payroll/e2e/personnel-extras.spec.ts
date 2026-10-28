import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Category, type Employee } from '../shared';
import type { HrProfile } from '../shared-hr';

test.describe.configure({ retries: 0 });
async function setup(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const employees: Employee[] = [];
  for (let i = 1; i <= 2; i++)
    employees.push(
      await callApi<Employee>(
        request,
        'm.payroll.saveEmployee',
        {
          code: `EXHR00${i}`,
          name: `合成扩展人员${i}`,
          departmentId: departments[0]!.id,
          startDate: '2026-01-01',
        },
        { token },
      ),
    );
  await page.goto('/m/payroll/employees');
  await expect(page.getByRole('row').filter({ hasText: employees[0]!.code })).toBeVisible();
  return {
    token,
    employees,
    profile: (id: number) =>
      callApi<HrProfile>(request, 'm.payroll.hrProfile', { id }, { token, method: 'GET' }),
  };
}

test('w_gz_rsgl 自定义栏目和断续任职保存刷新保留，所选人事另存与打印包含真实资料', async ({
  page,
  request,
}) => {
  const { employees, profile } = await setup(page, request);
  const first = employees[0]!;
  await page.getByRole('button', { name: '基本资料栏目', exact: true }).click();
  const fields = page.getByRole('dialog', { name: '基本资料栏目', exact: true });
  await fields.getByRole('button', { name: '增加基本栏目', exact: true }).click();
  await fields.getByLabel('基本栏目变量1', { exact: true }).fill('position');
  await fields.getByLabel('基本栏目名称1', { exact: true }).fill('岗位');
  await fields.getByRole('button', { name: '保存基本资料栏目', exact: true }).click();
  await expect(fields).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: first.code });
  await row.getByRole('button', { name: '基本资料 / 任职', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: '基本资料 / 任职记录', exact: true });
  await drawer.getByLabel('任职结束1', { exact: true }).fill('2026-01-31');
  await drawer.getByRole('button', { name: '增加任职记录', exact: true }).click();
  await drawer.getByLabel('任职开始2', { exact: true }).fill('2026-03-01');
  await drawer.getByLabel('基本资料-position', { exact: true }).fill('合成研发<&>');
  await drawer.getByRole('button', { name: '保存基本资料', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  expect(await profile(first.id)).toMatchObject({
    basicValues: { position: '合成研发<&>' },
    employmentSpells: [
      { startDate: '2026-01-01', endDate: '2026-01-31' },
      { startDate: '2026-03-01', endDate: null },
    ],
  });
  await page.reload();
  await row.getByRole('button', { name: '基本资料 / 任职', exact: true }).click();
  drawer = page.getByRole('dialog', { name: '基本资料 / 任职记录', exact: true });
  await expect(drawer.getByLabel('任职开始2', { exact: true })).toHaveValue('2026-03-01');
  await expect(drawer.getByLabel('基本资料-position', { exact: true })).toHaveValue('合成研发<&>');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await row.getByRole('checkbox').check();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '另存人事档案', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('人事档案.xlsx');
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await download.path())!);
  const sheet = book.worksheets[0]!;
  expect(sheet.rowCount).toBe(2);
  expect(sheet.getRow(1).values).toContain('岗位');
  expect(sheet.getRow(2).values).toContain('合成研发<&>');
  expect(sheet.getRow(2).values).toContain('2026-01-01—2026-01-31；2026-03-01—在职');
  const printed = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const observer = new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes)
              if (node instanceof HTMLIFrameElement)
                node.addEventListener(
                  'load',
                  () => {
                    observer.disconnect();
                    resolve(node.contentDocument?.body.textContent ?? '');
                  },
                  { once: true },
                );
        });
        observer.observe(document.body, { childList: true });
      }),
  );
  await expect(page.getByRole('button', { name: '打印人事档案', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+p');
  const printedText = await printed;
  expect(printedText).toContain(first.code);
  expect(printedText).toContain('合成研发<&>');
  expect(printedText).not.toContain(employees[1]!.code);
});

test('w_gz_rsgl 基本资料保存失败保留输入，快捷键重试完整保存', async ({ page, request }) => {
  const { employees, profile } = await setup(page, request),
    first = employees[0]!;
  const before = await profile(first.id);
  await page
    .getByRole('row')
    .filter({ hasText: first.code })
    .getByRole('button', { name: '基本资料 / 任职', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: '基本资料 / 任职记录', exact: true });
  await drawer.getByLabel('任职结束1', { exact: true }).fill('2026-02-28');
  const pattern = '**/trpc/m.payroll.saveHrProfile*';
  await page.route(pattern, (route) => route.abort('connectionfailed'));
  await drawer.getByRole('button', { name: '保存基本资料', exact: true }).click();
  await expect(drawer.getByText('输入已保留，请核对后重试。', { exact: true })).toBeVisible();
  await expect(drawer.getByLabel('任职结束1', { exact: true })).toHaveValue('2026-02-28');
  expect(await profile(first.id)).toEqual(before);
  await page.unroute(pattern);
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handled = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    reached();
    await held;
    await route.fulfill({ response });
  });
  await drawer.getByLabel('任职结束1', { exact: true }).press('Control+s');
  await handled;
  try {
    await expect(drawer.getByLabel('任职结束1', { exact: true })).toBeDisabled();
    await page.keyboard.press('Control+F4');
    const leave = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
    await expect(leave).not.toBeVisible();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel('任职结束1', { exact: true })).toHaveValue('2026-02-28');
  } finally {
    release();
  }
  await expect(drawer).not.toBeVisible();
  expect((await profile(first.id)).employmentSpells).toEqual([
    { startDate: '2026-01-01', endDate: '2026-02-28' },
  ]);
});

test('w_gz_rsgl 删除取消不写入，确认删除未引用人员，工资引用阻止删除', async ({
  page,
  request,
}) => {
  const { employees, token } = await setup(page, request),
    first = employees[0]!,
    second = employees[1]!;
  await page
    .getByRole('row')
    .filter({ hasText: second.code })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  let drawer = page.getByRole('dialog', { name: '删除人员确认', exact: true });
  await drawer.getByRole('button', { name: '确认删除人员', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  expect(
    await callApi<Employee[]>(request, 'm.payroll.employees', undefined, { token, method: 'GET' }),
  ).toHaveLength(2);
  await drawer.getByRole('button', { name: '确认删除人员', exact: true }).click();
  const popup = page.locator('.ant-popconfirm:visible');
  await expect(popup).not.toHaveClass(/ant-zoom-big-(enter|appear|leave)/);
  await popup.getByRole('button', { name: '确定', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: second.code })).toHaveCount(0);
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '合成人事引用工资', fields: DEFAULT_FIELDS },
    { token },
  );
  await callApi(
    request,
    'm.payroll.saveBatch',
    {
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: [{ employeeId: first.id, values: { base: 1000000 } }],
    },
    { token },
  );
  await page
    .getByRole('row')
    .filter({ hasText: first.code })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  drawer = page.getByRole('dialog', { name: '删除人员确认', exact: true });
  await expect(
    drawer.getByText('人员已被工资、历史快照或凭证设置引用，不能删除；可使用停用保留历史。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(drawer.getByRole('button', { name: '确认删除人员', exact: true })).toBeDisabled();
});

test('w_gz_rsgl 定位查询和首末上下记录快捷键定位当前人员', async ({ page, request }) => {
  const { employees } = await setup(page, request);
  await expect(page.getByText(`当前人员：${employees[0]!.name}`, { exact: true })).toBeVisible();
  await page.keyboard.press('Control+End');
  await expect(page.getByText(`当前人员：${employees[1]!.name}`, { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByText(`当前人员：${employees[0]!.name}`, { exact: true })).toBeVisible();
  await page.keyboard.press('Control+q');
  const locate = page.getByLabel('定位人员', { exact: true });
  await expect(locate).toBeFocused();
  await locate.fill('不存在');
  await locate.press('Enter');
  await expect(
    page.getByText('当前筛选范围没有该人员，请核对完整编号或姓名。', { exact: true }),
  ).toBeVisible();
  await locate.fill(employees[1]!.code);
  await locate.press('Enter');
  await expect(
    page.getByRole('dialog', { name: '基本资料 / 任职记录', exact: true }),
  ).toContainText(employees[1]!.name);
  await page
    .getByRole('dialog', { name: '基本资料 / 任职记录', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.getByRole('button', { name: '修改当前人员', exact: true }).click();
  const editing = page.getByRole('dialog', { name: '修改员工 / 编号', exact: true });
  await editing.getByLabel('姓名', { exact: true }).fill('合成快捷保存姓名');
  await editing.getByLabel('姓名', { exact: true }).press('Control+s');
  await expect(editing).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: employees[1]!.code })).toContainText(
    '合成快捷保存姓名',
  );
});
