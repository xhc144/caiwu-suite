import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';

test('独立临时账套：真实待办→路由穿透→实体搜索与键盘→产品持久化', async ({ page, seeded }) => {
  await seeded.login(page);
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  await expect(page.locator('.ant-descriptions')).toContainText('4-2-2');
  await expect(page.locator('.ant-descriptions')).toContainText('CNY');
  await expect(page.getByText('待审核凭证', { exact: true })).toBeVisible();
  const pendingCard = page
    .locator('.ant-card')
    .filter({ has: page.getByRole('button', { name: '处理待审核凭证' }) });
  const auditedCard = page
    .locator('.ant-card')
    .filter({ has: page.getByRole('button', { name: '处理待过账凭证' }) });
  await expect(pendingCard.locator('.ant-statistic-content-value')).toHaveText(
    String(seeded.counts.pending),
  );
  await expect(auditedCard.locator('.ant-statistic-content-value')).toHaveText(
    String(seeded.counts.audited),
  );
  await page.getByRole('combobox', { name: '查看期间' }).click();
  await page.getByTitle('2026年02月', { exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('period') === '202602');
  await expect(pendingCard.locator('.ant-statistic-content-value')).toHaveText('0');
  await expect(auditedCard.locator('.ant-statistic-content-value')).toHaveText('0');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(pendingCard.locator('.ant-statistic-content-value')).toHaveText('0');
  await page.goBack();
  await expect(pendingCard.locator('.ant-statistic-content-value')).toHaveText(
    String(seeded.counts.pending),
  );
  await page.getByRole('button', { name: '处理待审核凭证' }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/m/voucher-book' &&
      url.searchParams.get('period') === '202601' &&
      url.searchParams.get('status') === 'pending',
  );
  await page.getByRole('tab', { name: '首页', exact: true }).click();
  await page.getByRole('button', { name: '处理待过账凭证' }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === '/m/voucher-book' && url.searchParams.get('status') === 'audited',
  );
  await page.getByRole('tab', { name: '首页', exact: true }).click();
  await page.getByRole('button', { name: '搜索 Ctrl+K' }).focus();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: '全局搜索', exact: true });
  await expect(search).toBeVisible();
  const input = search.getByRole('combobox', { name: '全局搜索关键词' });
  for (const [term, text] of [
    ['kcxj', '1001 库存现金'],
    ['0001', '记-0001'],
    ['独立工作台摘要', '记-0001'],
    ['C001', 'C001'],
    ['tqbyj', '提取备用金'],
  ]) {
    await input.fill(term!);
    await expect(search.getByRole('option').filter({ hasText: text! }).first()).toBeVisible();
  }
  await input.fill('kcxj');
  await expect(search.getByRole('option').filter({ hasText: '1001 库存现金' })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/m/ledgers/detail' &&
      url.searchParams.get('account') === '1001' &&
      url.searchParams.get('from') === '202601' &&
      url.searchParams.get('to') === '202601' &&
      url.searchParams.has('dims'),
  );
  await expect(search).not.toBeVisible();
  await page.goto(`${seeded.origin}/m/workbench/settings`);
  const product = page.getByRole('combobox', { name: '产品形态' });
  await product.click();
  await page.getByTitle('轻松会计', { exact: true }).click();
  await page.getByRole('button', { name: '切换产品形态', exact: true }).click();
  await page.getByRole('button', { name: '已保存内容，确认切换' }).click();
  await expect(page).toHaveURL(`${seeded.origin}/home`);
  const login = await seeded.login(page);
  expect(login.book.product).toBe('qingsong');
  await expect(page.getByText('轻松会计', { exact: true }).first()).toBeVisible();
});

