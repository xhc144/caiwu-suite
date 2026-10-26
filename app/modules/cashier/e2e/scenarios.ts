import { randomUUID } from 'node:crypto';
import type { inferRouterOutputs } from '@trpc/server';
import { loginWithNewBook, callApi, type E2EBook } from '@caiwu/testkit/e2e';
import type { CashierRouter } from '../server/router';
import type { CashierFixture } from './fixture';
import { expect } from './fixture';

type Outputs = inferRouterOutputs<CashierRouter>;
export type BankBook = E2EBook & { accountId: number; cashflow: number; voucherTypeId: number };
export const receipts = [
  { summary: '客户到账', amount: 20000, direction: 'receipt' },
  { summary: '支付手续费', amount: 8000, direction: 'payment' },
  { summary: '利息到账', amount: 2500, direction: 'receipt' },
] as const;

// 每个场景都有独占服务、目录和新账套；前置也走本模块真实 HTTP mutation。
// 只有账务期初及审核/过账前置由已知目录的 core 服务建立，无跨模块接口。
export async function bankBook(cashier: CashierFixture): Promise<BankBook> {
  const book = await loginWithNewBook(cashier.page, cashier.request, { product: 'chengben' });
  const ids = await cashier.withServices(book.bookId, async (svc) => {
    const bank = await svc.accounts.require('100201');
    await svc.opening.upsert({ year: 2026, accountId: bank.id, balance: 100000 });
    return {
      bankId: bank.id,
      cashflow: (await svc.dimensions.getByCode('cashflow', 'CF01'))!.id,
      voucherTypeId: (await svc.reference.voucherTypes())[0]!.id,
    };
  });
  await callApi(cashier.request, 'm.cashier.enable', { period: 202601 }, { token: book.token });
  const account = await callApi<{ id: number }>(
    cashier.request,
    'm.cashier.saveAccount',
    {
      data: { name: '闭环银行', coreAccountId: ids.bankId, currency: 'CNY', opening: 100000 },
    },
    { token: book.token },
  );
  return {
    ...book,
    accountId: account.id,
    cashflow: ids.cashflow,
    voucherTypeId: ids.voucherTypeId,
  };
}

export const documents = (cashier: CashierFixture, book: BankBook) =>
  callApi<Outputs['documents']>(
    cashier.request,
    'm.cashier.documents',
    {},
    { token: book.token, method: 'GET' },
  );
export const reconciliation = (cashier: CashierFixture, book: BankBook) =>
  callApi<Outputs['reconcile']>(
    cashier.request,
    'm.cashier.reconcile',
    { accountId: book.accountId, cutoff: '2026-01-31' },
    { token: book.token, method: 'GET' },
  );

export async function recordThree(cashier: CashierFixture, book: BankBook) {
  const oppositeAccountId = await cashier.withServices(
    book.bookId,
    async (svc) => (await svc.accounts.require('6603')).id,
  );
  for (const row of receipts) {
    await callApi(
      cashier.request,
      'm.cashier.createDocument',
      {
        ...row,
        accountId: book.accountId,
        period: 202601,
        date: '2026-01-10',
        oppositeAccountId,
        dimensions: { cashflow: book.cashflow },
        requestKey: randomUUID(),
      },
      { token: book.token },
    );
  }
  const rows = await documents(cashier, book);
  expect(rows.map((d) => [d.summary, d.amount, d.direction])).toEqual(
    receipts.map((d) => [d.summary, d.amount, d.direction]),
  );
  return rows;
}

export async function postGenerated(
  cashier: CashierFixture,
  book: BankBook,
  expectedCount: number,
) {
  const rows = await documents(cashier, book);
  const ids = [...new Set(rows.map((d) => d.voucherId!))];
  expect(ids).toHaveLength(expectedCount);
  expect(rows).toHaveLength(3);
  await cashier.withServices(book.bookId, async (svc) => {
    let total = 0;
    for (const id of ids) {
      const v = (await svc.vouchers.get(id))!;
      expect(v.status).toBe('pending');
      expect(v.debitTotal).toBe(v.creditTotal);
      expect(v.source).toEqual({ module: 'cashier', type: 'batch', id: String(rows[0]!.batchId) });
      total += v.debitTotal;
    }
    expect(total).toBe(30500);
    await svc.vouchers.changeStatus({ ids, to: 'audited' });
    await svc.vouchers.changeStatus({ ids, to: 'posted' });
  });
  const ledger = await reconciliation(cashier, book);
  expect(ledger.entries).toHaveLength(3);
  expect(ledger.adjustment).toMatchObject({
    cashOpening: 100000,
    coreOpening: 100000,
    cashBalance: 114500,
    coreBalance: 114500,
    difference: 0,
  });
}

export async function postedBook(cashier: CashierFixture) {
  const book = await bankBook(cashier);
  const rows = await recordThree(cashier, book);
  await callApi(
    cashier.request,
    'm.cashier.generate',
    {
      documents: rows.map((d) => ({ id: d.id, revision: d.revision })),
      date: '2026-01-10',
      voucherTypeId: book.voucherTypeId,
      mode: 'individual',
      requestKey: randomUUID(),
    },
    { token: book.token },
  );
  await postGenerated(cashier, book, 3);
  return book;
}
