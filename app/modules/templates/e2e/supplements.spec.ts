import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Account, BookInfo, TemplateSummary } from '@caiwu/core';
import { callApi } from '@caiwu/testkit/e2e';

const cases = [
  { id: 'real-estate-enterprise', selection: /^房地产开发企业/, code: '500101' },
  { id: 'financing-guarantee-cas22-2026', selection: /^融资担保企业（金融工具/, code: '280101' },
  { id: 'financing-guarantee-cas25-2026', selection: /^融资担保企业（保险合同/, code: '2603' },
  { id: 'microloan-enterprise-cas22-2026', selection: /^小额贷款企业/, code: '130301' },
  { id: 'construction-cas-revenue-2017', selection: /^建筑施工企业/, code: '149001' },
  { id: 'construction-small-business-2013', selection: /^建筑施工小企业/, code: '440101' },
  { id: 'pawn-enterprise-cas-2021', selection: /^典当企业/, code: '1409' },
  {
    id: 'enterprise-infrastructure-cas',
    selection: /^企业基本建设|^企业基建|^基本建设.*企业/,
    code: '160401',
  },
];
for (const example of cases)
  for (const scheme of ['4-2-2', '4-3-3']) {
    test(`w_xt_kgzb_a2 / a3：${example.id} ${scheme}真实向导建账与重开`, async ({
      page,
      request,
    }) => {
      const summaries = await callApi<TemplateSummary[]>(
        request,
        'core.books.templates',
        undefined,
        { method: 'GET' },
      );
      const selected = summaries.find((t) => t.id === example.id)!;
      expect(selected.status).toBe('current');
      await page.goto('/');
      await page.getByRole('button', { name: '新建账套', exact: true }).click();
      const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
      await wizard
        .getByLabel('账套名称', { exact: true })
        .fill(`行业验证-${randomUUID().slice(0, 8)}`);
      await wizard.getByLabel('单位名称', { exact: true }).fill('合成行业单位');
      await wizard.getByLabel('管理员密码').fill('industry-test');
      await wizard.getByRole('button', { name: '下一步' }).click();
      await expect(wizard.getByRole('radio', { name: /党费专账/ })).toHaveCount(0);
      await expect(
        wizard.getByRole('radio', { name: /^融资担保企业（金融工具/ }),
      ).not.toBeChecked();
      await expect(
        wizard.getByRole('radio', { name: /^融资担保企业（保险合同/ }),
      ).not.toBeChecked();
      await wizard.getByRole('radio', { name: example.selection }).check();
      await wizard.getByRole('button', { name: '下一步' }).click();
      await wizard.getByLabel('科目级次', { exact: true }).fill(scheme);
      await wizard.getByRole('button', { name: '下一步' }).click();
      await wizard.getByLabel('启用年份', { exact: true }).fill('2026');
      if (example.id.startsWith('financing-guarantee-')) {
        await wizard
          .getByRole('radio', {
            name: example.id.includes('cas25') ? '保险合同准则' : '金融工具确认和计量准则',
            exact: true,
          })
          .check();
        for (const checkbox of await wizard.getByRole('checkbox').all()) await checkbox.check();
      }
      await wizard.getByRole('button', { name: '下一步' }).click();
      await wizard.getByRole('button', { name: '创建', exact: true }).click();
      await expect(page).toHaveURL(/\/login\//);
      const bookId = page.url().split('/').at(-1)!;
      await page.getByLabel('密码', { exact: true }).fill('industry-test');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page).toHaveURL('/home');
      const session = await page.evaluate(
        () => JSON.parse(sessionStorage.getItem('caiwu.session')!) as { token: string },
      );
      const rows = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
        token: session.token,
      });
      expect(rows).toHaveLength(selected.accountCount);
      let code = example.code.slice(0, 4);
      for (let i = 4; i < example.code.length; i += 2)
        code += example.code.slice(i, i + 2).padStart(scheme === '4-2-2' ? 2 : 3, '0');
      expect(rows.find((a) => a.code === code)).toMatchObject({ isLeaf: true, disabled: false });
      const info = await callApi<{ book: BookInfo }>(request, 'core.auth.me', undefined, {
        token: session.token,
      });
      expect(info.book).toMatchObject({
        id: bookId,
        templateId: example.id,
        codeScheme: scheme.split('-').map(Number),
      });
      await page.reload();
      expect(
        await callApi(request, 'core.accounts.list', undefined, { token: session.token }),
      ).toEqual(rows);
    });
  }
