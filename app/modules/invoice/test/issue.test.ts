import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import type { CoreServices } from '@caiwu/core/server';
import type { InvoiceIssueInput, InvoiceIssuePlan, InvoiceIssueReferences } from '@caiwu/core';
import {
  IssueOptionsSchema,
  type InvoiceInput,
  type IssueOptions,
  type IssueSave,
} from '../shared';
import type { InvoiceTables } from '../server/migrations';
import { invoiceIssueService } from '../server/issue-service';
import server from '../server';
import { mapping, single } from './fixtures';

let app: TestApp;
let catalogAccounts: { inventory: number; sales: number };
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  await app.close();
});
async function setup(overrides: Partial<InvoiceInput> = {}, audit = true) {
  const api = app.call(server);
  const cfg = await mapping(app.svc, 'output');
  await api.saveSettings(cfg);
  const cost = await app.svc.accounts.create(
    { code: '9800', name: '合成销售成本', categoryId: 'pnl' },
    (await app.svc.book.info()).codeScheme,
  );
  catalogAccounts = { inventory: cost.id, sales: cfg.business.accountId };
  const data: InvoiceInput = single({
    direction: 'output',
    number: 'ISSUE-SYNTHETIC',
    date: '2026-02-05',
    confirmDate: null,
    amount: 10001,
    tax: 1300,
    total: 11301,
    lines: [
      {
        name: '合成商品',
        specification: 'S-1',
        unit: '件',
        quantity: '2',
        unitPrice: '50.005',
        taxRate: '0.13',
        taxMark: 'rate',
        amount: 10001,
        tax: 1300,
        total: 11301,
      },
    ],
    ...overrides,
  });
  const id = await api.save({ data });
  if (audit) await api.audit({ selection: [{ id, revision: 1 }], to: 'audited' });
  const options: IssueOptions = {
    invoiceId: id,
    invoiceRevision: audit ? 2 : 1,
    requestKey: randomUUID(),
    warehouseId: 1,
    date: '2026-02-28',
    number: 'FP-TEST-1',
    settlementAccountId: cfg.settlement.accountId,
    costAccountId: cost.id,
    regenerate: false,
    products: [{ lineNo: 1, productCode: 'SYNTHETIC-01', create: false }],
  };
  return { api, cfg, cost, options, id };
}

/** 只验证本模块调用契约与本模块事务。此处不替代真实 core 桥和库存 provider 联测。 */
function contractFixture() {
  const calls: InvoiceIssueInput[] = [];
  const products = [
    {
      id: 1,
      code: 'SYNTHETIC-01',
      name: '合成商品',
      specification: 'S-1',
      unit: '件',
      inventoryAccountId: catalogAccounts.inventory as number | null,
      salesAccountId: catalogAccounts.sales as number | null,
      disabled: false,
    },
  ];
  const plan: InvoiceIssuePlan = {
    fingerprint: 'a'.repeat(64),
    expiresAt: Date.now() + 300000,
    stockRevision: 1,
    shortages: [],
  };
  let rejectSave = false;
  let originalDocument: InvoiceIssueReferences['originalDocument'] = null;
  const denied = async () => {
    throw new Error('发票契约夹具不提供旧库存核算能力');
  };
  const bind = (base: CoreServices): CoreServices =>
    new Proxy(base, {
      get(target, key, receiver) {
        if (key === 'tx')
          return <T>(fn: (svc: CoreServices) => Promise<T>) => target.tx((t) => fn(bind(t)));
        if (key === 'inventory')
          return {
            invoiceIssueReferences: async () => ({
              warehouses: [{ id: 1, code: '01', name: '合成仓库' }],
              products,
              originalDocument,
            }),
            previewInvoiceIssue: async (_input: InvoiceIssueInput) => plan,
            with: async <T>(
              run: (
                capability: CoreServices['inventory'] extends {
                  with(run: (capability: infer C) => Promise<unknown>): Promise<unknown>;
                }
                  ? C
                  : never,
              ) => Promise<T>,
            ) => {
              const capability = {
                saveDocument: denied,
                removeDocument: denied,
                snapshot: denied,
                commitCosting: denied,
                cancelCosting: denied,
                lockVoucherSource: denied,
                releaseVoucherSource: denied,
                saveInvoiceIssue: async ({ input }: { input: InvoiceIssueInput }) => {
                  expect(target.db.isTransaction).toBe(true);
                  calls.push(input);
                  for (const product of input.newProducts)
                    if (!products.some((p) => p.code === product.code))
                      products.push({ ...product, id: products.length + 1, disabled: false });
                  await sql`INSERT INTO invoice_test_stock (number) VALUES (${input.number})`.execute(
                    target.db,
                  );
                  if (rejectSave) throw new Error('合成库存保存失败');
                  originalDocument = {
                    id: 200,
                    revision: calls.length,
                    number: input.number,
                    date: input.date,
                  };
                  return { id: 200, revision: calls.length };
                },
              };
              return run(capability);
            },
          };
        return Reflect.get(target, key, receiver);
      },
    });
  const service = () => invoiceIssueService(bind(app.svcFor('invoice')));
  return {
    calls,
    products,
    plan,
    setOriginalDocument: (value: InvoiceIssueReferences['originalDocument']) => {
      originalDocument = value;
    },
    service,
    failSave: () => {
      rejectSave = true;
    },
  };
}
async function fixtureTable() {
  await sql`CREATE TABLE invoice_test_stock (number TEXT NOT NULL)`.execute(app.svc.db);
}
async function request(
  fixture: ReturnType<typeof contractFixture>,
  options: IssueOptions,
): Promise<IssueSave> {
  const preview = await fixture.service().preview(options);
  return {
    options,
    plan: preview.plan,
    fingerprint: preview.fingerprint,
    newProductsConfirmed: false,
    negativeStockConfirmed: false,
    replacementConfirmed: false,
  };
}

