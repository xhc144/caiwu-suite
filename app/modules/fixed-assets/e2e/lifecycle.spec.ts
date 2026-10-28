import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CardInput } from '../shared';

// Whole-book replacement needs an exclusive data directory. Other E2E workers
// may legitimately open a helper runtime against the common server's directory.
const resetTest = test.extend<{ assetServerUrl: string }>({
  assetServerUrl: async ({ browserName }, use) => {
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), `caiwu-assets-${browserName}-maintenance-e2e-`),
    );
    const server = spawnLocalServer({
      dataDir,
      shutdownProtocol: 'native',
      env: {
        CAIWU_PORT: '0',
        CAIWU_TOKEN: 'e2e-token',
        CAIWU_DEV: '1',
        CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
      },
    });
    try {
      await use(`http://127.0.0.1:${await server.ready()}`);
    } finally {
      await server.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
  baseURL: async ({ assetServerUrl }, use) => use(assetServerUrl),
});

async function prepare(request: APIRequestContext, token: string) {
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'GET' });
  const post = <T>(name: string, input?: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'POST' });
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token, method: 'GET' },
  );
  const aid = (code: string) => accounts.find((a) => a.code === code)!.id;
  const categoryId = await post<number>('saveMaster', {
    data: { kind: 'category', code: '01', name: '办公设备', accountId: aid('1601') },
  });
  const purposeId = await post<number>('saveMaster', {
    data: { kind: 'purpose', code: '01', name: '管理用', accountId: aid('6602') },
  });
  const statusId = await post<number>('saveMaster', {
    data: { kind: 'status', code: '01', name: '在用' },
  });
  const deps = await get<{ id: number; code: string; name: string }[]>('departments');
  await post('saveSettings', {
    depreciationAccountId: aid('1602'),
    clearingAccountId: aid('1601'),
    voucherTypeId: (
      await callApi<{ id: number }[]>(request, 'core.reference.voucherTypes', undefined, {
        token,
        method: 'GET',
      })
    )[0]!.id,
  });
  const data: CardInput = {
    code: 'A',
    name: '合成服务器',
    categoryId,
    purposeId,
    statusId,
    departmentId: deps.find((d) => d.code === '01')!.id,
    acquired: '2026-01-01',
    useDate: '2026-01-01',
    original: 600000,
    rate: '0',
    method: '1',
    lifeMonths: 60,
    manufacturer: '合成制造厂',
    manufactured: '2025-12-01',
    installation: '一号机房',
    machineCode: 'M-001',
    custodian: '合成保管人',
    reference: 'REF-A',
  };
  const run = async (period: number) => {
    const p = await get<{ token: string }>('preview', { period });
    return post<number>('depreciate', { period, token: p.token, confirm: true });
  };
  return { get, post, data, deps, run };
}
async function select(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByText(text, { exact: true }).last().click();
}
async function nativePrint(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { assetPrints: string[] }).assetPrints = [];
    window.caiwuDesktop = {
      print: async (html) => {
        (window as unknown as { assetPrints: string[] }).assetPrints.push(html);
      },
      printToPdf: async () => null,
    };
  });
}

test('w_zc_zcgl：原快捷键、输入内全选、记录移动与全局搜索互不抢占', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  await p.post('save', { data: p.data });
  await nativePrint(page);
  await page.goto('/m/fixed-assets/cards');
  const heading = page.getByRole('heading', { name: '固定资产台账', exact: true });
  await heading.click();
  await page.keyboard.press('Control+p');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { assetPrints: string[] }).assetPrints.length),
    )
    .toBe(1);
  await heading.click();
  await page.keyboard.press('Control+k');
  const copy = page.getByRole('dialog', { name: '复制新增资产', exact: true });
  await expect(copy).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const name = copy.getByLabel('设备名称', { exact: true });
  await name.click();
  await name.press('Control+a');
  await name.press('Backspace');
  await expect(name).toHaveValue('');
  await name.fill('快捷复制设备');
  await copy.getByLabel('设备编号', { exact: true }).fill('B');
  await name.press('Control+s');
  await expect(copy).toBeHidden();
  await page.getByRole('button', { name: '末条', exact: true }).click();
  await expect(page.getByText('当前：2 / 2 B 快捷复制设备', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '首条', exact: true }).click();
  await heading.click();
  await page.keyboard.press('Control+d');
  const removal = page.getByRole('dialog', { name: '确认删除资产 A 合成服务器？', exact: true });
  await expect(removal).toBeVisible();
  await removal.getByRole('button', { name: '取消', exact: true }).click();
  await heading.click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('#fixed-assets-card-search')).toBeFocused();
  await heading.click();
  await page.keyboard.press('Control+q');
  await expect(page).toHaveURL(/\/m\/fixed-assets\/queries/);
  expect((await p.get<unknown[]>('list', {})).length).toBe(2);
});

