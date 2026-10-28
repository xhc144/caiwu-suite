import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { DocumentInput } from '../shared';
import type { ExchangeFile } from '../exchange';

type SavedDocument = { id: number; revision: number; number: string };
async function setup(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    {
      code: '01',
      name: '合同往返仓',
    },
    { token },
  );
  await callApi(
    request,
    'm.inventory.saveProduct',
    { code: 'CR-P1', name: '合同反冲产品' },
    { token },
  );
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token },
  );
  const partners = await callApi<{ id: number; code: string }[]>(
    request,
    'core.dimensions.items',
    {
      type: 'partner',
    },
    { token, method: 'GET' },
  );
  const accountId = accounts.find((a) => a.code === '1001')!.id;
  const contract = await callApi<{ id: number }>(
    request,
    'm.inventory.saveContract',
    {
      number: 'HT-ROUNDTRIP',
      warehouseId,
      supplierId: partners.find((p) => p.code === 'S001')!.id,
      date: '2026-01-05',
      lines: [{ productCode: 'CR-P1', quantity: '10', unitPrice: '2.5' }],
    },
    { token },
  );
  const receive = async (number: string) => {
    const draft = await callApi<DocumentInput>(
      request,
      'm.inventory.contractDraft',
      {
        id: contract.id,
      },
      { token, method: 'GET' },
    );
    return callApi<SavedDocument>(
      request,
      'm.inventory.saveDocument',
      {
        ...draft,
        accountId,
        number,
      },
      { token },
    );
  };
  return {
    token,
    warehouseId,
    contract,
    receive,
    costAccountId: accounts.find((a) => a.code === '6401')!.id,
  };
}

