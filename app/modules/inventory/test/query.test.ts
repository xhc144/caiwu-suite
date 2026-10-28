import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { inventoryQuery } from '../server/query';
import { InventoryQuerySchema, type InventoryQueryInput, type QueryCondition } from '../query';

let app: TestApp;
const condition = (
  field: QueryCondition['field'],
  operator: QueryCondition['operator'],
  value: string,
): QueryCondition => ({ type: 'condition', field, operator, value });
const run = (input: InventoryQueryInput = {}) =>
  app.svcFor('inventory').tx((svc) => inventoryQuery(svc, input));
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  const caller = app.call(server);
  const warehouseId = await caller.saveWarehouse({ code: '01', name: '原料仓' });
  const otherWarehouse = await caller.saveWarehouse({ code: '02', name: '成品仓' });
  const cash = (await app.svc.accounts.require('1001')).id;
  const inventory = (await app.svc.accounts.require('1405')).id;
  await caller.saveProduct({
    code: 'P1',
    name: '精密产品',
    specification: 'A型',
    unit: '件',
    inventoryAccountId: inventory,
  });
  await caller.saveProduct({ code: 'P2', name: '普通产品', unit: '箱' });
  await caller.saveDocument({
    requestKey: randomUUID(),
    kind: 'receipt',
    warehouseId,
    number: 'R1',
    date: '2026-01-10',
    category: '采购',
    accountId: cash,
    taxRate: '13',
    summary: '南区采购',
    operator: '张会计',
    lines: [
      { productCode: 'P1', quantity: '0.3', unitPrice: '10', note: '第一批' },
      { productCode: 'P2', quantity: '10', unitPrice: '2', note: '第二批' },
    ],
  });
  await caller.saveDocument({
    requestKey: randomUUID(),
    kind: 'receipt',
    warehouseId: otherWarehouse,
    number: 'R2',
    date: '2026-01-11',
    category: '采购',
    accountId: cash,
    taxRate: '0',
    summary: '北区采购',
    lines: [{ productCode: 'P1', quantity: '2', unitPrice: '3' }],
  });
});
afterEach(async () => app.close());

