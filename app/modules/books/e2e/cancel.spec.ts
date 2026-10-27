import { expect, test } from '@playwright/test';
import { callApi, createBook } from '@caiwu/testkit/e2e';
import type { BookSummary } from '@caiwu/core';
import { clickModalAction, probeModalPointers } from './pointer-probe';

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
    const open = page.getByRole('button', { name: '新建账套', exact: true });
    const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
    const confirmation = page.getByRole('dialog', { name: '放弃未提交的新建账套内容？' });
    for (let attempt = 0; attempt < 2; attempt++) {
      await open.click();
      await wizard.getByRole('button', { name: '取消', exact: true }).dblclick();
      await expect(wizard).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await open.click();
      const name = `取消不建账-${Date.now()}-${attempt}`;
      await wizard.getByLabel('账套名称', { exact: true }).fill(name);
      await wizard.getByRole('button', { name: '取消', exact: true }).dblclick();
      await expect(confirmation).toHaveCount(1);
      await clickModalAction(confirmation, '继续编辑');
      // 保持真实退场动画；确认框彻底移除后才定位仍打开的向导。
      await expect(confirmation).toHaveCount(0);
      await expect(wizard.getByLabel('账套名称', { exact: true })).toHaveValue(name);
      await wizard.getByRole('button', { name: '取消', exact: true }).dblclick();
      await expect(confirmation).toHaveCount(1);
      await clickModalAction(confirmation, '放弃创建');
      await expect(confirmation).toHaveCount(0);
      await expect(wizard).toHaveCount(0);
      await page.getByRole('textbox', { name: '搜索账套' }).fill(name);
      await expect(page.getByText('没有匹配的账套，请修改搜索内容')).toBeVisible();
    }
    await open.click();
    await wizard.getByLabel('账套名称', { exact: true }).fill('快速键盘取消');
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(1);
    await clickModalAction(confirmation, '继续编辑');
    await expect(confirmation).toHaveCount(0);
    await expect(wizard.getByLabel('账套名称', { exact: true })).toHaveValue('快速键盘取消');
    await wizard.getByRole('button', { name: '取消', exact: true }).dblclick();
    await clickModalAction(confirmation, '放弃创建');
    await expect(confirmation).toHaveCount(0);
    await expect(wizard).toHaveCount(0);
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
