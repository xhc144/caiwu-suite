import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import type { inferRouterOutputs } from '@trpc/server';
import type { InvoiceRouter } from '../server/router';
import type { Direction, PlanInput } from '../shared';
import type { InvoiceTables } from '../server/migrations';
import server from '../server';
import { mapping, single } from './fixtures';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  await app.close();
});
async function setup(direction: Direction = 'input', foreign = false, red = false) {
  const api = app.call(server);
  const cfg = await mapping(app.svc, direction);
  if (foreign) {
    const scheme = (await app.svc.book.info()).codeScheme;
    const business = await app.svc.accounts.create(
      {
        code: '9801',
        name: '合成外币数量业务',
        categoryId: 'asset',
        currency: 'USD',
        quantityUnit: '件',
      },
      scheme,
    );
    const settlement = await app.svc.accounts.create(
      { code: '9802', name: '合成外币结算', categoryId: 'asset', currency: 'USD' },
      scheme,
    );
    cfg.business = { accountId: business.id, dimensions: {} };
    cfg.settlement = { accountId: settlement.id, dimensions: {} };
  }
  await api.saveSettings(cfg);
  const sign = red ? -1 : 1;
  for (let i = 0; i < 2; i++) {
    await api.save({
      data: single({
        direction,
        number: `REGEN-${i}`,
        date: '2026-02-05',
        confirmDate: direction === 'input' ? '2026-02-05' : null,
        amount: sign * 7100,
        tax: sign * 710,
        total: sign * 7810,
        lines: [
          {
            name: '合成产品',
            unit: '件',
            quantity: String(sign * 2),
            unitPrice: '35.5',
            taxRate: '0.1',
            taxMark: 'rate',
            amount: sign * 7100,
            tax: sign * 710,
            total: sign * 7810,
          },
        ],
      }),
    });
  }
  await api.audit({
    selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })),
    to: 'audited',
  });
  const input: PlanInput = {
    selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })),
    date: '2026-02-28',
    voucherTypeId: 1,
    mode: 'monthly',
  };
  if (foreign)
    input.allocations = input.selection.flatMap(({ id }) => [
      { invoiceId: id, role: 'business' as const, exchangeRate: '7.1', fcAmount: sign * 1000 },
      { invoiceId: id, role: 'settlement' as const, exchangeRate: '7.1', fcAmount: sign * 1100 },
    ]);
  return { api, input, cfg };
}
const request = (input: PlanInput, plan: inferRouterOutputs<InvoiceRouter>['previewVoucher']) => ({
  ...input,
  deletionPlan: plan.deletionPlan ?? undefined,
  fingerprint: plan.fingerprint,
  requestId: randomUUID(),
  regenerateConfirmed: true,
});

