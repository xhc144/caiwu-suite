import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import analysis from '../server';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('w_fx_demo 数量公式结果精度及真实保存', () => {
  it('六位数量保存重开完整保留，金额公式计算到最后才舍入为整分', async () => {
    app = await createTestApp({ modules: [analysis] });
    const api = app.call(analysis);
    await seedVouchers(app.svc, [
      {
        date: '2026-02-10',
        status: 'posted',
        lines: [
          { account: '1403', debit: 12345, quantity: '1.234567', unitPrice: '100' },
          { account: '4001', credit: 12345 },
        ],
      },
    ]);
    const definition = await api.definitions.save({
      code: '817',
      name: '数量精度测试',
      expectedRevision: 0,
      rows: [
        { key: 1, name: '材料数量', formula: 'S借方("1403")', unit: 'number', decimalPlaces: 6 },
        { key: 2, name: '计算成本', formula: 'S借方("1403") * 100', unit: 'money' },
      ],
    });
    const sheet = await api.definitions.calculate({
      definitionId: definition.id,
      periodFrom: 202601,
      periodTo: 202602,
    });
    expect(sheet.rows[0]).toMatchObject({
      decimalPlaces: 6,
      values: [0, 1234567],
      originalValues: [0, 1234567],
    });
    expect(sheet.rows[1]!.values).toEqual([0, 12346]);
    const result = await api.results.save({ name: '数量原稿', expectedRevision: 0, sheet });
    const reopened = await api.results.get({ id: result.id });
    expect(reopened.sheet.rows[0]).toMatchObject({
      decimalPlaces: 6,
      values: [0, 1234567],
      originalValues: [0, 1234567],
    });
    expect(reopened.sheet.rows[1]!.values).toEqual([0, 12346]);
  });
});
