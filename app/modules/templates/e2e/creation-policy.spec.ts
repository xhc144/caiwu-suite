import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { callApi } from '@caiwu/testkit/e2e';
import type { Account, BookInfo } from '@caiwu/core';
import type { TemplateCreationResult } from '../shared';

test('w_xt_kgzb_a2 / a5 / 3：HTTP建账前复检日期和担保选择；修正后真实建账登录重开', async ({
  page,
  request,
}) => {
  const name = `适用性-${randomUUID().slice(0, 8)}`;
  const facts = {
    guaranteeStandard: 'cas25',
    financialGuaranteeContract: true,
    designatedAtFairValue: false,
    previouslyAssertedInsurance: true,
    usedInsuranceAccounting: true,
    irrevocableContractElection: true,
  };
  const input = {
    name,
    orgName: '合成担保单位',
    product: 'qingsong',
    templateId: 'financing-guarantee-cas25-2026',
    startYear: 2025,
    startMonth: 12,
    adminPassword: 'policy-password',
    requestKey: randomUUID(),
    facts,
  };
  const preview = await callApi<TemplateCreationResult>(
    request,
    'm.templates.checkCreation',
    input,
    { method: 'GET' },
  );
  expect(preview.allowed).toBe(false);
  await expect(callApi(request, 'm.templates.createBook', input)).rejects.toThrow(
    '不能用于2025-12-01',
  );
  await expect(
    callApi(request, 'm.templates.createBook', { ...input, startYear: 2026, facts: undefined }),
  ).rejects.toThrow('核算准则');
  const list = await callApi<BookInfo[]>(request, 'core.books.list');
  expect(list.some((b) => b.name === name)).toBe(false);
  const book = await callApi<BookInfo>(request, 'm.templates.createBook', {
    ...input,
    startYear: 2026,
  });
  const retry = await callApi<BookInfo>(request, 'm.templates.createBook', {
    ...input,
    startYear: 2026,
  });
  expect(retry.id).toBe(book.id);
  await page.goto(`/login/${book.id}`);
  await page.getByLabel('密码', { exact: true }).fill('policy-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/home');
  const session = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('caiwu.session')!) as { token: string },
  );
  const rows = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
    token: session.token,
  });
  expect(rows.find((a) => a.code === '2603')?.disabled).toBe(false);
  await page.reload();
  expect(await callApi(request, 'core.accounts.list', undefined, { token: session.token })).toEqual(
    rows,
  );
});

test('w_xt_kgzb_a2 / a3：居民医保现行替代出现在向导，按三级建账后读取规定明细', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建账套', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
  await wizard.getByLabel('账套名称', { exact: true }).fill(`居民医保-${randomUUID().slice(0, 8)}`);
  await wizard.getByLabel('单位名称', { exact: true }).fill('合成医保经办机构');
  await wizard.getByLabel('管理员密码').fill('medical-password');
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByRole('radio', { name: /^城乡居民基本医疗保险基金/ }).check();
  await wizard.getByRole('button', { name: '下一步' }).click();
  await expect(wizard.getByLabel('科目级次', { exact: true })).toHaveValue('4-2-2');
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByLabel('启用年份', { exact: true }).fill('2026');
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(/\/login\//);
  await page.getByLabel('密码', { exact: true }).fill('medical-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/home');
  const session = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('caiwu.session')!) as { token: string },
  );
  const rows = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
    token: session.token,
  });
  expect(rows).toHaveLength(59);
  expect(rows.find((a) => a.code === '110102')).toMatchObject({
    name: '医保预付金',
    disabled: false,
    isLeaf: true,
  });
  expect(rows.find((a) => a.code === '200105')).toMatchObject({
    name: '待确认收入',
    disabled: true,
  });
  expect(rows.find((a) => a.code === '51010103')).toMatchObject({
    name: '盈余返还',
    categoryId: 'expense',
    isLeaf: true,
  });
});
