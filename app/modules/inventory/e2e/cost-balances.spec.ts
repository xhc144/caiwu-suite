import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import inventory from '../server';
import type { InventoryTables } from '../server/migrations';

test('W2-20 独立账套：真实核算成本与估价分开 → 跨月结余 → 盘点金额快照 → 导出 → 未核算留空', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(90_000);
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'inventory-cost-e2e-'));
  const local = spawnLocalServer({
    dataDir,
    shutdownProtocol: 'native',
    env: {
      CAIWU_PORT: '0',
      CAIWU_TOKEN: 'e2e-token',
      CAIWU_DEV: '1',
      CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
    },
  });
  let runtime: ReturnType<typeof createRuntime> | undefined;
  let clean = false;
  try {
    const port = await local.ready();
    runtime = createRuntime({ dataDir, modules: [inventory], devMode: true });
    const baseURL = `http://127.0.0.1:${port}`;
    const request = await playwright.request.newContext({ baseURL });
    const context = await browser.newContext({ baseURL, locale: 'zh-CN' });
    const page = await context.newPage();
    try {
      const { bookId, token } = await loginWithNewBook(page, request, { product: 'chengben' });
      const withCore = <T>(run: (svc: CoreServices) => Promise<T>) =>
        runtime!.bookStore.withBook(bookId, async (book) => {
          const user = (await loadServiceUser(book.db, 1))!;
          return run(
            createCoreServices({
              db: book.db,
              user,
              moduleId: 'inventory',
              now: runtime!.now,
              modules: runtime!.modules.lookup,
            }),
          );
        });
      const { warehouseId, issueId } = await withCore(async (svc) => {
        // Only core and this module's stable API/service are used for fixtures.
        const api = inventory.router.createCaller({
          app: runtime!,
          token: (await runtime!.sessions.create(bookId, 1)).token,
        });
        const warehouseId = await api.saveWarehouse({ code: '01', name: '独立核算仓' });
        await api.saveProduct({
          code: 'P1',
          name: '核算测试产品',
          receiptPrice: '9',
          issuePrice: '20',
        });
        const cash = (await svc.accounts.require('1001')).id;
        const cost = (await svc.accounts.require('6401')).id;
        await api.saveOpening({
          warehouseId,
          revision: 0,
          rows: [{ productCode: 'P1', quantity: '10', unitPrice: '2.55' }],
        });
        await api.saveDocument({
          requestKey: 'w220-receipt',
          kind: 'receipt',
          warehouseId,
          number: 'R1',
          date: '2026-01-10',
          category: '采购',
          accountId: cash,
          lines: [{ productCode: 'P1', quantity: '5', unitPrice: '3.33' }],
        });
        const issue = await api.saveDocument({
          requestKey: 'w220-issue',
          kind: 'issue',
          warehouseId,
          number: 'S1',
          date: '2026-01-15',
          category: '销售',
          accountId: cash,
          costAccountId: cost,
          lines: [{ productCode: 'P1', quantity: '3', unitPrice: '5' }],
        });
        await svc.tx(async (t) => {
          const db = t.db.withTables<InventoryTables>();
          await db
            .updateTable('inventory_document')
            .set({
              calculation_status: 'calculated',
              calculation_batch: 'fixture',
              calculation_period: 202601,
            })
            .where('id', '=', issue.id)
            .execute();
          await db
            .updateTable('inventory_line')
            .set({
              calculation_status: 'calculated',
              calculation_batch: 'fixture',
              calculation_period: 202601,
              outbound_cost_cents: 843,
              unit_cost: '2.81',
            })
            .where('document_id', '=', issue.id)
            .execute();
        });
        return { warehouseId, issueId: issue.id };
      });
      await page.goto(`${baseURL}/m/inventory/stock?productCode=P1`);
      const stock = page
        .getByRole('row')
        .filter({ has: page.getByRole('button', { name: '查看台账', exact: true }) });
      await expect(stock).toContainText('33.72');
      await expect(stock).toContainText('账面金额完整');
      const issueRow = page.getByRole('row').filter({ hasText: 'S1' });
      await expect(issueRow).toContainText('8.43');
      await expect(issueRow).toContainText('33.72');
      await page.getByLabel('库存估价口径').click();
      await page
        .locator('.ant-select-item-option-content')
        .getByText('默认入库价估算', { exact: true })
        .click();
      await expect(stock).toContainText('108.00');
      await page.getByLabel('库存估价口径').click();
      await page
        .locator('.ant-select-item-option-content')
        .getByText('账面成本（未核算留空）', { exact: true })
        .click();
      await expect(stock).toContainText('33.72');

      await page.getByRole('button', { name: '查看月末库存数据', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: '月末库存数据（只读）', exact: true });
      await expect(drawer.getByText('截止日期：2026-01-31；成本已核算至：尚未核算')).toBeVisible();
      await expect(drawer.getByRole('row').filter({ hasText: 'S1' })).toContainText('8.43');
      await drawer.locator('button.ant-drawer-close').click();

      await page.goto(`${baseURL}/m/inventory/stock?productCode=P1&from=2026-02-01&to=2026-02-28`);
      await expect(stock).toContainText('33.72');
      await expect(stock).toContainText('12');

      await page.goto(`${baseURL}/m/inventory/counts`);
      await page.getByRole('button', { name: '生成账面快照', exact: true }).click();
      const count = page.getByRole('row').filter({ hasText: 'P1' });
      await expect(count).toContainText('33.72');
      await page.getByRole('button', { name: '录入实盘', exact: true }).click();
      await page.getByLabel('实盘P1', { exact: true }).fill('11');
      await page.getByRole('button', { name: '保存实盘', exact: true }).click();
      await expect(page.getByRole('button', { name: '保存实盘', exact: true })).not.toBeVisible();
      await expect(count).toContainText('30.91');
      await expect(count).toContainText('-2.81');
      await page.reload();
      await expect(count).toContainText('30.91');
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'download 导出 Excel', exact: true }).click();
      const downloaded = await pending;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(new Uint8Array(await readFile((await downloaded.path())!)).buffer);
      const sheet = workbook.worksheets[0]!;
      const cells = Array.from({ length: sheet.rowCount }, (_, i) => sheet.getRow(i + 1).values);
      expect(JSON.stringify(cells)).toContain('账面金额快照');
      expect(JSON.stringify(cells)).toContain('30.91');
      expect(JSON.stringify(cells)).toContain('-2.81');

      await page.goto(`${baseURL}/m/inventory/reports`);
      await page.getByLabel('报表类型').click();
      await page
        .locator('.ant-select-item-option-content')
        .getByText('销售明细账', { exact: true })
        .click();
      const sale = page.getByRole('row').filter({ hasText: 'S1' });
      await expect(sale).toContainText('15.00');
      await expect(sale).toContainText('8.43');
      await expect(sale).toContainText('2.81');
      await withCore(async (svc) => {
        await svc.db
          .withTables<InventoryTables>()
          .updateTable('inventory_line')
          .set({ calculation_status: 'uncalculated' })
          .where('document_id', '=', issueId)
          .execute();
      });
      await page.reload();
      await page.getByLabel('报表类型').click();
      await page
        .locator('.ant-select-item-option-content')
        .getByText('销售明细账', { exact: true })
        .click();
      await expect(sale).toContainText('待成本核算');
      await expect(sale).not.toContainText('8.43');
      expect(
        (
          await callApi<{ balanceCents: number | null }[]>(
            request,
            'm.inventory.stock',
            { warehouseId },
            { token, method: 'GET' },
          )
        )[0]!.balanceCents,
      ).toBeNull();
    } finally {
      await context.close();
      await request.dispose();
    }
    await runtime.bookStore.closeAll();
    runtime = undefined;
    await local.close();
    clean = true;
  } finally {
    await runtime?.bookStore.closeAll();
    if (!clean) await local.close();
    if (clean) rmSync(dataDir, { recursive: true, force: true });
  }
});

