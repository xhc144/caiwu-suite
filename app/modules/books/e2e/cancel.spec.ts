import { expect, test, type Locator } from '@playwright/test';
import { callApi, createBook } from '@caiwu/testkit/e2e';
import type { BookSummary } from '@caiwu/core';
import { clickModalAction, probeModalPointers } from './pointer-probe';

async function fillValidWizard(wizard: Locator, name: string) {
  await wizard.getByLabel('账套名称', { exact: true }).fill(name);
  await wizard.getByLabel('单位名称', { exact: true }).fill('有效取消测试单位');
  await wizard.getByLabel('管理员编号', { exact: true }).fill('cancel-admin');
  await wizard.getByLabel('管理员姓名', { exact: true }).fill('取消测试管理员');
  await wizard.getByLabel('管理员密码', { exact: true }).fill('synthetic-cancel-pass');
  await wizard.getByRole('button', { name: '下一步', exact: true }).click();
  await wizard.getByRole('radio', { name: /小企业会计准则/ }).check();
  await wizard.getByRole('button', { name: '下一步', exact: true }).click();
  await wizard.getByLabel('科目级次', { exact: true }).fill('4-2-2');
  await wizard.getByRole('button', { name: '下一步', exact: true }).click();
  await wizard.getByLabel('启用年份', { exact: true }).fill('2026');
  await wizard.getByLabel('启用月份', { exact: true }).fill('1');
  await wizard.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(wizard.locator('.ant-form-item-explain-error')).toHaveCount(0);
  await expect(wizard.getByRole('button', { name: '创建', exact: true })).toBeEnabled();
}

test('w_tzjl_1_new：重复打开取消、快速取消及确认退场后可继续操作，原账套不变', async ({
  page,
  request,
}, info) => {
  const attachPointers = await probeModalPointers(page, info);
  try {
    const prefix = `取消保留原账套-${Date.now()}`;
    const original = await createBook(request, { name: `${prefix}-原账套` });
    // 列表铺满向导后方，检测关闭时快速第二次点击是否穿透到账套行。
    for (let i = 0; i < 12; i++) await createBook(request, { name: `${prefix}-${i}` });
    const originals = (await callApi<BookSummary[]>(request, 'core.books.list')).filter((book) =>
      book.name.startsWith(prefix),
    );
    expect(originals).toHaveLength(13);
    const before = originals.find((book) => book.id === original.bookId);
    let creates = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('core.books.create')) creates++;
    });
    await page.goto('/');
    await page.getByRole('textbox', { name: '搜索账套' }).fill(prefix);
    const selectOriginal = async () => {
      await page.getByRole('textbox', { name: '搜索账套' }).fill(prefix);
      await page.getByRole('row', { name: new RegExp(original.bookId) }).click();
    };
    await selectOriginal();
    const selectedRow = page.locator('tr.ant-table-row-selected');
    const open = page.getByRole('button', { name: '新建账套', exact: true });
    const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
    const confirmation = page.getByRole('dialog', { name: '放弃未提交的新建账套内容？' });
    for (let attempt = 0; attempt < 2; attempt++) {
      await open.click();
      await wizard.getByRole('button', { name: '取消', exact: true }).dblclick();
      await expect(wizard).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
      await expect(selectedRow).toContainText(original.bookId);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await selectOriginal();
      await open.click();
      const name = `取消不建账-${Date.now()}-${attempt}`;
      await fillValidWizard(wizard, name);
      await wizard.getByRole('button', { name: '取消', exact: true }).dblclick();
      await expect(confirmation).toHaveCount(1);
      await clickModalAction(confirmation, '继续编辑');
      // 保持真实退场动画；确认框彻底移除后才定位仍打开的向导。
      await expect(confirmation).toHaveCount(0);
      await expect(wizard.getByLabel('账套名称', { exact: true })).toHaveValue(name);
      await expect(wizard.getByLabel('单位名称', { exact: true })).toHaveValue('有效取消测试单位');
      await expect(wizard.getByRole('button', { name: '创建', exact: true })).toBeEnabled();
      await wizard.getByRole('button', { name: '取消', exact: true }).dblclick();
      await expect(confirmation).toHaveCount(1);
      await clickModalAction(confirmation, '放弃创建');
      await expect(confirmation).toHaveCount(0);
      await expect(wizard).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
      await expect(selectedRow).toContainText(original.bookId);
      await page.getByRole('textbox', { name: '搜索账套' }).fill(name);
      await expect(page.getByText('没有匹配的账套，请修改搜索内容')).toBeVisible();
    }
    await selectOriginal();
    await open.click();
    await fillValidWizard(wizard, '快速键盘取消');
    await wizard.focus();
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(1);
    await clickModalAction(confirmation, '继续编辑');
    await expect(confirmation).toHaveCount(0);
    await expect(wizard.getByLabel('账套名称', { exact: true })).toHaveValue('快速键盘取消');
    await wizard.getByRole('button', { name: '取消', exact: true }).dblclick();
    await clickModalAction(confirmation, '放弃创建');
    await expect(confirmation).toHaveCount(0);
    await expect(wizard).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await expect(selectedRow).toContainText(original.bookId);
    expect(creates).toBe(0);
    const after = await callApi<BookSummary[]>(request, 'core.books.list');
    expect(after.some((book) => book.name.startsWith('取消不建账-'))).toBe(false);
    expect(after.find((book) => book.id === original.bookId)).toEqual(before);
    expect(after.filter((book) => book.name.startsWith(prefix))).toEqual(originals);
    await page.reload();
    await page.getByRole('textbox', { name: '搜索账套' }).fill(original.bookId);
    await page.getByRole('button', { name: '刷新列表', exact: true }).click();
    await page.getByRole('row', { name: new RegExp(original.bookId) }).dblclick();
    await expect(page).toHaveURL(new RegExp(`/login/${original.bookId}$`));
  } finally {
    await attachPointers();
  }
});

