import { test, expect, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

async function passwordDraft(page: Page) {
  await page.goto('/m/system-admin/password');
  await page.getByLabel('原密码', { exact: true }).fill('admin');
  await page.getByLabel('新密码', { exact: true }).fill('synthetic-next123');
  await page.getByLabel('确认新密码', { exact: true }).fill('synthetic-next123');
}
async function printDraft(page: Page) {
  await page.getByRole('menuitem', { name: '打印与导出', exact: true }).click();
  await page.getByRole('button', { name: '打印格式设置', exact: true }).click();
  await page.getByLabel('打印单位名称', { exact: true }).fill('凭据变更前须保存的草稿');
}

test('w_pass 两标签直接改密前先处理其他页草稿，保存失败不得改密或撤销会话', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  await passwordDraft(page);
  await printDraft(page);
  await page.getByRole('tab', { name: '自改密码', exact: true }).click();
  let changes = 0;
  page.on('request', (req) => {
    if (req.url().includes('m.system-admin.changePassword')) changes++;
  });
  await page.route('**/trpc/*m.print-settings.saveSettings*', (route) => route.abort('failed'));
  await page.getByRole('button', { name: '保存新密码并重新登录', exact: true }).click();
  const guard = page.getByRole('dialog', { name: '有尚未保存的内容', exact: true });
  await expect(guard).toContainText('打印格式设置');
  await guard.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(guard).toBeHidden();
  expect(changes).toBe(0);
  expect(
    (
      await callApi<{ book: { id: string } }>(request, 'core.auth.me', undefined, {
        token: book.token,
        method: 'GET',
      })
    ).book.id,
  ).toBe(book.bookId);
  await page.getByRole('tab', { name: '打印与导出', exact: true }).click();
  await expect(page.getByLabel('打印单位名称', { exact: true })).toHaveValue(
    '凭据变更前须保存的草稿',
  );
  await page.unroute('**/trpc/*m.print-settings.saveSettings*');
  await page.getByRole('tab', { name: '自改密码', exact: true }).click();
  await page.getByRole('button', { name: '保存新密码并重新登录', exact: true }).click();
  await guard.getByRole('button', { name: '继续编辑', exact: true }).click();
  expect(changes).toBe(0);
  await page.getByRole('button', { name: '保存新密码并重新登录', exact: true }).click();
  await guard.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(page).toHaveURL(`/login/${book.bookId}`);
  const fresh = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId: book.bookId,
    userCode: 'admin',
    password: 'synthetic-next123',
  });
  const saved = await callApi<{ voucher: { unitName: string } }>(
    request,
    'm.print-settings.settings',
    undefined,
    { token: fresh.token, method: 'GET' },
  );
  expect(saved.voucher.unitName).toBe('凭据变更前须保存的草稿');
});

test('w_login_1 两标签保存后切用户：密码先登记也须先保存业务，再失效会话', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  await passwordDraft(page);
  await printDraft(page);
  await page.getByRole('menuitem', { name: '切换用户', exact: true }).click();
  await page.getByRole('button', { name: '确认并切换用户', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认切换用户', exact: true });
  await confirmation.getByLabel('确认文字', { exact: true }).fill('切换用户');
  await confirmation.getByRole('button', { name: '确定', exact: true }).click();
  const guard = page.getByRole('dialog', { name: '有尚未保存的内容', exact: true });
  await expect(guard).toContainText('自改密码');
  await expect(guard).toContainText('打印格式设置');
  await guard.getByRole('button', { name: '保存后继续', exact: true }).click();
  await expect(page).toHaveURL(`/login/${book.bookId}`);
  const fresh = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId: book.bookId,
    userCode: 'admin',
    password: 'synthetic-next123',
  });
  const saved = await callApi<{ voucher: { unitName: string } }>(
    request,
    'm.print-settings.settings',
    undefined,
    { token: fresh.token, method: 'GET' },
  );
  expect(saved.voucher.unitName).toBe('凭据变更前须保存的草稿');
});

