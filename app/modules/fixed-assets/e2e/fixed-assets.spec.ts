import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import type { Account, DimensionItem, Voucher } from '@caiwu/core';
import fixedAssets from '../server';

/** 在本次 E2E 的临时账套上调用真实 core 状态服务，不增加测试后门或依赖审核页面。 */
async function setVoucherStatus(bookId: string, id: number, status: 'audited' | 'posted') {
  const dataDir = readdirSync(os.tmpdir())
    .filter((n) => n.startsWith('caiwu-e2e-'))
    .map((n) => path.join(os.tmpdir(), n))
    .find((p) => existsSync(path.join(p, 'books', `${bookId}.caiwu`)));
  if (!dataDir) throw new Error('未找到本次 E2E 临时账套');
  const runtime = createRuntime({ dataDir, modules: [fixedAssets], devMode: true });
  try {
    const book = runtime.bookStore.open(bookId);
    const user = (await loadServiceUser(book.db, 1))!;
    const svc = createCoreServices({
      db: book.db,
      user,
      moduleId: null,
      now: runtime.now,
      modules: runtime.modules.lookup,
    });
    await svc.vouchers.changeStatus({ ids: [id], to: 'audited' });
    if (status === 'posted') await svc.vouchers.changeStatus({ ids: [id], to: 'posted' });
  } finally {
    await runtime.bookStore.closeAll();
  }
}
async function prepare(request: APIRequestContext, token: string) {
  const get = <T>(procedure: string, input?: unknown) =>
    callApi<T>(request, procedure, input, { token, method: 'GET' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'POST' });
  const accounts = await get<Account[]>('core.accounts.list');
  const departments = await get<DimensionItem[]>('core.dimensions.items', { type: 'department' });
  const types = await get<{ id: number }[]>('core.reference.voucherTypes');
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  const categoryId = await post<number>('saveMaster', {
    data: { kind: 'category', code: '01', name: '办公设备', accountId: id('1601'), rate: '0' },
  });
  const purposeId = await post<number>('saveMaster', {
    data: { kind: 'purpose', code: '01', name: '管理用', accountId: id('6602') },
  });
  const statusId = await post<number>('saveMaster', {
    data: { kind: 'status', code: '01', name: '在用', depreciates: true },
  });
  await post('saveMaster', { data: { kind: 'reason', code: '01', name: '报废' } });
  await post('saveSettings', {
    depreciationAccountId: id('1602'),
    clearingAccountId: id('1601'),
    voucherTypeId: types[0]!.id,
  });
  return {
    get,
    post,
    categoryId,
    purposeId,
    statusId,
    departmentId: departments.find((d) => d.code === '01')!.id,
  };
}
async function confirmPopover(page: Page) {
  await page.getByRole('button', { name: '确认', exact: true }).last().click();
}

