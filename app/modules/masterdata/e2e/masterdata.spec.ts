import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Account, DimensionItem } from '@caiwu/core';

test('w_xt_kmwh / w_xt_fhwh：科目与部门持久化 → 原生拼音选择器 → 保存重载 → 停用 → Excel预览', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const book = await loginWithNewBook(page, request);
  await page.goto('/m/masterdata/accounts');
  await page.getByRole('button', { name: '新增科目', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增科目', exact: true });
  await drawer.getByLabel('科目编码', { exact: true }).fill('160101');
  await drawer.getByLabel('科目名称', { exact: true }).fill('研发设备');
  await drawer.getByLabel('启用部门', { exact: true }).check();
  await drawer.getByLabel('部门必填', { exact: true }).check();
  await drawer.getByLabel('启用项目', { exact: true }).check();
  await drawer.getByLabel('项目必填', { exact: true }).check();
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: '160101' });
  await expect(row).toContainText('部门必填');
  await expect(row).toContainText('项目必填');

  await page.goto('/m/masterdata/dimensions?type=department');
  await page.getByRole('button', { name: '新增部门', exact: true }).click();
  const department = page.getByRole('dialog', { name: '新增部门', exact: true });
  await department.getByLabel('档案编码', { exact: true }).fill('03');
  await department.getByLabel('档案名称', { exact: true }).fill('研发中心');
  await department.getByRole('button', { name: '保存', exact: true }).click();
  await expect(department).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: '研发中心' })).toBeVisible();

  await page.goto('/m/masterdata/accounts');
  await page.getByRole('combobox', { name: '快速查看科目', exact: true }).fill('yfsb');
  await page.keyboard.press('Enter');
  const edit = page.getByRole('dialog', { name: '编辑科目', exact: true });
  await expect(edit.getByLabel('科目名称', { exact: true })).toHaveValue('研发设备');
  await edit.getByLabel('默认部门', { exact: true }).fill('yfzx');
  await page.keyboard.press('Enter');
  await edit.getByLabel('默认项目', { exact: true }).fill('XM01');
  await page.keyboard.press('Enter');
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await page.reload();
  const accounts = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
    token: book.token,
  });
  const departments = await callApi<DimensionItem[]>(
    request,
    'core.dimensions.items',
    { type: 'department' },
    { token: book.token },
  );
  const account = accounts.find((a) => a.code === '160101')!;
  const dept = departments.find((d) => d.code === '03')!;
  expect(account.dimensions.find((d) => d.type === 'department')).toMatchObject({
    required: true,
    defaultItemId: dept.id,
  });

  await page.getByRole('combobox', { name: '快速查看科目', exact: true }).fill('yfsb');
  await page.keyboard.press('Enter');
  await expect(edit.getByLabel('默认部门', { exact: true }).locator('..')).toContainText(
    '研发中心',
  );
  await edit.getByLabel('停用', { exact: true }).check();
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await page.reload();
  await page.getByRole('combobox', { name: '快速查看科目', exact: true }).fill('yfsb');
  await expect(page.locator('.ant-select-dropdown:visible')).toContainText('暂无数据');
  await page.keyboard.press('Escape');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('科目.xlsx');
  await page.locator('input[type=file]').setInputFiles((await download.path())!);
  const preview = page.getByRole('dialog', { name: 'Excel 导入预览', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('row').filter({ hasText: '160101' })).toContainText('更新/保持');
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  const after = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
    token: book.token,
  });
  expect(after).toHaveLength(accounts.length);
  expect(after.find((a) => a.id === account.id)!.disabled).toBe(true);
});

test('w_xt_dwwh：客供明细取消/刷新未存盘可继续、放弃或保存，失败保留编辑；现金流历史方向未设置', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/masterdata/dimensions?type=partner');
  await page.getByRole('button', { name: '新增客户/供应商', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增客户/供应商', exact: true });
  await drawer.getByLabel('档案编码', { exact: true }).fill('C002');
  await drawer.getByLabel('档案名称', { exact: true }).fill('研发客户');
  await drawer.getByLabel('联系人', { exact: true }).fill('李四');
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: '有未保存的修改', exact: true });
  await unsaved.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(drawer.getByLabel('联系人', { exact: true })).toHaveValue('李四');
  await drawer.getByRole('button', { name: '刷新表单', exact: true }).click();
  await unsaved.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '研发客户' })).toContainText('李四');
  await page
    .getByRole('row')
    .filter({ hasText: '研发客户' })
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  const edit = page.getByRole('dialog', { name: '编辑客户/供应商', exact: true });
  await edit.getByLabel('档案编码', { exact: true }).fill('C001');
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('编号 C001 已存在', { exact: true })).toBeVisible();
  await expect(edit).toBeVisible();
  await edit.getByRole('button', { name: '取消', exact: true }).click();
  await unsaved.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.goto('/m/masterdata/dimensions?type=cashflow');
  await expect(page.getByRole('row').filter({ hasText: 'CF01' })).toContainText('未设置方向');
});
