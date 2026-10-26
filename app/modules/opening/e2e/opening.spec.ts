import { expect, test, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { SavedRow } from '../shared';
import { rowVersion } from '../shared';

async function select(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.keyboard.press('Enter');
}
async function add(
  page: Page,
  code: string,
  amount: string,
  credit = false,
  dimension?: { name: string; code: string },
) {
  await page.getByRole('button', { name: '新增期初', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增期初', exact: true });
  await select(page, '末级科目', code);
  if (dimension) await select(page, dimension.name, dimension.code);
  if (credit) {
    await drawer.getByLabel('年初余额方向', { exact: true }).click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
      .filter({ hasText: /^贷$/ })
      .click();
  }
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill(amount);
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await expect(drawer).not.toBeVisible();
}
const details = (page: Page) => page.locator('.cw-data-table:visible').nth(1);

test('w_xt_ye：真实期初与辅助录入→重载→一分差额定位→修复→锁定→写入拒绝→Excel预览', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const { token } = await loginWithNewBook(page, request);
  await page.goto('/m/opening?year=2026');
  await expect(page.getByRole('heading', { name: '期初余额', exact: true })).toBeVisible();
  await expect(page.getByTestId('trial-result')).toContainText('期初尚未录入');
  await add(page, '1001', '100.00');
  await add(page, '4001', '150.00', true);
  await add(page, '5001', '50.00', false, { name: '项目', code: 'XM01' });
  await expect(page.getByTestId('trial-result')).toContainText('试算平衡通过');
  await page.reload();
  await expect(page.getByTestId('trial-result')).toContainText('试算平衡通过');
  await expect(details(page)).toContainText('项目：XM01');
  const cash = details(page).getByRole('row').filter({ hasText: '1001 库存现金' });
  await cash.getByRole('button', { name: '修改', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: '修改期初', exact: true });
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('100.01');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByTestId('trial-result')).toContainText('启用余额本位币差额 0.01');
  await page.getByRole('button', { name: '定位 1001 库存现金', exact: true }).click();
  await expect(page).toHaveURL(/account=1001/);
  await expect(cash).toContainText('100.01');
  await expect(details(page).getByRole('row')).toHaveCount(2);
  await cash.getByRole('button', { name: '修改', exact: true }).click();
  drawer = page.getByRole('dialog', { name: '修改期初', exact: true });
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('100.00');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByTestId('trial-result')).toContainText('试算平衡通过');
  await page.getByRole('button', { name: '锁定年度期初', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByText('本模块手工锁：已锁定', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增期初', exact: true })).toBeDisabled();
  const before = await callApi<{ rows: SavedRow[] }>(
    request,
    'm.opening.list',
    { year: 2026 },
    { token, method: 'GET' },
  );
  const first = before.rows[0]!;
  await expect(
    callApi(
      request,
      'm.opening.save',
      {
        year: 2026,
        changes: [
          {
            id: first.id,
            expected: rowVersion(first),
            data: { ...first, balance: first.balance + 1 },
          },
        ],
      },
      { token },
    ),
  ).rejects.toThrow('手工锁定');
  expect(
    (
      await callApi<{ rows: SavedRow[] }>(
        request,
        'm.opening.list',
        { year: 2026 },
        { token, method: 'GET' },
      )
    ).rows,
  ).toEqual(before.rows);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByRole('button', { name: '导入 Excel', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Excel 导入预览', exact: true });
  await modal.getByLabel('导入模式', { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .filter({ hasText: /^覆盖（明确修改已有键）$/ })
    .click();
  await modal.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles(path!);
  await modal.getByRole('button', { name: '解析预览', exact: true }).click();
  await expect(modal).toContainText('预览通过，请确认整批写入');
  await expect(modal).toContainText('覆盖此键');
  await modal.getByRole('button', { name: '取消导入', exact: true }).click();
});

test('w_xt_ye/w_xt_xmnc：取消未保存退出、真实锁冲突保存失败保留输入，解锁后重试成功', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const { token } = await loginWithNewBook(page, request);
  await page.goto('/m/opening?year=2026&dimension=project');
  await add(page, '5001', '0.00', false, { name: '项目', code: 'XM01' });
  const row = details(page).getByRole('row').filter({ hasText: '5001 生产成本' });
  await row.getByRole('button', { name: '修改', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '修改期初', exact: true });
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('1.01');
  await drawer
    .locator('.ant-drawer-footer')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  let prompt = page.getByRole('dialog', { name: '有未保存修改', exact: true });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: '取消退出', exact: true }).click();
  await expect(drawer.getByLabel('年初余额（本位币）', { exact: true })).toHaveValue('1.01');
  await callApi(request, 'm.opening.setLock', { year: 2026, locked: true }, { token });
  await drawer
    .locator('.ant-drawer-footer')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  prompt = page.getByRole('dialog', { name: '有未保存修改', exact: true });
  await prompt.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(drawer).toContainText('手工锁定');
  await expect(prompt).toBeVisible();
  await expect(drawer.getByLabel('年初余额（本位币）', { exact: true })).toHaveValue('1.01');
  await callApi(request, 'm.opening.setLock', { year: 2026, locked: false }, { token });
  await prompt.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(prompt).not.toBeVisible();
  await expect(row).toContainText('1.01');
  await page.reload();
  await expect(row).toContainText('1.01');
});

for (const w of [
  {
    name: '项目',
    menu: '项目期初录入',
    id: 'project',
    account: '5001',
    code: 'XM01',
    window: 'w_xt_xmnc',
  },
  {
    name: '客供',
    menu: '客供期初录入',
    id: 'partner',
    account: '1122',
    code: 'C001',
    window: 'w_xt_dwnc',
  },
  {
    name: '部门',
    menu: '部门期初录入',
    id: 'department',
    account: '6602',
    code: '01',
    window: 'w_xt_bmnc',
  },
  {
    name: '个人',
    menu: '个人期初录入',
    id: 'person',
    account: '1221',
    code: 'P01',
    window: 'w_xt_grnc',
  },
]) {
  test(`${w.window}：直接菜单进入，真实档案保存，取消删除及二次确认清理`, async ({
    page,
    request,
  }) => {
    await loginWithNewBook(page, request);
    await page.goto('/m/opening?year=2026');
    await page.getByRole('menuitem', { name: w.menu, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`dimension=${w.id}`));
    await add(page, w.account, '1.23', false, { name: w.name, code: w.code });
    const row = details(page).getByRole('row').filter({ hasText: w.account });
    await expect(row).toContainText(`${w.name}：${w.code}`);
    await row.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(row).toContainText('1.23');
    await page.getByRole('button', { name: '清理损益年初数', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '清理损益年初数：请核对', exact: true });
    await expect(dialog.getByRole('button', { name: '二次确认清理', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(row).toContainText('1.23');
    await page.reload();
    await expect(row).toContainText('1.23');
  });
}

test('w_xt_ye：外币本位币独立录入、六位数量，真实导出覆盖导入不双计', async ({ page, request }) => {
  test.setTimeout(60000);
  const { token } = await loginWithNewBook(page, request);
  await page.goto('/m/opening?year=2026');
  await page.getByRole('button', { name: '新增期初', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: '新增期初', exact: true });
  await select(page, '末级科目', '100202');
  await drawer.getByLabel('录入币种', { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .filter({ hasText: /^USD$/ })
    .click();
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('7.11');
  await drawer.getByLabel('外币启用余额（借正贷负）', { exact: true }).fill('1.01');
  await expect(drawer).toContainText('参考汇率：7.1');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.getByRole('button', { name: '新增期初', exact: true }).click();
  drawer = page.getByRole('dialog', { name: '新增期初', exact: true });
  await select(page, '末级科目', '1403');
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('1.23');
  await drawer.getByLabel('启用数量（千克，借正贷负）', { exact: true }).fill('1.234567');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.reload();
  await expect(details(page)).toContainText('7.11');
  await expect(details(page)).toContainText('1.01');
  await expect(details(page)).toContainText('1.234567');
  await page.getByLabel('币种筛选', { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .filter({ hasText: /^USD 美元$/ })
    .click();
  await expect(page).toHaveURL(/currency=USD/);
  await expect(details(page).getByRole('row')).toHaveCount(2);
  await expect(details(page)).toContainText('美元户');
  await page.getByLabel('币种筛选', { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .filter({ hasText: /^全部币种$/ })
    .click();
  await page.getByRole('switch', { name: '期初数量', exact: true }).click();
  await expect(page).toHaveURL(/quantity=1/);
  await expect(details(page).getByRole('row')).toHaveCount(2);
  await expect(details(page)).toContainText('原材料');
  await page.getByRole('switch', { name: '期初数量', exact: true }).click();
  const before = await callApi<{ rows: SavedRow[] }>(
    request,
    'm.opening.list',
    { year: 2026 },
    { token, method: 'GET' },
  );
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const path = await (await downloading).path();
  await page.getByRole('button', { name: '导入 Excel', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Excel 导入预览', exact: true });
  await modal.getByLabel('导入模式', { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .filter({ hasText: /^覆盖（明确修改已有键）$/ })
    .click();
  await modal.getByLabel('选择 Excel 文件', { exact: true }).setInputFiles(path!);
  await modal.getByRole('button', { name: '解析预览', exact: true }).click();
  await expect(modal).toContainText('预览通过');
  await expect(modal).toContainText('1.234567');
  await modal.getByRole('button', { name: '确认整批写入', exact: true }).click();
  await expect(modal).not.toBeVisible();
  expect(
    (
      await callApi<{ rows: SavedRow[] }>(
        request,
        'm.opening.list',
        { year: 2026 },
        { token, method: 'GET' },
      )
    ).rows,
  ).toEqual(before.rows);
});

test('w_xt_ye_nf：年份筛选同步URL、拒绝开账前与任意未来年，跨模块按钮只验证地址', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/opening?year=2025');
  await expect(
    page.getByRole('alert').filter({ hasText: '2025 年早于开账年度' }).first(),
  ).toBeVisible();
  await page.getByLabel('年度', { exact: true }).fill('2027');
  await expect(page).toHaveURL(/year=2027/);
  await expect(
    page.getByRole('alert').filter({ hasText: '2027 年期初尚未建立' }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '去期末处理', exact: true }).first().click();
  await expect(page).toHaveURL(/\/m\/period-close$/);
});

test('w_xt_ye：Ctrl+F4/F5取消退出，原生刷新保留草稿，明确放弃后空白不落行', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request);
  await page.goto('/m/opening?year=2026');
  await page.getByRole('button', { name: '新增期初', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: '新增期初', exact: true });
  await select(page, '末级科目', '1001');
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('1.23');
  for (const shortcut of ['Control+F4', 'F5']) {
    await page.keyboard.press(shortcut);
    const dialog = page.getByRole('dialog', { name: '有未保存修改', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '取消退出', exact: true }).click();
    await expect(drawer.getByLabel('年初余额（本位币）', { exact: true })).toHaveValue('1.23');
  }
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
  drawer = page.getByRole('dialog', { name: '新增期初', exact: true });
  await expect(drawer.getByLabel('年初余额（本位币）', { exact: true })).toHaveValue('1.23');
  await drawer
    .locator('.ant-drawer-footer')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '有未保存修改', exact: true })
    .getByRole('button', { name: '放弃修改', exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  expect(
    (
      await callApi<{ rows: SavedRow[] }>(
        request,
        'm.opening.list',
        { year: 2026 },
        { token, method: 'GET' },
      )
    ).rows,
  ).toEqual([]);
  await page.getByRole('button', { name: '新增期初', exact: true }).click();
  await expect(drawer.getByLabel('年初余额（本位币）', { exact: true })).toHaveValue('');
});
