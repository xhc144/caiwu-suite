import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook, E2E_APP_TOKEN } from '@caiwu/testkit/e2e';
import ExcelJS from 'exceljs';

/** 只使用 testkit、core 和本模块接口建立独立合成账套。 */
async function prepare(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'POST' });
  const department = await callApi<{ id: number; code: string }[]>(
    request,
    'core.dimensions.items',
    { type: 'department' },
    { token, method: 'GET' },
  );
  const categoryId = await post<number>('saveMaster', {
    data: { kind: 'category', code: '01', name: '设备类' },
  });
  const purposeId = await post<number>('saveMaster', {
    data: { kind: 'purpose', code: '01', name: '管理用' },
  });
  const statusId = await post<number>('saveMaster', {
    data: { kind: 'status', code: '01', name: '在用' },
  });
  for (const [code, name, original] of [
    ['A01', '服务器甲', 600000],
    ['A02', '服务器乙', 1200000],
    ['B01', '打印机', 600000],
  ] as const)
    await post('save', {
      data: {
        code,
        name,
        original,
        categoryId,
        purposeId,
        statusId,
        departmentId: department.find((d) => d.code === '01')!.id,
        acquired: '2026-01-01',
        useDate: '2026-01-01',
        rate: '0',
        method: '1',
        lifeMonths: 60,
      },
    });
  const preview = await callApi<{ token: string }>(
    request,
    'm.fixed-assets.preview',
    { period: 202602 },
    { token, method: 'GET' },
  );
  await post('depreciate', { period: 202602, token: preview.token, confirm: true });
  return token;
}

async function select(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').getByText(text, { exact: true }).click();
}

async function excelRows(page: Page, index: number) {
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /导出 Excel$/ })
    .nth(index)
    .click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await (await download).path())!);
  return workbook.worksheets[0]!.getSheetValues();
}