test('身份隔离：跨账套同ID不残留，撤销会话后清除旧页面，普通用户不显示财务0', async ({
  page,
  seeded,
}) => {
  const first = await seeded.login(page);
  await page.getByRole('button', { name: '搜索 Ctrl+K' }).click();
  await page.getByRole('combobox', { name: '全局搜索关键词' }).fill('kcxj');
  await expect(page.getByRole('option').filter({ hasText: '1001 库存现金' })).toBeVisible();
  await page.keyboard.press('Escape');
  await seeded.login(page, seeded.otherBookId);
  await page.getByRole('button', { name: '搜索 Ctrl+K' }).click();
  const input = page.getByRole('combobox', { name: '全局搜索关键词' });
  await expect(input).toHaveValue('');
  await input.fill('1001');
  await expect(page.getByRole('option').filter({ hasText: '1001 隔离专用现金' })).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: '1001 库存现金' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const clerk = await seeded.login(page, seeded.bookId, 'clerk');
  await expect(page.getByText('无法读取本期统计', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '处理待审核凭证' })).toHaveCount(0);
  await page.getByRole('button', { name: '搜索 Ctrl+K' }).click();
  await page.getByRole('combobox', { name: '全局搜索关键词' }).fill('1001');
  await expect(page.getByText('未检索：科目、摘要、往来单位、凭证')).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: '库存现金' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await callApi(seeded.api, 'core.auth.logout', {}, { token: clerk.token });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/' || url.pathname.startsWith('/login/'));
  await expect(page.getByText('待审核凭证', { exact: true })).toHaveCount(0);
  await callApi(seeded.api, 'core.auth.logout', {}, { token: first.token });
});

test('快捷键焦点与反复开关、隐藏页不抢键', async ({ page, seeded }) => {
  await seeded.login(page);
  const trigger = page.getByRole('button', { name: '快捷键 ?' });
  for (let i = 0; i < 2; i++) {
    await trigger.focus();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: '快捷键总表' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  await page.getByRole('button', { name: '搜索 Ctrl+K' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '搜索 Ctrl+K' })).toBeFocused();
  await page.goto(`${seeded.origin}/m/example/memos`);
  await expect(page.getByRole('heading', { name: '示范记账单', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '帮助', exact: true }).click();
  await expect(page.getByRole('heading', { name: '帮助与关于', exact: true })).toBeVisible();
  await page.keyboard.press('Alt+n');
  await expect(page.getByRole('dialog', { name: '新增记账单' })).toHaveCount(0);
});

test('改密后旧会话经工作台检查失效，回登录且不保留财务结果', async ({ page, seeded }) => {
  await seeded.login(page);
  await expect(page.getByRole('button', { name: '处理待审核凭证' })).toBeVisible();
  await seeded.setPassword('admin', 'changed-password');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/' || url.pathname.startsWith('/login/'));
  await expect(page.getByText('待审核凭证', { exact: true })).toHaveCount(0);
});

test('首页无业务标签时直接切账套，隐藏业务标签仍需确认并尊重离开保护', async ({ page, seeded }) => {
  await seeded.login(page);
  const userMenu = page
    .getByRole('menu')
    .filter({ has: page.getByRole('menuitem', { name: /退出登录$/ }) });
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /系统管理员/ }).hover();
  await userMenu.getByRole('menuitem', { name: '切换账套', exact: true }).click();
  await expect(page).toHaveURL(`${seeded.origin}/`);
  expect(await page.evaluate(() => sessionStorage.getItem('caiwu.session'))).toBeNull();
  await seeded.login(page);
  await page.goto(`${seeded.origin}/m/example/memos`);
  await page.getByLabel('摘要', { exact: true }).fill('保留隐藏标签输入');
  await page.getByRole('tab', { name: '首页', exact: true }).click();
  await page.getByRole('button', { name: /系统管理员/ }).hover();
  await userMenu.getByRole('menuitem', { name: '切换账套', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '切换账套', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('tab', { name: '示范记账单', exact: true }).click();
  await expect(page.getByLabel('摘要', { exact: true })).toHaveValue('保留隐藏标签输入');
  await page.getByRole('tab', { name: '首页', exact: true }).click();
  await page.evaluate(() => {
    window.onbeforeunload = (e) => e.preventDefault();
  });
  await page.getByRole('button', { name: /系统管理员/ }).hover();
  await userMenu.getByRole('menuitem', { name: '切换账套', exact: true }).click();
  await confirm.getByRole('button', { name: '已保存内容，继续', exact: true }).click();
  await expect(page).toHaveURL(`${seeded.origin}/home`);
  await expect(confirm).toBeVisible();
  await page.evaluate(() => {
    window.onbeforeunload = null;
  });
  await confirm.getByRole('button', { name: '已保存内容，继续', exact: true }).click();
  await expect(page).toHaveURL(`${seeded.origin}/`);
});
