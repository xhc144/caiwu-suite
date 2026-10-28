import { expect, test, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { SavedRow } from '../shared';

async function edit(page: Page) {
  await page.goto('/m/opening?year=2026');
  await page.getByRole('button', { name: '新增期初', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: /^(新增|修改)期初$/ });
  await drawer.getByLabel('末级科目', { exact: true }).fill('1001');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('1.00');
  return drawer;
}

test('w_xt_ye：壳关闭保存失败保留输入，解锁重试后关闭且只保存一条', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request);
  const initial = await callApi<{ accounts: { id: number; code: string }[] }>(
    request,
    'm.opening.list',
    { year: 2026 },
    { token, method: 'GET' },
  );
  const accountId = initial.accounts.find((a) => a.code === '1001')!.id;
  await callApi(
    request,
    'm.opening.save',
    {
      year: 2026,
      changes: [{ data: { year: 2026, accountId, balance: 0 } }],
    },
    { token },
  );
  await page.goto('/m/opening?year=2026');
  await page
    .locator('.cw-data-table')
    .nth(1)
    .getByRole('row')
    .filter({ hasText: '1001 库存现金' })
    .getByRole('button', { name: '修改', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: '修改期初', exact: true });
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('1.00');
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('0.00');
  await page.keyboard.press('Control+F4');
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: '有未保存内容', exact: true })).not.toBeVisible();
  await page.getByRole('menuitem', { name: '期初余额', exact: true }).click();
  await page
    .locator('.cw-data-table')
    .nth(1)
    .getByRole('row')
    .filter({ hasText: '1001 库存现金' })
    .getByRole('button', { name: '修改', exact: true })
    .click();
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('1.00');
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F4', ctrlKey: true, isComposing: true, bubbles: true }),
    ),
  );
  await expect(page.getByRole('dialog', { name: '有未保存内容', exact: true })).not.toBeVisible();
  await page.keyboard.press('Control+F4');
  const prompt = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await expect(prompt).toContainText('2026 年期初余额');
  await prompt.getByRole('button', { name: /取\s*消/ }).click();
  await expect(drawer.getByLabel('年初余额（本位币）', { exact: true })).toHaveValue('1.00');
  // 另一会话锁定已保存的平衡零记录，制造真实保存冲突。
  await callApi(request, 'm.opening.setLock', { year: 2026, locked: true }, { token });
  await page.keyboard.press('Control+F4');
  await prompt.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(drawer).toContainText('手工锁定');
  await expect(drawer.getByLabel('年初余额（本位币）', { exact: true })).toHaveValue('1.00');
  await callApi(request, 'm.opening.setLock', { year: 2026, locked: false }, { token });
  // 解锁后由同一个编辑版本重试成功。
  await page.keyboard.press('Control+F4');
  await prompt.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const result = await callApi<{ rows: SavedRow[] }>(
    request,
    'm.opening.list',
    { year: 2026 },
    { token, method: 'GET' },
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]!.balance).toBe(100);
});

test('w_xt_ye：保存响应延迟期间的新输入保留，第二次修改同一行且关闭守卫仅在存净后放行', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request);
  const drawer = await edit(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const responseReady = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route('**/trpc/m.opening.save*', async (route) => {
    const response = await route.fetch();
    reached();
    await gate;
    await route.fulfill({ response });
  });
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await responseReady;
  await page.keyboard.press('Control+F4');
  await page
    .getByRole('dialog', { name: '有未保存内容', exact: true })
    .getByRole('button', { name: '放弃修改并继续', exact: true })
    .click();
  await expect(drawer).toBeVisible();
  await expect(
    page.getByText('正在保存期初，请等待保存结果后再关闭。', { exact: true }),
  ).toBeVisible();
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('2.00');
  release();
  await expect(drawer).toContainText('保存期间的新修改仍未保存');
  await expect(drawer.getByLabel('年初余额（本位币）', { exact: true })).toHaveValue('2.00');
  let result = await callApi<{ rows: SavedRow[] }>(
    request,
    'm.opening.list',
    { year: 2026 },
    { token, method: 'GET' },
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]!.balance).toBe(100);
  await page.unroute('**/trpc/m.opening.save*');
  await page.keyboard.press('Control+F4');
  await page
    .getByRole('dialog', { name: '有未保存内容', exact: true })
    .getByRole('button', { name: '保存并继续', exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  result = await callApi<{ rows: SavedRow[] }>(
    request,
    'm.opening.list',
    { year: 2026 },
    { token, method: 'GET' },
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]!.balance).toBe(200);
});
