import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Employee } from '../shared';

const drawerTitle = '人事基本项统一置数';
async function chooseField(page: Page, drawer: Locator, label: string) {
  await drawer.getByRole('combobox', { name: '人事置数栏目' }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .getByText(label, { exact: true })
    .click();
}
async function confirm(page: Page, drawer: Locator) {
  await drawer.getByRole('button', { name: '确认人事置数' }).click();
  const popup = page.locator('.ant-popconfirm:visible');
  await expect(popup).toBeVisible();
  await expect(popup).not.toHaveClass(/ant-zoom-big-(enter|appear|leave)/);
  await popup.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.locator('.ant-popconfirm:visible')).toHaveCount(0);
}
async function setup(page: Page, request: APIRequestContext, count = 3) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  for (let i = 1; i <= count; i++)
    await callApi(
      request,
      'm.payroll.saveEmployee',
      {
        code: i === 3 ? 'Z001' : `H00${i}`,
        name: `合成人事${i}`,
        departmentId: departments[0]!.id,
        startDate: '2026-01-01',
      },
      { token },
    );
  await page.goto('/m/payroll/employees');
  await expect(page.getByRole('row').filter({ hasText: 'H001' })).toBeVisible();
  return {
    token,
    read: () =>
      callApi<Employee[]>(request, 'm.payroll.employees', undefined, { token, method: 'GET' }),
  };
}

test('w_gz_rsgl/w_gz_edit_set：所选人员取消与保存、筛选结果统一停用均保留范围外档案', async ({
  page,
  request,
}) => {
  const { read } = await setup(page, request);
  const before = await read();
  await page.getByRole('row').filter({ hasText: 'H001' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: '人事统一置数（所选）' }).click();
  let drawer = page.getByRole('dialog', { name: drawerTitle });
  await chooseField(page, drawer, '姓名');
  await drawer.getByLabel('人事统一修改值', { exact: true }).fill('合成人事改名');
  await drawer.getByRole('button', { name: '预览人事修改' }).click();
  await expect(drawer.getByRole('row').filter({ hasText: 'H001' })).toContainText('合成人事改名');
  await expect(drawer.getByRole('row').filter({ hasText: 'H002' })).toHaveCount(0);
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  expect(await read()).toEqual(before);
  await page.getByRole('button', { name: '人事统一置数（所选）' }).click();
  drawer = page.getByRole('dialog', { name: drawerTitle });
  await chooseField(page, drawer, '姓名');
  await drawer.getByLabel('人事统一修改值', { exact: true }).fill('合成人事改名');
  await drawer.getByRole('button', { name: '预览人事修改' }).click();
  await expect(drawer.getByText('修改栏目：姓名；实际变化 1 人。')).toBeVisible();
  await confirm(page, drawer);
  await expect(drawer).not.toBeVisible();
  let current = await read();
  expect(current[0]!.name).toBe('合成人事改名');
  expect(current.slice(1)).toEqual(before.slice(1));
  await page.getByLabel('编号或姓名', { exact: true }).fill('H00');
  await page.getByLabel('编号或姓名', { exact: true }).press('Enter');
  await expect(page.getByRole('row').filter({ hasText: 'Z001' })).toHaveCount(0);
  await page.getByRole('button', { name: '人事统一置数（筛选结果）' }).click();
  drawer = page.getByRole('dialog', { name: drawerTitle });
  await chooseField(page, drawer, '停用状态');
  await drawer.getByRole('combobox', { name: '人事统一状态' }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .getByText('停用', { exact: true })
    .click();
  await drawer.getByRole('button', { name: '预览人事修改' }).click();
  await expect(drawer.getByText('修改栏目：停用状态；实际变化 2 人。')).toBeVisible();
  await confirm(page, drawer);
  await expect(drawer).not.toBeVisible();
  current = await read();
  expect(current.filter((e) => e.code.startsWith('H')).every((e) => e.disabled)).toBe(true);
  expect(current.find((e) => e.code === 'Z001')).toEqual(before.find((e) => e.code === 'Z001'));
});

test('w_gz_edit_set：人事保存失败保留输入，并发修改使预览失效，重新预览可重试', async ({
  page,
  request,
}) => {
  const { token, read } = await setup(page, request, 1);
  const before = (await read())[0]!;
  await page.getByRole('row').filter({ hasText: 'H001' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: '人事统一置数（所选）' }).click();
  const drawer = page.getByRole('dialog', { name: drawerTitle });
  await chooseField(page, drawer, '姓名');
  const name = drawer.getByLabel('人事统一修改值', { exact: true });
  await name.fill('合成重试姓名');
  await drawer.getByRole('button', { name: '预览人事修改' }).click();
  await expect(drawer.getByRole('button', { name: '确认人事置数' })).toBeEnabled();
  const pattern = '**/trpc/m.payroll.applyPersonnelBulk*';
  await page.route(pattern, (route) => route.abort('connectionfailed'));
  await confirm(page, drawer);
  await expect(drawer.getByText(/保存请求失败，输入已保留/)).toBeVisible();
  await expect(name).toHaveValue('合成重试姓名');
  expect(await read()).toEqual([before]);
  await page.unroute(pattern);
  await callApi(request, 'm.payroll.saveEmployee', { ...before, name: '合成并发姓名' }, { token });
  await confirm(page, drawer);
  await expect(drawer.getByText(/人事置数预览已失效/)).toBeVisible();
  await expect(name).toHaveValue('合成重试姓名');
  expect((await read())[0]!.name).toBe('合成并发姓名');
  await drawer.getByRole('button', { name: '预览人事修改' }).click();
  await expect(drawer.getByRole('row').filter({ hasText: 'H001' })).toContainText('合成并发姓名');
  await confirm(page, drawer);
  await expect(drawer).not.toBeVisible();
  expect((await read())[0]!.name).toBe('合成重试姓名');
});
