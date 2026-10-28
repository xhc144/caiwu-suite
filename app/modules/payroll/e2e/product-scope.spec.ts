import { test, expect } from '@playwright/test';
import { E2E_APP_TOKEN, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS } from '../shared';

test('工资产品边界：轻松管理员真实HTTP读写都拒绝，民非与成本仍可保存和查询', async ({
  page,
  request,
}) => {
  for (const product of ['qingsong', 'minfei', 'chengben'] as const) {
    const { token } = await loginWithNewBook(page, request, { product });
    const headers = { 'x-caiwu-token': E2E_APP_TOKEN, authorization: `Bearer ${token}` };
    const read = await request.get('/trpc/m.payroll.categories', { headers });
    const write = await request.post('/trpc/m.payroll.saveCategory', {
      headers,
      data: { name: '合成产品边界工资', fields: DEFAULT_FIELDS },
    });
    if (product === 'qingsong') {
      expect(read.status()).toBe(400);
      expect(write.status()).toBe(400);
      for (const response of [read, write])
        expect(await response.json()).toMatchObject({
          error: { data: { business: { code: 'PAYROLL_PRODUCT' } } },
        });
      await page.goto('/m/payroll');
      await expect(page.getByText('页面不存在', { exact: false }).first()).toBeVisible();
      expect((await request.get('/trpc/m.payroll.categories', { headers })).status()).toBe(400);
    } else {
      expect(read.ok()).toBe(true);
      expect((await read.json()).result.data).toEqual([]);
      expect(write.ok()).toBe(true);
      const saved = (await write.json()).result.data;
      const after = await request.get('/trpc/m.payroll.categories', { headers });
      expect(after.ok()).toBe(true);
      expect((await after.json()).result.data).toEqual([saved]);
    }
  }
});
