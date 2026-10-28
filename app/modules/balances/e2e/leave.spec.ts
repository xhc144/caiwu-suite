import { expect } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Settings } from '../shared';
import { seedBalanceCases } from '../test/fixtures';
import { test } from './fixture';

for (const [path, title] of [
  ['/m/balances', '汇总余额表'],
  ['/m/balances/foreign', '外币余额表'],
] as const) {
  test(`${title}：取消离开保留草稿，放弃设置后可关闭整个标签`, async ({ page, localServer }) => {
    const { bookId, token } = await loginWithNewBook(page, localServer.request);
    await page.goto(`${localServer.url}${path}`);
    const tab = page.getByRole('tab', { name: title, exact: true });
    const drawer = page.getByRole('dialog', { name: '展示设置', exact: true });
    await page.getByRole('button', { name: '展示设置', exact: true }).click();
    await drawer.getByLabel('默认显示级次').selectOption('-1');
    // Ctrl+F4 请求关闭整个标签；未保存的设置和编辑值必须仍在。
    await page.keyboard.press('Control+F4');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
    const leavingGuard = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await expect(leavingGuard).toContainText(`${title}展示设置`);
    await leavingGuard.getByRole('button', { name: /取\s*消/ }).click();
    await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    const abandon = page.getByRole('dialog', { name: '展示设置尚未保存', exact: true });
    await expect(abandon).toBeVisible();
    await abandon.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
    await expect(tab).toHaveAttribute('aria-selected', 'true');

    // 真实浏览器离开确认选择取消；不能仅依靠合成事件或默认自动 dismiss。
    const leaving = page.waitForEvent('dialog');
    // 直接触发浏览器刷新；取消后不再等待一次不会发生的 load 事件。
    const reload = page.evaluate(() => window.location.reload());
    const confirmation = await leaving;
    expect(confirmation.type()).toBe('beforeunload');
    await confirmation.dismiss();
    await reload;
    await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const storageKey = `balances.settingsDraft.${bookId}`;
    expect(
      JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), storageKey))!),
    ).toMatchObject({ display: { level: -1 } });
    const metadata = await callApi<{ settings: Settings }>(
      localServer.request,
      'm.balances.metadata',
      undefined,
      { token, method: 'GET' },
    );
    expect(metadata.settings.display.level).toBe(1);

    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await abandon.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(drawer).toHaveCount(0);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
    await page.keyboard.press('Control+F4');
    await expect(tab).toHaveCount(0);
    await expect(page).toHaveURL(`${localServer.url}/home`);
    await expect(page.getByRole('tab', { name: '首页', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.goBack();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: '展示设置', exact: true }).click();
    await expect(drawer.getByLabel('默认显示级次')).toHaveValue('1');
    await expect(drawer.getByRole('status')).toHaveCount(0);
  });
}

test('w_zw_ye：已应用查询与即时筛选可关闭，前进后退恢复条件和真实余额', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, seedBalanceCases);
  await page.goto(`${localServer.url}/m/balances?from=202602&to=202602`);
  const tab = page.getByRole('tab', { name: '汇总余额表', exact: true });
  const home = page.getByRole('tab', { name: '首页', exact: true });
  const total = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '合计', exact: true }) });
  await expect(total).toContainText('738.34');
  await page.getByLabel('开始科目', { exact: true }).fill('100201');
  await page.keyboard.press('Enter');
  await page.getByLabel('结束科目', { exact: true }).fill('100201');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '查询', exact: false }).click();
  await page.getByRole('checkbox', { name: '包含未过账凭证', exact: true }).check();
  await page.getByRole('checkbox', { name: '只显示有发生额', exact: true }).check();
  await page.getByLabel('显示级次', { exact: true }).selectOption('-1');
  await expect(total).toContainText('430.00');
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('codeFrom') === '100201' &&
      url.searchParams.get('codeTo') === '100201' &&
      url.searchParams.get('includeUnposted') === '1' &&
      url.searchParams.get('onlyActivity') === '1' &&
      url.searchParams.get('level') === '-1',
  );
  const queryUrl = page.url();
  await home.click();
  await expect(page).toHaveURL(`${localServer.url}/home`);
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(queryUrl);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(total).toContainText('430.00');
  await page.goForward();
  await expect(page).toHaveURL(`${localServer.url}/home`);
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(queryUrl);
  await expect(total).toContainText('430.00');
  await expect(page.getByRole('checkbox', { name: '包含未过账凭证', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '只显示有发生额', exact: true })).toBeChecked();
  await expect(page.getByLabel('显示级次', { exact: true })).toHaveValue('-1');
  await page.keyboard.press('Control+F4');
  await expect(tab).toHaveCount(0);
  await expect(page).toHaveURL(`${localServer.url}/home`);
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(queryUrl);
  await expect(total).toContainText('430.00');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
