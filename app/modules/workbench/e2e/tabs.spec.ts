import { expect, test } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';

test('快速回切：路由提交前的Ctrl+F4关闭刚选择的标签，首页保持不可关闭', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/example/memos');
  const input = page.getByLabel('摘要', { exact: true });
  await input.fill('路由提交前的输入');
  const home = page.getByRole('tab', { name: '首页', exact: true });
  const memo = page.getByRole('tab', { name: '示范记账单', exact: true });
  await home.click();
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/home$/);
  // 同一个浏览器任务内点击并按键，稳定覆盖React路由尚未提交的窗口。
  await memo.evaluate((element) => {
    (element as HTMLElement).click();
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F4',
        code: 'F4',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(memo).toHaveCount(0);
  await expect(page).toHaveURL(/\/home$/);
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+F4');
  await expect(home).toHaveCount(1);
});

test('可见活动页Ctrl+F4：原生按键重复关闭、保留取消离开和标签输入', async ({ page, request }) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/example/memos');
  const input = page.getByLabel('摘要', { exact: true });
  const home = page.getByRole('tab', { name: '首页', exact: true });
  const memo = page.getByRole('tab', { name: '示范记账单', exact: true });
  for (let i = 0; i < 3; i++) {
    if (i > 0) await page.getByRole('menuitem', { name: /示范记账单/ }).click();
    await expect(memo).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeVisible();
    await input.fill(`未提交筛选${i}`);
    await home.click();
    await expect(home).toHaveAttribute('aria-selected', 'true');
    await memo.click();
    await expect(page).toHaveURL(/\/m\/example\/memos$/);
    await expect(memo).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(`未提交筛选${i}`);
    await page.evaluate(() => {
      window.onbeforeunload = (event) => event.preventDefault();
    });
    await page.keyboard.press('Control+F4');
    await expect(memo).toHaveCount(1);
    await expect(memo).toHaveAttribute('aria-selected', 'true');
    await expect(input).toHaveValue(`未提交筛选${i}`);
    await page.evaluate(() => {
      window.onbeforeunload = null;
    });
    await page.keyboard.press('Control+F4');
    await expect(memo).toHaveCount(0);
    await expect(page).toHaveURL(/\/home$/);
  }
});

test('关闭后立即history.back重建活动页，反复前进后退不留下空工作区', async ({ page, request }) => {
  await loginWithNewBook(page, request);
  await page.goto('/home');
  await page.getByRole('menuitem', { name: /示范记账单/ }).click();
  const memo = page.getByRole('tab', { name: '示范记账单', exact: true });
  await expect(memo).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('摘要', { exact: true })).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+F4');
    await expect(page).toHaveURL(/\/home$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/m\/example\/memos$/);
    await expect(memo).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('摘要', { exact: true })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('tab', { name: '首页', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.goBack();
    await expect(memo).toHaveAttribute('aria-selected', 'true');
  }
});

test('尾斜杠只规范标签身份，保留query、未保存输入及不同业务路径', async ({ page, request }) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/example/memos');
  const input = page.getByLabel('摘要', { exact: true });
  await input.fill('保留尾斜杠前的筛选');
  await page.getByRole('button', { name: '帮助', exact: true }).click();
  await expect(page.getByRole('heading', { name: '帮助与关于', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.history.pushState(
      { ...window.history.state, key: 'slash-regression' },
      '',
      '/m/example/memos/?keyword=尾斜杠&mode=project',
    );
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  });
  await expect(page).toHaveURL((url) => url.searchParams.get('mode') === 'project');
  await expect(page.getByRole('tab', { name: '示范记账单', exact: true })).toHaveCount(1);
  await expect(page.getByRole('tab', { name: '示范记账单', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(input).toHaveValue('保留尾斜杠前的筛选');
  await expect(page.getByRole('tab', { name: '帮助与关于', exact: true })).toHaveCount(1);
});

test('同任务先导航再打开搜索，迟到路由不能关闭新弹窗且发出真实搜索请求', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request);
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '帮助', exact: true }).evaluate((help) => {
    (help as HTMLElement).click();
    const trigger = [...document.querySelectorAll('button')].find(
      (el) => el.textContent === '搜索 Ctrl+K',
    );
    trigger!.click();
  });
  const search = page.getByRole('dialog', { name: '全局搜索', exact: true });
  const responses: number[] = [];
  page.on('response', (res) => {
    if (new URL(res.url()).pathname.includes('m.workbench.search')) responses.push(res.status());
  });
  await search.getByRole('combobox', { name: '全局搜索关键词' }).fill('帮助与关于');
  await expect.poll(() => responses).toContain(200);
  await expect(search.getByRole('option').filter({ hasText: '帮助与关于' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '帮助与关于', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await search.getByRole('option').filter({ hasText: '帮助与关于' }).getByRole('button').click();
  await expect(search).not.toBeVisible();
});

test('页面chunk尚未返回时先激活目标标签，资源放行后挂载示范页', async ({ page, request }) => {
  await loginWithNewBook(page, request);
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const chunkRequested = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/assets/MemoPage-*.js', async (route) => {
    requested();
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole('menuitem', { name: /示范记账单/ }).click();
    await chunkRequested;
    const active = page.getByRole('tab').filter({ hasText: /示范记账单|加载中…/ });
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: '首页', exact: true })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    release();
    await expect(
      page
        .getByRole('tabpanel')
        .filter({ visible: true })
        .getByRole('heading', { name: '示范记账单', exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});
