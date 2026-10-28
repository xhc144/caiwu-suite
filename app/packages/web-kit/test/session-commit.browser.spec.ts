import { expect, test } from '@playwright/test';

test('w_pass：真实HTTP响应飞行及异步收尾期间，锁定同账套和portal，另一账套可提交', async ({
  page,
}) => {
  let respond!: () => void;
  let cleanup!: () => void;
  const response = new Promise<void>((resolve) => {
    respond = resolve;
  });
  const finalizing = new Promise<void>((resolve) => {
    cleanup = resolve;
  });
  await page.route('**/credential', async (route) => {
    await response;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/cleanup', async (route) => {
    await finalizing;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/packages/web-kit/test/browser/session-commit.html');
  await page.getByRole('button', { name: '改密', exact: true }).click();
  await expect(page.getByRole('status', { name: '正在保存登录信息' })).toBeVisible();
  await expect(page.getByLabel('凭据请求数')).toHaveText('1');
  await page.getByLabel('打印草稿').fill('飞行期间新编辑');
  await expect(page.getByLabel('打印草稿')).toHaveValue('已保存打印稿');
  await page.getByLabel('甲抽屉').click();
  await page.keyboard.type('portal-new-edit');
  await expect(page.getByLabel('甲抽屉')).toHaveValue('抽屉原稿');
  await page.getByLabel('甲表单').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.getByLabel('甲提交数')).toHaveText('0');
  await page.getByLabel('乙草稿').fill('另账套仍可编辑');
  await page.getByRole('button', { name: '乙提交' }).click();
  await expect(page.getByLabel('乙提交数')).toHaveText('1');
  respond();
  await expect(page.getByRole('status', { name: '正在保存登录信息' })).toBeVisible();
  await page.getByLabel('打印草稿').fill('收尾期间新编辑');
  await expect(page.getByLabel('打印草稿')).toHaveValue('已保存打印稿');
  cleanup();
  await expect(page.getByText('请重新登录')).toBeVisible();
  await expect(page.getByLabel('协调结果')).toHaveText('true/true');
  await expect(page.getByRole('status', { name: '正在保存登录信息' })).toHaveCount(0);
});

test('w_pass：真实HTTP失败后释放交互锁，保留原稿并允许继续编辑和提交', async ({ page }) => {
  let respond!: () => void;
  const response = new Promise<void>((resolve) => {
    respond = resolve;
  });
  await page.route('**/credential', async (route) => {
    await response;
    await route.fulfill({ status: 503, json: { ok: false } });
  });
  await page.goto('/packages/web-kit/test/browser/session-commit.html');
  await page.getByRole('button', { name: '改密', exact: true }).click();
  await expect(page.getByRole('status', { name: '正在保存登录信息' })).toBeVisible();
  await page.getByLabel('打印草稿').fill('不应写入');
  await expect(page.getByLabel('打印草稿')).toHaveValue('已保存打印稿');
  respond();
  await expect(page.getByRole('alert')).toHaveText('凭据写入失败');
  await expect(page.getByRole('status', { name: '正在保存登录信息' })).toHaveCount(0);
  await expect(page.getByLabel('打印草稿')).toHaveValue('已保存打印稿');
  await page.getByLabel('打印草稿').fill('失败后继续编辑');
  await page.getByRole('button', { name: '甲提交' }).click();
  await expect(page.getByLabel('甲提交数')).toHaveText('1');
  await expect(page.getByLabel('打印草稿')).toHaveValue('失败后继续编辑');
  await expect(page.getByLabel('协调结果')).toHaveText('false/false');
});
