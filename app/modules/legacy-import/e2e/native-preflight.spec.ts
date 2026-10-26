import { test, expect } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { createHash } from 'node:crypto';
import { syntheticNative } from '../native-sample';
import type { NativeReport } from '../native';

// Production web + real HTTP/tRPC + SQLite; all account data is invented.
test('w_pz_get 原生结构：真实文件预检、阻断报告及下载；HTTP异常不写账或生成批次', async ({
  page,
  request,
}) => {
  const session = await loginWithNewBook(page, request, { seed: false });
  const opts = { token: session.token };
  const state = async () =>
    Promise.all([
      callApi(request, 'core.accounts.list', undefined, opts),
      callApi(request, 'core.vouchers.list', { includeVoided: true }, opts),
      callApi(
        request,
        'core.ledger.balances',
        { periodFrom: 202601, periodTo: 202601, includeUnposted: true, rollup: false },
        opts,
      ),
      callApi(request, 'm.legacy-import.list', undefined, opts),
    ]);
  const before = await state();
  const writeRequests: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /m\.legacy-import\.(prepare|execute)/.test(r.url()))
      writeRequests.push(r.url());
  });
  await page.goto('/m/legacy-import/native');
  await expect(
    page.getByText(
      '原生数据尚未完成迁移；所有目标账务零变化。本入口仅作结构预检，不提供正式写账。',
      { exact: true },
    ),
  ).toBeVisible();
  const doc = syntheticNative();
  const text = JSON.stringify(doc, null, 2);
  await page.getByLabel('明确表行文件', { exact: true }).setInputFiles({
    name: 'synthetic-native.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  await expect(page.getByLabel('原字段表行文本')).toHaveValue(text);
  await page.getByRole('button', { name: '执行原生结构预检', exact: true }).click();
  await expect(page.getByText('结构检查通过；迁移仍被阻断', { exact: true })).toBeVisible();
  await expect(
    page.getByText(createHash('sha256').update(text).digest('hex'), { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('0；没有可提交批次或正式写账操作', { exact: true })).toBeVisible();
  await page.getByText('四键连接与精确金额（整数分）', { exact: true }).click();
  await expect(page.getByRole('cell', { name: '2026/1/3/7', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '12345', exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '执行原生结构预检', exact: true })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await page.screenshot({ path: test.info().outputPath('native-normal.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载完整预检报告', exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const report = JSON.parse(Buffer.concat(chunks).toString('utf8')) as NativeReport;
  expect(report).toMatchObject({
    structurePassed: true,
    migrationAllowed: false,
    targetChanges: 0,
  });
  expect(report.document).toEqual(doc);
  expect(report.source.sha256).toBe(createHash('sha256').update(text).digest('hex'));
  expect(report.vouchers[0]).toMatchObject({
    key: '2026/1/3/7',
    debitCents: '12345',
    creditCents: '12345',
  });
  expect(await state()).toEqual(before);
  // New input clears the previous report immediately and does not restore submit eligibility.
  const bad = syntheticNative('saveas0');
  await page.getByLabel('原字段表行文本').fill(JSON.stringify(bad));
  await expect(page.getByRole('button', { name: '下载完整预检报告', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '执行原生结构预检', exact: true }).click();
  await expect(page.getByText('结构检查未通过；迁移被阻断', { exact: true })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('native-saveas0-blocked.png'),
    fullPage: true,
  });
  await page.getByText('逐字段覆盖清单', { exact: true }).click();
  await expect(page.getByText('固定字段识别', { exact: true })).toBeVisible();
  expect(await state()).toEqual(before);
  const invalid = syntheticNative();
  const pz = invalid.tables.find((t) => t.name === 'pz')!;
  pz.rows[0]![pz.columns.indexOf('pz_jf')] = '123.451';
  await page.getByLabel('原字段表行文本').fill(JSON.stringify(invalid));
  await page.getByRole('button', { name: '执行原生结构预检', exact: true }).click();
  await expect(
    page.getByText('单位或精度检查未通过，或因结构缺失未完成校验', { exact: true }),
  ).toBeVisible();
  const viaHttp = await callApi<NativeReport>(
    request,
    'm.legacy-import.nativePreflight',
    { name: 'bad-decimal.json', text: JSON.stringify(invalid) },
    opts,
  );
  expect(viaHttp.issues.map((i) => i.code)).toContain('AMOUNT_PRECISION');
  expect(viaHttp.vouchers[0]!.debitCents).toBeNull();
  expect(viaHttp.textAmountsPassed).toBe(false);
  expect(viaHttp).toMatchObject({ migrationAllowed: false, targetChanges: 0 });
  const unknownBytes = await callApi<NativeReport>(
    request,
    'm.legacy-import.nativePreflight',
    { name: 'unknown-export.txt', text: 'original ~t unknown escape' },
    opts,
  );
  expect(unknownBytes.structurePassed).toBe(false);
  expect(unknownBytes.issues[0]!.code).toBe('EXPLICIT_ROWS_REQUIRED');
  expect(await state()).toEqual(before);
  expect(writeRequests).toEqual([]);
  await expect(page.getByRole('button', { name: '确认导入新空账', exact: true })).toHaveCount(0);
});

test('原生预检真实 UI：未知编码拒绝；虚构示例按钮会填真实请求并显示状态阻断', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request, { seed: false });
  await page.goto('/m/legacy-import/native');
  await page.getByLabel('明确表行文件', { exact: true }).setInputFiles({
    name: 'unknown.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from([0xff, 0xfe, 0x81]),
  });
  await expect(
    page.getByText('文件不是有效 UTF-8 明确表行；原编码或转义未知，不能声称兼容。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '执行原生结构预检', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '填入虚构示例', exact: true }).click();
  await page.getByRole('button', { name: '执行原生结构预检', exact: true }).click();
  await expect(page.getByText('结构检查通过；迁移仍被阻断', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell').filter({ hasText: '原规则禁止转入状态 1' })).toBeVisible();
});
