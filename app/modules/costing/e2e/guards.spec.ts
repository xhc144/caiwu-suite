import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import type { InventorySnapshot } from '@caiwu/core';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import { sql } from '@caiwu/db';
import { createRuntime } from '@caiwu/server-kit';
import { voucherInputFromSpec } from '@caiwu/testkit';
import { callApi } from '@caiwu/testkit/e2e';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import { serverModules } from '../../../.generated/server-modules';
import { costingService } from '../server/service';
import {
  seed,
  preview,
  confirmPublish,
  cancelLatest,
  costVoucherPreview,
  confirmCostVoucher,
} from './fixtures';

type GuardApp = Awaited<ReturnType<typeof seed>> & {
  page: Page;
  request: APIRequestContext;
  withCore<T>(run: (svc: CoreServices) => Promise<T>): Promise<T>;
};
// 仅审核/损坏历史等前置用真实core服务或SQL造数据，正式发布/撤销仍由页面经HTTP调用。
const test = base.extend<{ guarded: GuardApp }>({
  guarded: async ({ browser, playwright }, use) => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'costing-guards-'));
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
      runtime = createRuntime({ dataDir, modules: serverModules, devMode: true });
      const baseURL = `http://127.0.0.1:${port}`;
      const request = await playwright.request.newContext({ baseURL });
      const context = await browser.newContext({ baseURL, locale: 'zh-CN' });
      try {
        const page = await context.newPage();
        const seeded = await seed(page, request);
        const withCore = <T>(run: (svc: CoreServices) => Promise<T>) =>
          runtime!.bookStore.withBook(seeded.bookId, async (book) => {
            const user = (await loadServiceUser(book.db, 1))!;
            return run(
              createCoreServices({
                db: book.db,
                user,
                moduleId: 'costing',
                now: runtime!.now,
                modules: runtime!.modules.lookup,
                providers: runtime!.modules.providers,
              }),
            );
          });
        await use({ ...seeded, page, request, withCore });
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
  },
});

test('w_cb_fgz：已审核来源阻止撤销', async ({ guarded: t }) => {
  await preview(t.page);
  await confirmPublish(t.page);
  await expect(t.page.getByText(/202601 正式成本核算已发布/)).toBeVisible();
  const voucher = await t.withCore((svc) =>
    svc.tx((tx) =>
      tx.inventory.with(async (inv) => {
        const snapshot = await inv.snapshot(202601);
        const document = snapshot.documents.find((d) => d.id === t.issue.id)!;
        const voucher = await tx.vouchers.create({
          ...(await voucherInputFromSpec(tx, {
            date: '2026-01-10',
            lines: [
              { account: '6401', debit: 1000 },
              { account: '1405', credit: 1000, quantity: '-5' },
            ],
          })),
          source: { type: 'cost', id: String(document.id) },
        });
        await inv.lockVoucherSource({
          bookId: snapshot.bookId,
          documentId: document.id,
          purpose: 'cost',
          expectedRevision: document.revision,
          voucherId: voucher.id,
        });
        await tx.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
        return voucher;
      }),
    ),
  );
  const before = await t.get<InventorySnapshot>('costingSnapshot', { period: 202601 });
  await t.page.reload();
  await cancelLatest(t.page);
  await expect(
    t.page.getByText('关联凭证缺失、已审核或过账，不能取消成本核算').first(),
  ).toBeVisible();
  expect(await t.get<InventorySnapshot>('costingSnapshot', { period: 202601 })).toEqual(before);
  expect((await t.batches())[0]).toMatchObject({ status: 'calculated', revision: 1 });
  expect(await t.withCore((svc) => svc.vouchers.get(voucher.id))).toMatchObject({
    status: 'audited',
  });
});

