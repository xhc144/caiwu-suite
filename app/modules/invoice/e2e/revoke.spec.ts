import { randomUUID } from 'node:crypto';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Voucher } from '@caiwu/core';
import type { inferRouterOutputs } from '@trpc/server';
import type { InvoiceRouter } from '../server/router';
import type { Invoice, IssueOptions } from '../shared';
import { mapping, single } from '../test/fixtures';
import { test, expect } from './isolated';

type Outputs = inferRouterOutputs<InvoiceRouter>;

for (const renumberAfterDelete of [false, true])
  test(`w_fp_pz：真实库存成本链，删除重排 ${renumberAfterDelete}，预览确认与并发失效`, async ({
    page,
    isolated,
  }) => {
    const { bookId, token } = await loginWithNewBook(page, isolated.request, {
      product: 'chengben',
    });
    const get = <T>(name: string, input?: unknown) =>
      callApi<T>(isolated.request, name, input, { token, method: 'GET' });
    const post = <T>(name: string, input: unknown) =>
      callApi<T>(isolated.request, name, input, { token });
    await post('core.voucherPolicy.set', {
      numbering: 'automatic',
      renumberAfterDelete,
      allowModifyOthers: false,
    });
    const { cfg, stockAccountId, costAccountId } = await isolated.inBook(bookId, async (svc) => ({
      cfg: await mapping(svc, 'output'),
      stockAccountId: (await svc.accounts.require('1405')).id,
      costAccountId: (await svc.accounts.require('6401')).id,
    }));
    await post('m.invoice.saveSettings', cfg);
    const warehouseId = await post<number>('m.inventory.saveWarehouse', {
      code: 'REVOKE',
      name: '合成撤销仓库',
    });
    await post('m.inventory.saveProduct', {
      code: 'REVOKE',
      name: '合成撤销商品',
      unit: '件',
      inventoryAccountId: stockAccountId,
      salesAccountId: cfg.business.accountId,
    });
    await post('m.inventory.saveOpening', {
      warehouseId,
      revision: 0,
      rows: [{ productCode: 'REVOKE', quantity: '10', unitPrice: '3' }],
    });
    const id = await post<number>('m.invoice.save', {
      data: single({
        direction: 'output',
        number: 'REVOKE-ISSUED',
        date: '2026-01-05',
        confirmDate: null,
        amount: 10000,
        tax: 1300,
        total: 11300,
        lines: [
          {
            name: '合成撤销商品',
            unit: '件',
            quantity: '2',
            unitPrice: '50',
            taxRate: '0.13',
            taxMark: 'rate',
            amount: 10000,
            tax: 1300,
            total: 11300,
          },
        ],
      }),
    });
    await post('m.invoice.audit', { selection: [{ id, revision: 1 }], to: 'audited' });
    const issueOptions: IssueOptions = {
      invoiceId: id,
      invoiceRevision: 2,
      requestKey: randomUUID(),
      warehouseId,
      date: '2026-01-05',
      number: 'REVOKE-OUT',
      settlementAccountId: cfg.settlement.accountId,
      costAccountId,
      regenerate: false,
      products: [{ lineNo: 1, productCode: 'REVOKE', create: false }],
    };
    const issuePlan = await post<Outputs['previewIssue']>('m.invoice.previewIssue', issueOptions);
    const issue = await post<{ id: number }>('m.invoice.saveIssue', {
      options: issueOptions,
      fingerprint: issuePlan.fingerprint,
      plan: issuePlan.plan,
      newProductsConfirmed: false,
      negativeStockConfirmed: false,
      replacementConfirmed: false,
    });
    // 先生成成本凭证；删除收入时不应越过其他模块的来源锁。
    const calculation = await get<{ fingerprint: string }>('m.costing.preview', { period: 202601 });
    await post('m.costing.commit', {
      period: 202601,
      fingerprint: calculation.fingerprint,
      requestKey: randomUUID(),
      confirmed: true,
    });
    const costTarget = { documentId: issue.id, purpose: 'cost' };
    const costPlan = await get<{
      fingerprint: string;
      expectedRevision: number;
      debitCents: number;
    }>('m.costing.previewVoucher', costTarget);
    expect(costPlan.debitCents).toBe(600);
    await post('m.costing.generateVoucher', {
      ...costTarget,
      ...costPlan,
      voucherTypeId: 1,
      confirmed: true,
    });
    const invoice = async () => (await get<Invoice[]>('m.invoice.list', { id }))[0]!;
    const vouchers = () => get<{ total: number; items: Voucher[] }>('core.vouchers.list', {});
    const generate = async () => {
      const input = {
        selection: [{ id, revision: (await invoice()).revision }],
        date: '2026-01-05',
        voucherTypeId: 1,
        mode: 'individual',
      };
      const plan = await get<Outputs['previewVoucher']>('m.invoice.previewVoucher', input);
      return post<{ id: number; voucher_id: number }[]>('m.invoice.generate', {
        ...input,
        fingerprint: plan.fingerprint,
        requestId: randomUUID(),
      });
    };
    const [group] = await generate();
    const beforeInvoice = await invoice();
    const revenue = await get<Voucher>('core.vouchers.get', { id: group!.voucher_id });
    expect(revenue.number).toBe(2);
    const costVoucher = (await vouchers()).items.find((v) => v.id !== revenue.id)!;
    const beforeCost = await get<Voucher>('core.vouchers.get', { id: costVoucher.id });
    const beforeIssues = await get('m.inventory.documents', { kind: 'issue' });
    const addManual = () =>
      isolated.inBook(bookId, (svc) =>
        svc.vouchers.create({
          date: '2026-01-05',
          voucherTypeId: 1,
          lines: [
            { accountId: costAccountId, summary: '合成并发测试凭证', debit: 100 },
            { accountId: cfg.tax.accountId, summary: '合成并发测试凭证', credit: 100 },
          ],
        }),
      );
    const manual = await addManual();
    expect(manual.number).toBe(3);
    const target = { id: group!.id, expectedRevision: revenue.revision };
    await expect(post('m.invoice.revoke', { ...target, confirmed: true })).rejects.toThrow(
      /先预览撤销/,
    );
    const preview = await get<Outputs['previewRevoke']>('m.invoice.previewRevoke', target);
    expect(preview.invoices).toEqual([{ id, number: 'REVOKE-ISSUED', state: 'issued' }]);
    expect(
      preview.impacts
        .filter((p) => p.oldNumber !== p.number)
        .map((p) => [p.id, p.oldNumber, p.number]),
    ).toEqual(renumberAfterDelete ? [[manual.id, 3, 2]] : []);

    await page.goto(`${isolated.origin}/m/invoice/process?direction=output&period=202601`);
    await page.getByRole('button', { name: '整体撤销', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '撤销来源凭证预览', exact: true });
    const confirm = dialog.getByRole('button', { name: '确认整体撤销', exact: true });
    const checkbox = dialog.getByRole('checkbox', {
      name: '已核对来源发票与编号影响，确认整体撤销',
      exact: true,
    });
    await expect(dialog).toContainText('REVOKE-ISSUED：恢复为已转出库');
    await expect(confirm).toBeDisabled();
    await checkbox.check();
    await expect(confirm).toBeEnabled();
    if (renumberAfterDelete) {
      // 用户已看过映射后，另一窗口新增凭证；旧确认必须失败且不能悄悄确认新映射。
      await addManual();
      const before = await vouchers();
      const rejected = page.waitForResponse((r) => r.url().includes('m.invoice.revoke'));
      await confirm.click();
      expect((await rejected).ok()).toBe(false);
      await expect(confirm).toBeDisabled();
      expect(await vouchers()).toEqual(before);
      expect(await invoice()).toEqual(beforeInvoice);
      await dialog.getByRole('button', { name: '重新预览撤销', exact: true }).click();
      await expect(checkbox).not.toBeChecked();
      await expect(dialog.getByRole('row')).toHaveCount(4);
      await checkbox.check();
    }
    const revoked = page.waitForResponse((r) => r.url().includes('m.invoice.revoke'));
    await confirm.click();
    expect((await revoked).ok()).toBe(true);
    await expect(dialog).not.toBeVisible();
    expect(await invoice()).toMatchObject({
      state: 'issued',
      groupId: null,
      voucherId: null,
      inventoryDocumentId: issue.id,
      issueNumber: 'REVOKE-OUT',
    });
    expect(await get('m.inventory.documents', { kind: 'issue' })).toEqual(beforeIssues);
    expect(await get('core.vouchers.get', { id: costVoucher.id })).toEqual(beforeCost);
    expect(
      (await get<{ balance: string }[]>('m.inventory.stock', { warehouseId }))[0]!.balance,
    ).toBe('8');
    expect((await vouchers()).items.map((v) => v.number).sort()).toEqual(
      renumberAfterDelete ? [1, 2, 3] : [1, 3],
    );
    await expect(
      post('m.invoice.audit', {
        selection: [{ id, revision: (await invoice()).revision }],
        to: 'draft',
      }),
    ).rejects.toThrow(/已后续处理/);
    await expect(
      get('m.costing.previewVoucher', { documentId: issue.id, purpose: 'revenue' }),
    ).rejects.toThrow(/发票/);
    const [next] = await generate();
    const nextVoucher = await get<Voucher>('core.vouchers.get', { id: next!.voucher_id });
    await isolated.inBook(bookId, (svc) =>
      svc.vouchers.changeStatus({ ids: [nextVoucher.id], to: 'audited' }),
    );
    await expect(
      get('m.invoice.previewRevoke', { id: next!.id, expectedRevision: nextVoucher.revision + 1 }),
    ).rejects.toThrow(/审核|过账/);
    const numbers = (await vouchers()).items.map((v) => v.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect((await invoice()).state).toBe('generated');
  });