/** 捕获 Chromium 原生打印事件中的真实文档，不替换打印驱动。 */
async function observePrint(page: Page) {
  return page.evaluateHandle(() => {
    const events: { phase: string; trusted: boolean; text: string }[] = [];
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
                    events.push({
                      phase,
                      trusted: event.isTrusted,
                      text: node.contentDocument!.body.textContent!,
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
    return events;
  });
}

test('w_zjgl_cx：两条件交集、增删编辑、清除恢复、重载、Excel及原生打印同一口径', async ({
  page,
  request,
}) => {
  await prepare(page, request);
  await page.goto('/m/fixed-assets/queries');
  await expect(page.getByText('明细合计：400.00 元', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '增加条件', exact: true }).click();
  await select(page, '条件 1 字段', '名称');
  await select(page, '条件 1 操作符', '含有');
  await page.getByLabel('条件 1 值', { exact: true }).fill('服务器');
  await page.getByRole('button', { name: '增加条件', exact: true }).click();
  await select(page, '条件 2 字段', '折旧额（整数分）');
  await page.getByLabel('条件 2 值', { exact: true }).fill('10000');
  await page.getByLabel('起始月份', { exact: true }).fill('202602');
  await page.getByLabel('截止月份', { exact: true }).fill('202602');
  await page.getByRole('checkbox', { name: '显示零折旧', exact: true }).check();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('row', { name: /A01 服务器甲/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /A02|B01/ })).toHaveCount(0);
  await expect(page.getByText('明细合计：100.00 元', { exact: true })).toBeVisible();
  const details = await excelRows(page, 0);
  expect(details).toHaveLength(3);
  expect(details[1]).toEqual([
    undefined,
    '月份',
    '编号',
    '设备',
    '部门',
    '类别',
    '用途',
    '月工作量',
    '折旧额',
    '跳过或说明',
  ]);
  expect(details[2]).toEqual([
    undefined,
    202602,
    'A01',
    '服务器甲',
    '01 行政部',
    '01 设备类',
    '01 管理用',
    '0',
    100,
    '',
  ]);
  const distribution = await excelRows(page, 1);
  expect(distribution).toHaveLength(3);
  expect(distribution[2]).toEqual([undefined, '01 行政部 / 01 设备类', 100]);
  for (const label of ['打印折旧明细', '打印折旧分布表']) {
    const printed = await observePrint(page);
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect
      .poll(() => printed.evaluate((events) => events.map((e) => e.phase)))
      .toEqual(['beforeprint', 'afterprint']);
    const events = await printed.jsonValue();
    expect(events.every((e) => e.trusted)).toBe(true);
    expect(events[0]!.text).toContain('合计：100.00 元；共 1 条');
    expect(events[0]!.text).toContain(
      '全部同时满足：名称 含有 服务器；折旧额（整数分） 等于 10000',
    );
    expect(events[0]!.text).not.toContain('服务器乙');
    if (label === '打印折旧明细') expect(events[0]!.text).toContain('A01');
    await printed.dispose();
  }
  await page.reload();
  await expect(page.getByLabel('条件 2 值', { exact: true })).toHaveValue('10000');
  await expect(page.getByText('明细合计：100.00 元', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.getByLabel('条件 1 值', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('起始月份', { exact: true })).toHaveValue('202601');
  await expect(page.getByLabel('截止月份', { exact: true })).toHaveValue('202612');
  await expect(page.getByRole('checkbox', { name: '显示零折旧', exact: true })).not.toBeChecked();
  await expect(page.getByText('明细合计：400.00 元', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复清除前筛选', exact: true }).click();
  await expect(page.getByLabel('条件 2 值', { exact: true })).toHaveValue('10000');
  await expect(page.getByLabel('起始月份', { exact: true })).toHaveValue('202602');
  await expect(page.getByLabel('截止月份', { exact: true })).toHaveValue('202602');
  await expect(page.getByRole('checkbox', { name: '显示零折旧', exact: true })).toBeChecked();
  await expect(page.getByText('明细合计：100.00 元', { exact: true })).toBeVisible();
  await page.getByLabel('删除条件 2', { exact: true }).click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('明细合计：300.00 元', { exact: true })).toBeVisible();
  await page.getByLabel('条件 1 值', { exact: true }).fill('查无此设备');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('没有符合筛选条件的折旧记录', { exact: true })).toBeVisible();
  await expect(page.getByText('明细合计：0.00 元', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /导出 Excel$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打印折旧明细', exact: true })).toBeDisabled();
});

test('w_zjgl_cx：旧单条件保留、类型操作符、错误条件及非法HTTP请求拒绝', async ({
  page,
  request,
}) => {
  const token = await prepare(page, request);
  await page.goto('/m/fixed-assets/queries?field=code&op=eq&value=A02');
  await expect(page.getByLabel('条件 1 值', { exact: true })).toHaveValue('A02');
  await expect(page.getByText('明细合计：200.00 元', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '增加条件', exact: true }).click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText(/第 2 条条件：条件值不能为空/)).toBeVisible();
  await expect(page.getByRole('button', { name: /导出 Excel$/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /A02 服务器乙/ })).toHaveCount(0);
  await select(page, '条件 2 操作符', '含有');
  await select(page, '条件 2 字段', '折旧额（整数分）');
  await page.getByLabel('条件 2 操作符', { exact: true }).click();
  await expect(
    page.locator('.ant-select-dropdown:visible').getByText('含有', { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByLabel('条件 2 值', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('金额条件必须为整数分', { exact: true })).toBeVisible();
  await select(page, '条件 2 字段', '使用日期');
  await page.getByLabel('条件 2 值', { exact: true }).fill('2026-02-30');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('日期条件格式应为 YYYY-MM-DD', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.getByText('明细合计：400.00 元', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复清除前筛选', exact: true }).click();
  await expect(page.getByLabel('条件 2 值', { exact: true })).toHaveValue('2026-02-30');
  await expect(page.getByText('日期条件格式应为 YYYY-MM-DD', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /导出 Excel$/ })).toHaveCount(0);
  for (const condition of [
    { field: 'sql', op: 'eq', value: '1' },
    { field: 'name', op: 'execute', value: '1' },
    { field: 'name', op: 'eq', value: '服务器', logical: 'or' },
    { field: 'amount', op: 'contains', value: '100' },
  ]) {
    const response = await request.get(
      `/trpc/m.fixed-assets.query?input=${encodeURIComponent(JSON.stringify({ from: 202602, to: 202602, conditions: [{ field: 'name', op: 'contains', value: '服务器' }, condition] }))}`,
      { headers: { 'x-caiwu-token': E2E_APP_TOKEN, authorization: `Bearer ${token}` } },
    );
    expect(response.ok()).toBe(false);
    const body = await response.json();
    expect(body.error).toBeTruthy();
    expect(body.result).toBeUndefined();
  }
  for (const suffix of [
    '?field=unknown&op=eq&value=1',
    '?field=amount&op=contains&value=1',
    '?conditions=%7B',
  ]) {
    await page.goto(`/m/fixed-assets/queries${suffix}`);
    await expect(page.getByRole('alert').filter({ hasText: '查询未执行成功' })).toBeVisible();
    await expect(page.getByRole('button', { name: '打印折旧明细', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /导出 Excel$/ })).toHaveCount(0);
  }
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.getByText('明细合计：400.00 元', { exact: true })).toBeVisible();
});

test('w_zjgl_cx：延迟旧请求不覆盖新查询，加载时禁止沿用旧结果导出打印', async ({
  page,
  request,
}) => {
  await prepare(page, request);
  await page.goto('/m/fixed-assets/queries');
  await expect(page.getByText('明细合计：400.00 元', { exact: true })).toBeVisible();
  let releaseOld!: () => void;
  let oldStarted!: () => void;
  let oldFinished!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const started = new Promise<void>((resolve) => {
    oldStarted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    oldFinished = resolve;
  });
  await page.route('**/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes('m.fixed-assets.query')) return route.continue();
    const input = JSON.parse(url.searchParams.get('input') ?? '{}') as Record<
      string,
      { conditions?: { value: string }[] }
    >;
    if (!Object.values(input).some((v) => v.conditions?.[0]?.value === 'A01'))
      return route.continue();
    const response = await route.fetch();
    oldStarted();
    await held;
    await route.fulfill({ response });
    oldFinished();
  });
  try {
    await page.getByRole('button', { name: '增加条件', exact: true }).click();
    await page.getByLabel('条件 1 值', { exact: true }).fill('A01');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await started;
    await expect(page.getByRole('button', { name: '打印折旧明细', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /导出 Excel$/ })).toHaveCount(0);
    await page.getByLabel('条件 1 值', { exact: true }).fill('A02');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByText('明细合计：200.00 元', { exact: true })).toBeVisible();
    releaseOld();
    await finished;
    await expect(page.getByRole('row', { name: /A02 服务器乙/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /A01 服务器甲/ })).toHaveCount(0);
    expect((await excelRows(page, 0))[2]).toEqual([
      undefined,
      202602,
      'A02',
      '服务器乙',
      '01 行政部',
      '01 设备类',
      '01 管理用',
      '0',
      200,
      '',
    ]);
  } finally {
    releaseOld();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('w_zjgl_cx：请求失败不保留旧结果，同条件再次查询可恢复并导出', async ({ page, request }) => {
  await prepare(page, request);
  await page.goto('/m/fixed-assets/queries');
  await expect(page.getByText('明细合计：400.00 元', { exact: true })).toBeVisible();
  await page.route('**/trpc/**', async (route) => {
    if (route.request().url().includes('m.fixed-assets.query')) await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('button', { name: '增加条件', exact: true }).click();
  await page.getByLabel('条件 1 值', { exact: true }).fill('B01');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('查询失败，请重试', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /服务器甲|服务器乙|打印机/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /导出 Excel$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打印折旧明细', exact: true })).toBeDisabled();
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('明细合计：100.00 元', { exact: true })).toBeVisible();
  expect((await excelRows(page, 0))[2]).toEqual([
    undefined,
    202602,
    'B01',
    '打印机',
    '01 行政部',
    '01 设备类',
    '01 管理用',
    '0',
    100,
    '',
  ]);
});
