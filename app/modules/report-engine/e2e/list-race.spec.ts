import { expect, test } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { emptyTemplate } from '../shared';

test('w_bb_get 引入完成时首个空列表仍在返回途中，取消旧查询后显示实际新增报表', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request);
  let fetched!: () => void;
  let release!: () => void;
  const firstResponse = new Promise<void>((resolve) => (fetched = resolve));
  const delayed = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  // 保留真实HTTP响应，仅延迟首个空列表，重现导入已完成而初次查询尚未返回的顺序。
  await page.route(/\/trpc\/.*m\.report-engine\.list/, async (route) => {
    const response = await route.fetch();
    if (first) {
      first = false;
      fetched();
      await delayed;
    }
    await route.fulfill({ response });
  });
  try {
    await page.goto('/m/report-engine');
    await firstResponse;
    const template = emptyTemplate({ code: '913', name: '虚构网络延迟引入报表', rows: 3, cols: 3 });
    await page.getByLabel('引入JSON模板').setInputFiles({
      name: '913.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(template)),
    });
    await expect(page.getByText('已引入报表模板', { exact: true })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: template.name });
    await expect(row).toBeVisible();
    release();
    await expect(row).toBeVisible();
  } finally {
    release();
  }
});
