import type { CoreServices } from '@caiwu/core/server';

export async function seedHierarchyCases(svc: CoreServices) {
  const parent = await svc.dimensions.create({ type: 'department', code: 'G', name: '合成事业部' });
  const a = await svc.dimensions.create({
    type: 'department',
    code: 'A',
    name: '合成甲组',
    parentId: parent.id,
  });
  const b = await svc.dimensions.create({
    type: 'department',
    code: 'Z',
    name: '合成乙组',
    parentId: parent.id,
  });
  const grand = await svc.dimensions.create({
    type: 'department',
    code: 'Q',
    name: '合成乙组分队',
    parentId: b.id,
  });
  const outside = await svc.dimensions.create({
    type: 'department',
    code: 'Y',
    name: '合成独立部门',
  });
  const account = await svc.accounts.create(
    {
      code: '140301',
      name: '合成层级物料',
      quantityUnit: '千克',
      currency: 'USD',
      dimensions: [{ type: 'department', required: false }],
    },
    [4, 2, 2],
  );
  for (const [id, balance, quantity, fcBalance] of [
    [a.id, 7100, '1.000001', 1000],
    [grand.id, -3550, '-0.500001', -500],
    [outside.id, 14200, '2', 2000],
  ] as const)
    await svc.opening.upsert({
      year: 2026,
      accountId: account.id,
      currency: 'USD',
      dimensions: { department: id },
      balance,
      quantity,
      fcBalance,
    });
  return { parent, a, b, grand, outside, account };
}
