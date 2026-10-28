import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

test('w_zc_sydw_bak：部门草稿保护、修改、资产引用检查、停用与启用、未使用部门删除', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'POST' });
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'GET' });
  await page.goto('/m/fixed-assets/masters');
  await page.getByRole('tab', { name: '部门', exact: true }).click();
  await page.getByRole('button', { name: '新增部门', exact: true }).click();
  let editor = page.getByRole('dialog', { name: '新增部门', exact: true });
  await editor.getByLabel('编码', { exact: true }).fill('E2EDEP');
  await editor.getByLabel('名称', { exact: true }).fill('设备管理');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  const guard = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await expect(guard).toContainText('部门维护');
  await guard.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(editor.getByLabel('名称', { exact: true })).toHaveValue('设备管理');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toBeHidden();
  let row = page.getByRole('row', { name: /E2EDEP/ });
  await expect(row).toContainText('设备管理');
  await row.getByRole('button', { name: '修改', exact: true }).click();
  editor = page.getByRole('dialog', { name: '修改部门', exact: true });
  await editor.getByLabel('名称', { exact: true }).fill('固定资产管理');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(row).toContainText('固定资产管理');
  const department = (await get<{ id: number; code: string }[]>('departments')).find(
    (item) => item.code === 'E2EDEP',
  )!;
  const categoryId = await post<number>('saveMaster', {
    data: { kind: 'category', code: '01', name: '设备' },
  });
  const statusId = await post<number>('saveMaster', {
    data: { kind: 'status', code: '01', name: '在用' },
  });
  const purposeId = await post<number>('saveMaster', {
    data: { kind: 'purpose', code: '01', name: '管理用' },
  });
  const data = {
    code: 'E2EDEP-ASSET',
    name: '部门设备',
    categoryId,
    statusId,
    purposeId,
    departmentId: department.id,
    acquired: '2026-01-01',
    useDate: '2026-01-01',
    original: 60_000,
    rate: '0',
    method: '1',
    lifeMonths: 60,
  };
  const id = await post<number>('save', { data });
  await row.getByRole('button', { name: '删除', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '删除部门', exact: true });
  await expect(deletion).toContainText('资产卡片：1 项');
  await expect(deletion.getByRole('button', { name: '确认删除部门', exact: true })).toBeDisabled();
  await deletion.getByRole('button', { name: /close|关闭/i }).click();
  await row.getByRole('button', { name: '停用', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(row).toContainText('已停用');
  await page.goto('/m/fixed-assets/cards');
  await page
    .getByRole('row', { name: /E2EDEP-ASSET/ })
    .getByRole('button', { name: '修改', exact: true })
    .click();
  const card = page.getByRole('dialog', { name: '修改资产卡片', exact: true });
  await card.getByLabel('设备名称', { exact: true }).fill('停用部门原卡片更名');
  await card.getByRole('button', { name: '保存卡片', exact: true }).click();
  await expect(card).toBeHidden();
  expect(
    (await get<{ card: { name: string; department_id: number } }>('detail', { id })).card,
  ).toMatchObject({
    name: '停用部门原卡片更名',
    department_id: department.id,
  });
  await expect(post('save', { data: { ...data, code: 'NEW-DISABLED' } })).rejects.toThrow(
    /启用的末级部门/,
  );
  await page.goto('/m/fixed-assets/masters');
  await page.getByRole('tab', { name: '部门', exact: true }).click();
  row = page.getByRole('row', { name: /E2EDEP/ });
  await row.getByRole('button', { name: '启用', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(row).toContainText('使用中');
  await post('saveDepartment', { code: 'EMPTYDEP', name: '待删除空部门' });
  await page.getByRole('tab', { name: '资产类别', exact: true }).click();
  await page.getByRole('tab', { name: '部门', exact: true }).click();
  // 刷新当前页面以读取由接口新增的合成档案。
  await page.reload();
  await page.getByRole('tab', { name: '部门', exact: true }).click();
  const empty = page.getByRole('row', { name: /EMPTYDEP/ });
  await empty.getByRole('button', { name: '删除', exact: true }).click();
  await deletion.getByRole('button', { name: '确认删除部门', exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect(empty).toHaveCount(0);
  expect(
    (await get<{ code: string }[]>('departments')).some((item) => item.code === 'EMPTYDEP'),
  ).toBe(false);
});

test('w_zc_sydw_bak：新增保存期间继续编辑，下一次保存更新同一部门且不丢后续输入', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  await page.goto('/m/fixed-assets/masters');
  await page.getByRole('tab', { name: '部门', exact: true }).click();
  await page.getByRole('button', { name: '新增部门', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增部门', exact: true });
  await editor.getByLabel('编码', { exact: true }).fill('ASYNCDEP');
  await editor.getByLabel('名称', { exact: true }).fill('首次提交');
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved = new Promise<void>((resolve) => {
    started = resolve;
  });
  let requests = 0;
  await page.route(/\/trpc\/m\.fixed-assets\.saveDepartment(?:\?|$)/, async (route) => {
    requests++;
    const response = await route.fetch();
    if (requests === 1) {
      started();
      await gate;
    }
    await route.fulfill({ response });
  });
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await saved;
  await editor.getByLabel('名称', { exact: true }).fill('保存期间的新输入');
  release();
  await expect(editor.getByRole('button', { name: '保存', exact: true })).not.toHaveClass(
    /ant-btn-loading/,
  );
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('名称', { exact: true })).toHaveValue('保存期间的新输入');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toBeHidden();
  const departments = await callApi<{ code: string; name: string; revision: number }[]>(
    request,
    'm.fixed-assets.departments',
    undefined,
    { token, method: 'GET' },
  );
  expect(departments.filter((row) => row.code === 'ASYNCDEP')).toEqual([
    expect.objectContaining({ code: 'ASYNCDEP', name: '保存期间的新输入', revision: 2 }),
  ]);
  expect(requests).toBe(2);
});
