import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';

let app: TestApp;
const caller = (a: TestApp) => a.call(server);
let api: ReturnType<typeof caller>;

beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'minfei' });
  api = caller(app);
  const categoryId = await api.saveMaster({
    data: { kind: 'category', code: '01', name: '设备类' },
  });
  const purposeId = await api.saveMaster({ data: { kind: 'purpose', code: '01', name: '管理用' } });
  const statusId = await api.saveMaster({ data: { kind: 'status', code: '01', name: '在用' } });
  for (const [code, name, original, department] of [
    ['A01', '服务器甲', 600000, '01'],
    ['A02', '服务器乙', 1200000, '02'],
    ['B01', '打印机', 600000, '01'],
    ['C01', '比例%_\\设备', 600000, '01'],
  ] as const)
    await api.save({
      data: {
        code,
        name,
        original,
        categoryId,
        purposeId,
        statusId,
        departmentId: (await app.svc.dimensions.getByCode('department', department))!.id,
        acquired: '2026-01-01',
        useDate: '2026-01-01',
        rate: '0',
        method: '1',
        lifeMonths: 60,
      },
    });
  for (const period of [202602, 202603]) {
    const preview = await api.preview({ period });
    await api.depreciate({ period, token: preview.token, confirm: true });
  }
});
afterEach(async () => app.close());

describe('w_zjgl_cx / w_zjgl_fb：真实账套多条件查询', () => {
  it('文字、整数分、日期条件取交集；基础筛选继续取交集，分布与明细同口径', async () => {
    const filter = {
      from: 202602,
      to: 202603,
      conditions: [
        { field: 'name' as const, op: 'contains' as const, value: '服务器' },
        { field: 'amount' as const, op: 'gt' as const, value: '10000' },
        { field: 'useDate' as const, op: 'eq' as const, value: '2026-01-01' },
      ],
    };
    const result = await api.query(filter);
    expect(result.rows.map((r) => [r.period, r.code, r.amount])).toEqual([
      [202602, 'A02', 20000],
      [202603, 'A02', 20000],
    ]);
    expect(result.total).toBe(40000);
    expect(result.distribution).toEqual([{ group: '02 销售部 / 01 设备类', amount: 40000 }]);
    const departmentId = (await app.svc.dimensions.getByCode('department', '01'))!.id;
    expect(await api.query({ ...filter, departmentId })).toEqual({
      rows: [],
      distribution: [],
      total: 0,
    });
    expect((await api.query({ ...filter, to: 202602 })).total).toBe(20000);
    expect((await api.query({ from: 202602, to: 202603 })).rows).toHaveLength(8);
  });

  it('含有对百分号、下划线、反斜杠及引号作字面匹配，用户值不会进入 SQL 语法', async () => {
    for (const value of ['%', '_', '\\', '%_\\']) {
      const result = await api.query({
        from: 202602,
        to: 202602,
        conditions: [{ field: 'name', op: 'contains', value }],
      });
      expect(result.rows.map((r) => r.code)).toEqual(['C01']);
    }
    expect(
      (
        await api.query({
          from: 202602,
          to: 202602,
          conditions: [{ field: 'name', op: 'contains', value: "' OR 1=1 --" }],
        })
      ).rows,
    ).toEqual([]);
  });

  it('坏的第二条条件、未知字段/操作符、隐藏逻辑及超量条件拒绝整个请求', async () => {
    const valid = { field: 'name', op: 'contains', value: '服务器' };
    const invalid = [
      { field: 'raw_sql', op: 'eq', value: '1' },
      { field: 'name', op: 'execute', value: '1' },
      { ...valid, logical: 'or' },
    ];
    for (const condition of invalid)
      await expect(
        api.query({ from: 202602, to: 202602, conditions: [valid, condition] } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      api.query({
        from: 202602,
        to: 202602,
        conditions: Array.from({ length: 21 }, () => valid),
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    for (const [bad, expected] of [
      [{ field: 'amount', op: 'contains', value: '100' }, 'QUERY_OPERATOR'],
      [{ field: 'amount', op: 'eq', value: '9007199254740992' }, 'QUERY_NUMBER'],
      [{ field: 'useDate', op: 'eq', value: '2026-02-30' }, 'QUERY_DATE'],
      [{ field: 'name', op: 'eq', value: ' ' }, 'QUERY_VALUE'],
    ] as const)
      await expect(
        api.query({ from: 202602, to: 202602, conditions: [valid, bad] } as never),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        cause: { data: { code: `FIXED_ASSETS_${expected}` } },
      });
    expect((await api.query({ from: 202602, to: 202602 })).total).toBe(50000);
  });
});