test('ht1/ht2/w_ck_rk：真实三单下载跨账套转入，合同保持履约10，额度重用后页面删除反冲拒绝', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  const source = await setup(page, request);
  const first = await source.receive('CR-R1');
  await callApi(
    request,
    'm.inventory.reverseDocument',
    {
      id: first.id,
      revision: first.revision,
      requestKey: crypto.randomUUID(),
      number: 'CR-I1',
      date: '2026-01-10',
      accountId: source.costAccountId,
      confirmed: true,
    },
    { token: source.token },
  );
  await source.receive('CR-R2');
  await page.goto('/m/inventory/receipts');
  for (const number of ['CR-R2', 'CR-I1', 'CR-R1']) {
    await page.getByLabel('多单转出选择', { exact: true }).fill(number);
    await page.keyboard.press('Enter');
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '多单文件转出', exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  const file = JSON.parse(bytes.toString()) as ExchangeFile;
  expect(file.documents.map((d) => d.number)).toEqual(['CR-R2', 'CR-I1', 'CR-R1']);
  expect(file.version).toBe(2);
  if (file.version !== 2) throw new Error('缺少反冲关系');
  expect(file.relations.reversals).toEqual([
    { originalKey: 'document-3', reversalKey: 'document-2' },
  ]);

  const targetPage = await page.context().newPage();
  const target = await setup(targetPage, request);
  await targetPage.goto('/m/inventory/receipts');
  await targetPage.getByRole('button', { name: '多单文件转入', exact: true }).click();
  const modal = targetPage.getByRole('dialog', { name: '多单文件转入：核对头行后整批保存' });
  await modal.getByLabel('多单转入文件', { exact: true }).setInputFiles({
    name: '合同入库反冲再入库.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  await modal.getByRole('button', { name: '预览全部单据', exact: true }).click();
  await expect(modal.getByText(/预览 3 张单据，0 个错误/)).toBeVisible();
  targetPage.once('dialog', (dialog) => dialog.accept());
  await modal.getByRole('button', { name: '确认整批转入', exact: true }).click();
  await expect(modal).not.toBeVisible();
  const documents = await callApi<SavedDocument[]>(
    request,
    'm.inventory.documents',
    {},
    {
      token: target.token,
      method: 'GET',
    },
  );
  expect(documents).toHaveLength(3);
  const fulfillment = await callApi<{
    rows: { planned: string; received: string; remaining: string }[];
  }>(
    request,
    'm.inventory.contractFulfillment',
    { id: target.contract.id },
    { token: target.token, method: 'GET' },
  );
  expect(fulfillment.rows[0]).toMatchObject({ planned: '10', received: '10', remaining: '0' });

  await targetPage.goto('/m/inventory/issues');
  const reversalRow = targetPage.getByRole('row').filter({
    has: targetPage.getByRole('cell', { name: 'CR-I1', exact: true }),
  });
  targetPage.once('dialog', (dialog) => dialog.accept());
  await reversalRow.getByRole('button', { name: '删除', exact: true }).click();
  await expect(
    targetPage.getByText(/撤销反冲会使产品 CR-P1 的合同累计入库超过计划数量 10/),
  ).toBeVisible();
  expect(
    await callApi(request, 'm.inventory.documents', {}, { token: target.token, method: 'GET' }),
  ).toEqual(documents);
  await targetPage.goto('/m/inventory/contracts');
  const contractRow = targetPage.getByRole('row').filter({
    has: targetPage.getByRole('cell', { name: 'HT-ROUNDTRIP', exact: true }),
  });
  await contractRow.getByRole('button', { name: '履约明细', exact: true }).click();
  const detail = targetPage.getByRole('dialog', { name: '采购合同履约明细', exact: true });
  const productRow = detail.getByRole('row').filter({ hasText: 'CR-P1' });
  await expect(productRow.getByRole('cell', { name: '10', exact: true })).toHaveCount(2);
  await expect(productRow.getByRole('cell', { name: '0', exact: true })).toBeVisible();
  await expect(productRow.getByRole('cell', { name: '0', exact: true })).toBeInViewport();
  await targetPage.screenshot({
    path: testInfo.outputPath('合同反冲往返履约.png'),
    animations: 'disabled',
  });
});

for (const scenario of ['满额合同迁入净零历史', '四单选择顺序不制造负库存'] as const) {
  test(`ht1/ht2/w_ck_rk：${scenario}，真实下载并跨账套预览保存`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    const source = await setup(page, request);
    const first = await source.receive('CR-R1');
    await callApi(
      request,
      'm.inventory.reverseDocument',
      {
        id: first.id,
        revision: first.revision,
        requestKey: crypto.randomUUID(),
        number: 'CR-I1',
        date: '2026-01-10',
        accountId: source.costAccountId,
        confirmed: true,
      },
      { token: source.token },
    );
    const full = scenario === '满额合同迁入净零历史';
    if (!full) {
      await source.receive('CR-R2');
      await callApi(
        request,
        'm.inventory.saveDocument',
        {
          requestKey: crypto.randomUUID(),
          kind: 'issue',
          warehouseId: source.warehouseId,
          number: 'CR-O',
          date: '2026-01-12',
          category: '领用',
          costAccountId: source.costAccountId,
          lines: [{ productCode: 'CR-P1', quantity: '10', unitPrice: '2.5' }],
        },
        { token: source.token },
      );
    }
    await page.goto('/m/inventory/receipts');
    for (const number of full ? ['CR-I1', 'CR-R1'] : ['CR-R1', 'CR-R2', 'CR-O', 'CR-I1']) {
      await page.getByLabel('多单转出选择', { exact: true }).fill(number);
      await page.keyboard.press('Enter');
    }
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '多单文件转出', exact: true }).click();
    const bytes = await readFile((await (await download).path())!);
    const targetPage = await page.context().newPage();
    const target = await setup(targetPage, request);
    if (full) await target.receive('TARGET-FULL');
    await targetPage.goto('/m/inventory/receipts');
    await targetPage.getByRole('button', { name: '多单文件转入', exact: true }).click();
    const modal = targetPage.getByRole('dialog', { name: '多单文件转入：核对头行后整批保存' });
    await modal.getByLabel('多单转入文件', { exact: true }).setInputFiles({
      name: `${scenario}.json`,
      mimeType: 'application/json',
      buffer: bytes,
    });
    await modal.getByRole('button', { name: '预览全部单据', exact: true }).click();
    await expect(
      modal.getByText(new RegExp(`预览 ${full ? 2 : 4} 张单据，0 个错误`)),
    ).toBeVisible();
    await expect(modal.getByText('转入后库存不足，默认取消', { exact: true })).toHaveCount(0);
    targetPage.once('dialog', (dialog) => dialog.accept());
    await modal.getByRole('button', { name: '确认整批转入', exact: true }).click();
    await expect(modal).not.toBeVisible();
    const fulfillment = await callApi<{ rows: { received: string; remaining: string }[] }>(
      request,
      'm.inventory.contractFulfillment',
      { id: target.contract.id },
      { token: target.token, method: 'GET' },
    );
    expect(fulfillment.rows[0]).toMatchObject({ received: '10', remaining: '0' });
    const stock = await callApi<{ balance: string }[]>(
      request,
      'm.inventory.stock',
      {
        warehouseId: target.warehouseId,
      },
      { token: target.token, method: 'GET' },
    );
    expect(stock[0]?.balance).toBe(full ? '10' : '0');
    await targetPage.screenshot({
      path: testInfo.outputPath(`${scenario}.png`),
      animations: 'disabled',
    });
  });
}
