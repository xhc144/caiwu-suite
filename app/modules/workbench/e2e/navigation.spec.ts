import { test, expect } from './fixture';

test('w_main1 原入口映射到真实菜单，摘要搜索进入实际分类路由', async ({ page, seeded }) => {
  await seeded.login(page);
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  const map = page.locator('.ant-card').filter({ hasText: '原工作台功能现在在哪里' });
  for (const [name, path, kind] of [
    ['摘要管理', '/m/masterdata/reference', 'summaries'],
    ['结算类别', '/m/masterdata/reference', 'settlementMethods'],
    ['凭证查询', '/m/voucher-book', ''],
  ]) {
    await map.getByRole('button', { name: new RegExp(`^${name} · 进入`) }).click();
    // 本测试只验证工作台的导航契约，不依赖其他任务页面实现或加载完成。
    await expect(page).toHaveURL(
      (url) => url.pathname === path && (!kind || url.searchParams.get('kind') === kind),
    );
    await page.getByRole('tab', { name: '首页', exact: true }).click();
  }
  await page.getByRole('button', { name: '搜索 Ctrl+K' }).click();
  const search = page.getByRole('dialog', { name: '全局搜索', exact: true });
  await search.getByRole('combobox', { name: '全局搜索关键词' }).fill('tqbyj');
  await search.getByRole('option').filter({ hasText: '提取备用金' }).getByRole('button').click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/m/masterdata/reference' &&
      url.searchParams.get('kind') === 'summaries' &&
      url.searchParams.get('keyword') === '提取备用金',
  );
});
