import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import ExcelJS from 'exceljs';

async function references(request: APIRequestContext, token: string) {
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    {},
    { token, method: 'GET' },
  );
  for (const [kind, account] of [
    ['category', '1601'],
    ['purpose', '6602'],
    ['status', ''],
  ] as const)
    await callApi(
      request,
      'm.fixed-assets.saveMaster',
      {
        data: {
          kind,
          code: '01',
          name: kind === 'category' ? '设备类' : kind === 'purpose' ? '管理用' : '在用',
          accountId: accounts.find((a) => a.code === account)?.id ?? null,
        },
      },
      { token, method: 'POST' },
    );
}
function fill(workbook: ExcelJS.Workbook) {
  workbook.worksheets[0]!.addRow([
    '0001',
    '旧账设备',
    '01',
    '01',
    '01',
    '01',
    '2025-01-01',
    '2025-01-01',
    '6000.01',
    '0',
    '1',
    '60',
    '100.02',
    '1',
    '0',
    '0',
    '型号保留',
    '台',
    '1',
    '否',
    '',
    '参考001',
  ]);
  workbook
    .getWorksheet('附属设备')!
    .addRow(['0001', '000A', '旧账硬盘', '0.1', '0.2', '原始配件说明']);
}

test('W2-19 w_xt_kgzb_zc/w_zcgl_kp_fssb：真实双表Excel→逐行预览→原子入库→导出回导→差异拒绝', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  await references(request, token);
  const get = <T>(name: string, input: unknown = {}) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'GET' });
  await page.goto('/m/fixed-assets/opening');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 Excel 模板', exact: true }).click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await (await download).path())!);
  expect(workbook.worksheets.map((s) => s.name)).toEqual(['期初卡片', '附属设备']);
  fill(workbook);
  const upload = async () =>
    page.getByLabel('选择期初 Excel').setInputFiles({
      name: '旧账与配件.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    });
  workbook.getWorksheet('附属设备')!.getRow(2).getCell(1).value = '没有主卡片';
  await upload();
  await expect(page.getByText(/附属设备第 2 行.*唯一存在/)).toBeVisible();
  await expect(page.getByRole('button', { name: '确认期初入库', exact: true })).toHaveCount(0);
  expect(await get('list')).toEqual([]);
  workbook.getWorksheet('附属设备')!.getRow(2).getCell(1).value = '0001';
  await upload();
  await expect(page.getByRole('row', { name: /0001 旧账设备/ })).toContainText('待导入');
  await expect(page.getByRole('row', { name: /000A 旧账硬盘/ })).toContainText('原始配件说明');
  await page.getByRole('button', { name: '确认期初入库', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).last().click();
  await expect(page.getByText('导入 1 张，跳过 0 张', { exact: true })).toBeVisible();
  const cards = await get<{ id: number; code: string }[]>('list');
  expect(cards.map((c) => c.code)).toEqual(['0001']);
  const old = await get<{
    card: { original: number; depreciation: number };
    accessories: { amount: number; code: string; note: string }[];
  }>('detail', { id: cards[0]!.id });
  expect(old.card).toMatchObject({ original: 600001, depreciation: 10002 });
  expect(old.accessories[0]).toMatchObject({ amount: 2, code: '000A', note: '原始配件说明' });
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出期初卡片', exact: true }).click();
  const exportedFile = await exported;
  const check = new ExcelJS.Workbook();
  await check.xlsx.readFile((await exportedFile.path())!);
  expect(check.getWorksheet('附属设备')!.getRow(2).values).toEqual([
    undefined,
    '0001',
    '000A',
    '旧账硬盘',
    '0.1',
    '0.2',
    '原始配件说明',
  ]);
  await page.getByLabel('选择期初 Excel').setInputFiles((await exportedFile.path())!);
  await expect(page.getByRole('row', { name: /0001 旧账设备/ })).toContainText('已存在，跳过');
  await page.getByRole('button', { name: '确认期初入库', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).last().click();
  await expect(page.getByText('导入 0 张，跳过 1 张', { exact: true })).toBeVisible();
  workbook.getWorksheet('附属设备')!.getRow(2).getCell(5).value = '0.3';
  await upload();
  await expect(page.getByRole('row', { name: /0001 旧账设备/ })).toContainText('禁止覆盖');
  await page.getByRole('button', { name: '确认期初入库', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).last().click();
  await expect(page.getByText('导入文件存在逐行错误', { exact: true })).toBeVisible();
  expect(await get('detail', { id: cards[0]!.id })).toEqual(old);
  await page.getByLabel('选择期初 Excel').setInputFiles([]);
  await expect(page.getByRole('button', { name: '确认期初入库', exact: true })).toHaveCount(0);
});

test('W2-19：选择坏文件清除旧预览，先前挂起的预览返回后也不能恢复确认入口', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request);
  await references(request, token);
  await page.goto('/m/fixed-assets/opening');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 Excel 模板', exact: true }).click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await (await download).path())!);
  fill(workbook);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const started = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route('**/trpc/m.fixed-assets.importPreview*', async (route) => {
    captured();
    await pending;
    await route.continue();
  });
  try {
    await page.getByLabel('选择期初 Excel').setInputFiles({
      name: '先选的有效文件.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    });
    await started;
    await expect(page.getByRole('status')).toContainText('正在读取文件');
    await page.getByLabel('选择期初 Excel').setInputFiles({
      name: '后选的坏文件.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('不是 Excel'),
    });
    await expect(
      page.getByRole('alert').filter({ hasText: /zip|central directory|Excel/i }),
    ).toBeVisible();
    const response = page.waitForResponse((r) => r.url().includes('m.fixed-assets.importPreview'));
    release();
    expect((await response).ok()).toBe(true);
    await expect(page.getByRole('button', { name: '确认期初入库', exact: true })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /0001 旧账设备/ })).toHaveCount(0);
    expect(await callApi(request, 'm.fixed-assets.list', {}, { token, method: 'GET' })).toEqual([]);
  } finally {
    release();
  }
});

async function printed(page: Page, button: string) {
  const events = await page.evaluateHandle(() => {
    const result: { phase: string; trusted: boolean; text: string; html: string }[] = [];
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations)
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLIFrameElement)) continue;
          node.addEventListener(
            'load',
            () => {
              for (const phase of ['beforeprint', 'afterprint'])
                node.contentWindow!.addEventListener(
                  phase,
                  (event) => {
                    result.push({
                      phase,
                      trusted: event.isTrusted,
                      text: node.contentDocument!.body.textContent!,
                      html: node.contentDocument!.body.innerHTML,
                    });
                    if (phase === 'afterprint') observer.disconnect();
                  },
                  { once: true },
                );
            },
            { capture: true, once: true },
          );
        }
    });
    observer.observe(document.body, { childList: true });
    return result;
  });
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect
    .poll(() => events.evaluate((records) => records.map((r) => r.phase)))
    .toEqual(['beforeprint', 'afterprint']);
  const records = await events.jsonValue();
  expect(records.every((r) => r.trusted)).toBe(true);
  await expect(page.locator('iframe')).toHaveCount(0);
  await events.dispose();
  return records[0]!;
}

