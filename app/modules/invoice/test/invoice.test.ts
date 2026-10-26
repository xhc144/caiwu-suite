import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import type { BusinessError } from '@caiwu/core';
import { sampleRows } from '../samples';
import { InvoiceSchema } from '../shared';
import server from '../server';
import { safeSum, validateInvoice } from '../server/service';
import type { InvoiceTables } from '../server/migrations';
import { mapping, midyearInvoices, sampleFile, single } from './fixtures';

let app: TestApp;
const caller = () => app.call(server);
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  await app.close();
});
async function code(p: Promise<unknown>) {
  const e = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as { cause: BusinessError } | null;
  expect(e).not.toBeNull();
  return e!.cause.data.code;
}
async function setup5(mode: 'monthly' | 'individual' = 'monthly') {
  const api = caller();
  const file = await sampleFile();
  await api.commitImport(file);
  await api.saveSettings(await mapping(app.svc));
  let rows = await api.list({ direction: 'input' });
  await api.audit({
    selection: rows.map((r) => ({ id: r.id, revision: r.revision })),
    to: 'audited',
  });
  rows = await api.list({ direction: 'input' });
  const input = {
    selection: rows.map((r) => ({ id: r.id, revision: r.revision })),
    date: '2026-02-28',
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
    mode,
  };
  const preview = await api.previewVoucher(input);
  return { api, file, rows, input, preview };
}
describe('w_fp_get_xz / w_fp_lr_2 导入持久化', () => {
  it('合成5票：6商品行分组、长号前导零、红字与确认跨月；重复/冲突不覆盖', async () => {
    const api = caller(),
      file = await sampleFile();
    const p = await api.previewImport(file);
    expect(p.errors).toEqual([]);
    expect(p.duplicates).toEqual([]);
    expect(p.invoices).toHaveLength(5);
    expect(p.invoices.map((g) => [g.data.amount, g.data.tax, g.data.total])).toEqual([
      [15000, 1500, 16500],
      [20000, 2000, 22000],
      [-5000, -500, -5500],
      [30000, 3000, 33000],
      [40000, 4000, 44000],
    ]);
    await api.commitImport(file);
    const list = await api.list({ direction: 'input' });
    expect(list[0]).toMatchObject({
      number: '00000000000000000001',
      period: 202602,
      lines: [{ quantity: '10' }, { quantity: '5' }],
    });
    const stored = await app.svc.db
      .withTables<InvoiceTables>()
      .selectFrom('invoice_line')
      .selectAll()
      .orderBy('id')
      .execute();
    expect(stored[0]!.quantity_e6).toBe(10000000);
    expect((JSON.parse(stored[0]!.data) as { quantity: null }).quantity).toBeNull();
    expect((await api.previewImport(file)).duplicates).toHaveLength(5);
    expect((await api.previewImport(file)).duplicates.every((d) => !d.conflict)).toBe(true);
    expect(await code(api.commitImport(file))).toBe('INVOICE_IMPORT_BLOCKED');
    expect(await api.list({})).toHaveLength(5);
    const changed = sampleRows.map((r) => [...r]);
    changed[0]![18] = '111.00';
    const conflict = await api.previewImport(await sampleFile('input', changed));
    expect(conflict.duplicates[0]!.conflict).toBe(true);
    const svc = app.svcFor('invoice');
    await app.runtime.bookStore.closeAll();
    const reopened = app.runtime.bookStore.open(app.book.id);
    expect(reopened.db).not.toBe(svc.db);
    expect(await api.list({})).toHaveLength(5);
  });
  it('缺列、未知列/未知类型/PDF和公式拒绝；错误行整批不变', async () => {
    const api = caller();
    expect(await code(api.previewImport(await sampleFile('input', sampleRows, ['未知字段'])))).toBe(
      'INVOICE_FILE',
    );
    expect(
      await code(
        api.previewImport({ direction: 'input', fileName: '发票.pdf', base64: 'JVBERg==' }),
      ),
    ).toBe('INVOICE_FILE');
    const bad: unknown[][] = sampleRows.map((r) => [...r]);
    bad[2]![16] = '不是金额';
    bad[3]![1] = 1234567890;
    bad[4]![19] = { formula: 'WEBSERVICE("https://invalid.example")' };
    const p = await api.previewImport(await sampleFile('input', bad));
    expect(p.errors).toHaveLength(3);
    expect(await code(api.commitImport(await sampleFile('input', bad)))).toBe(
      'INVOICE_IMPORT_BLOCKED',
    );
    expect(await api.list({})).toEqual([]);
    expect(
      await app.svc.db
        .withTables<InvoiceTables>()
        .selectFrom('invoice_batch')
        .selectAll()
        .execute(),
    ).toEqual([]);
    const missing = await sampleFile('input', [], ['发票号码']);
    expect(await code(api.previewImport(missing))).toBe('INVOICE_FILE');
  });
  it('非法日期、号码数值单元格、同标识票头冲突、重复汇总行都明确报告', async () => {
    const rows = sampleRows.map((r) => [...r]);
    rows[0]![2] = '2026-02-30';
    rows[1]![4] = '不同销方';
    expect(
      (await caller().previewImport(await sampleFile('input', rows))).errors.length,
    ).toBeGreaterThan(0);
    const r = sampleRows[2]!.map((v, i) => (i >= 10 && i <= 15 ? '' : v));
    const p = await caller().previewImport(await sampleFile('input', [r, r]));
    expect(p.errors[0]!.message).toMatch(/重复汇总/);
  });
  it('仅汇总票保留空明细，不伪造商品；未知明细字段不丢失', async () => {
    const row = sampleRows[2]!.map((v, i) => (i >= 10 && i <= 15 ? '' : v));
    const api = caller();
    await api.commitImport(await sampleFile('input', [row]));
    expect((await api.list({}))[0]!.lines).toEqual([]);
    row[13] = '2';
    const p = await api.previewImport(await sampleFile('input', [row]));
    expect(p.errors[0]!.message).toMatch(/不能作为汇总票/);
  });
});
describe('w_fp_lr_1/_2 录入和状态保护', () => {
  it('空号码、失衡、未知字段及非法日期拒绝', async () => {
    expect(InvoiceSchema.safeParse(single({ number: '' })).success).toBe(false);
    expect(InvoiceSchema.safeParse({ ...single(), unknownData: '不能丢弃' }).success).toBe(false);
    expect(await code(caller().save({ data: single({ total: 11001 }) }))).toBe('INVOICE_TOTAL');
    await expect(caller().save({ data: single({ date: '2026-02-30' }) })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
  it.each([
    ['0.009', false],
    ['0.01', true],
    ['0.011', true],
  ] as const)('w_fp_lr_1 数量乘单价差额 %s 元边界', async (diff, blocked) => {
    const data = single({
      direction: 'output',
      confirmDate: null,
      amount: 10000,
      tax: 1000,
      total: 11000,
      lines: [
        {
          name: '材料',
          quantity: '1',
          unitPrice: String(100 + Number(diff)),
          taxRate: '0.1',
          taxMark: 'rate',
          amount: 10000,
          tax: 1000,
          total: 11000,
        },
      ],
    });
    if (blocked) expect(() => validateInvoice(data)).toThrow(/至少 0.01/);
    else expect(validateInvoice(data).amount).toBe(10000);
  });
  it.each([
    [1, false],
    [2, true],
    [3, true],
  ] as const)('w_fp_lr_1 税额差额 %i 分边界', async (diff, blocked) => {
    const data = single({
      direction: 'output',
      tax: 1000 + diff,
      total: 11000 + diff,
      lines: [
        {
          name: '材料',
          taxRate: '0.1',
          taxMark: 'rate',
          amount: 10000,
          tax: 1000 + diff,
          total: 11000 + diff,
        },
      ],
    });
    if (blocked) expect(() => validateInvoice(data)).toThrow(/至少 0.02/);
    else expect(validateInvoice(data).tax).toBe(1001);
  });
  it('w_fp_lr_2 确认月份筛选；开票/确认已结月均不能保存，反结账不早于启用', async () => {
    const api = caller();
    await api.save({ data: single() });
    expect(await api.list({ period: 202601 })).toEqual([]);
    expect(await api.list({ period: 202602 })).toHaveLength(1);
    await api.close({ period: 202602, expectedRevision: 0, confirmed: true });
    expect(await code(api.save({ data: single({ number: '2' }) }))).toBe('INVOICE_CLOSED');
    await api.reopen({ period: 202602, expectedRevision: 1, confirmed: true });
    await api.close({ period: 202601, expectedRevision: 0, confirmed: true });
    expect(await code(api.save({ data: single({ number: '2' }) }))).toBe('INVOICE_CLOSED');
    expect(await code(api.reopen({ period: 202512, expectedRevision: 0, confirmed: true }))).toBe(
      'INVOICE_START',
    );
    expect((await app.svc.periods.require(202601)).status).toBe('open');
  });
  it('w_fp_lr_2 审核禁止修改/删除，取消审核/删除需确认，过期版本不能覆盖', async () => {
    const api = caller(),
      data = single();
    const id = await api.save({ data });
    await api.audit({ selection: [{ id, revision: 1 }], to: 'audited' });
    expect(await code(api.save({ id, revision: 2, data }))).toBe('INVOICE_LOCKED');
    expect(await code(api.remove({ id, revision: 2, confirmed: true }))).toBe('INVOICE_LOCKED');
    await api.audit({ selection: [{ id, revision: 2 }], to: 'draft' });
    expect(await code(api.save({ id, revision: 1, data }))).toBe('INVOICE_STALE');
    expect(await code(api.remove({ id, revision: 3, confirmed: false }))).toBe('INVOICE_CONFIRM');
    await api.remove({ id, revision: 3, confirmed: true });
    expect(await api.list({})).toEqual([]);
  });
});
describe('w_fp_sz/_2 / w_fp_pz 配置和来源凭证', () => {
  it('末级映射、缺科目、必需辅助、外币/数量模式拒绝；参数乐观锁', async () => {
    const api = caller(),
      cfg = await mapping(app.svc);
    expect(
      await code(api.saveSettings({ ...cfg, tax: { accountId: 99999, dimensions: {} } })),
    ).toBe('NOT_FOUND');
    expect(
      await code(
        api.saveSettings({
          ...cfg,
          tax: { accountId: (await app.svc.accounts.require('2221')).id, dimensions: {} },
        }),
      ),
    ).toBe('INVOICE_ACCOUNT');
    expect(
      await code(api.saveSettings({ ...cfg, business: { ...cfg.business, dimensions: {} } })),
    ).toBe('INVOICE_DIMENSION');
    expect(
      await code(
        api.saveSettings({
          ...cfg,
          business: { accountId: (await app.svc.accounts.require('1403')).id, dimensions: {} },
        }),
      ),
    ).toBe('INVOICE_ACCOUNT_MODE');
    await api.saveSettings(cfg);
    expect(await code(api.saveSettings(cfg))).toBe('INVOICE_STALE');
  });
  it('5票汇总来源凭证：独立借贷期望、幂等与重复生成保护、pending/posted比对', async () => {
    const { api, file, input, preview } = await setup5();
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0]).toMatchObject({ debit: 110000, credit: 110000 });
    const req = { ...input, fingerprint: preview.fingerprint, requestId: randomUUID() };
    const groups = await api.generate(req);
    expect(await api.generate(req)).toEqual(groups);
    const v = (await app.svc.vouchers.get(groups[0]!.voucher_id!))!;
    expect(v.source).toEqual({ module: 'invoice', type: 'generation', id: String(groups[0]!.id) });
    expect(v.lines.filter((l) => l.accountCode === '9901').map((l) => l.debit)).toEqual([
      1500, 2000, -500, 3000, 4000,
    ]);
    expect(v.debitTotal).toBe(110000);
    expect(v.creditTotal).toBe(110000);
    const vat = () => api.vat({ year: 2026, groupBy: 'month', includeUnposted: false });
    const row = () => vat().then((rows) => rows.find((r) => r.key === 'input-202602')!);
    expect(await row()).toMatchObject({ face: 10000, book: 0, difference: -10000, count: 5 });
    expect(
      (await api.vat({ year: 2026, groupBy: 'month', includeUnposted: true })).find(
        (r) => r.key === 'input-202602',
      ),
    ).toMatchObject({ face: 10000, book: 10000, difference: 0 });
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
    expect(await row()).toMatchObject({ face: 10000, book: 10000, difference: 0 });
    expect(await code(api.generate({ ...req, requestId: randomUUID() }))).toBe('INVOICE_STALE');
    expect(await code(api.commitImport(file))).toBe('INVOICE_IMPORT_BLOCKED');
    expect((await app.svc.vouchers.list({ sourceModule: 'invoice' })).items).toHaveLength(1);
    const r = (await api.list({}))[0]!;
    expect(await code(api.save({ id: r.id, revision: r.revision, data: single() }))).toBe(
      'INVOICE_LOCKED',
    );
    expect(
      await code(
        api.revoke({ id: groups[0]!.id, expectedRevision: v.revision + 2, confirmed: true }),
      ),
    ).toBe('VOUCHER_LOCKED');
    await expect(app.svc.vouchers.delete(v.id)).rejects.toThrow(/发票/);
  });
  it('逐票生成和整体撤销汇总全部关联；已结月/已审核凭证拒绝撤销', async () => {
    const { api, input, preview } = await setup5();
    const groups = await api.generate({
      ...input,
      fingerprint: preview.fingerprint,
      requestId: randomUUID(),
    });
    const g = groups[0]!;
    const v = (await app.svc.vouchers.get(g.voucher_id!))!;
    expect(
      await code(api.revoke({ id: g.id, expectedRevision: v.revision, confirmed: false })),
    ).toBe('INVOICE_CONFIRM');
    expect(
      await code(api.revoke({ id: g.id, expectedRevision: v.revision + 1, confirmed: true })),
    ).toBe('VOUCHER_STALE');
    await api.close({ period: 202602, expectedRevision: 0, confirmed: true });
    expect(
      await code(api.revoke({ id: g.id, expectedRevision: v.revision, confirmed: true })),
    ).toBe('INVOICE_CLOSED');
    await api.reopen({ period: 202602, expectedRevision: 1, confirmed: true });
    await api.revoke({ id: g.id, expectedRevision: v.revision, confirmed: true });
    expect(await app.svc.vouchers.get(v.id)).toBeNull();
    const rows = await api.list({});
    expect(rows.every((r) => r.state === 'audited' && r.groupId === null)).toBe(true);
    const p = await api.previewVoucher({
      ...input,
      selection: rows.map((r) => ({ id: r.id, revision: r.revision })),
      mode: 'individual',
    });
    const out = await api.generate({
      ...input,
      mode: 'individual',
      selection: p.selection,
      fingerprint: p.fingerprint,
      requestId: randomUUID(),
    });
    expect(out).toHaveLength(5);
    await app.svc.vouchers.changeStatus({ ids: [out[2]!.voucher_id!], to: 'audited' });
    expect(await code(api.revoke({ id: out[2]!.id, expectedRevision: 2, confirmed: true }))).toBe(
      'VOUCHER_LOCKED',
    );
    expect((await api.list({})).every((r) => r.groupId != null)).toBe(true);
  });
  it('w_fp_pz 生成事务中途数据库失败回滚全部凭证、批次和来源关联', async () => {
    const { api, input, preview } = await setup5('individual');
    // Fail the second group insert after the first source voucher has been created.
    const logs = await app.svc.log.list();
    const { sql } = await import('@caiwu/db');
    await sql`CREATE TRIGGER invoice_test_failure BEFORE INSERT ON invoice_group WHEN (SELECT count(*) FROM invoice_group)>=1 BEGIN SELECT RAISE(ABORT,'synthetic transaction failure'); END`.execute(
      app.svc.db,
    );
    await expect(
      api.generate({
        ...input,
        fingerprint: preview.fingerprint,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow();
    expect((await app.svc.vouchers.list({ sourceModule: 'invoice' })).items).toEqual([]);
    expect(await app.svc.log.list()).toEqual(logs);
    expect((await api.list({})).every((r) => r.groupId == null && r.state === 'audited')).toBe(
      true,
    );
    expect(
      await app.svc.db.withTables<InvoiceTables>().selectFrom('invoice_run').selectAll().execute(),
    ).toEqual([]);
  });
  it('非抵扣税额入明确成本科目，票面差额保留；不推断抵扣资格', async () => {
    const api = caller();
    const cfg = await mapping(app.svc);
    await api.saveSettings({ ...cfg, inputTaxTreatment: 'cost' });
    const id = await api.save({ data: single() });
    await api.audit({ selection: [{ id, revision: 1 }], to: 'audited' });
    const p = await api.previewVoucher({
      selection: [{ id, revision: 2 }],
      date: '2026-02-10',
      voucherTypeId: 1,
      mode: 'monthly',
    });
    expect(p.groups[0]!.lines.find((l) => l.accountCode === '6603')?.debit).toBe(1000);
    expect(p.groups[0]!.lines.some((l) => l.accountCode === '9901')).toBe(false);
  });
  it('预览后设置变化/关闭账务期间不能生成；空选择、未审核、作废不能处理', async () => {
    const { api, input, preview } = await setup5();
    const cfg = (await api.settings({ direction: 'input' }))!;
    await api.saveSettings({ ...cfg, taxpayerBasis: 'small' });
    expect(
      await code(
        api.generate({ ...input, fingerprint: preview.fingerprint, requestId: randomUUID() }),
      ),
    ).toBe('INVOICE_STALE');
    await app.svc.periods.setStatus(202602, 'closed');
    expect(await code(api.previewVoucher(input))).toBe('PERIOD_CLOSED');
    expect((await app.svc.vouchers.list({ sourceModule: 'invoice' })).items).toEqual([]);
  });
});
describe('w_fp_pz / w_fp_get_xz 补充阻止规则', () => {
  it('未配置、未审核、作废、混月与空选择均拒绝制证', async () => {
    const api = caller();
    const a = await api.save({ data: single() });
    const input = {
      selection: [{ id: a, revision: 1 }],
      date: '2026-02-28',
      voucherTypeId: 1,
      mode: 'monthly' as const,
    };
    expect(await code(api.previewVoucher(input))).toBe('INVOICE_STATE');
    await api.audit({ selection: input.selection, to: 'audited' });
    expect(await code(api.previewVoucher({ ...input, selection: [{ id: a, revision: 2 }] }))).toBe(
      'INVOICE_SETTINGS',
    );
    await api.saveSettings(await mapping(app.svc));
    const b = await api.save({ data: single({ number: '2', invoiceStatus: 'void' }) });
    await api.audit({ selection: [{ id: b, revision: 1 }], to: 'audited' });
    expect(await code(api.previewVoucher({ ...input, selection: [{ id: b, revision: 2 }] }))).toBe(
      'INVOICE_STATE',
    );
    const c = await api.save({
      data: single({ number: '3', date: '2026-03-01', confirmDate: '2026-03-01' }),
    });
    await api.audit({ selection: [{ id: c, revision: 1 }], to: 'audited' });
    expect(
      await code(
        api.previewVoucher({
          ...input,
          selection: [
            { id: a, revision: 2 },
            { id: c, revision: 2 },
          ],
        }),
      ),
    ).toBe('INVOICE_PERIOD');
    await expect(api.previewVoucher({ ...input, selection: [] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
  it('导入事务中途失败，票头、商品明细、批次、日志全部回滚', async () => {
    const { sql } = await import('@caiwu/db');
    const logs = await app.svc.log.list();
    await sql`CREATE TRIGGER invoice_test_import_failure BEFORE INSERT ON invoice_document WHEN (SELECT count(*) FROM invoice_document)>=1 BEGIN SELECT RAISE(ABORT,'synthetic import failure'); END`.execute(
      app.svc.db,
    );
    await expect(caller().commitImport(await sampleFile())).rejects.toThrow();
    expect(await app.svc.log.list()).toEqual(logs);
    for (const table of ['invoice_document', 'invoice_line', 'invoice_batch'] as const)
      expect(
        await app.svc.db.withTables<InvoiceTables>().selectFrom(table).selectAll().execute(),
      ).toEqual([]);
  });
  it('w_fp_lr_1 红字销项来源凭证保持负借负贷，季度比对只取所配置税科目', async () => {
    const api = caller();
    const cfg = await mapping(app.svc, 'output');
    await api.saveSettings(cfg);
    const id = await api.save({
      data: single({
        direction: 'output',
        confirmDate: null,
        amount: -10000,
        tax: -1000,
        total: -11000,
      }),
    });
    await api.audit({ selection: [{ id, revision: 1 }], to: 'audited' });
    const input = {
      selection: [{ id, revision: 2 }],
      date: '2026-01-31',
      voucherTypeId: 1,
      mode: 'individual' as const,
    };
    const p = await api.previewVoucher(input);
    expect(p.groups[0]).toMatchObject({ debit: -11000, credit: -11000 });
    const g = await api.generate({ ...input, fingerprint: p.fingerprint, requestId: randomUUID() });
    const v = (await app.svc.vouchers.get(g[0]!.voucher_id!))!;
    expect(v.lines.map((l) => [l.debit, l.credit])).toEqual([
      [-11000, 0],
      [0, -10000],
      [0, -1000],
    ]);
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
    await seedVouchers(app.svc, [
      {
        date: '2026-01-31',
        status: 'posted',
        lines: [
          { account: '6603', debit: 50000 },
          { account: '6001', credit: 50000 },
        ],
      },
    ]);
    const rows = await api.vat({ year: 2026, groupBy: 'quarter', includeUnposted: false });
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.key === 'output-202601')).toMatchObject({
      face: -1000,
      book: -1000,
      difference: 0,
    });
  });
  it('w_fp_zzs_hz 凭证跨期与确认跨月分别解释，账面与票面差额不强行补齐', async () => {
    const api = caller();
    await api.saveSettings(await mapping(app.svc));
    const id = await api.save({ data: single() });
    await api.audit({ selection: [{ id, revision: 1 }], to: 'audited' });
    const input = {
      selection: [{ id, revision: 2 }],
      date: '2026-01-31',
      voucherTypeId: 1,
      mode: 'individual' as const,
    };
    const p = await api.previewVoucher(input);
    const g = await api.generate({ ...input, fingerprint: p.fingerprint, requestId: randomUUID() });
    const vid = g[0]!.voucher_id!;
    await app.svc.vouchers.changeStatus({ ids: [vid], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [vid], to: 'posted' });
    const rows = await api.vat({ year: 2026, groupBy: 'month', includeUnposted: false });
    expect(rows.find((r) => r.key === 'input-202601')).toMatchObject({
      face: 0,
      book: 1000,
      difference: 1000,
    });
    expect(rows.find((r) => r.key === 'input-202602')).toMatchObject({
      face: 1000,
      book: 0,
      difference: -1000,
      explanations: [{ crossPeriod: true, crossVoucherPeriod: true, voucherDate: '2026-01-31' }],
    });
  });
  it('w_fp_lr_1 明细合计、免税标记、数量精度和安全整数拒绝非法输入', () => {
    const line = {
      name: '测试',
      taxMark: 'exempt' as const,
      amount: 10000,
      tax: 1000,
      total: 11000,
    };
    expect(() => validateInvoice(single({ lines: [line] }))).toThrow(/免税/);
    expect(() =>
      validateInvoice(
        single({
          lines: [{ ...line, taxMark: 'unspecified', amount: 9000, tax: 1000, total: 10000 }],
        }),
      ),
    ).toThrow(/明细金额/);
    expect(() =>
      validateInvoice(
        single({
          lines: [
            { ...line, taxMark: 'rate', taxRate: '0.1', quantity: '1.0000001', unitPrice: '100' },
          ],
        }),
      ),
    ).toThrow(/最多六位/);
    expect(() => safeSum([Number.MAX_SAFE_INTEGER, 1])).toThrow(/安全整数/);
  });
});
describe('w_fp_lr_1/_2 批量删除与 w_fp_hz/w_fp_khhz/_2 汇总', () => {
  it('当前查询预览、二次确认、逐项跳过锁定票，取消不删；变化后预览过期', async () => {
    const api = caller();
    const a = await api.save({ data: single() }),
      b = await api.save({ data: single({ number: '2' }) });
    await api.audit({ selection: [{ id: b, revision: 1 }], to: 'audited' });
    const filter = { direction: 'input' as const, period: 202602 };
    const p = await api.previewDelete(filter);
    expect(p.items).toEqual([
      { id: a, revision: 1, number: '00001', reason: null },
      { id: b, revision: 2, number: '2', reason: expect.stringContaining('已审核') },
    ]);
    expect(
      await code(
        api.deleteBatch({
          filter,
          fingerprint: p.fingerprint,
          confirmed: true,
          secondConfirmed: false,
        }),
      ),
    ).toBe('INVOICE_CONFIRM');
    expect(await api.list({})).toHaveLength(2);
    await api.save({ id: a, revision: 1, data: single({ note: '修改' }) });
    expect(
      await code(
        api.deleteBatch({
          filter,
          fingerprint: p.fingerprint,
          confirmed: true,
          secondConfirmed: true,
        }),
      ),
    ).toBe('INVOICE_STALE');
    const fresh = await api.previewDelete(filter);
    expect(
      await api.deleteBatch({
        filter,
        fingerprint: fresh.fingerprint,
        confirmed: true,
        secondConfirmed: true,
      }),
    ).toMatchObject({ deleted: 1, skipped: [{ id: b }] });
    expect((await api.list({})).map((r) => r.id)).toEqual([b]);
  });
  it('月/季度与客户供应商汇总保留红字；导出和查询筛选一致，忽略作废票', async () => {
    const api = caller();
    await api.commitImport(await sampleFile());
    await api.save({ data: single({ number: 'VOID', invoiceStatus: 'void' }) });
    expect(await api.summary({ year: 2026, direction: 'input', groupBy: 'month' })).toEqual([
      {
        key: '202602',
        label: '202602',
        taxId: '',
        count: 5,
        amount: 100000,
        tax: 10000,
        total: 110000,
        ids: expect.any(Array),
      },
    ]);
    const quarter = await api.summary({ year: 2026, direction: 'input', groupBy: 'quarter' });
    expect(quarter[0]).toMatchObject({
      key: '2026-Q1',
      count: 5,
      amount: 100000,
      tax: 10000,
      total: 110000,
    });
    const partner = await api.summary({ year: 2026, direction: 'input', groupBy: 'partner' });
    expect(partner).toHaveLength(5);
    expect(partner.find((r) => r.taxId === 'TEST-S003')).toMatchObject({
      amount: -5000,
      tax: -500,
      total: -5500,
    });
    expect(await api.exportSummary({ year: 2026, direction: 'input', groupBy: 'quarter' })).toEqual(
      quarter,
    );
    expect(await api.summary({ year: 2026, direction: 'output', groupBy: 'partner' })).toEqual([]);
    expect(
      await api.export({ direction: 'input', dateFrom: '2026-02-06', dateTo: '2026-02-07' }),
    ).toHaveLength(2);
  });
});
describe('w_fp_zzs_hz 年中启用的月/季度可比范围', () => {
  it('真实SQLite：3月启用的全年、季度、跨年确认和红字只取启用后期间', async () => {
    await app.close();
    app = await createTestApp({ modules: [server], startMonth: 3 });
    const api = caller();
    await api.saveSettings(await mapping(app.svc));
    await api.saveSettings(await mapping(app.svc, 'output'));
    for (const data of midyearInvoices()) await api.save({ data });
    await app.svc.periods.ensureYear(2027);
    await seedVouchers(app.svc, [
      {
        date: '2026-03-31',
        status: 'posted',
        lines: [
          { account: '6603', debit: 400 },
          { account: '9902', credit: 400 },
        ],
      },
      {
        date: '2026-04-15',
        status: 'posted',
        lines: [
          { account: '9901', debit: 800 },
          { account: '6603', credit: 800 },
        ],
      },
      {
        date: '2027-01-31',
        status: 'posted',
        lines: [
          { account: '9901', debit: 300 },
          { account: '6603', credit: 300 },
        ],
      },
    ]);
    const months = await api.vat({ year: 2026, groupBy: 'month', includeUnposted: false });
    for (const row of months.filter((r) => r.to < 202603))
      expect(row).toMatchObject({
        active: false,
        startPeriod: 202603,
        effectiveFrom: null,
        face: null,
        book: null,
        difference: null,
        count: null,
        entries: [],
      });
    expect(months.find((r) => r.key === 'input-202603')).toMatchObject({
      active: true,
      effectiveFrom: 202603,
      face: 0,
      book: 0,
      difference: 0,
      count: 0,
    });
    expect(months.find((r) => r.key === 'output-202603')).toMatchObject({
      face: 400,
      book: 400,
      difference: 0,
      count: 2,
    });
    const april = months.find((r) => r.key === 'input-202604')!;
    expect(april).toMatchObject({ face: 800, book: 800, difference: 0, count: 2 });
    expect(april.explanations.find((r) => r.number === 'MID-NORMAL')).toMatchObject({
      date: '2026-03-31',
      confirmDate: '2026-04-01',
      crossPeriod: true,
    });
    expect(april.explanations.find((r) => r.number === 'MID-RED')).toMatchObject({ red: true });
    expect(months.find((r) => r.key === 'input-202612')).toMatchObject({
      face: 0,
      book: 0,
      count: 0,
    });
    const quarters = await api.vat({ year: 2026, groupBy: 'quarter', includeUnposted: false });
    expect(quarters.find((r) => r.key === 'output-202601')).toMatchObject({
      from: 202601,
      to: 202603,
      active: true,
      partial: true,
      effectiveFrom: 202603,
      face: 400,
      book: 400,
      difference: 0,
    });
    expect(quarters.find((r) => r.key === 'input-202604')).toMatchObject({
      partial: false,
      effectiveFrom: 202604,
      face: 800,
      book: 800,
      difference: 0,
    });
    for (const groupBy of ['month', 'quarter'] as const) {
      const next = await api.vat({ year: 2027, groupBy, includeUnposted: false });
      expect(next.find((r) => r.key === 'input-202701')).toMatchObject({
        active: true,
        partial: false,
        effectiveFrom: 202701,
        face: 300,
        book: 300,
        difference: 0,
        count: 1,
        explanations: [
          {
            number: 'MID-CROSS-YEAR',
            date: '2026-12-31',
            confirmDate: '2027-01-01',
            crossPeriod: true,
          },
        ],
      });
      const before = await api.vat({ year: 2025, groupBy, includeUnposted: true });
      expect(
        before.every(
          (r) =>
            !r.active &&
            r.effectiveFrom == null &&
            r.face == null &&
            r.book == null &&
            r.difference == null &&
            r.count == null &&
            r.entries.length === 0,
        ),
      ).toBe(true);
    }
  });
  it.each([2, 5, 8, 12])('w_fp_zzs_hz %i月启用，季度截断不把前月当作零业务', async (startMonth) => {
    await app.close();
    app = await createTestApp({ modules: [server], startMonth });
    const api = caller();
    await api.saveSettings(await mapping(app.svc));
    const startPeriod = 202600 + startMonth;
    for (const groupBy of ['month', 'quarter'] as const) {
      const rows = await api.vat({ year: 2026, groupBy, includeUnposted: false });
      for (const row of rows) {
        if (row.to < startPeriod)
          expect(row).toMatchObject({
            active: false,
            effectiveFrom: null,
            face: null,
            book: null,
            difference: null,
          });
        else
          expect(row).toMatchObject({
            active: true,
            effectiveFrom: Math.max(row.from, startPeriod),
            partial: row.from < startPeriod,
            face: 0,
          });
      }
    }
  });
});
describe('权限和隔离', () => {
  it('w_fp_lr_2 查看不授予导入、编辑、审核、制证、参数、结账、反结账或导出权限', async () => {
    const none = app.call(server, await app.addUser('none'));
    expect(await code(none.list({}))).toBe('FORBIDDEN');
    const token = await app.addUser('viewer', { permissions: ['invoice.view'] });
    const api = app.call(server, token);
    expect(await api.list({})).toEqual([]);
    const file = await sampleFile();
    const cfg = await mapping(app.svc);
    const checks = [
      api.save({ data: single() }),
      api.previewImport(file),
      api.commitImport(file),
      api.audit({ selection: [{ id: 1, revision: 1 }], to: 'audited' }),
      api.saveSettings(cfg),
      api.generate({
        selection: [{ id: 1, revision: 1 }],
        date: '2026-02-01',
        voucherTypeId: 1,
        mode: 'monthly',
        fingerprint: 'a'.repeat(64),
        requestId: randomUUID(),
      }),
      api.close({ period: 202602, expectedRevision: 0, confirmed: true }),
      api.reopen({ period: 202602, expectedRevision: 0, confirmed: true }),
      api.export({}),
    ];
    expect(await Promise.all(checks.map((p) => code(p)))).toEqual(checks.map(() => 'FORBIDDEN'));
  });
  it('w_fp_lr_2 另一账套看不到发票，民非产品不开放', async () => {
    await caller().save({ data: single() });
    const other = await createTestApp({ modules: [server] });
    try {
      expect(await other.call(server).list({})).toEqual([]);
    } finally {
      await other.close();
    }
    const minfei = await createTestApp({ modules: [server], product: 'minfei' });
    try {
      await expect(minfei.call(server).list({})).rejects.toThrow();
    } finally {
      await minfei.close();
    }
  });
});
it('w_fp_pz 金额不变量：红字借贷保持符号，安全整数相加无浮点差额', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
      fc.integer({ min: -100_000, max: 100_000 }),
      (amount, tax) => {
        const total = safeSum([amount, tax]);
        expect(safeSum([amount, tax, -total])).toBe(0);
      },
    ),
    { numRuns: 200 },
  );
});