// 所有金额独立按 10 USD × 7.1 = 71 CNY、税7.1 CNY、两票合计156.2 CNY核对。
describe('w_fp_pz 外币数量与完整重新生成', () => {
  for (const direction of ['input', 'output'] as const)
    for (const red of [false, true]) {
      it(`${direction} ${red ? '红字' : '正常'}：原币、六位数量、单价和原借贷方向保存并可回读`, async () => {
        const { api, input } = await setup(direction, true, red);
        const fields = await api.voucherFields(input.selection);
        expect(fields.filter((f) => f.currency)).toHaveLength(4);
        expect(fields[0]).toMatchObject({
          currency: 'USD',
          quantityUnit: '件',
          quantity: red ? '-2' : '2',
        });
        const plan = await api.previewVoucher(input);
        expect(plan.groups[0]).toMatchObject({
          debit: red ? -15620 : 15620,
          credit: red ? -15620 : 15620,
        });
        const generated = await api.generate(request(input, plan));
        const voucher = (await app.svc.vouchers.get(generated[0]!.voucher_id!))!;
        const business = voucher.lines.filter((l) => l.accountCode === '9801');
        expect(business).toHaveLength(2);
        expect(business[0]).toMatchObject({
          currency: 'USD',
          exchangeRate: '7.1',
          fcAmount: red ? -1000 : 1000,
          quantity: red ? '-2' : '2',
          unitPrice: '35.5',
          entrySide: direction === 'input' ? 'debit' : 'credit',
        });
        expect(voucher.lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
        await app.runtime.bookStore.closeAll();
        expect((await api.list({})).every((d) => d.voucherId === voucher.id)).toBe(true);
      });
    }
  it('外币必填/换算、数量单位、重复/未选择核算项与非外币科目均由服务端阻止', async () => {
    const { api, input, cfg } = await setup('input', true);
    await expect(api.previewVoucher({ ...input, allocations: [] })).rejects.toThrow(
      /汇率和外币金额/,
    );
    await expect(
      api.previewVoucher({
        ...input,
        allocations: input.allocations!.map((a, i) => (i ? a : { ...a, fcAmount: 1001 })),
      }),
    ).rejects.toThrow(/本币金额不符/);
    await expect(
      api.previewVoucher({
        ...input,
        allocations: [...input.allocations!, input.allocations![0]!],
      }),
    ).rejects.toThrow(/重复/);
    await expect(
      api.previewVoucher({
        ...input,
        allocations: [...input.allocations!, { invoiceId: 9999, role: 'business', quantity: '1' }],
      }),
    ).rejects.toThrow(/未选择/);
    await expect(
      api.previewVoucher({
        ...input,
        allocations: [
          ...input.allocations!,
          { invoiceId: input.selection[0]!.id, role: 'tax', fcAmount: 1 },
        ],
      }),
    ).rejects.toThrow(/未启用外币/);
    await app.svc.db
      .updateTable('account')
      .set({ quantity_unit: '吨' })
      .where('id', '=', cfg.business.accountId)
      .execute();
    await expect(api.previewVoucher(input)).rejects.toThrow(/需要填写数量（吨）/);
    await expect(
      api.previewVoucher({
        ...input,
        allocations: input.allocations!.map((a) =>
          a.role === 'business' ? { ...a, quantity: '0.0000001' } : a,
        ),
      }),
    ).rejects.toThrow(/六位小数/);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  });
  it('重新生成一次撤销旧汇总并重建，旧关联保留撤销历史；重复提交幂等', async () => {
    const { api, input } = await setup();
    const first = await api.generate(request(input, await api.previewVoucher(input)));
    const oldId = first[0]!.voucher_id!;
    const regen = {
      ...input,
      regenerate: true,
      mode: 'individual' as const,
      selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })),
    };
    const plan = await api.previewVoucher(regen);
    expect(plan.replacements).toMatchObject([{ voucherId: oldId }]);
    expect(await app.svc.vouchers.get(oldId)).not.toBeNull();
    await expect(
      api.generate({ ...request(regen, plan), regenerateConfirmed: false }),
    ).rejects.toThrow(/明确确认/);
    const req = request(regen, plan);
    const result = await api.generate(req);
    expect(await api.generate(req)).toEqual(result);
    expect(result).toHaveLength(2);
    expect(
      (
        await app.svc.vouchers.list({
          sourceModule: 'invoice',
          sourceType: 'generation',
          sourceId: String(first[0]!.id),
        })
      ).total,
    ).toBe(0);
    expect((await api.groups({})).find((g) => g.id === first[0]!.id)).toMatchObject({
      revoked: 1,
      voucher_id: null,
    });
    expect((await api.list({})).map((d) => d.voucherId)).toEqual(result.map((g) => g.voucher_id));
    expect((await app.svc.vouchers.list({})).total).toBe(2);
  });
  it('不允许部分替换汇总；预览后审核、修改参数、关账均不删除原凭证', async () => {
    const { api, input, cfg } = await setup();
    const first = await api.generate(request(input, await api.previewVoucher(input)));
    const oldId = first[0]!.voucher_id!;
    const regen = {
      ...input,
      regenerate: true,
      selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })),
    };
    await expect(
      api.previewVoucher({ ...regen, selection: [regen.selection[0]!] }),
    ).rejects.toThrow(/全部来源发票/);
    const plan = await api.previewVoucher(regen);
    await api.saveSettings({ ...cfg, expectedRevision: 1, taxpayerBasis: 'general' });
    await expect(api.generate(request(regen, plan))).rejects.toThrow(/预览后/);
    const current = await api.previewVoucher(regen);
    await app.svc.vouchers.changeStatus({ ids: [oldId], to: 'audited' });
    await expect(api.generate(request(regen, current))).rejects.toThrow(/审核或过账/);
    expect(await app.svc.vouchers.get(oldId)).not.toBeNull();
    await app.svc.vouchers.changeStatus({ ids: [oldId], to: 'pending' });
    const beforeClose = await api.previewVoucher(regen);
    await app.svc.periods.setStatus(202602, 'closed');
    await expect(api.generate(request(regen, beforeClose))).rejects.toThrow(/结账/);
    expect((await api.list({})).every((d) => d.voucherId === oldId)).toBe(true);
  });
  it('删除之后新建失败，原凭证、关联、编号和日志一起回滚', async () => {
    const { api, input } = await setup();
    const first = await api.generate(request(input, await api.previewVoucher(input)));
    const oldId = first[0]!.voucher_id!;
    const before = await api.list({});
    const regen = {
      ...input,
      regenerate: true,
      selection: before.map(({ id, revision }) => ({ id, revision })),
    };
    const plan = await api.previewVoucher(regen);
    const logCount = (await app.svc.log.list()).length;
    await sql`CREATE TRIGGER invoice_test_fail_rebuild BEFORE INSERT ON invoice_group BEGIN SELECT RAISE(ABORT, '合成重建失败'); END`.execute(
      app.svc.db,
    );
    await expect(api.generate(request(regen, plan))).rejects.toThrow(/合成重建失败/);
    expect(await api.list({})).toEqual(before);
    expect((await app.svc.vouchers.get(oldId))?.displayNo).toBe('记-0001');
    expect((await app.svc.log.list()).length).toBe(logCount);
    expect(
      await app.svc.db.withTables<InvoiceTables>().selectFrom('invoice_run').selectAll().execute(),
    ).toHaveLength(1);
  });
  it('手工起始编号必须显式填写且整批无冲突，自动编号拒绝手工输入', async () => {
    const { api, input } = await setup();
    await expect(api.previewVoucher({ ...input, firstNumber: 30 })).rejects.toThrow(/自动编号/);
    await app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    await expect(api.previewVoucher(input)).rejects.toThrow(/起始凭证号/);
    const manual = { ...input, mode: 'individual' as const, firstNumber: 30 };
    const result = await api.generate(request(manual, await api.previewVoucher(manual)));
    expect(
      await Promise.all(
        result.map(async (g) => (await app.svc.vouchers.get(g.voucher_id!))!.number),
      ),
    ).toEqual([30, 31]);
    const regen = {
      ...input,
      regenerate: true,
      firstNumber: 31,
      selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })).slice(0, 1),
    };
    await expect(api.previewVoucher(regen)).rejects.toThrow(/已有凭证/);
  });
  it('仅查看权限不能获取制证核算项或重新生成', async () => {
    const { input } = await setup();
    const limited = app.call(
      server,
      await app.addUser('invoice-reader', { permissions: ['invoice.view'] }),
    );
    await expect(limited.voucherFields(input.selection)).rejects.toThrow(/权限/);
    await expect(limited.previewVoucher({ ...input, regenerate: true })).rejects.toThrow(/权限/);
  });
  it('零本币外币和数量分录保留原侧，不被当作空行丢弃', async () => {
    const { api, cfg } = await setup('input', true);
    const id = await api.save({
      data: single({
        number: 'ZERO-FX-QTY',
        date: '2026-02-05',
        confirmDate: '2026-02-05',
        amount: 0,
        tax: 0,
        total: 0,
        lines: [
          {
            name: '合成零价产品',
            unit: '件',
            quantity: '0.000001',
            unitPrice: '0',
            taxMark: 'exempt',
            amount: 0,
            tax: 0,
            total: 0,
          },
        ],
      }),
    });
    await api.audit({ selection: [{ id, revision: 1 }], to: 'audited' });
    const input: PlanInput = {
      selection: [{ id, revision: 2 }],
      date: '2026-02-28',
      voucherTypeId: 1,
      mode: 'monthly',
      allocations: [
        { invoiceId: id, role: 'business', fcAmount: 1, exchangeRate: '0.01' },
        { invoiceId: id, role: 'settlement', fcAmount: 1, exchangeRate: '0.01' },
      ],
    };
    const plan = await api.previewVoucher(input);
    expect(plan.groups[0]?.lines).toHaveLength(2);
    const result = await api.generate(request(input, plan));
    const v = (await app.svc.vouchers.get(result[0]!.voucher_id!))!;
    expect(v.lines.find((l) => l.accountId === cfg.business.accountId)).toMatchObject({
      debit: 0,
      credit: 0,
      entrySide: 'debit',
      fcAmount: 1,
      quantity: '0.000001',
    });
    expect(v.lines.find((l) => l.accountId === cfg.settlement.accountId)).toMatchObject({
      debit: 0,
      credit: 0,
      entrySide: 'credit',
      fcAmount: 1,
    });
  });
  it('显式数量和单价必须一致，溢出与七位小数均给出业务提示', async () => {
    const { api, input } = await setup('input', true);
    const change = (patch: Record<string, string>) => ({
      ...input,
      allocations: input.allocations!.map((a) => (a.role === 'business' ? { ...a, ...patch } : a)),
    });
    await expect(api.previewVoucher(change({ quantity: '3', unitPrice: '35.5' }))).rejects.toThrow(
      /数量乘单价/,
    );
    await expect(api.previewVoucher(change({ quantity: '-2', unitPrice: '35.5' }))).rejects.toThrow(
      /数量乘单价/,
    );
    await expect(api.previewVoucher(change({ quantity: '9007199254.740992' }))).rejects.toThrow(
      /制证数量超出可保存范围/,
    );
    await expect(api.previewVoucher(change({ quantity: '0.0000001' }))).rejects.toThrow(/六位小数/);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  });
  it('极小的自动本币单价按普通十进制保存，预览通过后可正式生成', async () => {
    const { api } = await setup('input', true);
    const id = await api.save({
      data: single({
        number: 'SMALL-PRICE',
        date: '2026-02-05',
        confirmDate: '2026-02-05',
        amount: 1,
        tax: 0,
        total: 1,
      }),
    });
    await api.audit({ selection: [{ id, revision: 1 }], to: 'audited' });
    const input: PlanInput = {
      selection: [{ id, revision: 2 }],
      date: '2026-02-28',
      voucherTypeId: 1,
      mode: 'monthly',
      allocations: [
        { invoiceId: id, role: 'business', fcAmount: 1, exchangeRate: '1', quantity: '9000000000' },
        { invoiceId: id, role: 'settlement', fcAmount: 1, exchangeRate: '1' },
      ],
    };
    const plan = await api.previewVoucher(input);
    expect(plan.groups[0]!.lines[0]?.unitPrice).toBe('0.000000000001');
    const generated = await api.generate(request(input, plan));
    expect((await app.svc.vouchers.get(generated[0]!.voucher_id!))?.lines[0]?.unitPrice).toBe(
      '0.000000000001',
    );
  });
  it('删除后重排的实际占号也在手工编号预览中阻止', async () => {
    const { api, input, cfg } = await setup();
    const first = await api.generate(request(input, await api.previewVoucher(input)));
    await app.svc.vouchers.create({
      date: '2026-02-28',
      voucherTypeId: 1,
      lines: [
        {
          summary: '合成重排占号',
          accountId: cfg.business.accountId,
          dimensions: cfg.business.dimensions,
          debit: 100,
        },
        { summary: '合成重排占号', accountId: cfg.tax.accountId, credit: 100 },
      ],
    });
    await app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const regen = {
      ...input,
      regenerate: true,
      firstNumber: 1,
      selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })),
    };
    await expect(api.previewVoucher(regen)).rejects.toThrow(/已有凭证/);
    const allowed = { ...regen, firstNumber: 2 };
    const plan = await api.previewVoucher(allowed);
    expect(plan.deletionPlan?.impacts).toMatchObject([{ oldNumber: 2, number: 1 }]);
    await api.generate(request(allowed, plan));
    expect((await app.svc.vouchers.list({})).items.map((v) => v.number).sort()).toEqual([1, 2]);
    expect((await api.groups({})).find((g) => g.id === first[0]!.id)?.revoked).toBe(1);
  });
  it('制证输入按操作员隔离，保存失败保留已存版本且不生成凭证', async () => {
    const { api, input } = await setup();
    const draft = {
      direction: 'input' as const,
      period: 202602,
      selected: input.selection.map((s) => s.id),
      values: { date: input.date, mode: input.mode, voucherTypeId: input.voucherTypeId },
    };
    await api.saveProcessDraft(draft);
    expect(await api.processDraft()).toEqual(draft);
    const other = app.call(
      server,
      await app.addUser('invoice-drafter', { permissions: ['invoice.voucher'] }),
    );
    expect(await other.processDraft()).toBeNull();
    await other.saveProcessDraft({ ...draft, selected: [] });
    expect(await api.processDraft()).toEqual(draft);
    await sql`CREATE TRIGGER invoice_test_draft_failure BEFORE UPDATE ON book_setting WHEN OLD.scope='invoice' BEGIN SELECT RAISE(ABORT, '合成输入保存失败'); END`.execute(
      app.svc.db,
    );
    await expect(
      api.saveProcessDraft({ ...draft, values: { ...draft.values, date: '2026-02-27' } }),
    ).rejects.toThrow(/合成输入保存失败/);
    expect(await api.processDraft()).toEqual(draft);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  });
  it('生成另一批输入不会清除同一操作员已经保存的不同草稿', async () => {
    const { api, input } = await setup();
    const saved = {
      direction: 'input' as const,
      period: 202602,
      selected: input.selection.map((s) => s.id),
      values: { date: '2026-02-27', voucherTypeId: 1, mode: 'monthly' as const },
    };
    await api.saveProcessDraft(saved);
    await api.generate(request(input, await api.previewVoucher(input)));
    expect(await api.processDraft()).toEqual(saved);
  });
  it('任意正负合成金额的原币换算、借贷平衡与数量方向保持不变', async () => {
    const { api } = await setup('input', true);
    let sequence = 0;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10000 }), fc.boolean(), async (n, red) => {
        const sign = red ? -1 : 1;
        const amount = sign * n * 700,
          tax = sign * n * 70,
          total = amount + tax;
        const id = await api.save({
          data: single({
            number: `PROPERTY-${sequence++}`,
            date: '2026-02-05',
            confirmDate: '2026-02-05',
            amount,
            tax,
            total,
            lines: [
              {
                name: '合成性质测试产品',
                unit: '件',
                quantity: String(sign * 2),
                unitPrice: String(n * 3.5),
                taxRate: '0.1',
                taxMark: 'rate',
                amount,
                tax,
                total,
              },
            ],
          }),
        });
        await api.audit({ selection: [{ id, revision: 1 }], to: 'audited' });
        const input: PlanInput = {
          selection: [{ id, revision: 2 }],
          date: '2026-02-28',
          voucherTypeId: 1,
          mode: 'monthly',
          allocations: [
            { invoiceId: id, role: 'business', exchangeRate: '7', fcAmount: sign * n * 100 },
            { invoiceId: id, role: 'settlement', exchangeRate: '7', fcAmount: sign * n * 110 },
          ],
        };
        const plan = await api.previewVoucher(input);
        expect(plan.groups[0]?.debit).toBe(total);
        expect(plan.groups[0]?.credit).toBe(total);
        const saved = await api.generate(request(input, plan));
        const v = (await app.svc.vouchers.get(saved[0]!.voucher_id!))!;
        expect(v.lines.reduce((sum, l) => sum + l.debit - l.credit, 0)).toBe(0);
        expect(v.lines.find((l) => l.accountCode === '9801')?.quantity).toBe(String(sign * 2));
      }),
      { numRuns: 12 },
    );
  });
  it('名称匹配拟新增外币数量科目可使用逐票辅助项，确认后继承核算设置', async () => {
    const { api, input, cfg } = await setup();
    const scheme = (await app.svc.book.info()).codeScheme;
    const firstProject = (await app.svc.dimensions.getByCode('project', 'XM01'))!;
    const secondProject = await app.svc.dimensions.create({
      type: 'project',
      code: 'INV-NEW',
      name: '合成逐票项目',
    });
    const parent = await app.svc.accounts.create(
      {
        code: '9800',
        name: '合成外币往来上级',
        categoryId: 'liability',
        currency: 'USD',
        quantityUnit: '件',
        dimensions: [{ type: 'project', required: true, defaultItemId: firstProject.id }],
      },
      scheme,
    );
    await app.svc.accounts.create({ code: '980001', name: '合成已有往来' }, scheme);
    await api.saveSettings({
      ...cfg,
      expectedRevision: 1,
      settlementMode: 'partnerName',
      settlement: { accountId: parent.id, dimensions: {} },
    });
    const next = {
      ...input,
      allocations: input.selection.map(({ id }) => ({
        invoiceId: id,
        role: 'settlement' as const,
        fcAmount: 1100,
        exchangeRate: '7.1',
        quantity: '2',
        dimensions: { project: secondProject.id },
      })),
    };
    const plan = await api.previewVoucher(next);
    expect(plan.newAccounts).toMatchObject([
      { code: '980002', currency: 'USD', quantityUnit: '件' },
    ]);
    const generated = await api.generate({ ...request(next, plan), newAccountsConfirmed: true });
    const account = (await app.svc.accounts.getByCode('980002'))!;
    expect(account).toMatchObject({ currency: 'USD', quantityUnit: '件' });
    expect(
      (await app.svc.vouchers.get(generated[0]!.voucher_id!))!.lines
        .filter((l) => l.accountId === account.id)
        .every((l) => l.dimensions.project === secondProject.id),
    ).toBe(true);
  });
});
