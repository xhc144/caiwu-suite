import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

// 所有业务提交走真实 HTTP；发布、确认、查看和撤销由实际页面触发，不拦截或 mock 核心服务。
export async function seed(page: Page, request: APIRequestContext) {
  const { bookId, token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const accounts = await callApi<{ id: number; code: string }[]>(request, 'core.accounts.list', undefined, { token, method: 'GET' });
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  const post = <T>(name: string, input: unknown) => callApi<T>(request, `m.inventory.${name}`, input, { token, method: 'POST' });
  const get = <T>(name: string, input: unknown = {}) => callApi<T>(request, `m.inventory.${name}`, input, { token, method: 'GET' });
  const batches = () => callApi<{ id: number; inventory_batch_id: string; status: string; revision: number }[]>(request, 'm.costing.batches', undefined, { token, method: 'GET' });
  const warehouseId = await post<number>('saveWarehouse', { code: '01', name: '正式核算仓' });
  await post('saveProduct', { code: 'P1', name: '黄金产品', inventoryAccountId: id('1405'), salesAccountId: id('6001') });
  await post('saveOpening', { warehouseId, revision: 0, rows: [{ productCode: 'P1', quantity: '10', unitPrice: '1' }] });
  const document = (kind: 'receipt' | 'issue', quantity: string, unitPrice: string, date = '2026-01-10') => post<{ id: number }>('saveDocument', {
    requestKey: randomUUID(), kind, warehouseId, number: randomUUID(), date,
    category: kind === 'receipt' ? '采购' : '销售', accountId: id('1001'), costAccountId: id('6401'),
    lines: [{ productCode: 'P1', quantity, unitPrice }],
  });
  await document('receipt', '10', '3');
  const issue = await document('issue', '5', '10');
  return { bookId, token, warehouseId, issue, post, get, batches, document };
}
export async function preview(page: Page, period = 202601) {
  await page.goto('/m/costing/calculation');
  await expect(page.getByRole('heading', { name: '成本核算', exact: true })).toBeVisible();
  await page.getByRole('spinbutton', { name: '核算年月', exact: true }).fill(String(period));
  await page.getByRole('button', { name: '重新试算', exact: true }).click();
  await expect(page.getByRole('button', { name: '发布正式核算', exact: true })).toBeVisible();
}
export async function confirmPublish(page: Page) {
  await page.getByRole('button', { name: '发布正式核算', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('确认后将正式写入库存成本');
  await dialog.getByRole('button', { name: '确认发布并锁定本月', exact: true }).click();
}
export async function cancelLatest(page: Page) {
  await page.getByRole('button', { name: '撤销正式核算', exact: true }).click();
  await page.getByRole('button', { name: '确认撤销', exact: true }).click();
}