test('w_zc_zcgl：浏览器办理完整转移、历史取数、独立卡片打印及列表逐格存盘', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  const id = await p.post<number>('save', { data: p.data });
  await nativePrint(page);
  await page.goto('/m/fixed-assets/cards');
  await page
    .getByRole('row', { name: /合成服务器/ })
    .getByRole('button', { name: '资产转移', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '资产转移与变更记录', exact: true });
  await editor.getByLabel('转移日期', { exact: true }).fill('2026-02-01');
  await editor.getByLabel('转入部门', { exact: true }).fill('销售');
  await page.keyboard.press('Enter');
  await editor.getByLabel('转后安装地点', { exact: true }).fill('二号机房');
  await editor.getByLabel('转后保管人', { exact: true }).fill('合成转入保管人');
  await editor.getByLabel('转后数量', { exact: true }).fill('2.5');
  await editor.getByLabel('转移原因', { exact: true }).fill('完整设备转移');
  await editor.getByRole('button', { name: '确认资产转移', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(editor).toBeHidden();
  expect(await p.get('reports', { kind: 'list', year: 2026, cutoff: '2026-01-31' })).toMatchObject({
    rows: [{ department: '行政部', quantity: '1', installation: '一号机房' }],
  });
  expect(await p.get('reports', { kind: 'list', year: 2026, cutoff: '2026-02-28' })).toMatchObject({
    rows: [{ department: '销售部', quantity: '2.5', installation: '二号机房' }],
  });
  await page
    .getByRole('row', { name: /合成服务器/ })
    .getByRole('button', { name: '查看', exact: true })
    .click();
  const card = page.getByRole('dialog', { name: '查看资产卡片', exact: true });
  await expect(card.getByLabel('制造厂', { exact: true })).toHaveValue('合成制造厂');
  await card.getByRole('button', { name: '打印已保存卡片', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { assetPrints: string[] }).assetPrints.join('')),
    )
    .toContain('二号机房');
  await card.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '列表编辑', exact: true }).click();
  const list = page.getByRole('dialog', { name: '资产列表编辑', exact: true });
  await list.getByLabel('A 设备名称', { exact: true }).fill('列表修改后的服务器');
  await list.getByLabel('A 单位', { exact: true }).fill('套');
  await list.getByRole('button', { name: '保存列表修改', exact: true }).click();
  await expect(list).toBeHidden();
  expect(await p.get('detail', { id })).toMatchObject({
    card: { name: '列表修改后的服务器', unit: '套', quantity_e6: 2500000 },
  });
});