test('w_cb_hz：异常回滚后可从页面发布', async ({ guarded: t }) => {
  await preview(t.page);
  const before = await t.get<InventorySnapshot>('costingSnapshot', { period: 202601 });
  await expect(
    t.withCore((svc) =>
      svc.tx(async (tx) => {
        const r = await costingService(tx).preview({ period: 202601 });
        await costingService(tx).commit({
          period: r.period,
          fingerprint: r.fingerprint,
          requestKey: 'page-rollback-fixture',
          confirmed: true,
        });
        throw new Error('后续业务失败');
      }),
    ),
  ).rejects.toThrow('后续业务失败');
  expect(await t.batches()).toEqual([]);
  expect(await t.get<InventorySnapshot>('costingSnapshot', { period: 202601 })).toEqual(before);
  await confirmPublish(t.page);
  await expect(t.page.getByText(/202601 正式成本核算已发布/)).toBeVisible();
  expect(await t.batches()).toHaveLength(1);
});

test('w_cb_pz：历史断链时成本未知', async ({ guarded: t }) => {
  await preview(t.page);
  await confirmPublish(t.page);
  await expect(t.page.getByText(/202601 正式成本核算已发布/)).toBeVisible();
  await preview(t.page, 202602);
  await confirmPublish(t.page);
  await expect(t.page.getByText(/202602 正式成本核算已发布/)).toBeVisible();
  await preview(t.page, 202603);
  await confirmPublish(t.page);
  await expect(t.page.getByText(/202603 正式成本核算已发布/)).toBeVisible();
  const latest = (await t.batches())[0]!;
  const february = (await t.batches())[1]!;
  await t.withCore(async (svc) => {
    // 3月→2月保持正确，只破坏更早的2月→1月，必须核对从锚点至启用月的全链。
    await sql`UPDATE inventory_costing_batch SET previous_batch_id=NULL WHERE id=${february.inventory_batch_id}`.execute(
      svc.db,
    );
  });
  const source = await t.get<InventorySnapshot>('costingSnapshot', { period: 202604 });
  expect(source.periodOpeningReady).toBe(true);
  expect(source.control.costBatch).toBe(latest.inventory_batch_id);
  expect(source.batches.find((b) => b.id === latest.inventory_batch_id)).toMatchObject({
    period: 202603,
    previous_batch_id: february.inventory_batch_id,
  });
  expect(source.batches.find((b) => b.id === february.inventory_batch_id)).toMatchObject({
    period: 202602,
    previous_batch_id: null,
  });
  await t.page.goto('/m/costing/profit');
  await t.page.getByRole('button', { name: '查询销售明细', exact: true }).click();
  await expect(
    t.page.getByText('不含税收入 50.00；销售成本 历史成本未知；销售毛利 历史成本未知'),
  ).toBeVisible();
  await t.page.goto(`/m/costing/vouchers?id=${t.issue.id}`);
  await t.page.getByRole('combobox', { name: '凭证用途', exact: true }).click();
  await t.page
    .locator('.ant-select-item-option-content')
    .getByText('出库成本', { exact: true })
    .click();
  await t.page.getByRole('button', { name: '预览凭证', exact: true }).click();
  await expect(
    t.page
      .getByRole('tabpanel', { name: '出入库凭证预览', exact: true })
      .getByText('历史成本未知，不能预览成本凭证'),
  ).toBeVisible();
  await t.page.goto('/m/costing/calculation');
  await expect(t.page.getByText('正式批次链与控制锚点不一致，请核对历史核算记录')).toBeVisible();
  await expect(t.page.getByRole('button', { name: '撤销正式核算', exact: true })).toHaveCount(0);
  await t.page.getByRole('spinbutton', { name: '核算年月', exact: true }).fill('202604');
  await t.page.getByRole('button', { name: '重新试算', exact: true }).click();
  await expect(
    t.page
      .getByRole('tabpanel', { name: '成本核算', exact: true })
      .getByText('正式成本批次链与库存控制锚点不一致'),
  ).toBeVisible();
  expect(await t.get<InventorySnapshot>('costingSnapshot', { period: 202604 })).toEqual(source);
});

