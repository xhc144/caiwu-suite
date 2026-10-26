import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBook, voucherInputFromSpec, type TestBook } from '@caiwu/testkit';

let t: TestBook;
beforeEach(async () => {
  t = await createTestBook();
});
afterEach(async () => {
  await t.close();
});

async function configure(defaultId: number | null) {
  const account = await t.svc.accounts.require('6602');
  await t.svc.db
    .updateTable('account_dimension')
    .set({ default_item_id: defaultId })
    .where('account_id', '=', account.id)
    .where('dimension_type', '=', 'department')
    .execute();
  return voucherInputFromSpec(t.svc, {
    date: '2026-01-05',
    lines: [
      { account: '6602', debit: 100 },
      { account: '1001', credit: 100 },
    ],
  });
}

describe('凭证默认辅助项', () => {
  it('合法默认部门可用于新增、修改和草稿转正式，显式部门覆盖默认项', async () => {
    const department = (await t.svc.dimensions.getByCode('department', '01'))!;
    const other = (await t.svc.dimensions.getByCode('department', '02'))!;
    const input = await configure(department.id);
    const created = await t.svc.vouchers.create(input);
    expect(created.lines[0]!.dimensions.department).toBe(department.id);
    const explicit = structuredClone(input);
    explicit.lines[0]!.dimensions.department = other.id;
    const changed = await t.svc.vouchers.update(created.id, explicit, {
      expectedRevision: created.revision,
    });
    expect(changed.lines[0]!.dimensions.department).toBe(other.id);
    const reset = await t.svc.vouchers.update(created.id, input, {
      expectedRevision: changed.revision,
    });
    expect(reset.lines[0]!.dimensions.department).toBe(department.id);
    const draft = await t.svc.vouchers.create({ ...input, draft: true });
    const formal = await t.svc.vouchers.update(draft.id, input, {
      expectedRevision: draft.revision,
    });
    expect(formal.lines[0]!.dimensions.department).toBe(department.id);
  });

  it.each(['类型错误', '停用', '非末级'] as const)('%s的默认项和显式项同样被拒绝', async (kind) => {
    const item = (await t.svc.dimensions.getByCode(
      kind === '类型错误' ? 'partner' : 'department',
      kind === '类型错误' ? 'C001' : '01',
    ))!;
    if (kind !== '类型错误') {
      await t.svc.db
        .updateTable('dimension_item')
        .set(kind === '停用' ? { disabled: 1 } : { is_leaf: 0 })
        .where('id', '=', item.id)
        .execute();
    }
    const input = await configure(item.id);
    const message = kind === '类型错误' ? /部门.*不存在/ : kind === '停用' ? /已停用/ : /不是末级/;
    for (const explicit of [false, true]) {
      if (explicit) input.lines[0]!.dimensions.department = item.id;
      await expect(t.svc.vouchers.create(input)).rejects.toThrow(message);
    }
    expect((await t.svc.vouchers.list()).total).toBe(0);
  });

  it('没有默认项仍检查必填；未启用的维度不能借另一科目的默认项混入', async () => {
    const input = await configure(null);
    await expect(t.svc.vouchers.create(input)).rejects.toThrow(/需要填写部门/);
    const department = (await t.svc.dimensions.getByCode('department', '01'))!;
    await configure(department.id);
    input.lines[1]!.dimensions.department = department.id;
    await expect(t.svc.vouchers.create(input)).rejects.toThrow(/没有启用部门核算/);
  });
});
