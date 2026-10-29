import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
test('w_cb_pdk_1：产品集合调整确认后新增月末账面，保留原行快照和实盘', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const warehouseId = await callApi<number>(
    request,
    'm.inventory.saveWarehouse',
    { code: '01', name: '盘点集合仓' },
    { token },
  );
  await callApi(request, 'm.inventory.saveProduct', { code: 'P1', name: '原盘点产品' }, { token });
  await callApi(
    request,
    'm.inventory.saveOpening',
    { warehouseId, revision: 0, rows: [{ productCode: 'P1', quantity: '10', unitPrice: '2' }] },
    { token },
  );
  const generated = await callApi<{ revision: number }>(
    request,
    'm.inventory.generateCount',
    { warehouseId, period: 202601, revision: 0, confirmed: false },
    { token },
  );
  await callApi(
    request,
    'm.inventory.saveCount',
    {
      warehouseId,
      period: 202601,
      revision: generated.revision,
      rows: [{ productCode: 'P1', actual: '9' }],
    },
    { token },
  );
  await callApi(request, 'm.inventory.saveProduct', { code: 'P2', name: '新盘点产品' }, { token });
  const accounts = await callApi<{ id: number; code: string }[]>(
    request,
    'core.accounts.list',
    undefined,
    { token },
  );
  await callApi(
    request,
    'm.inventory.saveDocument',
    {
      kind: 'receipt',
      warehouseId,
      requestKey: crypto.randomUUID(),
      number: 'COUNT-R1',
      date: '2026-01-10',
      category: '采购',
      accountId: accounts.find((a) => a.code === '1001')!.id,
      lines: [{ productCode: 'P2', quantity: '5', unitPrice: '3' }],
    },
    { token },
  );
  await page.goto('/m/inventory/counts');
  await page.getByRole('button', { name: '调整盘点产品', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '调整盘点产品集合' });
  await modal.getByLabel('盘点产品集合', { exact: true }).fill('P2');
  await page.keyboard.press('Enter');
  page.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: '核对并确认调整' }).click();
  await expect(modal).not.toBeVisible();
  const first = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'P1', exact: true }) });
  await expect(first.getByRole('cell').nth(2)).toHaveText('10');
  await expect(first.getByRole('cell').nth(3)).toHaveText('9');
  const second = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'P2', exact: true }) });
  await expect(second.getByRole('cell').nth(2)).toHaveText('5');
  await expect(second.getByRole('cell').nth(3)).toHaveText('5');
});