test('M15：真实卡片→使用月不提→后续三月→来源凭证→删除待审核凭证→取消恢复→审核过账锁', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const { token, bookId } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  await page.goto('/m/fixed-assets/cards');
  await expect(page.getByRole('heading', { name: '固定资产台账' })).toBeVisible();
  await page.getByRole('button', { name: '新增资产', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增资产卡片' });
  await drawer.getByLabel('设备编号', { exact: true }).fill('E2E001');
  await drawer.getByLabel('设备名称', { exact: true }).fill('研发服务器');
  await drawer.getByLabel('类别', { exact: true }).click();
  await page.getByText('01 办公设备', { exact: true }).last().click();
  await drawer.getByLabel('状态', { exact: true }).click();
  await page.getByText('01 在用', { exact: true }).last().click();
  await drawer.getByLabel('用途', { exact: true }).click();
  await page.getByText('01 管理用', { exact: true }).last().click();
  await drawer.getByLabel('部门', { exact: true }).fill('行政');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('原值（元）', { exact: true }).fill('6000');
  await drawer.getByLabel('残值率（0 至 1）').fill('0');
  await drawer.getByRole('button', { name: '增加附属设备' }).click();
  await drawer.getByLabel('附属编号').fill('01');
  await drawer.getByLabel('附属名称').fill('硬盘');
  await drawer.getByLabel('单价（元）', { exact: true }).fill('0.20');
  await drawer.getByLabel('附属数量').fill('0.1');
  await drawer.getByRole('button', { name: '保存卡片' }).click();
  await expect(drawer).toBeHidden();
  const row = page.getByRole('row', { name: /E2E001/ });
  await expect(row).toContainText('6,000.00');
  const january = await p.get<{ total: number }>('m.fixed-assets.preview', { period: 202601 });
  expect(january.total).toBe(0);
  await page.goto('/m/fixed-assets/depreciation');
  for (const month of [202602, 202603, 202604]) {
    await page.getByLabel('计提月份', { exact: true }).fill(String(month));
    await page.getByRole('button', { name: '预览本月折旧' }).click();
    await expect(page.getByText('本月合计：100.00 元')).toBeVisible();
    await page.getByRole('button', { name: '确认计提', exact: true }).click();
    await confirmPopover(page);
    await expect(page.getByRole('row', { name: new RegExp(String(month)) }).last()).toBeVisible();
  }
  const list = await p.get<{ id: number; depreciation: number; months: number }[]>(
    'm.fixed-assets.list',
    {},
  );
  expect(list[0]).toMatchObject({ depreciation: 30000, months: 3 });
  const assetId = list[0]!.id;
  let batches =
    await p.get<{ id: number; period: number; voucher_id: number | null }[]>(
      'm.fixed-assets.batches',
    );
  const last = batches[0]!;
  const lastRow = page.getByRole('row', { name: /202604/ });
  await lastRow.getByRole('button', { name: '凭证预览/生成' }).click();
  let vd = page.getByRole('dialog', { name: '折旧凭证预览' });
  await expect(vd.getByText('日期：2026-04-30；借贷合计均为 100.00 元')).toBeVisible();
  await vd.getByRole('button', { name: '确认生成凭证' }).click();
  await confirmPopover(page);
  await expect(vd).toBeHidden();
  batches = await p.get('m.fixed-assets.batches');
  const vid = batches.find((b) => b.period === 202604)!.voucher_id!;
  const v = await p.get<Voucher>('core.vouchers.get', { id: vid });
  expect(v.source).toEqual({ module: 'fixed-assets', type: 'depreciation', id: String(last.id) });
  expect(v.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
    ['6602', 10000, 0],
    ['1602', 0, 10000],
  ]);
  await lastRow.getByRole('button', { name: /记-0001/ }).click();
  await expect(page).toHaveURL(new RegExp(`/m/voucher-entry/edit\\?id=${vid}`));
  await page.goto('/m/fixed-assets/depreciation');
  await page
    .getByRole('row', { name: /202604/ })
    .getByRole('button', { name: '凭证预览/生成' })
    .click();
  vd = page.getByRole('dialog', { name: '折旧凭证预览' });
  await vd.getByRole('button', { name: '删除待审核凭证' }).click();
  await confirmPopover(page);
  await expect(vd).toBeHidden();
  expect(await p.get('core.vouchers.get', { id: vid })).toBeNull();
  await page
    .getByRole('row', { name: /202604/ })
    .getByRole('button', { name: '取消此月折旧' })
    .click();
  const cd = page.getByRole('dialog', { name: '取消折旧预览' });
  await expect(cd).toContainText('202604');
  await expect(cd).toContainText('100.00');
  await cd.getByRole('button', { name: '确认取消最后月' }).click();
  await confirmPopover(page);
  await expect(cd).toBeHidden();
  const restored = await p.get<{ card: { depreciation: number; months: number; work_e6: number } }>(
    'm.fixed-assets.detail',
    { id: assetId },
  );
  expect(restored.card).toMatchObject({ depreciation: 20000, months: 2, work_e6: 0 });
  const march = batches.find((b) => b.period === 202603)!;
  const vp = await p.get<{ token: string }>('m.fixed-assets.voucherPreview', { id: march.id });
  const locked = await p.post<Voucher>('generateVoucher', { id: march.id, token: vp.token });
  for (const state of ['audited', 'posted'] as const) {
    if (state === 'audited') await setVoucherStatus(bookId, locked.id, 'audited');
    else {
      const dir = readdirSync(os.tmpdir())
        .filter((n) => n.startsWith('caiwu-e2e-'))
        .map((n) => path.join(os.tmpdir(), n))
        .find((d) => existsSync(path.join(d, 'books', `${bookId}.caiwu`)))!;
      const rt = createRuntime({ dataDir: dir, modules: [fixedAssets], devMode: true });
      try {
        const b = rt.bookStore.open(bookId);
        const svc = createCoreServices({
          db: b.db,
          user: (await loadServiceUser(b.db, 1))!,
          moduleId: null,
          now: rt.now,
          modules: rt.modules.lookup,
        });
        await svc.vouchers.changeStatus({ ids: [locked.id], to: 'posted' });
      } finally {
        await rt.bookStore.closeAll();
      }
    }
    await expect(p.post('remove', { id: assetId, confirm: true })).rejects.toThrow(/凭证/);
    await expect(p.post('cancel', { id: march.id, confirm: true })).rejects.toThrow(/审核|过账/);
    await expect(
      p.post('save', {
        id: assetId,
        revision: 4,
        data: {
          code: 'E2E001',
          name: '违规修改',
          categoryId: p.categoryId,
          statusId: p.statusId,
          purposeId: p.purposeId,
          departmentId: p.departmentId,
          acquired: '2026-01-01',
          useDate: '2026-01-01',
          original: 600000,
          rate: '0',
          method: '1',
          lifeMonths: 60,
        },
      }),
    ).rejects.toThrow(/凭证/);
  }
  for (const [route, title] of [
    ['masters', '资产基础档案'],
    ['queries', '折旧查询与分布'],
    ['reports', '资产报表与标签'],
    ['opening', '期初导入与开通'],
    ['batch', '统一置数'],
    ['settings', '资产凭证设置'],
  ]) {
    await page.goto(`/m/fixed-assets/${route}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
});

test('M15 产品开关：轻松隐藏资产导航并拒绝接口，成本提供资产导航', async ({ page, request }) => {
  const a = await loginWithNewBook(page, request, { product: 'qingsong' });
  await page.goto('/');
  await expect(page.getByText('固定资产台账', { exact: true })).toHaveCount(0);
  await expect(
    callApi(request, 'm.fixed-assets.list', {}, { token: a.token, method: 'GET' }),
  ).rejects.toThrow();
  await loginWithNewBook(page, request, { product: 'chengben' });
  await page.goto('/m/fixed-assets/cards');
  await expect(page.getByRole('heading', { name: '固定资产台账' })).toBeVisible();
});

test('M15 B/C：Excel模板与逐行导入→重导幂等→九项报表/导出/打印→统一置数→列宽确认', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const p = await prepare(request, token);
  await page.goto('/m/fixed-assets/opening');
  await expect(page.getByRole('heading', { name: '期初导入与开通' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 Excel 模板' }).click();
  const template = await downloaded;
  const { default: ExcelJS } = await import('exceljs');
  const { Workbook } = ExcelJS;
  const wb = new Workbook();
  await wb.xlsx.readFile((await template.path())!);
  const ws = wb.worksheets[0]!;
  expect(ws.getRow(1).getCell(1).text).toBe('设备编号');
  expect(ws.getRow(1).getCell(20).text).toContain('已复核');
  ws.addRow([
    '1',
    '期初设备一',
    '01',
    '01',
    '01',
    '01',
    '2025-01-01',
    '2025-01-01',
    '1200',
    '0',
    '1',
    '60',
    '200',
    '10',
    '0',
    '0',
    '型号一',
    '台',
    '1',
    '否',
  ]);
  ws.addRow([
    '01',
    '期初设备二',
    '01',
    '01',
    '01',
    '01',
    '2025-01-01',
    '2025-01-01',
    '0',
    '0',
    '1',
    '60',
    '0',
    '0',
    '0',
    '0',
    '型号二',
    '台',
    '1',
    '否',
  ]);
  const upload = async () =>
    page.getByLabel('选择期初 Excel').setInputFiles({
      name: '期初.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    });
  await upload();
  await expect(page.getByRole('row', { name: /3 01/ })).toContainText('原值必须大于零');
  await page.getByRole('button', { name: '确认期初入库' }).click();
  await confirmPopover(page);
  await expect(page.getByText('导入文件存在逐行错误', { exact: true })).toBeVisible();
  expect(await p.get<unknown[]>('m.fixed-assets.list', {})).toHaveLength(0);
  ws.getRow(3).getCell(9).value = '6000';
  await upload();
  await expect(page.getByRole('row', { name: /3 01/ })).toContainText('待导入');
  await page.getByRole('button', { name: '确认期初入库' }).click();
  await confirmPopover(page);
  await expect(page.getByText('导入 2 张，跳过 0 张', { exact: true })).toBeVisible();
  await upload();
  await expect(page.getByRole('row', { name: /2 1/ })).toContainText('已存在，跳过');
  await page.getByRole('button', { name: '确认期初入库' }).click();
  await confirmPopover(page);
  await expect(page.getByText('导入 0 张，跳过 2 张', { exact: true })).toBeVisible();
  const dep = await p.get<{ token: string; total: number }>('m.fixed-assets.preview', {
    period: 202601,
  });
  expect(dep.total).toBe(12000);
  await p.post('depreciate', { period: 202601, token: dep.token, confirm: true });
  await p.post('save', {
    data: {
      code: 'X',
      name: '附属测试设备',
      categoryId: p.categoryId,
      purposeId: p.purposeId,
      statusId: p.statusId,
      departmentId: p.departmentId,
      acquired: '2026-02-01',
      useDate: '2026-02-01',
      original: 10000,
      rate: '0',
      method: '1',
      lifeMonths: 60,
      accessories: [{ code: '1', name: '精确小数配件', quantity: '0.1', unitPrice: '0.2' }],
    },
  });
  for (const [kind, title] of Object.entries({
    ledger: '资产明细账',
    list: '资产清单',
    accessories: '附属设备表',
    due: '到期资产清单',
    additions: '资产增加清单',
    reductions: '资产减少清单',
    distribution: '资产分布表',
    register: '固定资产台账',
    labels: '资产标签',
  })) {
    await page.goto(`/m/fixed-assets/reports?kind=${kind}&year=2026&cutoff=2026-12-31`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    if (kind === 'reductions') {
      await expect(page.getByText('当年无资产减少', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '打印当前报表' })).toBeDisabled();
      await expect(page.getByRole('button', { name: '导出 Excel' })).toHaveCount(0);
    }
    if (kind === 'accessories') {
      await expect(page.getByRole('row', { name: /精确小数配件/ })).toContainText('0.02');
      const d = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出 Excel' }).click();
      const excel = await d;
      const check = new Workbook();
      await check.xlsx.readFile((await excel.path())!);
      expect(check.worksheets[0]!.rowCount).toBe(2);
    }
    if (kind === 'labels') {
      await page.getByRole('button', { name: '打印当前报表' }).click();
      const frame = page.locator('iframe');
      await frame.waitFor({ state: 'attached' });
      const html = await frame.getAttribute('srcdoc');
      expect(html).toContain('88mm 51mm');
      expect(html).toContain('期初设备一');
    }
  }
  await page.goto('/m/fixed-assets/batch');
  await page.getByLabel('编码/名称', { exact: true }).fill('期初');
  await page.getByLabel('修改字段').click();
  await page.getByText('编号补零长度', { exact: true }).last().click();
  await page.getByLabel('新值', { exact: true }).fill('2');
  await page.getByRole('button', { name: '筛选并预览' }).click();
  await expect(page.getByRole('row', { name: /1 期初设备一/ })).toContainText('编号 01 已存在');
  await page.getByRole('button', { name: '确认统一置数' }).click();
  await confirmPopover(page);
  expect((await p.get<{ code: string }[]>('m.fixed-assets.list', {})).map((c) => c.code)).toEqual([
    '01',
    '1',
    'X',
  ]);
  await page.goto('/m/fixed-assets/queries');
  await expect(page.getByText('明细合计：120.00 元', { exact: true })).toBeVisible();
  const separator = page.getByRole('separator', { name: '拖动调整列宽' }).first();
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 45, box.y + box.height / 2);
  await page.mouse.up();
  expect(
    await page.evaluate(() => localStorage.getItem('caiwu.fixed-assets.query.confirmed-widths')),
  ).toBeNull();
  await page.getByRole('button', { name: '记录列宽' }).click();
  expect(
    await page.evaluate(() => localStorage.getItem('caiwu.fixed-assets.query.confirmed-widths')),
  ).toBeNull();
  await confirmPopover(page);
  expect(
    await page.evaluate(() => localStorage.getItem('caiwu.fixed-assets.query.confirmed-widths')),
  ).not.toBeNull();
  await page.getByRole('button', { name: '恢复默认列宽' }).click();
  await confirmPopover(page);
  expect(
    await page.evaluate(() => localStorage.getItem('caiwu.fixed-assets.query.confirmed-widths')),
  ).toBeNull();
  await page.goto('/m/fixed-assets/queries?field=amount&op=contains&value=1');
  await expect(page.getByText('金额不能使用「含有」操作符', { exact: true })).toBeVisible();
});