test('w_cb_hz/w_cb_fgz 正式API闭环：盘亏调整真实库存与台账 → 全月锁 → 撤销恢复；不依赖costing页面', async ({
  page,
  request,
}) => {
  const { bookId, token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.inventory.${name}`, input, { token, method: 'POST' });
  const get = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.inventory.${name}`, input, { token, method: 'GET' });
  const warehouseId = await post<number>('saveWarehouse', { code: '01', name: '正式发布仓' });
  const p = await post<{ id: number }>('saveProduct', { code: 'P1', name: '正式成本产品' });
  await post('saveOpening', {
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '1' }],
  });
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token, method: 'GET' },
  );
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  await post('saveDocument', {
    requestKey: 'formal-receipt',
    kind: 'receipt',
    warehouseId,
    number: 'RK',
    date: '2026-01-10',
    category: '采购',
    accountId: id('1001'),
    lines: [{ productCode: 'P1', quantity: '10', unitPrice: '3' }],
  });
  const issue = await post<{ id: number }>('saveDocument', {
    requestKey: 'formal-issue',
    kind: 'issue',
    warehouseId,
    number: 'CK',
    date: '2026-01-15',
    category: '销售',
    accountId: id('1001'),
    costAccountId: id('6401'),
    lines: [{ productCode: 'P1', quantity: '5', unitPrice: '10' }],
  });
  const count = await post<{ id: number; revision: number }>('generateCount', {
    warehouseId,
    period: 202601,
    revision: 0,
    confirmed: false,
  });
  await post('saveCount', {
    warehouseId,
    period: 202601,
    revision: count.revision,
    rows: [{ productCode: 'P1', actual: '14' }],
  });
  const snapshot = await get<{
    fingerprint: string;
    stockRevision: number;
    openingRevision: number;
    previousBatchId: string | null;
    movements: { id: number; documentId: number }[];
  }>('costingSnapshot', { period: 202601 });
  const batch = await post<{ batchId: string; revision: number }>('commitCosting', {
    bookId,
    period: 202601,
    requestKey: 'formal-publication',
    expectedStockRevision: snapshot.stockRevision,
    expectedOpeningRevision: snapshot.openingRevision,
    previousBatchId: snapshot.previousBatchId,
    fingerprint: snapshot.fingerprint,
    lines: [
      {
        lineId: snapshot.movements.find((l) => l.documentId === issue.id)!.id,
        documentId: issue.id,
        costCents: 1000,
        unitCost: '2',
      },
    ],
    balances: [{ warehouseId, productId: p.id, quantity: '14', amountCents: 2800 }],
    countAdjustments: [
      {
        warehouseId,
        productId: p.id,
        countId: count.id,
        quantity: '-1',
        amountCents: -200,
        zeroQuantityAdjustmentCents: 0,
      },
    ],
  });
  await page.goto('/m/inventory/stock?productCode=P1');
  const stock = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: '查看台账', exact: true }) });
  await expect(stock).toContainText('14');
  await expect(stock).toContainText('28.00');
  await expect(page.getByRole('row').filter({ hasText: '盘点/零数量调整' })).toContainText('-2.00');
  await expect(
    post('generateCount', { warehouseId, period: 202601, revision: 2, confirmed: true }),
  ).rejects.toThrow(/锁定|核算/);
  await page.goto('/m/inventory/counts');
  const row = page.getByRole('row').filter({ hasText: 'P1' });
  await expect(row).toContainText('30.00');
  await expect(row).toContainText('28.00');
  await post('cancelCosting', { bookId, batchId: batch.batchId, expectedRevision: batch.revision });
  await page.goto('/m/inventory/stock?productCode=P1');
  await expect(stock).toContainText('15');
  await expect(stock).toContainText('待成本核算');
  await expect(page.getByRole('row').filter({ hasText: '盘点/零数量调整' })).toHaveCount(0);
  expect(
    (await get<{ calculation_status: string }>('document', { id: issue.id })).calculation_status,
  ).toBe('uncalculated');
});