describe('w_ck_cx_rkd/w_ck_cx_ckd 综合查询', () => {
  it('任意字段和嵌套括号按且/或执行，不把单据头命中扩大为所有明细', async () => {
    const result = await run({
      where: {
        type: 'group',
        logic: 'and',
        children: [
          condition('warehouseName', 'eq', '原料仓'),
          {
            type: 'group',
            logic: 'or',
            children: [condition('quantity', 'lt', '1'), condition('productCode', 'eq', '不存在')],
          },
          condition('summary', 'contains', '南区'),
          condition('accountCode', 'startsWith', '100'),
          condition('date', 'gte', '2026-01-10'),
          condition('netCents', 'eq', '3.00'),
        ],
      },
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      number: 'R1',
      productCode: 'P1',
      quantity: '0.3',
      netCents: 300,
      inventoryAccountCode: '1405',
      operator: '张会计',
    });
    expect((await run({ where: condition('note', 'endsWith', '批') })).rows).toHaveLength(2);
    expect(
      (await run({ where: condition('summary', 'notContains', '南区') })).rows.map((r) => r.number),
    ).toEqual(['R2']);
  });
  it('多列排序保持数值精度；选择列与重复头只作用于相邻同单据明细', async () => {
    const result = await run({
      columns: ['number', 'quantity', 'productName'],
      sort: [
        { field: 'warehouseCode', direction: 'asc' },
        { field: 'quantity', direction: 'desc' },
      ],
      hideRepeatedHeaders: true,
    });
    expect(result.columns).toEqual(['number', 'quantity', 'productName']);
    expect(result.rows.map((r) => r.quantity)).toEqual(['10', '0.3', '2']);
    expect(result.rows.map((r) => r.repeatedHeader)).toEqual([false, true, false]);
    expect(result.rows[1]!.number).toBe('R1');
    expect(result.rows[1]!.productName).toBe('精密产品');
    const money = await run({ sort: [{ field: 'netCents', direction: 'desc' }] });
    expect(money.rows.map((r) => r.netCents)).toEqual([2000, 600, 300]);
  });
  it('空值查询和文字含有按字面匹配，不把百分号、引号或下划线解释成表达式', async () => {
    expect((await run({ where: condition('costCents', 'empty', '') })).rows).toHaveLength(3);
    expect((await run({ where: condition('costCents', 'notEmpty', '') })).rows).toEqual([]);
    expect((await run({ where: condition('unitCost', 'eq', '0') })).rows).toEqual([]);
    for (const text of ['%', '_', "' OR 1=1 --"])
      expect((await run({ where: condition('summary', 'contains', text) })).rows).toEqual([]);
  });
  it('数值、日期、运算符、未知字段和重复显示/排序字段错误一律拒绝，已有查询数据不改变', async () => {
    for (const bad of [
      { where: condition('quantity', 'contains', '1') },
      { where: condition('netCents', 'eq', '1.001') },
      { where: condition('quantity', 'eq', '1.0000001') },
      { where: condition('date', 'eq', '2026-02-30') },
      { where: condition('date', 'eq', '2026-2-1') },
      { where: condition('unitPrice', 'gt', 'bad') },
      { where: condition('unitCost', 'empty', '1') },
      { where: { ...condition('number', 'eq', 'R1'), field: 'number) OR 1=1' } },
      { columns: [] },
      { columns: ['number', 'number'] },
      {
        sort: [
          { field: 'date', direction: 'asc' },
          { field: 'date', direction: 'desc' },
        ],
      },
      { sql: 'DELETE FROM inventory_document' },
    ]) {
      expect(InventoryQuerySchema.safeParse(bad).success).toBe(false);
      await expect(run(bad as InventoryQueryInput)).rejects.toThrow(/[\u4e00-\u9fff]/);
    }
    expect((await run()).rows).toHaveLength(3);
  });
  it('空括号、过深或过多条件拒绝；空的外层条件可明确查询全部', async () => {
    let deep: InventoryQueryInput['where'] = condition('number', 'eq', 'R1');
    for (let i = 0; i < 10; i++) deep = { type: 'group', logic: 'and', children: [deep] };
    for (const where of [
      deep,
      { type: 'group', logic: 'and', children: [{ type: 'group', logic: 'or', children: [] }] },
      {
        type: 'group',
        logic: 'and',
        children: Array.from({ length: 129 }, () => condition('number', 'eq', 'R1')),
      },
    ])
      expect(InventoryQuerySchema.safeParse({ where }).success).toBe(false);
    expect((await run({ where: { type: 'group', logic: 'or', children: [] } })).rows).toHaveLength(
      3,
    );
  });
  it('含税反算单价按十进制精确筛选和排序，零成本与未核算空值不混淆', async () => {
    const caller = app.call(server);
    const warehouses = await caller.warehouses();
    const cash = (await app.svc.accounts.require('1001')).id;
    await caller.saveDocument({
      requestKey: randomUUID(),
      kind: 'receipt',
      warehouseId: warehouses[0]!.id,
      number: 'TAX',
      date: '2026-01-12',
      category: '采购',
      accountId: cash,
      taxRate: '13',
      lines: [{ productCode: 'P1', quantity: '1', unitPrice: '1', priceIncludesTax: true }],
    });
    const all = await run({ where: condition('number', 'eq', 'TAX') });
    const price = String(all.rows[0]!.unitPrice);
    expect(price).not.toBe('1');
    expect((await run({ where: condition('unitPrice', 'eq', price) })).rows).toHaveLength(1);
    expect(
      (await run({ where: condition('unitPrice', 'lt', '0.88495575221238938053') })).rows,
    ).toHaveLength(0);
  });
  it('查询接口受查看权限保护，两个账套同编号不会串数据', async () => {
    const caller = app.call(server);
    expect((await caller.queryDocuments({})).rows).toHaveLength(3);
    const noView = app.call(server, await app.addUser('none'));
    await expect(noView.queryDocuments({})).rejects.toThrow(/权限/);
    const viewer = app.call(
      server,
      await app.addUser('viewer', { permissions: ['inventory.view'] }),
    );
    expect(
      (await viewer.queryDocuments({ where: condition('warehouseCode', 'eq', '02') })).rows,
    ).toHaveLength(1);
    const other = await createTestApp({ modules: [server], product: 'chengben' });
    try {
      expect((await other.call(server).queryDocuments({})).rows).toEqual([]);
    } finally {
      await other.close();
    }
  });
});
