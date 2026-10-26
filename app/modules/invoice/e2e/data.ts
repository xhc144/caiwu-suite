import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import type { CoreServices } from '@caiwu/core/server';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Invoice, PlanInput, Settings } from '../shared';
import { sampleFile } from '../test/fixtures';
import type { Isolated } from './isolated';

export async function createInvoiceAccounts(svc: CoreServices): Promise<Settings> {
  const scheme = (await svc.book.info()).codeScheme;
  const department = await svc.dimensions.create({
    type: 'department',
    code: 'E2E-D',
    name: '发票测试部门',
  });
  const partner = await svc.dimensions.create({
    type: 'partner',
    code: 'E2E-S',
    name: '发票测试供应商',
  });
  const business = await svc.accounts.create(
    {
      code: '7901',
      name: '发票测试费用',
      categoryId: 'pnl',
      dimensions: [{ type: 'department', required: true }],
    },
    scheme,
  );
  const tax = await svc.accounts.create(
    { code: '7902', name: '发票测试进项税', categoryId: 'liability', direction: 'debit' },
    scheme,
  );
  const settlement = await svc.accounts.create(
    {
      code: '7903',
      name: '发票测试应付',
      categoryId: 'liability',
      dimensions: [{ type: 'partner', required: true }],
    },
    scheme,
  );
  const nonDeductible = await svc.accounts.create(
    { code: '7904', name: '发票测试非抵扣费用', categoryId: 'pnl' },
    scheme,
  );
  return {
    direction: 'input',
    expectedRevision: 0,
    taxpayerBasis: 'other',
    inputTaxTreatment: 'separate',
    business: { accountId: business.id, dimensions: { department: department.id } },
    tax: { accountId: tax.id, dimensions: {} },
    settlement: { accountId: settlement.id, dimensions: { partner: partner.id } },
    nonDeductible: { accountId: nonDeductible.id, dimensions: {} },
  };
}

/** Independent real HTTP setup for focused source/export tests; no shared book or mocked API. */
export async function bookWithInvoices(page: Page, isolated: Isolated, posted = false) {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const file = await sampleFile();
  await callApi(isolated.request, 'm.invoice.commitImport', file, { token });
  if (posted) {
    const mapping = await isolated.inBook(bookId, createInvoiceAccounts);
    await callApi(isolated.request, 'm.invoice.saveSettings', mapping, { token });
    let rows = await callApi<Invoice[]>(
      isolated.request,
      'm.invoice.list',
      {},
      { token, method: 'GET' },
    );
    await callApi(
      isolated.request,
      'm.invoice.audit',
      { selection: rows.map((r) => ({ id: r.id, revision: r.revision })), to: 'audited' },
      { token },
    );
    rows = await callApi<Invoice[]>(
      isolated.request,
      'm.invoice.list',
      {},
      { token, method: 'GET' },
    );
    const input: PlanInput = {
      selection: rows.map((r) => ({ id: r.id, revision: r.revision })),
      date: '2026-02-28',
      voucherTypeId: 1,
      mode: 'monthly',
    };
    const preview = await callApi<{ fingerprint: string }>(
      isolated.request,
      'm.invoice.previewVoucher',
      input,
      { token, method: 'GET' },
    );
    const groups = await callApi<{ voucher_id: number }[]>(
      isolated.request,
      'm.invoice.generate',
      { ...input, fingerprint: preview.fingerprint, requestId: randomUUID() },
      { token },
    );
    await isolated.inBook(bookId, async (svc) => {
      await svc.vouchers.changeStatus({ ids: groups.map((g) => g.voucher_id), to: 'audited' });
      await svc.vouchers.changeStatus({ ids: groups.map((g) => g.voucher_id), to: 'posted' });
    });
  }
  const docs = await callApi<Invoice[]>(
    isolated.request,
    'm.invoice.list',
    {},
    { token, method: 'GET' },
  );
  return { bookId, token, file, docs };
}

export async function saveInvoiceAgain(request: APIRequestContext, token: string, doc: Invoice) {
  return callApi(
    request,
    'm.invoice.save',
    {
      id: doc.id,
      revision: doc.revision,
      data: Object.fromEntries(
        Object.entries(doc).filter(
          ([k]) =>
            ![
              'id',
              'revision',
              'state',
              'period',
              'batchId',
              'groupId',
              'voucherId',
              'voucherNo',
              'voucherStatus',
            ].includes(k),
        ),
      ),
    },
    { token },
  );
}
