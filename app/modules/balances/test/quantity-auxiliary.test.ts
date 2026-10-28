import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { Decimal } from '@caiwu/core';
import fc from 'fast-check';
import balancesServer from '../server';
import { detailUrl, outputRows } from '../shared';
import { reportHtml } from '../web/output';
import { seedAuxiliaryQuantityCases } from './fixtures';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [balancesServer] });
});
afterEach(async () => app.close());
const range = { periodFrom: 202602, periodTo: 202602, codeFrom: '1403', codeTo: '1403' };
const api = () => app.call(balancesServer);

describe('w_zw_slye/w_zw_fhslye 数量与辅助数量', () => {
  it('同父不同单位独立合计，同单位父行与末级合计相等，红字抵消本币仍保留数量发生', async () => {
    await seedAuxiliaryQuantityCases(app.svc);
    const result = await api().query({ ...range, mode: 'quantity' });
    expect(result.groups.map((g) => g.unit).sort()).toEqual(['件', '千克']);
    const kg = result.groups.find((g) => g.unit === '千克')!;
    const pieces = result.groups.find((g) => g.unit === '件')!;
    expect(kg.quantityTotals).toEqual({
      qtyOpening: '3.000001',
      qtyDebit: '0.000002',
      qtyCredit: '0.5',
      qtyClosing: '2.500003',
      qtyYtdDebit: '0.000002',
      qtyYtdCredit: '0.5',
    });
    expect(pieces.quantityTotals).toEqual({
      qtyOpening: '100.000002',
      qtyDebit: '2',
      qtyCredit: '0',
      qtyClosing: '102.000002',
      qtyYtdDebit: '2',
      qtyYtdCredit: '0',
    });
    expect(kg.rows.find((r) => r.accountCode === '1403')).toMatchObject({
      qtyOpening: '3.000001',
      qtyClosing: '2.500003',
      opening: 10100,
      closing: 9100,
    });
    expect(pieces.rows.find((r) => r.accountCode === '1403')).toMatchObject({
      qtyClosing: '102.000002',
      opening: 20000,
      closing: 22000,
    });
    expect(kg.rows.map((r) => r.accountCode)).toEqual(['1403', '140301', '140303']);
    expect(pieces.rows.map((r) => r.accountCode)).toEqual(['1403', '140302']);
    for (const level of [-1, 0, 1, 2])
      expect(
        outputRows(
          kg,
          level,
          kg.rows.map((r) => r.accountId),
        ).at(-1),
      ).toMatchObject({ qtyClosing: '2.500003', debit: 0, credit: 1000 });
    const active = await api().query({ ...range, mode: 'quantity', onlyActivity: true });
    expect(
      active.groups.find((g) => g.unit === '千克')!.rows.find((r) => r.accountCode === '140301'),
    ).toMatchObject({ debit: 0, credit: 0, qtyDebit: '0.000002' });
    expect(active.groups.map((g) => g.quantityTotals)).toEqual(
      result.groups.map((g) => g.quantityTotals),
    );
    const pending = await api().query({ ...range, mode: 'quantity', includeUnposted: true });
    expect(pending.groups.find((g) => g.unit === '千克')!.quantityTotals?.qtyClosing).toBe(
      '2.623459',
    );
    const cut = await api().query({
      ...range,
      mode: 'quantity',
      codeFrom: '140301',
      codeTo: '140301',
    });
    expect(cut.groups[0]!.rows.map((r) => r.accountCode)).toEqual(['140301']);
    expect(cut.groups[0]!.quantityTotals?.qtyClosing).toBe('1.000003');
  });

  it('w_zw_fhslye 辅助范围、币种、URL 精确条件交集，未指定辅助项另列；打印不混单位', async () => {
    const ids = await seedAuxiliaryQuantityCases(app.svc);
    const result = await api().export({
      ...range,
      mode: 'quantity',
      dimension: 'department',
      dimensionFrom: '01',
      dimensionTo: '01',
      currency: 'USD',
      dims: JSON.stringify({ project: ids.project }),
    });
    expect(result.groups).toHaveLength(1);
    const group = result.groups[0]!;
    expect(group.dimension).toMatchObject({ id: ids.department, code: '01' });
    expect(group.quantityTotals?.qtyClosing).toBe('1.000003');
    expect(group.rows.map((r) => r.accountCode)).toEqual(['1403', '140301']);
    const url = new URL(
      detailUrl(
        result,
        group.rows.find((r) => r.isLeaf)!,
        group.currency,
      ),
      'http://localhost',
    );
    expect(JSON.parse(url.searchParams.get('dims')!)).toEqual({
      department: ids.department,
      project: ids.project,
    });
    expect(url.searchParams.get('currency')).toBe('USD');
    const all = await api().query({ ...range, mode: 'quantity', dimension: 'partner' });
    expect(all.groups.some((g) => g.dimension?.id === null && g.unit === '件')).toBe(true);
    const html = reportHtml(all, -1, []);
    for (const value of ['辅助数量余额表', '1.000003', '数量单位：件', '数量单位：千克'])
      expect(html).toContain(value);
  });

  it('w_zw_slye 随机六位小数按字符串汇总，不引入浮点误差', async () => {
    const account = await app.svc.accounts.require('1405');
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: -10000000, max: 10000000 }), { minLength: 1, maxLength: 12 }),
        async (values) => {
          const quantity = values
            .reduce((n, v) => n.add(new Decimal(v).div(1000000)), new Decimal(0))
            .toFixed();
          await app.svc.opening.upsert({ year: 2026, accountId: account.id, balance: 1, quantity });
          const result = await api().query({
            ...range,
            mode: 'quantity',
            codeFrom: '1405',
            codeTo: '1405',
          });
          expect(result.groups[0]!.quantityTotals?.qtyClosing).toBe(quantity);
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe('w_zw_fhye/w_zw_fhwbye 辅助余额与外币', () => {
  it('w_zw_fhwbye 每辅助项下 USD/EUR 保持独立原币合计，读取和导出不改凭证或期初', async () => {
    await seedAuxiliaryQuantityCases(app.svc);
    await app.svc.db
      .insertInto('currency')
      .values({ code: 'EUR', name: '欧元', symbol: '€', is_base: 0, disabled: 0, sort: 2 })
      .execute();
    await app.svc.accounts.create(
      {
        code: '140304',
        name: '合成欧元原料',
        currency: 'EUR',
        quantityUnit: '千克',
        dimensions: [{ type: 'project', required: false }],
      },
      [4, 2, 2],
    );
    await seedVouchers(app.svc, [
      {
        date: '2026-02-10',
        status: 'posted',
        lines: [
          {
            account: '140304',
            debit: 8000,
            currency: 'EUR',
            rate: '8',
            fcAmount: 1000,
            quantity: '8',
            dims: { project: 'XM01' },
          },
          { account: '4001', credit: 8000 },
        ],
      },
    ]);
    const beforeVouchers = await app.svc.vouchers.list({});
    const beforeOpening = await app.svc.opening.list(2026);
    const result = await api().export({ ...range, mode: 'foreign', dimension: 'project' });
    expect(result.groups.map((g) => g.currency).sort()).toEqual(['EUR', 'USD']);
    expect(result.groups.find((g) => g.currency === 'USD')!.totals.fcDebit).toBe(-1000);
    expect(result.groups.find((g) => g.currency === 'EUR')!.totals.fcDebit).toBe(1000);
    for (const mode of ['summary', 'foreign', 'quantity'] as const)
      await api().query({ ...range, mode, dimension: 'project' });
    expect(await app.svc.vouchers.list({})).toEqual(beforeVouchers);
    expect(await app.svc.opening.list(2026)).toEqual(beforeOpening);
  });

  it.each(['project', 'partner', 'department', 'person'] as const)(
    '按 %s 的真实分组不重复合计，原币单独列示',
    async (dimension) => {
      const ids = await seedAuxiliaryQuantityCases(app.svc);
      const report = await api().query({ ...range, mode: 'foreign', dimension });
      expect(report.groups).toHaveLength(1);
      expect(report.groups[0]!.dimension?.id).toBe(ids[dimension]);
      expect(report.groups[0]!.totals).toMatchObject({
        openingDebit: 7100,
        debit: 0,
        fcOpening: 1000,
        fcDebit: -1000,
        fcClosing: 0,
      });
      const active = await api().query({
        ...range,
        mode: 'foreign',
        dimension,
        onlyActivity: true,
      });
      expect(active.groups[0]!.rows.some((r) => r.accountCode === '140301')).toBe(true);
      const summary = await api().query({ ...range, dimension });
      expect(summary.groups.reduce((n, g) => n + g.totals.openingDebit, 0)).toBe(30100);
    },
  );

  it('w_zw_slye/w_zw_fhye/w_zw_fhwbye/w_zw_fhslye 非法科目和辅助范围阻止；查看与导出权限独立', async () => {
    await seedAuxiliaryQuantityCases(app.svc);
    for (const mode of ['summary', 'foreign', 'quantity'] as const) {
      await expect(
        api().query({ ...range, mode, dimension: 'department', codeFrom: '不存在' }),
      ).rejects.toThrow(/不存在/);
      await expect(
        api().query({
          ...range,
          mode,
          dimension: 'department',
          dimensionFrom: '02',
          dimensionTo: '01',
        }),
      ).rejects.toThrow(/开始辅助项/);
      await expect(
        api().query({ ...range, mode, dimension: 'department', dimensionFrom: '99' }),
      ).rejects.toThrow(/辅助项 99 不存在/);
    }
    await expect(api().query({ ...range, dimensionFrom: '01' })).rejects.toThrow(/核算类型/);
    const viewer = app.call(
      balancesServer,
      await app.addUser('read', { permissions: ['balances.view'] }),
    );
    const none = app.call(balancesServer, await app.addUser('none'));
    const exporter = app.call(
      balancesServer,
      await app.addUser('export', { permissions: ['balances.export'] }),
    );
    for (const mode of ['summary', 'foreign', 'quantity'] as const) {
      const input = { ...range, mode, dimension: 'department' as const };
      await expect(viewer.query(input)).resolves.toBeDefined();
      await expect(viewer.export(input)).rejects.toThrow(/权限/);
      await expect(none.query(input)).rejects.toThrow(/权限/);
      await expect(exporter.export(input)).rejects.toThrow(/权限/);
    }
  });
});
