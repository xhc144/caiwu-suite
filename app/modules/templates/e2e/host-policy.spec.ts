import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { callApi } from '@caiwu/testkit/e2e';
import type { Account, BookInfo } from '@caiwu/core';

const cas25 = {
  guaranteeStandard: 'cas25',
  financialGuaranteeContract: true,
  designatedAtFairValue: false,
  previouslyAssertedInsurance: true,
  usedInsuranceAccounting: true,
  irrevocableContractElection: true,
};

for (const standard of ['cas22', 'cas25'] as const) {
  test(`w_xt_kgzb_a2 / 3：真实向导明确填写${standard}合同事实，合法建账、登录与重开`, async ({
    page,
    request,
  }) => {
    const name = `担保向导-${standard}-${randomUUID().slice(0, 8)}`;
    let submissions = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('core.books.create')) submissions++;
    });
    await page.goto('/');
    await page.getByRole('button', { name: '新建账套', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
    await wizard.getByLabel('账套名称', { exact: true }).fill(name);
    await wizard.getByLabel('单位名称', { exact: true }).fill('合成担保单位');
    await wizard.getByLabel('管理员密码').fill('guarantee-password');
    await wizard.getByRole('button', { name: '下一步' }).click();
    await wizard
      .getByRole('radio', {
        name: standard === 'cas25' ? /^融资担保企业（保险合同/ : /^融资担保企业（金融工具/,
      })
      .check();
    await wizard.getByRole('button', { name: '下一步' }).click();
    await wizard.getByRole('button', { name: '下一步' }).click();
    await wizard.getByLabel('启用年份', { exact: true }).fill('2026');
    await wizard
      .getByRole('radio', {
        name: standard === 'cas25' ? '保险合同准则' : '金融工具确认和计量准则',
        exact: true,
      })
      .check();
    for (const checkbox of await wizard.getByRole('checkbox').all()) await checkbox.check();
    await wizard.getByRole('button', { name: '下一步' }).click();
    await wizard.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page).toHaveURL(/\/login\//);
    const id = page.url().split('/').at(-1)!;
    await page.getByLabel('密码', { exact: true }).fill('guarantee-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/home');
    expect(submissions).toBe(1);
    const session = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('caiwu.session')!) as { token: string },
    );
    const rows = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
      token: session.token,
    });
    expect(
      rows.find((row) => row.code === (standard === 'cas25' ? '2603' : '280101'))?.disabled,
    ).toBe(false);
    await page.reload();
    expect(
      await callApi(request, 'core.accounts.list', undefined, { token: session.token }),
    ).toEqual(rows);
    const books = await callApi<BookInfo[]>(request, 'core.books.list');
    expect(books.filter((book) => book.name === name)).toMatchObject([
      { id, templateId: `financing-guarantee-${standard}-2026`, startPeriod: 202601 },
    ]);
  });
}

test('w_xt_kgzb_a2 / a5：HTTP直调core和模块都拒绝无效日期与条件，预检通过不能复用，列表不残留账套', async ({
  request,
}) => {
  const name = `宿主拒绝-${randomUUID()}`;
  const input = {
    name,
    orgName: '合成单位',
    templateId: 'financing-guarantee-cas25-2026',
    product: 'qingsong',
    startYear: 2026,
    startMonth: 1,
    facts: cas25,
    requestKey: randomUUID(),
  };
  expect(
    await callApi(request, 'm.templates.checkCreation', input, { method: 'GET' }),
  ).toMatchObject({ allowed: true });
  await expect(
    callApi(request, 'core.books.create', {
      ...input,
      facts: { ...cas25, usedInsuranceAccounting: 'true' },
    }),
  ).rejects.toThrow('制度适用条件格式不正确');
  for (const procedure of ['core.books.create', 'm.templates.createBook']) {
    await expect(callApi(request, procedure, { ...input, startYear: 2025 })).rejects.toThrow(
      '不能用于',
    );
    await expect(callApi(request, procedure, { ...input, startMonth: 0 })).rejects.toThrow();
    await expect(callApi(request, procedure, { ...input, facts: undefined })).rejects.toThrow(
      '核算准则',
    );
    await expect(
      callApi(request, procedure, {
        ...input,
        facts: { ...cas25, usedInsuranceAccounting: false },
      }),
    ).rejects.toThrow('保险合同口径');
    await expect(
      callApi(request, procedure, {
        ...input,
        templateId: 'school-canteen-anhui-2021',
        facts: undefined,
      }),
    ).rejects.toThrow('安徽省');
    await expect(
      callApi(request, procedure, {
        ...input,
        templateId: 'party-dues-jining-port-2021',
        facts: undefined,
      }),
    ).rejects.toThrow('仅供参考');
  }
  const books = await callApi<BookInfo[]>(request, 'core.books.list');
  expect(books.filter((book) => book.name === name)).toEqual([]);
});