test('w_zc_zcgl.ue_action_zjjs：浏览器 R1→零差额 R2→逆序撤回，刷新后恢复 700 元', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  const rows = [
    {
      row: 2,
      data: {
        ...p.data,
        code: 'RC',
        acquired: '2025-01-01',
        useDate: '2025-01-01',
        openingDepreciation: 50000,
        openingMonths: 5,
        manufactured: '2024-12-01',
      },
    },
  ];
  const preview = await p.post<{ token: string }>('importPreview', { rows });
  await p.post('importConfirm', { rows, token: preview.token, confirm: true });
  const id = (await p.get<{ id: number }[]>('list', {}))[0]!.id;
  await p.run(202601);
  await p.run(202602);
  const original = await p.get<{ card: { revision: number; months: number } }>('detail', { id });
  await page.goto('/m/fixed-assets/cards');
  await page.getByRole('button', { name: '累计折旧重算', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '按使用日期重算累计折旧', exact: true });
  await expect(dialog.getByRole('row', { name: /RC/ })).toContainText('1,300.00');
  await dialog.getByRole('button', { name: '确认重算并保存', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect
    .poll(() =>
      p.get<{ card: { depreciation: number } }>('detail', { id }).then((x) => x.card.depreciation),
    )
    .toBe(130000);
  const first = (await p.get<{ id: number }[]>('recalculations'))[0]!.id;
  await dialog.getByRole('button', { name: '重新预览', exact: true }).click();
  await expect(dialog.getByText('累计折旧差额合计：0.00 元', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '确认重算并保存', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect.poll(async () => (await p.get<unknown[]>('recalculations')).length).toBe(2);
  const second = (await p.get<{ id: number }[]>('recalculations'))[0]!.id;
  const firstRow = dialog
    .locator(`tr[data-row-key="${first}"]`)
    .filter({ hasText: '已有后续变更' });
  await expect(firstRow).toBeVisible();
  await expect(firstRow.getByRole('button', { name: '撤回重算', exact: true })).toHaveCount(0);
  await expect(p.post('undoRecalculation', { id: first, confirm: true })).rejects.toThrow('后续');
  await dialog
    .locator(`tr[data-row-key="${second}"]`)
    .filter({ hasText: '可撤回' })
    .getByRole('button', { name: '撤回重算', exact: true })
    .click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await p.get<{ card: { revision: number; depreciation: number } }>('detail', { id })).card,
    )
    .toMatchObject({ revision: original.card.revision + 3, depreciation: 130000 });
  // The predecessor's eligibility is persisted, not held only in React state.
  await page.reload();
  await page.getByRole('button', { name: '累计折旧重算', exact: true }).click();
  await dialog
    .locator(`tr[data-row-key="${first}"]`)
    .filter({ hasText: '可撤回' })
    .getByRole('button', { name: '撤回重算', exact: true })
    .click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect
    .poll(() =>
      p
        .get<{ card: { depreciation: number; opening_depreciation: number } }>('detail', { id })
        .then((x) => [x.card.depreciation, x.card.opening_depreciation]),
    )
    .toEqual([70000, 50000]);
  expect(
    (await p.get<{ card: { revision: number; months: number } }>('detail', { id })).card,
  ).toMatchObject({ revision: original.card.revision + 4, months: original.card.months });
});

test('w_zc_zcgl.ue_action_zjjs：R2 撤回后的外部同值保存仍阻止 R1，页面显示原因且没有撤回入口', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  const id = await p.post<number>('save', { data: p.data });
  await p.run(202602);
  const recalculate = async () => {
    const preview = await p.get<{ token: string }>('recalculationPreview', { id });
    return p.post<number>('recalculate', { filter: { id }, token: preview.token, confirm: true });
  };
  const first = await recalculate();
  const second = await recalculate();
  await p.post('undoRecalculation', { id: second, confirm: true });
  const before = await p.get<{ card: { revision: number; depreciation: number } }>('detail', {
    id,
  });
  await p.post('saveListEdits', {
    rows: [{ id, revision: before.card.revision, changes: { name: p.data.name } }],
  });
  await expect(p.post('undoRecalculation', { id: first, confirm: true })).rejects.toThrow('后续');
  expect(
    (await p.get<{ card: { revision: number; depreciation: number } }>('detail', { id })).card,
  ).toMatchObject({ revision: before.card.revision + 1, depreciation: before.card.depreciation });
  await page.goto('/m/fixed-assets/cards');
  await page.getByRole('button', { name: '累计折旧重算', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '按使用日期重算累计折旧', exact: true });
  await expect(dialog.getByText('已有后续变更，请先逆序处理', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '撤回重算', exact: true })).toHaveCount(0);
  expect(await p.get('recalculations')).toMatchObject([
    { id: second, undone: 1, canUndo: false },
    { id: first, undone: 0, canUndo: false },
  ]);
});