test('W2-19 w_zjgl/w_zjgl_fb：明细与分布原生打印、零折旧筛选、空结果禁止打印', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request);
  await references(request, token);
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'POST' });
  const get = <T>(name: string, input: unknown = {}) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'GET' });
  const masters = await get<{ id: number; kind: string }[]>('masters');
  const departments = await callApi<{ id: number; code: string }[]>(
    request,
    'core.dimensions.items',
    { type: 'department' },
    { token, method: 'GET' },
  );
  for (const [code, name, date] of [
    ['P1', '<script>打印设备</script>', '2026-01-01'],
    ['P2', '当月零折旧设备', '2026-02-01'],
  ])
    await post('save', {
      data: {
        code,
        name,
        acquired: date,
        useDate: date,
        original: 600000,
        rate: '0',
        method: '1',
        lifeMonths: 60,
        categoryId: masters.find((m) => m.kind === 'category')!.id,
        purposeId: masters.find((m) => m.kind === 'purpose')!.id,
        statusId: masters.find((m) => m.kind === 'status')!.id,
        departmentId: departments.find((d) => d.code === '01')!.id,
      },
    });
  const preview = await get<{ token: string }>('preview', { period: 202602 });
  await post('depreciate', { period: 202602, token: preview.token, confirm: true });
  await page.goto('/m/fixed-assets/queries?from=202602&to=202602');
  await expect(page.getByText('明细合计：100.00 元', { exact: true })).toBeVisible();
  const detail = await printed(page, '打印折旧明细');
  expect(detail.text).toContain('202602 至 202602');
  expect(detail.text).toContain('<script>打印设备</script>');
  expect(detail.html).toContain('&lt;script&gt;打印设备&lt;/script&gt;');
  expect(detail.text).toContain('合计：100.00 元；共 1 条');
  expect(detail.text).not.toContain('当月零折旧设备');
  const distribution = await printed(page, '打印折旧分布表');
  expect(distribution.text).toContain('折旧分布表');
  expect(distribution.text).toContain('设备类');
  expect(distribution.text).toContain('合计：100.00 元；共 1 条');
  await page.getByLabel('显示零折旧').check();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('row', { name: /当月零折旧设备/ })).toBeVisible();
  expect((await printed(page, '打印折旧明细')).text).toContain('合计：100.00 元；共 2 条');
  await page.getByLabel('起始月份').fill('202603');
  await page.getByLabel('截止月份').fill('202603');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('明细合计：0.00 元', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打印折旧明细', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '打印折旧分布表', exact: true })).toBeDisabled();
});