for (const action of ['修改', '权限', '重置密码'] as const) {
  test(`w_xt_users 自身${action}先保存另一标签草稿，再失效会话`, async ({ page, request }) => {
    const book = await loginWithNewBook(page, request);
    await page.goto('/home');
    await printDraft(page);
    await page.getByRole('menuitem', { name: '用户管理', exact: true }).click();
    const row = page.getByRole('row').filter({ has: page.getByText('admin', { exact: true }) });
    await row.getByRole('button', { name: action, exact: true }).click();
    const title =
      action === '修改'
        ? '修改用户 admin'
        : action === '权限'
          ? '用户权限 admin'
          : '重置密码 admin';
    const drawer = page.getByRole('dialog', { name: title, exact: true });
    if (action === '修改')
      await drawer.getByLabel('用户名称', { exact: true }).fill('本次修改管理员');
    if (action === '权限')
      await drawer.getByRole('button', { name: '全选功能', exact: true }).click();
    if (action === '重置密码') {
      await drawer.getByLabel('新密码', { exact: true }).fill('synthetic-next123');
      await drawer.getByLabel('确认新密码', { exact: true }).fill('synthetic-next123');
    }
    await drawer.getByRole('button', { name: '保存', exact: true }).click();
    const guard = page.getByRole('dialog', { name: '有尚未保存的内容', exact: true });
    const confirmation = page.getByRole('dialog', {
      name: action === '权限' ? '保存 admin 的权限' : '重置 admin 的密码',
      exact: true,
    });
    let confirmed = false;
    if (action !== '修改') {
      await expect(guard.or(confirmation)).toBeVisible();
      if (await confirmation.isVisible()) {
        await confirmation.getByLabel('确认文字', { exact: true }).fill('admin');
        await confirmation.getByRole('button', { name: '确定', exact: true }).click();
        confirmed = true;
      }
    }
    await expect(guard).toContainText('打印格式设置');
    await guard.getByRole('button', { name: '保存后继续', exact: true }).click();
    if (action !== '修改' && !confirmed) {
      await expect(confirmation).toBeVisible();
      await confirmation.getByLabel('确认文字', { exact: true }).fill('admin');
      await confirmation.getByRole('button', { name: '确定', exact: true }).click();
    }
    await expect(page).toHaveURL(`/login/${book.bookId}`);
    const fresh = await callApi<{ token: string }>(request, 'core.auth.login', {
      bookId: book.bookId,
      userCode: 'admin',
      password: action === '重置密码' ? 'synthetic-next123' : 'admin',
    });
    const saved = await callApi<{ voucher: { unitName: string } }>(
      request,
      'm.print-settings.settings',
      undefined,
      { token: fresh.token, method: 'GET' },
    );
    expect(saved.voucher.unitName).toBe('凭据变更前须保存的草稿');
    await expect(
      callApi(request, 'core.auth.me', undefined, { token: book.token, method: 'GET' }),
    ).rejects.toThrow('登录已失效');
  });
}

test('w_pass 凭据响应门控期间尝试编辑另一标签，不产生撤会话后无法保存的新草稿', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  await passwordDraft(page);
  await printDraft(page);
  const input = page.getByLabel('打印单位名称', { exact: true });
  const inputBox = await input.boundingBox();
  const tabBox = await page.getByRole('tab', { name: '打印与导出', exact: true }).boundingBox();
  await page.getByRole('tab', { name: '自改密码', exact: true }).click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const received = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route('**/trpc/*m.system-admin.changePassword*', async (route) => {
    const response = await route.fetch();
    reached();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '保存新密码并重新登录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '有尚未保存的内容', exact: true })
    .getByRole('button', { name: '保存后继续', exact: true })
    .click();
  await received;
  try {
    await page.mouse.click(tabBox!.x + tabBox!.width / 2, tabBox!.y + tabBox!.height / 2);
    await page.mouse.click(inputBox!.x + inputBox!.width / 2, inputBox!.y + inputBox!.height / 2);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('凭据请求期间的新草稿');
    expect(await input.inputValue()).toBe('凭据变更前须保存的草稿');
  } finally {
    release();
  }
  await expect(page).toHaveURL(`/login/${book.bookId}`);
  const fresh = await callApi<{ token: string }>(request, 'core.auth.login', {
    bookId: book.bookId,
    userCode: 'admin',
    password: 'synthetic-next123',
  });
  const saved = await callApi<{ voucher: { unitName: string } }>(
    request,
    'm.print-settings.settings',
    undefined,
    { token: fresh.token, method: 'GET' },
  );
  expect(saved.voucher.unitName).toBe('凭据变更前须保存的草稿');
});