test('w_xt_kgzb_a2 / a5：真实向导拒绝日期和担保事实，切换制度清空事实，取消不建账', async ({
  page,
  request,
}) => {
  const name = `向导拒绝-${randomUUID()}`;
  let submissions = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('core.books.create')) submissions++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新建账套', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: '新建账套', exact: true });
  await wizard.getByLabel('账套名称', { exact: true }).fill(name);
  await wizard.getByLabel('单位名称', { exact: true }).fill('合成单位');
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByRole('radio', { name: /^城乡居民基本医疗保险基金/ }).check();
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByLabel('启用年份', { exact: true }).fill('2025');
  await wizard.getByRole('button', { name: '创建', exact: true }).click();
  await expect(
    wizard.getByRole('alert').filter({ hasText: '不能用于2025-01-01' }).first(),
  ).toBeVisible();
  expect(submissions).toBe(0);
  await wizard.getByRole('button', { name: '上一步' }).click();
  await wizard.getByRole('button', { name: '上一步' }).click();
  await wizard.getByRole('radio', { name: /^融资担保企业（保险合同/ }).check();
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByLabel('启用年份', { exact: true }).fill('2026');
  await expect(wizard.getByRole('radio', { name: '保险合同准则', exact: true })).not.toBeChecked();
  await wizard.getByRole('button', { name: '创建', exact: true }).click();
  await expect(wizard.getByRole('alert').filter({ hasText: '核算准则' }).first()).toBeVisible();
  expect(submissions).toBe(0);
  await wizard.getByRole('radio', { name: '保险合同准则', exact: true }).check();
  for (const checkbox of await wizard.getByRole('checkbox').all()) await checkbox.check();
  await wizard.getByLabel('启用年份', { exact: true }).fill('2025');
  await wizard.getByRole('button', { name: '创建', exact: true }).click();
  await expect(
    wizard.getByRole('alert').filter({ hasText: '不能用于2025-01-01' }).first(),
  ).toBeVisible();
  expect(submissions).toBe(0);
  await wizard.getByRole('button', { name: '上一步' }).click();
  await wizard.getByRole('button', { name: '上一步' }).click();
  await wizard.getByRole('radio', { name: /^融资担保企业（金融工具/ }).check();
  await wizard.getByRole('button', { name: '下一步' }).click();
  await wizard.getByRole('button', { name: '下一步' }).click();
  await expect(
    wizard.getByRole('radio', { name: '金融工具确认和计量准则', exact: true }),
  ).not.toBeChecked();
  for (const checkbox of await wizard.getByRole('checkbox').all())
    await expect(checkbox).not.toBeChecked();
  await wizard.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃创建', exact: true }).click();
  await expect(wizard).toHaveCount(0);
  expect(submissions).toBe(0);
  expect(
    (await callApi<BookInfo[]>(request, 'core.books.list')).filter((book) => book.name === name),
  ).toEqual([]);
});
