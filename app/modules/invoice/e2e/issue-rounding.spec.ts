import { randomUUID } from 'node:crypto';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { inferRouterOutputs } from '@trpc/server';
import type { InvoiceRouter } from '../server/router';
import type { Invoice, IssueOptions } from '../shared';
import { mapping, single } from '../test/fixtures';
import { test, expect } from './isolated';

// 记录现有跨域口径差异，供产品决定；此测试不授权改变原票金额或库存计价。
test('w_fp_pz_ckd：票面税额尾差 1 分可保存审核，但现有库存严格金额口径拒绝预览', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(isolated.request, name, input, { token, method: 'GET' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(isolated.request, name, input, { token });
  const { cfg, stockAccountId, costAccountId } = await isolated.inBook(bookId, async (svc) => ({
    cfg: await mapping(svc, 'output'),
    stockAccountId: (await svc.accounts.require('1405')).id,
    costAccountId: (await svc.accounts.require('6401')).id,
  }));
  await post('m.invoice.saveSettings', cfg);
  const warehouseId = await post<number>('m.inventory.saveWarehouse', {
    code: 'ROUND',
    name: '合成尾差仓库',
  });
  await post('m.inventory.saveProduct', {
    code: 'ROUND',
    name: '合成尾差商品',
    unit: '件',
    inventoryAccountId: stockAccountId,
    salesAccountId: cfg.business.accountId,
  });
  await post('m.inventory.saveOpening', {
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'ROUND', quantity: '10', unitPrice: '3' }],
  });
  const beforeStock = await get('m.inventory.stock', { warehouseId });
  for (const tax of [1299, 1300]) {
    const id = await post<number>('m.invoice.save', {
      data: single({
        direction: 'output',
        number: `ROUND-${tax}`,
        date: '2026-01-05',
        confirmDate: null,
        amount: 10000,
        tax,
        total: 10000 + tax,
        lines: [
          {
            name: '合成尾差商品',
            unit: '件',
            quantity: '2',
            unitPrice: '50',
            taxRate: '0.13',
            taxMark: 'rate',
            amount: 10000,
            tax,
            total: 10000 + tax,
          },
        ],
      }),
    });
    await post('m.invoice.audit', { selection: [{ id, revision: 1 }], to: 'audited' });
    const saved = (await get<Invoice[]>('m.invoice.list', { id }))[0]!;
    expect(saved).toMatchObject({ state: 'audited', amount: 10000, tax, total: 10000 + tax });
    const options: IssueOptions = {
      invoiceId: id,
      invoiceRevision: saved.revision,
      requestKey: randomUUID(),
      warehouseId,
      date: '2026-01-05',
      number: `ROUND-OUT-${tax}`,
      settlementAccountId: cfg.settlement.accountId,
      costAccountId,
      regenerate: false,
      products: [{ lineNo: 1, productCode: 'ROUND', create: false }],
    };
    if (tax === 1299) {
      await expect(post('m.invoice.previewIssue', options)).rejects.toThrow(
        /第 1 行发票净额、税额、合计与数量、单价和税率不一致/,
      );
    } else {
      const plan = await post<inferRouterOutputs<InvoiceRouter>['previewIssue']>(
        'm.invoice.previewIssue',
        options,
      );
      expect(plan.input.lines[0]).toMatchObject({
        netCents: 10000,
        taxCents: 1300,
        totalCents: 11300,
        taxRate: '13',
      });
    }
    expect(await get('m.inventory.stock', { warehouseId })).toEqual(beforeStock);
    expect(await get('m.inventory.documents', { kind: 'issue' })).toEqual([]);
    expect((await get<Invoice[]>('m.invoice.list', { id }))[0]).toEqual(saved);
  }
});
