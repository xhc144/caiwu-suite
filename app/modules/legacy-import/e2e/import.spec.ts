import { test, expect } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { syntheticInput } from '../sample';
import type { SourceCounts } from '../shared';

test('独立新账：自建 CSV → 映射 → 真实回滚预检 → 提交 → 来源与期初/余额/凭证对照', async ({
  page,
  request,
}) => {
  const session = await loginWithNewBook(page, request, { seed: false });
  const input = syntheticInput();
  await page.goto('/m/legacy-import/');
  await expect(page.getByText('不支持原版 .bak / .db / .acd')).toBeVisible();
  await page.getByLabel('来源文件', { exact: true }).setInputFiles(
    input.files.map((f) => ({
      name: f.name,
      mimeType: 'text/csv',
      buffer: Buffer.from(f.base64, 'base64'),
    })),
  );
  await page.getByRole('button', { name: '读取与映射', exact: true }).click();
  await expect(page.getByText('2. 核对字段映射和来源计数')).toBeVisible();
  const labels: Record<keyof SourceCounts, string> = {
    accounts: '科目行数',
    opening: '期初行数',
    vouchers: '凭证张数',
    lines: '分录行数',
    balances: '余额行数',
  };
  for (const [key, label] of Object.entries(labels))
    await page
      .getByLabel(label, { exact: true })
      .fill(String(input.expected[key as keyof SourceCounts]));
  await page.getByRole('button', { name: '全量事务预检', exact: true }).click();
  await expect(page.getByText(/全量演练及回读通过/)).toBeVisible();
  const before = await callApi<{ total: number }>(
    request,
    'core.vouchers.list',
    {},
    { token: session.token },
  );
  expect(before.total).toBe(0);
  await page.getByLabel('导入确认文字', { exact: true }).fill(`导入 ${session.bookName}`);
  await page.getByRole('button', { name: '确认导入新空账', exact: true }).click();
  await expect(page.getByText('导入完成，来源与目标核对一致')).toBeVisible();
  await expect(page.getByText(/保留目标模板额外科目/)).toBeVisible();
  await expect(page.getByText(/来源 SYN-001 → 记-7/)).toBeVisible();
  const vouchers = await callApi<{
    total: number;
    items: { id: number; number: number; status: string; source: { module: string } }[];
  }>(request, 'core.vouchers.list', {}, { token: session.token });
  expect(vouchers.total).toBe(1);
  expect(vouchers.items[0]).toMatchObject({
    number: 7,
    status: 'pending',
    source: { module: 'legacy-import' },
  });
  const balances = await callApi<{ accountCode: string; opening: number; closing: number }[]>(
    request,
    'core.ledger.balances',
    {
      periodFrom: 202601,
      periodTo: 202601,
      includeUnposted: true,
      rollup: false,
      accountCodes: ['9998', '9999'],
    },
    { token: session.token, method: 'GET' },
  );
  expect(
    balances.map((b) => ({ code: b.accountCode, opening: b.opening, closing: b.closing })),
  ).toEqual([
    { code: '9998', opening: 100000, closing: 112345 },
    { code: '9999', opening: -100000, closing: -112345 },
  ]);
  await page.reload();
  await expect(page.getByText('导入完成，来源与目标核对一致')).toBeVisible();
});

test('独立 Excel：下载的虚构示例经完整页面导入；未知字段不会被忽略', async ({ page, request }) => {
  const session = await loginWithNewBook(page, request, { seed: false });
  await page.goto('/m/legacy-import/');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载虚构示例 Excel' }).click();
  const download = await downloading;
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  await page.getByLabel('来源文件', { exact: true }).setInputFiles({
    name: '标准化导入.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await import('node:fs/promises').then((fs) => fs.readFile(filePath!)),
  });
  await page.getByRole('button', { name: '读取与映射', exact: true }).click();
  await expect(page.getByText('2. 核对字段映射和来源计数')).toBeVisible();
  for (const [label, count] of [
    ['科目行数', 2],
    ['期初行数', 2],
    ['凭证张数', 1],
    ['分录行数', 2],
    ['余额行数', 2],
  ] as const)
    await page.getByLabel(label, { exact: true }).fill(String(count));
  await page.getByRole('button', { name: '全量事务预检', exact: true }).click();
  await expect(page.getByText(/全量演练及回读通过/)).toBeVisible();

  await page.getByLabel('导入确认文字', { exact: true }).fill(`导入 ${session.bookName}`);
  await page.getByRole('button', { name: '确认导入新空账', exact: true }).click();
  await expect(page.getByText('导入完成，来源与目标核对一致')).toBeVisible();

  const invalid = syntheticInput();
  const accounts = invalid.files[0]!;
  const text = Buffer.from(accounts.base64, 'base64').toString('utf8').split('\r\n');
  text[0] += ',未支持字段';
  text[1] += ',未知';
  text[2] += ',未知';
  accounts.base64 = Buffer.from(text.join('\r\n')).toString('base64');
  await page.getByLabel('来源文件', { exact: true }).setInputFiles(
    invalid.files.map((f) => ({
      name: f.name,
      mimeType: 'text/csv',
      buffer: Buffer.from(f.base64, 'base64'),
    })),
  );
  await expect(page.getByRole('button', { name: '确认导入新空账', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '读取与映射', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: '未支持字段', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全量事务预检', exact: true }).click();
  await expect(page.getByText(/存在未覆盖字段：未支持字段/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '确认导入新空账', exact: true })).toHaveCount(0);
});