resetTest(
  'w_xt_kgzb_zc：浏览器口令保护、受保护重置、重新登录及恢复重置前整账',
  async ({ page, request }) => {
    const { token, bookId } = await loginWithNewBook(page, request, { product: 'minfei' });
    const p = await prepare(request, token);
    await p.post('save', { data: p.data });
    await page.goto('/m/fixed-assets/opening');
    await page.getByRole('button', { name: '受保护重置固定资产', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '受保护重置固定资产', exact: true });
    const preview = await p.get<{ book: { name: string } }>('resetPreview');
    await dialog.getByLabel('输入完整账套名称', { exact: true }).fill(preview.book.name);
    await dialog.getByLabel('当前管理员密码', { exact: true }).fill('wrong');
    await dialog.getByLabel('输入“清空固定资产”', { exact: true }).fill('清空固定资产');
    await dialog.getByRole('button', { name: '备份并重置固定资产', exact: true }).click();
    await expect(dialog.getByText('当前管理员密码错误', { exact: true })).toBeVisible();
    expect(await p.get('list', {})).toMatchObject([{ code: 'A' }]);
    await dialog.getByLabel('当前管理员密码', { exact: true }).fill('admin');
    const response = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('m.fixed-assets.reset'),
    );
    await dialog.getByRole('button', { name: '备份并重置固定资产', exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.url()).not.toContain('/m/fixed-assets/opening');
    const login = await callApi<{ token: string; book: unknown; user: unknown }>(
      request,
      'core.auth.login',
      { bookId, userCode: 'admin', password: 'admin' },
    );
    const active = await page.context().newPage();
    await active.addInitScript((s) => sessionStorage.setItem('caiwu.session', JSON.stringify(s)), {
      ...login,
      bookId,
    });
    await active.goto('/m/fixed-assets/opening');
    await active.getByRole('button', { name: '恢复重置前整账', exact: true }).click();
    const restore = active.getByRole('dialog', { name: '恢复重置前的完整账套', exact: true });
    await expect(restore.getByText(/资产：1 张/)).toBeVisible();
    await restore.getByLabel('确认完整账套名称', { exact: true }).fill(preview.book.name);
    await restore.getByLabel('确认当前管理员密码', { exact: true }).fill('admin');
    await restore.getByLabel('输入“恢复重置前整账”', { exact: true }).fill('恢复重置前整账');
    const restored = active.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && /m\.fixed-assets\.resetRestore(?:\?|$)/.test(r.url()),
    );
    await restore.getByRole('button', { name: '备份当前账套并恢复', exact: true }).click();
    expect((await restored).ok()).toBe(true);
    await expect(restore).toBeHidden();
    await expect.poll(() => active.url()).not.toContain('/m/fixed-assets/opening');
    const after = await callApi<{ token: string }>(request, 'core.auth.login', {
      bookId,
      userCode: 'admin',
      password: 'admin',
    });
    expect(
      await callApi(request, 'm.fixed-assets.list', {}, { token: after.token, method: 'GET' }),
    ).toMatchObject([{ code: 'A', name: '合成服务器' }]);
    await active.close();
  },
);

