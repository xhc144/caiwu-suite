import { expect, test } from '@playwright/test';
import { callApi } from '@caiwu/testkit/e2e';
import type { Account, BookInfo } from '@caiwu/core';

for (const scheme of ['4-2-2', '4-3-3']) {
  test(`w_xt_kgzb_a2/1：企业完整科目${scheme}复核、创建、登录、重开；已有账套不补改`, async ({
    page,
    request,
  }) => {
    // 前置只用core；旧九项隔离由真实SQLite单测保留独立旧模板夹具验证。
    const old = await callApi<BookInfo>(request, 'core.books.create', {
      name: `已有小企业-${scheme}-${Date.now()}`,
      orgName: '合成旧单位',
      templateId: 'books-small-business',
      product: 'qingsong',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'old-pass',
    });
    const oldLogin = await callApi<{ token: string }>(request, 'core.auth.login', {
      bookId: old.id,
      userCode: 'admin',
      password: 'old-pass',
    });
    const before = await callApi<Account[]>(request, 'core.accounts.list', undefined, oldLogin);
    expect(before).toHaveLength(66);
    await expect(callApi(request, 'core.accounts.list')).rejects.toThrow(/登录/);

    await page.goto('/');
    await page.getByRole('button', { name: '新建账套', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
    await wizard.getByLabel('账套名称', { exact: true }).fill(`完整企业-${scheme}-${Date.now()}`);
    await wizard.getByLabel('单位名称', { exact: true }).fill('合成新单位');
    await wizard.getByLabel('管理员密码').fill('new-pass');
    await wizard.getByRole('button', { name: '下一步' }).click();
    const options = wizard.getByRole('radio');
    await expect(options.nth(0)).toHaveAccessibleName(/^企业会计准则/);
    await expect(options.nth(1)).toHaveAccessibleName(/^小企业会计准则/);
    await wizard.getByRole('radio', { name: /^企业会计准则/ }).check();
    await expect(wizard).toContainText('203项一级、45项明细，共248项');
    await expect(wizard.getByRole('alert').filter({ hasText: '待核科目' })).toHaveCount(0);
    await wizard.getByRole('button', { name: '下一步' }).click();
    await wizard.getByLabel('科目级次', { exact: true }).fill(scheme);
    await wizard.getByRole('button', { name: '下一步' }).click();
    await wizard.getByLabel('启用年份', { exact: true }).fill('2026');
    await wizard.getByLabel('启用月份', { exact: true }).fill('1');
    await wizard.getByRole('button', { name: '下一步' }).click();
    await expect(wizard).toContainText('最终复核');
    await wizard.getByText('查看将要建立的科目与依据', { exact: true }).click();
    await expect(wizard.getByRole('cell', { name: '库存现金', exact: true })).toBeVisible();
    let release!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let creates = 0;
    await page.route('**/trpc/core.books.create*', async (route) => {
      creates++;
      await responseGate;
      await route.continue();
    });
    await wizard.getByRole('button', { name: '创建', exact: true }).dblclick();
    await expect.poll(() => creates).toBe(1);
    release();
    await expect(page).toHaveURL(/\/login\//);
    expect(creates).toBe(1);
    expect(page.url()).not.toContain(old.id);
    const bookId = page.url().split('/').at(-1)!;
    await page.getByLabel('用户编号', { exact: true }).fill('admin');
    await page.getByLabel('密码', { exact: true }).fill('new-pass');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/home$/);
    const token = await page.evaluate(
      () => (JSON.parse(sessionStorage.getItem('caiwu.session')!) as { token: string }).token,
    );
    const accounts = await callApi<Account[]>(request, 'core.accounts.list', undefined, { token });
    expect(accounts).toHaveLength(248);
    expect(accounts.filter((a) => a.code.length === 4)).toHaveLength(203);
    expect(
      accounts.find((a) => a.code === (scheme === '4-2-2' ? '22210101' : '2221001001')),
    ).toMatchObject({ name: '进项税额', direction: 'debit' });
    const settlement = accounts.find((a) => a.code === '5402')!;
    const provenance = await callApi<{ isContra: boolean; source: string }>(
      request,
      'core.accounts.provenance',
      { id: settlement.id },
      { token, method: 'GET' },
    );
    expect(provenance.isContra).toBe(true);
    expect(provenance.source).toContain('第三项完工对冲工程施工');
    expect(
      (await callApi<{ book: BookInfo }>(request, 'core.auth.me', undefined, { token })).book,
    ).toMatchObject({
      templateId: 'books-enterprise-cas-2006',
      orgName: '合成新单位',
      codeScheme: scheme.split('-').map(Number),
    });
    await callApi(request, 'core.auth.logout', {}, { token });
    const reopened = await callApi<{ token: string }>(request, 'core.auth.login', {
      bookId,
      userCode: 'admin',
      password: 'new-pass',
    });
    expect(await callApi<Account[]>(request, 'core.accounts.list', undefined, reopened)).toEqual(
      accounts,
    );
    expect(await callApi<Account[]>(request, 'core.accounts.list', undefined, oldLogin)).toEqual(
      before,
    );
    expect(
      (await callApi<{ book: BookInfo }>(request, 'core.auth.me', undefined, oldLogin)).book,
    ).toEqual(old);
  });
}
