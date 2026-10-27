import { expect, test } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';

test('w_frame：两懒加载页，一脏一净关闭所有只列脏页；取消、保存失败保留，成功后统一关闭', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/example/shared/a');
  const active = () => page.getByRole('tabpanel').filter({ visible: true });
  await active().getByLabel('合成文本', { exact: true }).fill('需要保留的甲内容');
  await active().getByRole('button', { name: '打开乙编辑页' }).click();
  await expect(active().getByRole('heading', { name: '乙编辑页' })).toBeVisible();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '有未保存内容' });
  await expect(dialog.getByText('甲编辑页', { exact: true })).toBeVisible();
  await expect(dialog.getByText('乙编辑页', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect(page.getByRole('tab')).toHaveCount(3);
  await page.getByRole('tab', { name: '甲编辑页', exact: true }).click();
  await expect(active().getByLabel('合成文本', { exact: true })).toHaveValue('需要保留的甲内容');
  await active().getByLabel('模拟保存冲突').check();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '有未保存内容' });
  await dialog.getByRole('button', { name: '保存并继续' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(active().getByLabel('合成文本', { exact: true })).toHaveValue('需要保留的甲内容');
  await active().getByLabel('模拟保存冲突').uncheck();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await page
    .getByRole('dialog', { name: '有未保存内容' })
    .getByRole('button', { name: '保存并继续' })
    .click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page).toHaveURL(/\/home$/);
});

test('w_pz_pzedit：鼠标、Tab和程序focus金额全选，1000替换0.00', async ({ page, request }) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/example/shared/a');
  const input = page.getByLabel('合成金额', { exact: true });
  await input.click();
  await page.keyboard.type('1000');
  await expect(page.getByTestId('fixture-money')).toHaveText('100000');
  await page.getByRole('button', { name: '聚焦金额' }).click();
  await page.keyboard.type('-12.5');
  await expect(page.getByTestId('fixture-money')).toHaveText('-1250');
});

test('w_retrieve_wait：超过300ms有中文加载，刷新保留旧内容，取消清理', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request);
  await page.goto('/m/example/shared/a');
  const input = page.getByLabel('合成文本', { exact: true });
  await input.fill('刷新时保留');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/trpc/core.auth.me*', async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page.getByRole('button', { name: '刷新合成页面' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '正在加载或刷新，请稍候' }),
  ).toBeVisible();
  await expect(input).toHaveValue('刷新时保留');
  await page.getByRole('button', { name: '取消加载' }).click();
  release();
  await expect(page.getByRole('status').filter({ hasText: '正在加载或刷新，请稍候' })).toHaveCount(
    0,
  );
  await expect(input).toHaveValue('刷新时保留');
});