describe('w_fp_pz_ckd 发票转出库（本模块；库存为显式契约夹具）', () => {
  it('逐行使用原票的整数分、尾差、数量、单价及税率，不接受客户端重写金额', async () => {
    const { options } = await setup();
    const parsed = IssueOptionsSchema.parse({
      ...options,
      lines: [{ netCents: 1, taxCents: 0, totalCents: 1 }],
    });
    const prepared = await contractFixture().service().prepare(parsed);
    expect(prepared.input).toMatchObject({
      invoiceId: options.invoiceId,
      invoiceRevision: 2,
      redLetter: false,
      originalDocument: null,
    });
    expect(prepared.input.lines).toEqual([
      {
        productCode: 'SYNTHETIC-01',
        quantity: '2',
        unitPrice: '50.005',
        taxRate: '13',
        netCents: 10001,
        taxCents: 1300,
        totalCents: 11301,
      },
    ]);
    expect((await app.call(server).list({}))[0]?.state).toBe('audited');
  });
  it('新产品名称、规格、单位从原票产生，存货/收入科目必须为可用末级', async () => {
    const { options, cfg, cost } = await setup();
    const next = {
      ...options,
      products: [
        {
          ...options.products[0]!,
          create: true,
          productCode: 'NEW-01',
          inventoryAccountId: cost.id,
          salesAccountId: cfg.business.accountId,
        },
      ],
    };
    const prepared = await contractFixture().service().prepare(next);
    expect(prepared.input.newProducts).toEqual([
      {
        code: 'NEW-01',
        name: '合成商品',
        specification: 'S-1',
        unit: '件',
        inventoryAccountId: cost.id,
        salesAccountId: cfg.business.accountId,
      },
    ]);
    await expect(
      contractFixture()
        .service()
        .prepare({
          ...next,
          products: [{ ...next.products[0]!, inventoryAccountId: undefined }],
        }),
    ).rejects.toThrow(/存货和收入科目/);
    await app.svc.db
      .updateTable('account')
      .set({ disabled: 1 })
      .where('id', '=', cost.id)
      .execute();
    await expect(contractFixture().service().prepare(next)).rejects.toThrow(/可用末级/);
  });
  it('产品匹配必须逐行完整且不能重复或引用不存在的行', async () => {
    const { options } = await setup();
    const service = contractFixture().service();
    await expect(
      service.prepare({ ...options, products: [...options.products, ...options.products] }),
    ).rejects.toThrow(/逐行完整/);
    await expect(
      service.prepare({ ...options, products: [{ ...options.products[0]!, lineNo: 2 }] }),
    ).rejects.toThrow(/逐行完整/);
  });
  it('实际产品单位、名称、规格、停用状态与可用仓库由服务端复核', async () => {
    const { options } = await setup();
    const fixture = contractFixture();
    fixture.products[0]!.unit = '盒';
    await expect(fixture.service().prepare(options)).rejects.toThrow(/产品单位与原票不一致/);
    fixture.products[0]!.unit = '件';
    fixture.products[0]!.specification = '其他规格';
    await expect(fixture.service().prepare(options)).rejects.toThrow(/名称或规格/);
    fixture.products[0]!.specification = 'S-1';
    fixture.products[0]!.disabled = true;
    await expect(fixture.service().prepare(options)).rejects.toThrow(/产品不存在或已停用/);
    fixture.products[0]!.disabled = false;
    await expect(fixture.service().prepare({ ...options, warehouseId: 9999 })).rejects.toThrow(
      /仓库不存在或已停用/,
    );
    expect((await app.call(server).list({}))[0]?.state).toBe('audited');
  });
  it('已有产品目录中的空科目不转为零，须补齐可用末级科目后才预览', async () => {
    const { options, cost } = await setup();
    const fixture = contractFixture();
    fixture.products[0]!.inventoryAccountId = null;
    await expect(fixture.service().preview(options)).rejects.toThrow(/尚未配置存货或收入科目/);
    fixture.products[0]!.inventoryAccountId = cost.id;
    fixture.products[0]!.salesAccountId = null;
    await expect(fixture.service().preview(options)).rejects.toThrow(/尚未配置存货或收入科目/);
    fixture.products[0]!.salesAccountId = catalogAccounts.sales;
    await app.svc.db
      .updateTable('account')
      .set({ disabled: 1 })
      .where('id', '=', cost.id)
      .execute();
    await expect(fixture.service().preview(options)).rejects.toThrow(/可用末级/);
    expect(fixture.calls).toEqual([]);
    expect((await app.call(server).list({}))[0]?.state).toBe('audited');
  });
  it.each(['void', 'unit', 'quantity', 'input'] as const)(
    '无效来源 %s 不进入库存预览',
    async (condition) => {
      const line = {
        name: '合成商品',
        specification: 'S-1',
        unit: condition === 'unit' ? '' : '件',
        quantity: condition === 'quantity' ? null : '2',
        unitPrice: condition === 'quantity' ? null : '50.005',
        taxRate: '0.13',
        taxMark: 'rate' as const,
        amount: 10001,
        tax: 1300,
        total: 11301,
      };
      const { options } = await setup({
        invoiceStatus: condition === 'void' ? 'void' : 'normal',
        direction: condition === 'input' ? 'input' : 'output',
        confirmDate: condition === 'input' ? '2026-02-05' : null,
        lines: [line],
      });
      await expect(contractFixture().service().prepare(options)).rejects.toThrow(
        condition === 'void'
          ? /作废/
          : condition === 'unit'
            ? /计量单位/
            : condition === 'quantity'
              ? /真实的正数量/
              : /只有销项/,
      );
      expect((await app.call(server).list({}))[0]?.state).toBe('audited');
    },
  );
  it('红字明确拒绝，不取绝对值或调用库存', async () => {
    const { options } = await setup({
      amount: -10001,
      tax: -1300,
      total: -11301,
      lines: [
        {
          name: '合成商品',
          unit: '件',
          quantity: '-2',
          unitPrice: '50.005',
          taxMark: 'rate',
          taxRate: '0.13',
          amount: -10001,
          tax: -1300,
          total: -11301,
        },
      ],
    });
    const fixture = contractFixture();
    await expect(fixture.service().preview(options)).rejects.toThrow(/红字发票转出库尚不支持/);
    expect(fixture.calls).toEqual([]);
    expect((await app.call(server).list({}))[0]).toMatchObject({
      amount: -10001,
      state: 'audited',
    });
  });
  it('草稿与汇总票均拒绝', async () => {
    const { api, options, id } = await setup({}, false);
    await expect(contractFixture().service().prepare(options)).rejects.toThrow(/尚未审核/);
    await api.audit({ selection: [{ id, revision: 1 }], to: 'audited' });
    await api.audit({ selection: [{ id, revision: 2 }], to: 'draft' });
    const base = single({
      direction: 'output',
      number: 'ISSUE-SYNTHETIC',
      date: '2026-02-05',
      confirmDate: null,
      amount: 10001,
      tax: 1300,
      total: 11301,
      lines: [],
    });
    await api.save({ id, revision: 3, data: base });
    await api.audit({ selection: [{ id, revision: 4 }], to: 'audited' });
    await expect(
      contractFixture()
        .service()
        .prepare({ ...options, invoiceRevision: 5 }),
    ).rejects.toThrow(/汇总金额/);
  });
  it('原票税率不可改写，未注明税率必须明确填写', async () => {
    const { options } = await setup();
    const service = contractFixture().service();
    await expect(
      service.prepare({ ...options, products: [{ ...options.products[0]!, taxRate: '0.09' }] }),
    ).rejects.toThrow(/不能改写原票税率/);
    const doc = await service.details(options.invoiceId, 2);
    const line = { ...doc.invoice.lines[0]!, taxMark: 'unspecified' as const, taxRate: null };
    const tdb = app.svc.db.withTables<InvoiceTables>();
    await tdb
      .updateTable('invoice_line')
      .set({ data: JSON.stringify({ ...line, quantity: null }) })
      .where('document_id', '=', options.invoiceId)
      .execute();
    await expect(service.prepare(options)).rejects.toThrow(/明确的税率/);
    const prepared = await service.prepare({
      ...options,
      products: [{ ...options.products[0]!, taxRate: '0.13' }],
    });
    expect(prepared.input.lines[0]?.taxRate).toBe('13');
  });
  it('预览无写入，确认保存后来源、版本与状态落库，同一请求重试幂等', async () => {
    const { api, options } = await setup();
    await fixtureTable();
    const fixture = contractFixture();
    const req = await request(fixture, options);
    expect(
      await app.svc.db
        .withTables<InvoiceTables>()
        .selectFrom('invoice_issue')
        .selectAll()
        .execute(),
    ).toEqual([]);
    const saved = await fixture.service().save(req);
    expect(await fixture.service().save(req)).toEqual(saved);
    expect(fixture.calls).toHaveLength(1);
    expect((await api.list({}))[0]).toMatchObject({
      state: 'issued',
      revision: 3,
      inventoryDocumentId: 200,
      issueNumber: 'FP-TEST-1',
    });
    await expect(
      api.audit({ selection: [{ id: options.invoiceId, revision: 3 }], to: 'draft' }),
    ).rejects.toThrow(/已后续处理/);
    await expect(api.save({ id: options.invoiceId, revision: 3, data: single() })).rejects.toThrow(
      /后续处理/,
    );
    const revenue = await api.previewVoucher({
      selection: [{ id: options.invoiceId, revision: 3 }],
      date: '2026-02-28',
      mode: 'monthly',
      voucherTypeId: 1,
    });
    expect(revenue.groups).toHaveLength(1);
    expect(revenue.groups[0]?.debit).toBe(11301);
    await expect(fixture.service().save({ ...req, negativeStockConfirmed: true })).rejects.toThrow(
      /同一请求编号/,
    );
  });
  it('新增产品和替换原单均须明确确认，重复出库不能绕过来源唯一', async () => {
    const { options, cfg, cost } = await setup();
    await fixtureTable();
    const fixture = contractFixture();
    const next = {
      ...options,
      products: [
        {
          ...options.products[0]!,
          create: true,
          productCode: 'NEW-01',
          inventoryAccountId: cost.id,
          salesAccountId: cfg.business.accountId,
        },
      ],
    };
    const req = await request(fixture, next);
    await expect(fixture.service().save(req)).rejects.toThrow(/新增产品必须/);
    expect(fixture.calls).toHaveLength(0);
    await fixture.service().save({ ...req, newProductsConfirmed: true });
    const current = { ...options, requestKey: randomUUID(), invoiceRevision: 3 };
    await expect(fixture.service().prepare(current)).rejects.toThrow(/已转出库/);
    const regen = { ...current, regenerate: true, number: 'FP-REBUILT' };
    const preview = await fixture.service().preview(regen);
    expect(preview.input.originalDocument).toEqual({ id: 200, revision: 1 });
    fixture.setOriginalDocument({ id: 200, revision: 3, number: 'FP-TEST-1', date: '2026-02-28' });
    expect((await fixture.service().preview(regen)).input.originalDocument).toEqual({
      id: 200,
      revision: 3,
    });
    const re = await request(fixture, regen);
    await expect(fixture.service().save(re)).rejects.toThrow(/确认替换/);
    await fixture.service().save({ ...re, replacementConfirmed: true });
    await expect(fixture.service().save({ ...req, newProductsConfirmed: true })).rejects.toThrow(
      /后续重新生成/,
    );
    expect((await app.call(server).list({}))[0]).toMatchObject({
      state: 'issued',
      revision: 4,
      issueNumber: 'FP-REBUILT',
    });
    expect(
      await app.svc.db
        .withTables<InvoiceTables>()
        .selectFrom('invoice_issue')
        .selectAll()
        .execute(),
    ).toHaveLength(1);
  });
  it.each([false, true])(
    'w_fp_pz：删除重排 %s，混合收入撤销失败全回滚，成功恢复出库和审核状态',
    async (renumberAfterDelete) => {
      await app.svc.voucherPolicy.set({
        ...(await app.svc.voucherPolicy.get()),
        renumberAfterDelete,
      });
      const { api, options } = await setup();
      await fixtureTable();
      const fixture = contractFixture();
      await fixture.service().save(await request(fixture, options));
      const ordinaryId = await api.save({
        data: single({
          direction: 'output',
          number: 'ORDINARY-INCOME',
          date: '2026-02-05',
          confirmDate: null,
        }),
      });
      await api.audit({ selection: [{ id: ordinaryId, revision: 1 }], to: 'audited' });
      const input = {
        selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })),
        date: '2026-02-28',
        voucherTypeId: 1,
        mode: 'monthly' as const,
      };
      const preview = await api.previewVoucher(input);
      expect(preview.groups[0]).toMatchObject({ debit: 22301, credit: 22301 });
      const generateInput = { ...input, fingerprint: preview.fingerprint, requestId: randomUUID() };
      const [group] = await api.generate(generateInput);
      expect(await api.generate(generateInput)).toEqual([group]);
      const voucher = (await app.svc.vouchers.get(group!.voucher_id!))!;
      expect((await api.list({})).every((row) => row.state === 'generated')).toBe(true);
      await sql`CREATE TRIGGER invoice_test_revenue_revoke_fail BEFORE INSERT ON operation_log WHEN NEW.action='invoice.revoke' BEGIN SELECT RAISE(ABORT,'合成收入撤销日志失败'); END`.execute(
        app.svc.db,
      );
      const revokeInput = {
        ...(await api.previewRevoke({ id: group!.id, expectedRevision: voucher.revision })),
        confirmed: true,
      };
      await expect(api.revoke(revokeInput)).rejects.toThrow(/合成收入撤销日志失败/);
      expect(await app.svc.vouchers.get(voucher.id)).not.toBeNull();
      expect((await api.list({})).every((row) => row.groupId === group!.id)).toBe(true);
      await sql`DROP TRIGGER invoice_test_revenue_revoke_fail`.execute(app.svc.db);
      await api.revoke(revokeInput);
      const rows = await api.list({});
      expect(rows.find((row) => row.id === options.invoiceId)).toMatchObject({
        state: 'issued',
        groupId: null,
        inventoryDocumentId: 200,
      });
      expect(rows.find((row) => row.id === ordinaryId)).toMatchObject({
        state: 'audited',
        groupId: null,
        inventoryDocumentId: null,
      });
      expect(fixture.calls).toHaveLength(1);
      await expect(
        api.audit({
          selection: [
            {
              id: options.invoiceId,
              revision: rows.find((row) => row.id === options.invoiceId)!.revision,
            },
          ],
          to: 'draft',
        }),
      ).rejects.toThrow(/已后续处理/);
      const retry = { ...input, selection: rows.map(({ id, revision }) => ({ id, revision })) };
      const next = await api.previewVoucher(retry);
      await api.generate({ ...retry, fingerprint: next.fingerprint, requestId: randomUUID() });
      expect((await app.svc.vouchers.list({})).total).toBe(1);
    },
  );
  it('w_fp_pz：已出库票收入保存失败不留凭证，状态与出库关联一起保留', async () => {
    const { api, options } = await setup();
    await fixtureTable();
    const fixture = contractFixture();
    await fixture.service().save(await request(fixture, options));
    const input = {
      selection: [{ id: options.invoiceId, revision: 3 }],
      date: '2026-02-28',
      voucherTypeId: 1,
      mode: 'individual' as const,
    };
    const preview = await api.previewVoucher(input);
    const generation = { ...input, fingerprint: preview.fingerprint, requestId: randomUUID() };
    await sql`CREATE TRIGGER invoice_test_revenue_save_fail BEFORE INSERT ON operation_log WHEN NEW.action='invoice.generate' BEGIN SELECT RAISE(ABORT,'合成收入制证日志失败'); END`.execute(
      app.svc.db,
    );
    await expect(api.generate(generation)).rejects.toThrow(/合成收入制证日志失败/);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    expect(await api.groups({})).toEqual([]);
    expect((await api.list({}))[0]).toMatchObject({
      state: 'issued',
      revision: 3,
      groupId: null,
      inventoryDocumentId: 200,
    });
    expect(fixture.calls).toHaveLength(1);
    await sql`DROP TRIGGER invoice_test_revenue_save_fail`.execute(app.svc.db);
    await api.generate(generation);
    expect((await app.svc.vouchers.list({})).total).toBe(1);
  });
  it('w_fp_pz：出库标志缺少来源时拒绝收入制证，不用凭证覆盖不完整关联', async () => {
    const { api, options } = await setup();
    await app.svc.db
      .withTables<InvoiceTables>()
      .updateTable('invoice_document')
      .set({ state: 'issued' })
      .where('id', '=', options.invoiceId)
      .execute();
    await expect(
      api.previewVoucher({
        selection: [{ id: options.invoiceId, revision: 2 }],
        date: '2026-02-28',
        voucherTypeId: 1,
        mode: 'individual',
      }),
    ).rejects.toThrow(/出库来源关联不一致/);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  });
  it('库存保存或来源日志失败时，库存夹具写入、票关联与请求一起回滚', async () => {
    const { options } = await setup();
    await fixtureTable();
    const fixture = contractFixture();
    const req = await request(fixture, options);
    fixture.failSave();
    await expect(fixture.service().save(req)).rejects.toThrow(/合成库存保存失败/);
    expect(
      (await sql<{ n: number }>`SELECT COUNT(*) n FROM invoice_test_stock`.execute(app.svc.db))
        .rows[0]?.n,
    ).toBe(0);
    expect((await app.call(server).list({}))[0]?.state).toBe('audited');
    expect(
      await app.svc.db
        .withTables<InvoiceTables>()
        .selectFrom('invoice_issue_request')
        .selectAll()
        .execute(),
    ).toEqual([]);
    const second = contractFixture();
    const next = await request(second, options);
    await sql`CREATE TRIGGER invoice_test_issue_log_fail BEFORE INSERT ON operation_log WHEN NEW.action='invoice.issue.generate' BEGIN SELECT RAISE(ABORT,'合成出库日志失败'); END`.execute(
      app.svc.db,
    );
    await expect(second.service().save(next)).rejects.toThrow(/合成出库日志失败/);
    expect(
      (await sql<{ n: number }>`SELECT COUNT(*) n FROM invoice_test_stock`.execute(app.svc.db))
        .rows[0]?.n,
    ).toBe(0);
    expect(
      await app.svc.db
        .withTables<InvoiceTables>()
        .selectFrom('invoice_issue')
        .selectAll()
        .execute(),
    ).toEqual([]);
    expect((await app.call(server).list({}))[0]).toMatchObject({ state: 'audited', revision: 2 });
  });
  it('预览后票版本、发票月锁或账务月锁变化均在保存前复查', async () => {
    const { api, options } = await setup();
    await fixtureTable();
    const fixture = contractFixture();
    const req = await request(fixture, options);
    await api.close({ period: 202602, expectedRevision: 0, confirmed: true });
    await expect(fixture.service().save(req)).rejects.toThrow(/结账/);
    await api.reopen({ period: 202602, expectedRevision: 1, confirmed: true });
    await app.svc.periods.setStatus(202602, 'closed');
    await expect(fixture.service().save(req)).rejects.toThrow(/结账/);
    await app.svc.periods.setStatus(202602, 'open');
    await api.audit({ selection: [{ id: options.invoiceId, revision: 2 }], to: 'draft' });
    await expect(fixture.service().save(req)).rejects.toThrow(/已被其他操作更改/);
    expect(fixture.calls).toHaveLength(0);
  });
  it('只查看用户不能预览、保存出库或保存出库输入；无共享能力明确报错', async () => {
    const { options } = await setup();
    const limited = app.call(
      server,
      await app.addUser('issue-viewer', { permissions: ['invoice.view'] }),
    );
    await expect(limited.previewIssue(options)).rejects.toThrow(/权限/);
    await expect(limited.saveIssueDraft({})).rejects.toThrow(/权限/);
    await expect(invoiceIssueService(app.svcFor('invoice')).preview(options)).rejects.toThrow(
      /服务|未注册|缺少/,
    );
  });
});