test('w_zcgl_label / w_preview_zc_mxz：版式文件导入保存、标签实测预览、专用账册分页及文件输出', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  await p.post('save', { data: p.data });
  for (const month of [202602, 202603, 202604, 202605, 202606, 202607, 202608, 202609])
    await p.run(month);
  await nativePrint(page);
  await page.goto('/m/fixed-assets/reports?kind=labels');
  await page.getByRole('button', { name: '标签及账册版式', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '标签及账册版式', exact: true });
  await settings.getByLabel('导入资产版式', { exact: true }).setInputFiles({
    name: '专用标签.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        labelTitle: '合成专用标签',
        labelFields: ['code', 'name', 'reference', 'date'],
        rowsPerPage: 5,
        ruler: true,
        labelBorder: true,
      }),
    ),
  });
  await expect(settings.getByLabel('标签标题', { exact: true })).toHaveValue('合成专用标签');
  await settings.getByRole('button', { name: '保存版式', exact: true }).click();
  await expect(settings).toBeHidden();
  await page.getByRole('button', { name: '预览资产标签', exact: true }).click();
  const label = page.getByRole('dialog', { name: '资产标签预览', exact: true });
  await expect(
    page
      .frameLocator('iframe[title="资产标签纸张预览"]')
      .getByText('合成专用标签', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="资产标签纸张预览"]')
      .getByText('参考编号：REF-A', { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await label.getByRole('button', { name: '保存标签 HTML 文件', exact: true }).click();
  expect(readFileSync((await (await download).path())!, 'utf8')).toContain('合成专用标签');
  await label.getByRole('button', { name: '打印标签', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { assetPrints: string[] }).assetPrints.length),
    )
    .toBe(1);
  await label.getByRole('button', { name: '关闭预览', exact: true }).click();
  await page.goto('/m/fixed-assets/reports?kind=ledger');
  await page.getByRole('button', { name: '预览账册版式', exact: true }).click();
  const frame = page.frameLocator('iframe[title="固定资产账册版式"]');
  await expect(frame.getByText('承前页', { exact: true })).toBeVisible();
  await expect(frame.getByText('过次页', { exact: true })).toBeVisible();
  await page
    .getByRole('dialog', { name: '固定资产账册预览', exact: true })
    .getByRole('button', { name: '关闭预览', exact: true })
    .click();
  const ledgerDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存账册 HTML 文件', exact: true }).click();
  expect(readFileSync((await (await ledgerDownload).path())!, 'utf8')).toContain('本设备期末余额');
});

test('w_zjgl_cx：组合条件、查询定义恢复、自选列、打印及全量刷新逐次确认', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  await p.post('save', { data: p.data });
  await p.post('save', { data: { ...p.data, code: 'B', name: '打印机', original: 300000 } });
  await p.post('save', {
    data: { ...p.data, code: 'C', name: '服务器维护设备', original: 120000 },
  });
  await p.run(202602);
  await p.post('saveQueryDefinition', {
    name: '服务器或打印机',
    revision: 0,
    query: {
      from: 202602,
      to: 202602,
      conditions: [
        { field: 'name', op: 'contains', value: '服务器' },
        { field: 'code', op: 'eq', value: 'B' },
        { field: 'amount', op: 'gt', value: '4000' },
      ],
      expression: '(1 或者 2) 并且 3',
      displayColumns: ['code', 'amount', 'reference'],
      sortField: 'amount',
      sortDirection: 'desc',
    },
  });
  await nativePrint(page);
  await page.goto('/m/fixed-assets/queries');
  await select(page, '已保存查询', '服务器或打印机');
  await expect(page.getByText('明细合计：150.00 元', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: '参考编号 拖动调整列宽', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '打印折旧明细', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { assetPrints: string[] }).assetPrints.join('')),
    )
    .toContain('组合：((1 或者 2) 并且 3)');
  await page.getByLabel('条件组合表达式', { exact: true }).fill('1 或者 99');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('条件编号 99 不存在', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打印折旧明细', exact: true })).toBeDisabled();
  await select(page, '已保存查询', '服务器或打印机');
  await expect(page.getByText('明细合计：150.00 元', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '刷新全部单据', exact: true }).click();
  const all = page.getByRole('dialog', { name: '是否查询本年度全部资产单据？', exact: true });
  await all.getByRole('button', { name: '包含所有单据', exact: true }).click();
  const large = page.getByRole('dialog', { name: '全量刷新可能需要较长时间', exact: true });
  await large.getByRole('button', { name: '继续全量刷新', exact: true }).click();
  await expect(page.getByText('明细合计：170.00 元', { exact: true })).toBeVisible();
});