for (const status of ['audited', 'posted'] as const) {
  test(`w_cb_pz：真实生成的${status === 'audited' ? '已审核' : '已过账'}凭证禁止撤销和覆盖`, async ({
    guarded: t,
  }) => {
    await preview(t.page);
    await confirmPublish(t.page);
    await expect(t.page.getByText(/202601 正式成本核算已发布/)).toBeVisible();
    await costVoucherPreview(t.page, t.issue.id);
    await confirmCostVoucher(t.page);
    const v = await t.withCore(async (svc) => {
      const list = await svc.vouchers.list({
        sourceModule: 'costing',
        sourceType: 'cost',
        sourceId: String(t.issue.id),
      });
      const id = list.items[0]!.id;
      await svc.vouchers.changeStatus({ ids: [id], to: 'audited' });
      if (status === 'posted') await svc.vouchers.changeStatus({ ids: [id], to: 'posted' });
      return (await svc.vouchers.get(id))!;
    });
    const before = await t.get<InventorySnapshot>('costingSnapshot', { period: 202612 });
    await t.page.reload();
    await expect(
      t.page.getByText(
        `已有成本凭证 ${v.displayNo} · ${status === 'audited' ? '已审核' : '已过账'}`,
      ),
    ).toBeVisible();
    await expect(t.page.getByRole('button', { name: '撤销成本凭证', exact: true })).toBeDisabled();
    const doc = before.documents.find((d) => d.id === t.issue.id)!;
    await expect(
      callApi(
        t.request,
        'm.costing.cancelCostVoucher',
        {
          bookId: t.bookId,
          documentId: doc.id,
          documentRevision: doc.revision,
          voucherId: v.id,
          voucherRevision: v.revision,
          confirmed: true,
        },
        { token: t.token, method: 'POST' },
      ),
    ).rejects.toThrow(/审核|过账/);
    expect(await t.withCore((svc) => svc.vouchers.get(v.id))).toEqual(v);
    expect(await t.get<InventorySnapshot>('costingSnapshot', { period: 202612 })).toEqual(before);
  });
}

test('w_cb_pz：真实HTTP制证末步故障不留凭证和来源锁，移除合成故障后可明确重试', async ({
  guarded: t,
}) => {
  await preview(t.page);
  await confirmPublish(t.page);
  await expect(t.page.getByText(/202601 正式成本核算已发布/)).toBeVisible();
  await costVoucherPreview(t.page, t.issue.id);
  const before = await t.get<InventorySnapshot>('costingSnapshot', { period: 202612 });
  await t.withCore(async (svc) => {
    await sql`CREATE TRIGGER costing_e2e_failure BEFORE INSERT ON operation_log WHEN NEW.action='costing.voucher.generate' BEGIN SELECT RAISE(ABORT,'合成制证故障'); END`.execute(
      svc.db,
    );
  });
  try {
    await t.page.getByRole('button', { name: '生成成本凭证', exact: true }).click();
    await t.page
      .getByRole('dialog')
      .getByRole('button', { name: '确认生成待审核凭证', exact: true })
      .click();
    await expect(t.page.getByRole('dialog').getByText(/合成制证故障/)).toBeVisible();
    expect(await t.get<InventorySnapshot>('costingSnapshot', { period: 202612 })).toEqual(before);
    expect(await t.withCore((svc) => svc.vouchers.list())).toMatchObject({ total: 0 });
  } finally {
    await t.withCore(async (svc) => {
      await sql`DROP TRIGGER costing_e2e_failure`.execute(svc.db);
    });
  }
  await t.page.getByRole('dialog').getByRole('button', { name: '返回核对', exact: true }).click();
  await confirmCostVoucher(t.page);
  expect(await t.withCore((svc) => svc.vouchers.list())).toMatchObject({ total: 1 });
  expect(
    (await t.get<InventorySnapshot>('costingSnapshot', { period: 202612 })).voucherSources,
  ).toHaveLength(1);
});