test('w_tzjl_1_new：有效表单确认和退场期间的程序性重复创建不提交', async ({
  page,
  request,
}, info) => {
  const attachPointers = await probeModalPointers(page, info);
  let creates = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('core.books.create')) creates++;
  });
  try {
    const original = await createBook(request, { name: `有效取消原账套-${Date.now()}` });
    const name = `有效取消-${original.bookId}`;
    await page.goto('/');
    await page.getByRole('textbox', { name: '搜索账套' }).fill(original.bookId);
    await page.getByRole('row', { name: new RegExp(original.bookId) }).click();
    await page.getByRole('button', { name: '新建账套', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
    const confirmation = page.getByRole('dialog', { name: '放弃未提交的新建账套内容？' });
    await fillValidWizard(wizard, name);
    const create = wizard.getByRole('button', { name: '创建', exact: true });
    await wizard.getByRole('button', { name: '取消', exact: true }).click();
    await expect(confirmation).toHaveCount(1);
    const blockedDuringConfirmation = await create.isDisabled();
    // 程序性事件压力；真实指针继续编辑/放弃和双击取消由上一用例覆盖。
    await create.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await clickModalAction(confirmation, '继续编辑');
    await expect(confirmation).toHaveCount(0);
    const afterAttempt = await callApi<BookSummary[]>(request, 'core.books.list');
    expect(creates).toBe(0);
    expect(blockedDuringConfirmation).toBe(true);
    expect(afterAttempt.some((book) => book.name === name)).toBe(false);
    await expect(create).toBeEnabled();
    await wizard.getByRole('button', { name: '取消', exact: true }).click();
    // 在放弃按钮的真实点击回调后同一轮事件内再尝试创建，覆盖退场锁。
    const retiringCreate = await create.elementHandle();
    expect(retiringCreate).not.toBeNull();
    await retiringCreate!.evaluate((button: HTMLButtonElement) => {
      button.dataset.retirementCreateAttempts = '0';
      const tryCreate = (event: MouseEvent) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('button')?.textContent?.trim() !== '放弃创建') return;
        document.removeEventListener('click', tryCreate, true);
        queueMicrotask(() => {
          button.dataset.retirementCreateAttempts = '1';
          button.click();
          button.dataset.retirementCreateAttempts = '2';
          button.click();
        });
      };
      document.addEventListener('click', tryCreate, true);
    });
    await clickModalAction(confirmation, '放弃创建');
    await expect(wizard).toHaveCount(0);
    await expect(confirmation).toHaveCount(0);
    expect(
      await retiringCreate!.evaluate((button) => button.dataset.retirementCreateAttempts),
    ).toBe('2');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('row', { selected: true })).toContainText(original.bookId);
    const after = await callApi<BookSummary[]>(request, 'core.books.list');
    expect(creates).toBe(0);
    expect(after.some((book) => book.name === name)).toBe(false);
    expect(after.find((book) => book.id === original.bookId)).toEqual(
      afterAttempt.find((book) => book.id === original.bookId),
    );
  } finally {
    await info.attach('actual-page-create-request-count', {
      body: String(creates),
      contentType: 'text/plain',
    });
    await attachPointers();
  }
});
