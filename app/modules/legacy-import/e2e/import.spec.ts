import { test, expect } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { syntheticInput } from '../sample';
import type { SourceCounts } from '../shared';
import type { Page } from '@playwright/test';

async function prepareSource(page: Page, sourceId: string, amount = '123.45', closing = '1123.45') {
  const previous = new URL(page.url()).searchParams.get('id');
  const input = syntheticInput();
  await page.getByLabel('来源文件', { exact: true }).setInputFiles(
    input.files.map((f) => ({
      name: f.name,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        Buffer.from(f.base64, 'base64')
          .toString('utf8')
          .replaceAll('SYN-001', sourceId)
          .replaceAll('1123.45', closing)
          .replaceAll('123.45', amount),
      ),
    })),
  );
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
  await expect.poll(() => new URL(page.url()).searchParams.get('id')).not.toBe(previous);
  const id = new URL(page.url()).searchParams.get('id');
  expect(id).toBeTruthy();
  return id!;
}

test('P1 批次切换：A/B 来源和金额不同，选历史A后不能执行B；正确重预检A才可导入', async ({
  page,
  request,
}) => {
  const session = await loginWithNewBook(page, request, { seed: false });
  await page.goto('/m/legacy-import/');
  const coreState = async () =>
    Promise.all([
      callApi(request, 'core.accounts.list', undefined, { token: session.token }),
      callApi(request, 'core.vouchers.list', { includeVoided: true }, { token: session.token }),
      callApi(
        request,
        'core.ledger.balances',
        { periodFrom: 202601, periodTo: 202601, includeUnposted: true, rollup: false },
        { token: session.token },
      ),
    ]);
  const before = await coreState();
  const executes: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('m.legacy-import.execute'))
      executes.push(r.postData() ?? '');
  });
  const a = await prepareSource(page, 'A-SOURCE-001');
  const b = await prepareSource(page, 'B-SOURCE-002', '321.09', '1321.09');
  expect(a).not.toBe(b);
  const batchA = await callApi<{ createdAt: string }>(
    request,
    'm.legacy-import.get',
    { id: a },
    { token: session.token },
  );
  const batchB = await callApi<{ createdAt: string }>(
    request,
    'm.legacy-import.get',
    { id: b },
    { token: session.token },
  );
  await page.getByLabel('导入确认文字', { exact: true }).fill(`导入 ${session.bookName}`);
  await page.getByRole('button').filter({ hasText: batchA.createdAt }).click();
  await expect(page.getByRole('button', { name: '确认导入新空账', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '查看导入批次 ' + a, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('导入确认文字', { exact: true })).toHaveCount(0);
  await expect(page.locator('.ant-descriptions').getByText(a, { exact: true })).toBeVisible();
  expect(executes).toEqual([]);
  expect(await coreState()).toEqual(before);
  // 再点B也不能重新激活旧的确认文字/提交资格。
  await page.getByRole('button').filter({ hasText: batchB.createdAt }).click();
  await expect(page.getByRole('button', { name: '确认导入新空账', exact: true })).toHaveCount(0);
  expect(await coreState()).toEqual(before);
  const verifiedA = await prepareSource(page, 'A-SOURCE-001');
  expect(verifiedA).not.toBe(a);
  expect(verifiedA).not.toBe(b);
  await expect(
    page.getByText('来源凭证：A-SOURCE-001；借方合计：123.45', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('导入确认文字', { exact: true })).toHaveValue('');
  await page.getByLabel('导入确认文字', { exact: true }).fill(`导入 ${session.bookName}`);
  await page.getByRole('button', { name: '确认导入新空账', exact: true }).click();
  await expect(page.getByText('导入完成，来源与目标核对一致')).toBeVisible();
  expect(executes).toHaveLength(1);
  expect(executes[0]).toContain(verifiedA);
  expect(executes[0]).not.toContain(b);
  for (const old of [a, b]) {
    expect(
      await callApi(request, 'm.legacy-import.get', { id: old }, { token: session.token }),
    ).toMatchObject({ status: 'prepared' });
  }
  const result = await callApi(
    request,
    'm.legacy-import.get',
    { id: verifiedA },
    { token: session.token },
  );
  expect(result).toMatchObject({
    status: 'completed',
    plan: { vouchers: [{ sourceId: 'A-SOURCE-001' }] },
    reconciliation: {
      debitTotal: 12345,
      creditTotal: 12345,
      balances: [
        { code: '9998', closing: 112345 },
        { code: '9999', closing: -112345 },
      ],
    },
  });
});

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
