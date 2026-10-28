import { test, expect, type Page, type APIRequestContext, type Locator } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Employee } from '../shared';
import type { HrProfile } from '../shared-hr';

test.describe.configure({ retries: 0 });
async function setup(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const people: Employee[] = [];
  await callApi(
    request,
    'm.payroll.saveHrFields',
    { revision: 0, fields: [{ key: 'position', name: '岗位', kind: 'text' }] },
    { token },
  );
  for (let i = 1; i <= 3; i++)
    people.push(
      await callApi<Employee>(
        request,
        'm.payroll.saveEmployee',
        {
          code: `BHR00${i}`,
          name: `合成统一资料${i}`,
          departmentId: departments[0]!.id,
          startDate: '2026-01-01',
        },
        { token },
      ),
    );
  const get = (id: number) =>
    callApi<HrProfile>(request, 'm.payroll.hrProfile', { id }, { token, method: 'GET' });
  await callApi(
    request,
    'm.payroll.saveHrProfile',
    { ...(await get(people[0]!.id)), basicValues: { position: '已有岗位' } },
    { token },
  );
  await page.goto('/m/payroll/employees');
  await expect(page.getByRole('row').filter({ hasText: people[0]!.code })).toBeVisible();
  return { token, people, get, read: () => Promise.all(people.map((e) => get(e.id))) };
}

async function confirm(page: Page, drawer: Locator) {
  await drawer.getByRole('button', { name: '确认自定义资料置数', exact: true }).click();
  const popup = page.locator('.ant-popconfirm:visible');
  await expect(popup).not.toHaveClass(/ant-zoom-big-(enter|appear|leave)/);
  await popup.getByRole('button', { name: '确定', exact: true }).click();
}

test('w_gz_edit_set 自定义基本资料所选预览取消及空白补值不覆盖范围外和已有资料', async ({
  page,
  request,
}) => {
  const { people, read } = await setup(page, request),
    before = await read();
  for (const person of people.slice(0, 2))
    await page.getByRole('row').filter({ hasText: person.code }).getByRole('checkbox').check();
  await page.getByRole('button', { name: '自定义资料统一置数（所选）', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: '自定义资料统一置数', exact: true });
  await drawer.getByLabel('自定义资料统一值', { exact: true }).fill('统一岗位');
  await drawer.getByRole('checkbox', { name: '仅补空白项', exact: true }).check();
  await drawer.getByRole('button', { name: '预览自定义资料修改', exact: true }).click();
  await expect(drawer.getByText('修改栏目：岗位；实际变化 1 人。', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('row').filter({ hasText: people[0]!.code })).toContainText(
    '已有岗位',
  );
  await expect(drawer.getByRole('row').filter({ hasText: people[1]!.code })).toContainText(
    '统一岗位',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  expect(await read()).toEqual(before);
  await page.getByRole('button', { name: '自定义资料统一置数（所选）', exact: true }).click();
  drawer = page.getByRole('dialog', { name: '自定义资料统一置数', exact: true });
  await drawer.getByLabel('自定义资料统一值', { exact: true }).fill('统一岗位');
  await drawer.getByRole('checkbox', { name: '仅补空白项', exact: true }).check();
  await drawer.getByRole('button', { name: '预览自定义资料修改', exact: true }).click();
  await expect(
    drawer.getByRole('button', { name: '确认自定义资料置数', exact: true }),
  ).toBeVisible();
  await confirm(page, drawer);
  await expect(drawer).not.toBeVisible();
  const after = await read();
  expect(after[0]).toEqual(before[0]);
  expect(after[1]!.basicValues).toEqual({ position: '统一岗位' });
  expect(after[2]).toEqual(before[2]);
});

test('w_gz_edit_set 自定义资料保存失败保留输入，并发编辑令预览失效，重新预览可立即重试', async ({
  page,
  request,
}) => {
  const { token, people, read, get } = await setup(page, request),
    first = people[0]!,
    before = await read();
  await page.getByRole('row').filter({ hasText: first.code }).getByRole('checkbox').check();
  await page.getByRole('button', { name: '自定义资料统一置数（所选）', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '自定义资料统一置数', exact: true });
  const value = drawer.getByLabel('自定义资料统一值', { exact: true });
  await value.fill('本次统一岗位');
  await drawer.getByRole('button', { name: '预览自定义资料修改', exact: true }).click();
  await expect(
    drawer.getByRole('button', { name: '确认自定义资料置数', exact: true }),
  ).toBeVisible();
  const pattern = '**/trpc/m.payroll.applyHrBasicBulk*';
  await page.route(pattern, (route) => route.abort('connectionfailed'));
  await confirm(page, drawer);
  await expect(
    drawer.getByText('输入和范围已保留，核对后可以重新预览。', { exact: true }),
  ).toBeVisible();
  await expect(value).toHaveValue('本次统一岗位');
  expect(await read()).toEqual(before);
  await page.unroute(pattern);
  await callApi(
    request,
    'm.payroll.saveHrProfile',
    { ...(await get(first.id)), basicValues: { position: '期间新编辑岗位' } },
    { token },
  );
  await confirm(page, drawer);
  await expect(drawer.getByText('自定义资料置数预览已失效', { exact: true })).toBeVisible();
  await expect(value).toHaveValue('本次统一岗位');
  expect((await get(first.id)).basicValues.position).toBe('期间新编辑岗位');
  const notification = page
    .locator('.ant-notification-notice')
    .filter({ hasText: '自定义资料置数预览已失效' });
  await notification.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(notification).toHaveCount(0);
  await drawer.getByRole('button', { name: '预览自定义资料修改', exact: true }).click();
  await expect(drawer.getByRole('row').filter({ hasText: first.code })).toContainText(
    '期间新编辑岗位',
  );
  await confirm(page, drawer);
  await expect(drawer).not.toBeVisible();
  expect((await get(first.id)).basicValues.position).toBe('本次统一岗位');
  expect((await read()).slice(1)).toEqual(before.slice(1));
});
