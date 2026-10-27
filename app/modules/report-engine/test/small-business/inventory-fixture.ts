import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';

// 独立纸笔黄金值（整数分）。各项先逐科目结算，再相加；不从模板公式求期望。
export const inventoryGolden = {
  initial2025: { inventory: 27381, workInProgress: 9004 },
  yearOpening2026: {
    inventory: 27588,
    rawMaterials: 3115,
    workInProgress: 8890,
    finishedGoods: 13341,
    turnoverMaterials: 1009,
  },
  january2026: {
    inventory: 28702,
    rawMaterials: 2714,
    workInProgress: 9898,
    finishedGoods: 13341,
    turnoverMaterials: 1009,
  },
  february2026: {
    inventory: 28688,
    rawMaterials: 2788,
    workInProgress: 9197,
    finishedGoods: 14042,
    turnoverMaterials: 860,
  },
} as const;

const initialBalances = [
  ['1401', 101],
  ['1402', 211],
  ['140301', 1001],
  ['140302', 2003],
  ['140401', -307],
  ['140402', 53],
  ['40010101', 4001],
  ['400102', 5003],
  ['140501', 6001],
  ['140502', 7003],
  ['140701', -809],
  ['140702', 101],
  ['1408', 907],
  ['1411', 1009],
  ['1421', 1103],
  ['3001', -27381],
] as const;

const movements: VoucherSpec[] = [
  {
    date: '2025-12-05',
    status: 'posted',
    lines: [
      { account: '140301', debit: 111 },
      { account: '3001', credit: 111 },
    ],
  },
  {
    date: '2025-12-06',
    status: 'posted',
    lines: [
      { account: '40010101', debit: 223 },
      { account: '3001', credit: 223 },
    ],
  },
  {
    date: '2025-12-07',
    status: 'posted',
    lines: [
      { account: '3001', debit: 127 },
      { account: '140701', credit: 127 },
    ],
  },
  {
    date: '2025-12-08',
    status: 'posted',
    lines: [
      { account: '140501', debit: 337 },
      { account: '40010101', credit: 337 },
    ],
  },
  {
    date: '2026-01-05',
    status: 'posted',
    lines: [
      { account: '400102', debit: 401 },
      { account: '140301', credit: 401 },
    ],
  },
  {
    date: '2026-01-06',
    status: 'posted',
    lines: [
      { account: '1401', debit: 503 },
      { account: '3001', credit: 503 },
    ],
  },
  {
    date: '2026-01-07',
    status: 'posted',
    lines: [
      { account: '400102', debit: 607 },
      { account: '3001', credit: 607 },
    ],
  },
  {
    date: '2026-01-08',
    status: 'posted',
    lines: [
      { account: '3001', debit: 109 },
      { account: '140401', credit: 109 },
    ],
  },
  {
    date: '2026-01-09',
    status: 'posted',
    lines: [
      { account: '140701', debit: 113 },
      { account: '3001', credit: 113 },
    ],
  },
  {
    date: '2026-02-05',
    status: 'posted',
    lines: [
      { account: '140502', debit: 701 },
      { account: '400102', credit: 701 },
    ],
  },
  {
    date: '2026-02-06',
    status: 'posted',
    lines: [
      { account: '140302', debit: 211 },
      { account: '1402', credit: 211 },
    ],
  },
  {
    date: '2026-02-07',
    status: 'posted',
    lines: [
      { account: '140402', debit: 127 },
      { account: '3001', credit: 127 },
    ],
  },
  {
    date: '2026-02-08',
    status: 'posted',
    lines: [
      { account: '3001', debit: 131 },
      { account: '140702', credit: 131 },
    ],
  },
  {
    date: '2026-02-09',
    status: 'posted',
    lines: [
      { account: '1408', debit: 137 },
      { account: '140301', credit: 137 },
    ],
  },
  {
    date: '2026-02-10',
    status: 'posted',
    lines: [
      { account: '1421', debit: 139 },
      { account: '3001', credit: 139 },
    ],
  },
  {
    date: '2026-02-11',
    status: 'posted',
    lines: [
      { account: '3001', debit: 149 },
      { account: '1411', credit: 149 },
    ],
  },
];

/** 只经core/testkit造合成总账；从未创建、读取库存模块的私有表或成本批次。 */
export async function seedInventoryBook(svc: CoreServices) {
  await svc.periods.ensureYear(2026);
  for (const [code, name] of [
    ['140301', '材料甲'],
    ['140302', '材料乙'],
    ['140401', '材料节约差异'],
    ['140402', '材料超支差异'],
    ['400101', '基本生产成本'],
    ['40010101', '基本生产甲'],
    ['400102', '辅助生产成本'],
    ['140501', '库存商品甲'],
    ['140502', '库存商品乙'],
    ['140701', '商品差价甲'],
    ['140702', '商品差价乙'],
  ] as const)
    await svc.accounts.create({ code, name }, [4, 2, 2]);
  for (const [code, balance] of initialBalances)
    await svc.opening.upsert({
      year: 2025,
      accountId: (await svc.accounts.require(code)).id,
      balance,
    });
  await seedVouchers(svc, movements);
}

/** 模拟年结唯一core年度期初契约；报表代码自身只读总账。 */
export async function storeInventoryYearOpening(svc: CoreServices) {
  const rows = await svc.ledger.balances({
    periodFrom: 202512,
    periodTo: 202512,
    rollup: false,
    includeZero: true,
  });
  await svc.tx((tx) =>
    tx.opening.replaceYear(
      2026,
      rows.map((r) => ({ accountId: r.accountId, balance: r.closing })),
    ),
  );
}
