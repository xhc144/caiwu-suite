import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { BusinessError, Decimal } from '@caiwu/core';
import { createTestApp, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { entryService } from '../server/service';
import type { EntryTables } from '../server/migrations';
import {
  balanceCell,
  foreignAmount,
  monthDistance,
  quantityAmount,
  type Entry,
  type SaveInput,
} from '../shared';

let app: TestApp;
let serial = 0;
const api = () => app.call(server);
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
  app.runtime.now = () => new Date('2026-01-15T12:00:00Z');
  serial = 0;
});
afterEach(async () => app.close());
const base = () =>
  voucherInputFromSpec(app.svc, {
    date: '2026-01-10',
    lines: [
      { account: '6603', debit: 12345 },
      { account: '6001', credit: 12345 },
    ],
  });
const save = (data: Entry, extra: Partial<SaveInput> = {}) =>
  api().save({ key: `case-${++serial}`, data, ...extra });
async function code(promise: Promise<unknown>) {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).not.toBeNull();
  const cause = (error as { cause?: unknown }).cause ?? error;
  return cause instanceof BusinessError
    ? cause.data
    : { code: (error as { code: string }).code, message: String(error) };
}
const id = async (code: string) => (await app.svc.accounts.require(code)).id;
const itemId = async (
  type: 'project' | 'partner' | 'department' | 'person' | 'cashflow',
  code: string,
) => (await app.svc.dimensions.getByCode(type, code))!.id;

it('w_pz_pzedit：正式保存分配编号、返回 revision；差 1 分时 core 阻止', async () => {
  const data = await base();
  const done = await save(data);
  expect(done.voucher).toMatchObject({
    displayNo: '记-0001',
    status: 'pending',
    source: null,
    revision: 1,
  });
  data.lines[1]!.credit -= 1;
  expect((await code(save(data))).message).toMatch(/差额 0.01/);
  expect((await app.svc.vouchers.list({})).total).toBe(1);
});

it('w_pz_pzedit：自动草稿不编号；无科目行保存在编辑缓冲，刷新可恢复', async () => {
  const data: Entry = await base();
  data.draft = true;
  data.lines.push({
    summary: '未选择科目但已输入摘要',
    accountId: null,
    debit: 5,
    dimensions: {},
    credit: 0,
    currency: null,
    exchangeRate: null,
    fcAmount: null,
    quantity: null,
    unitPrice: null,
  });
  const result = await save(data, { key: 'buffer' });
  expect(result.voucher?.number).toBeNull();
  expect(result.voucher?.lines).toHaveLength(2);
  const restored = await api().buffer({ key: 'buffer' });
  expect(restored?.data.lines).toHaveLength(3);
  expect(restored?.data.lines[2]?.summary).toBe('未选择科目但已输入摘要');
  const reopened = await api().buffer({ key: `edit-${result.voucher!.id}` });
  expect(reopened?.data.lines).toHaveLength(3);
  expect(reopened?.revision).toBe(0);
  expect(
    await app.svc.ledger.entries({ periodFrom: 202601, periodTo: 202601, includeUnposted: true }),
  ).toEqual([]);
});

it('w_pz_pzedit：连续首次保存只创建一张；自动与手动串行后复用原 ID', async () => {
  const data = await base();
  const request = { key: 'once', data: { ...data, draft: true } };
  const [first, second] = await Promise.all([api().save(request), api().save(request)]);
  expect(first.voucher?.id).toBe(second.voucher?.id);
  expect((await app.svc.vouchers.list({})).total).toBe(1);
  const formal = await api().save({
    key: 'once',
    id: first.voucher!.id,
    expectedRevision: first.voucher!.revision,
    bufferRevision: first.bufferRevision,
    data: { ...data, draft: false },
  });
  expect(formal.voucher?.id).toBe(first.voucher?.id);
  expect(formal.voucher?.displayNo).toBe('记-0001');
  const buffered = await api().save({
    key: 'once',
    id: formal.voucher!.id,
    expectedRevision: formal.voucher!.revision,
    bufferRevision: formal.bufferRevision,
    data: { ...data, draft: true, lines: [{ ...data.lines[0]!, debit: 1 }, data.lines[1]!] },
  });
  expect(buffered.voucher?.status).toBe('pending');
  expect(buffered.voucher?.number).toBe(1);
  expect(buffered.voucher?.revision).toBe(formal.voucher?.revision);
  expect(await app.svc.vouchers.get(formal.voucher!.id)).toEqual(formal.voucher);
  expect(buffered.bufferRevision).toBe(formal.bufferRevision + 1);
  expect((await api().buffer({ key: 'once' }))?.data).toMatchObject({
    draft: true,
    lines: [{ debit: 1 }, { credit: 12345 }],
  });
  // 草稿缓冲保留真实新编辑；再次正式保存才提交 core 并推进其 revision。
  const resubmitted = await api().save({
    key: 'once',
    id: formal.voucher!.id,
    expectedRevision: formal.voucher!.revision,
    bufferRevision: buffered.bufferRevision,
    data: { ...data, draft: false, note: '再次正式提交' },
  });
  expect(resubmitted.voucher).toMatchObject({
    id: formal.voucher!.id,
    status: 'pending',
    number: 1,
    revision: formal.voucher!.revision + 1,
    debitTotal: 12345,
    creditTotal: 12345,
    note: '再次正式提交',
  });
});

it('w_pz_pzedit_b：revision 冲突及缓冲版本冲突拒绝覆盖', async () => {
  const data = await base();
  const first = (await save(data)).voucher!;
  await save({ ...data, attachments: 1 }, { id: first.id, expectedRevision: first.revision });
  expect(
    (
      await code(
        save({ ...data, attachments: 2 }, { id: first.id, expectedRevision: first.revision }),
      )
    ).code,
  ).toBe('VOUCHER_STALE');
  const buffered = await save({ ...data, draft: true }, { key: 'same' });
  expect(
    (
      await code(
        save(
          { ...data, draft: true, attachments: 3 },
          {
            key: 'same',
            id: buffered.voucher!.id,
            expectedRevision: buffered.voucher!.revision,
            bufferRevision: 0,
          },
        ),
      )
    ).code,
  ).toBe('VOUCHER_STALE');
});

it('w_pz_pzedit：直接 router 和服务均拒绝无编辑/模版权限', async () => {
  const token = await app.addUser('viewer', { permissions: ['voucher-entry.view'] });
  expect(await app.call(server, token).templates({})).toEqual([]);
  const data = await base();
  expect((await code(app.call(server, token).save({ key: 'x', data }))).code).toBe('FORBIDDEN');
  expect(
    (
      await code(
        app.call(server, token).saveTemplate({
          code: 'A',
          name: '测试',
          voucherTypeId: data.voucherTypeId,
          lines: data.lines,
        }),
      )
    ).code,
  ).toBe('FORBIDDEN');
  const user = (await app.svc.users.list()).find((u) => u.code === 'viewer')!;
  const svc = {
    ...app.svcFor('voucher-entry'),
    user: {
      id: user.id,
      code: user.code,
      name: user.name,
      isAdmin: false,
      permissions: new Set<string>(),
    },
  };
  // 使用真实非管理员上下文创建权限服务。
  const { createCoreServices } = await import('@caiwu/core/server');
  const restricted = createCoreServices({ ...svc.ctx, user: svc.user });
  expect((await code(entryService(restricted).save({ key: 'x', data }))).code).toBe('FORBIDDEN');
});

it.each(['audited', 'posted', 'voided', 'source'] as const)(
  'w_pz_pzedit_b：%s 凭证只读，去掉输入 source 也不能修改',
  async (state) => {
    const data = await base();
    let voucher =
      state === 'source'
        ? await app
            .svcFor('example')
            .vouchers.create({ ...data, source: { type: 'memo', id: '99' } })
        : await app.svc.vouchers.create(data);
    if (state === 'audited' || state === 'posted') {
      await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
      if (state === 'posted')
        await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
    }
    if (state === 'voided') await app.svc.vouchers.setVoided(voucher.id, true);
    voucher = (await app.svc.vouchers.get(voucher.id))!;
    const err = await code(save(data, { id: voucher.id, expectedRevision: voucher.revision }));
    expect(err.code).toBe('ENTRY_READONLY');
    expect((await app.svc.vouchers.get(voucher.id))!.revision).toBe(voucher.revision);
  },
);

it('w_pz_pzedit：伪造 source/closingKind/reversalOfId 被输入边界拒绝', async () => {
  const data = await base();
  for (const field of ['source', 'closingKind', 'reversalOfId']) {
    const value = { source: { type: 'memo', id: '1' }, closingKind: 'pnl', reversalOfId: 1 }[field];
    expect((await code(save({ ...data, [field]: value }))).code).toBe('BAD_REQUEST');
  }
});

it.each([
  ['无类型', (d: Entry) => ({ ...d, voucherTypeId: 0 }), 'BAD_REQUEST'],
  [
    '无科目',
    (d: Entry) => ({ ...d, lines: [{ ...d.lines[0], accountId: null }, d.lines[1]!] }),
    'ENTRY_INVALID',
  ],
  ['不足两行', (d: Entry) => ({ ...d, lines: [d.lines[0]!] }), 'ENTRY_INVALID'],
  [
    '空摘要',
    (d: Entry) => ({ ...d, lines: [{ ...d.lines[0], summary: '' }, d.lines[1]!] }),
    'ENTRY_INVALID',
  ],
  [
    '同一行借贷',
    (d: Entry) => ({ ...d, lines: [{ ...d.lines[0], credit: 1 }, d.lines[1]!] }),
    'ENTRY_INVALID',
  ],
  [
    '零额',
    (d: Entry) => ({ ...d, lines: [{ ...d.lines[0], debit: 0 }, d.lines[1]!] }),
    'ENTRY_INVALID',
  ],
  ['非法日期', (d: Entry) => ({ ...d, date: '2026-02-30' }), 'BAD_REQUEST'],
] as const)('w_pz_pzedit / w_pz_pzedit_b：%s 阻止并给下一步', async (_name, alter, expected) => {
  expect((await code(save(alter(await base())))).code).toBe(expected);
});

it('w_pz_pzedit：早于启用、已结账、编号冲突由 core 阻止', async () => {
  const data = await base();
  expect((await code(save({ ...data, date: '2025-12-31' }))).code).toBe('PERIOD_BEFORE_START');
  await save({ ...data, number: 2 });
  expect((await code(save({ ...data, number: 2 }))).code).toBe('VOUCHER_NUMBER_TAKEN');
  await app.svc.periods.setStatus(202601, 'closed');
  expect((await code(save(data))).code).toBe('PERIOD_CLOSED');
});

it('w_pz_pzedit：未来月份确认；跨年 12 个自然月边界，超过则阻止', async () => {
  const data = await base();
  await app.svc.periods.ensureYear(2027);
  expect(monthDistance('2027-01-31', '2026-01-15')).toBe(12);
  expect((await code(save({ ...data, date: '2027-01-31' }))).code).toBe('ENTRY_FUTURE_CONFIRM');
  expect(
    (await save({ ...data, date: '2027-01-31' }, { confirmFuture: true })).voucher?.period,
  ).toBe(202701);
  expect((await code(save({ ...data, date: '2027-02-01' }, { confirmFuture: true }))).code).toBe(
    'ENTRY_FUTURE_LIMIT',
  );
  expect(monthDistance('2027-01-01', '2026-12-31')).toBe(1);
});

it('w_pz_pzedit_b：改类型/跨期间/手动改编号先确认，取消时不变更数据库', async () => {
  const data = await base();
  const first = (await save(data)).voucher!;
  await app.svc.db
    .insertInto('voucher_type')
    .values({ code: '收', name: '收款', rule: null, disabled: 0, sort: 2 })
    .execute();
  const otherType = (await app.svc.reference.voucherTypes()).find((t) => t.code === '收')!.id;
  for (const patch of [{ voucherTypeId: otherType }, { date: '2026-02-10' }, { number: 6 }]) {
    expect(
      (
        await code(
          save(
            { ...data, ...patch },
            { id: first.id, expectedRevision: first.revision, confirmFuture: true },
          ),
        )
      ).code,
    ).toBe('ENTRY_NUMBER_CONFIRM');
    expect((await app.svc.vouchers.get(first.id))?.revision).toBe(1);
  }
  const next = await save(
    { ...data, number: 6 },
    { id: first.id, expectedRevision: first.revision, confirmNumberChange: true },
  );
  expect(next.voucher?.number).toBe(6);
});

it.each(['w_pz_pzedit', 'w_pz_pzedit_b', 'w_pz_pzedit_mb', 'wf_pzmb_save'])(
  '%s：辅助核算继承规则：必填、非法、停用、非末级、未启用拒绝',
  async () => {
    const data = await base();
    const cases = [
      ['project', '5001', 'XM01'],
      ['partner', '1122', 'C001'],
      ['department', '6602', '01'],
      ['person', '1221', 'P01'],
    ] as const;
    for (const [type, account, codeValue] of cases) {
      const accountId = await id(account);
      const dim = await itemId(type, codeValue);
      const check = async (dimensions: Record<string, number>) =>
        entryService(app.svc).inspect(
          [{ ...data.lines[0], accountId, dimensions }, data.lines[1]!],
          true,
        );
      expect((await check({})).problems.some((p) => p.field === type)).toBe(true);
      expect((await check({ [type]: 999999 })).problems.some((p) => p.field === type)).toBe(true);
      await app.svc.db
        .updateTable('dimension_item')
        .set({ disabled: 1 })
        .where('id', '=', dim)
        .execute();
      expect((await check({ [type]: dim })).problems.some((p) => p.field === type)).toBe(true);
      await app.svc.db
        .updateTable('dimension_item')
        .set({ disabled: 0, is_leaf: 0 })
        .where('id', '=', dim)
        .execute();
      expect((await check({ [type]: dim })).problems.some((p) => p.field === type)).toBe(true);
      await app.svc.db
        .updateTable('dimension_item')
        .set({ is_leaf: 1 })
        .where('id', '=', dim)
        .execute();
      expect((await check({ [type]: dim })).problems).toEqual([]);
      const wrong = await entryService(app.svc).inspect(
        [{ ...data.lines[0], dimensions: { [type]: dim } }, data.lines[1]!],
        true,
      );
      expect(wrong.problems.some((p) => p.field === type)).toBe(true);
    }
  },
);

it('w_pz_km_find：不存在、停用和非末级科目拒绝；默认辅助项明确回读', async () => {
  const data = await base();
  for (const accountId of [99999, await id('1002')])
    expect(
      (await code(save({ ...data, lines: [{ ...data.lines[0], accountId }, data.lines[1]!] })))
        .code,
    ).toBe('ENTRY_INVALID');
  const accountId = await id('6603');
  await app.svc.db
    .updateTable('account')
    .set({ disabled: 1 })
    .where('id', '=', accountId)
    .execute();
  expect((await code(save(data))).code).toBe('ENTRY_INVALID');
  await app.svc.db
    .updateTable('account')
    .set({ disabled: 0 })
    .where('id', '=', accountId)
    .execute();
  const dept = await itemId('department', '01');
  await app.svc.db
    .updateTable('account_dimension')
    .set({ default_item_id: dept })
    .where('account_id', '=', await id('6602'))
    .execute();
  const done = await save({
    ...data,
    lines: [{ ...data.lines[0], accountId: await id('6602'), dimensions: {} }, data.lines[1]!],
  });
  expect(done.voucher?.lines[0]?.dimensions.department).toBe(dept);
});

it('w_pz_pzedit / wf_pzmb_save：外币和数量缺失/零/非法填写阻止，红字保留，精确乘积', async () => {
  const data = await base();
  const foreign = {
    ...data.lines[0]!,
    accountId: await id('100202'),
    dimensions: { cashflow: await itemId('cashflow', 'CF01') },
    currency: 'USD',
    exchangeRate: '7.1',
    fcAmount: 100,
  };
  for (const patch of [
    { fcAmount: 0 },
    { fcAmount: null },
    { exchangeRate: null },
    { exchangeRate: '0' },
    { currency: 'EUR' },
  ]) {
    expect(
      (
        await code(
          save(
            { ...data, lines: [{ ...foreign, ...patch }, data.lines[1]!] },
            { acknowledgeCashflowUnknown: true },
          ),
        )
      ).code,
    ).toBe('ENTRY_INVALID');
  }
  const qty = {
    ...data.lines[0]!,
    accountId: await id('1403'),
    quantity: '1.2345674',
    unitPrice: '100',
    debit: 12346,
  };
  expect(
    (await save({ ...data, lines: [qty, { ...data.lines[1]!, credit: 12346 }] })).voucher?.lines[0]
      ?.quantity,
  ).toBe('1.234567');
  for (const quantity of ['0', null])
    expect(
      (await code(save({ ...data, lines: [{ ...qty, quantity }, data.lines[1]!] }))).code,
    ).toBe('ENTRY_INVALID');
  expect(
    (await code(save({ ...data, lines: [{ ...data.lines[0], quantity: '1' }, data.lines[1]!] })))
      .code,
  ).toBe('ENTRY_INVALID');
  expect(
    (await code(save({ ...data, lines: [{ ...data.lines[0], fcAmount: 100 }, data.lines[1]!] })))
      .code,
  ).toBe('ENTRY_INVALID');
  const red = await save({
    ...data,
    lines: [
      { ...qty, quantity: '-1', unitPrice: '10.01', debit: -1001 },
      { ...data.lines[1]!, credit: -1001 },
    ],
  });
  expect(red.voucher?.debitTotal).toBe(-1001);
});

it('w_pz_pzedit：现金流量真实标志、缺失、无效、无需却填、方向冲突及内部配平', async () => {
  const data = await base();
  const cf = await itemId('cashflow', 'CF01');
  const cash = { ...data.lines[0]!, accountId: await id('1001'), dimensions: {} };
  expect((await code(save({ ...data, lines: [cash, data.lines[1]!] }))).code).toBe('ENTRY_INVALID');
  const selected = { ...cash, dimensions: { cashflow: cf } };
  expect((await code(save({ ...data, lines: [selected, data.lines[1]!] }))).code).toBe(
    'ENTRY_CASHFLOW_UNKNOWN',
  );
  expect(
    (
      await code(
        save({ ...data, lines: [{ ...cash, dimensions: { cashflow: 9999 } }, data.lines[1]!] }),
      )
    ).code,
  ).toBe('ENTRY_INVALID');
  expect(
    (
      await code(
        save({
          ...data,
          lines: [{ ...data.lines[0], dimensions: { cashflow: cf } }, data.lines[1]!],
        }),
      )
    ).code,
  ).toBe('ENTRY_INVALID');
  await app.svc.db
    .updateTable('dimension_item')
    .set({ attrs: JSON.stringify({ cashflowDirection: 'outflow' }) })
    .where('id', '=', cf)
    .execute();
  expect((await code(save({ ...data, lines: [selected, data.lines[1]!] }))).code).toBe(
    'ENTRY_INVALID',
  );
  // 红字贷方是流入，不按正数借贷栏位猜测。
  await app.svc.db
    .updateTable('dimension_item')
    .set({ attrs: JSON.stringify({ cashflowDirection: 'inflow' }) })
    .where('id', '=', cf)
    .execute();
  expect(
    (
      await save({
        ...data,
        lines: [
          { ...selected, debit: 0, credit: -12345 },
          { ...data.lines[1]!, credit: 0, debit: -12345 },
        ],
      })
    ).voucher?.creditTotal,
  ).toBe(-12345);
  await app.svc.db
    .updateTable('dimension_item')
    .set({ attrs: JSON.stringify({ cashflowDirection: 'internal' }) })
    .where('id', '=', cf)
    .execute();
  expect((await code(save({ ...data, lines: [selected, data.lines[1]!] }))).message).toMatch(
    /内部现金流入流出未配平/,
  );
  const other = { ...data.lines[1]!, accountId: await id('100201'), dimensions: { cashflow: cf } };
  expect((await save({ ...data, lines: [selected, other] })).voucher?.status).toBe('pending');
});

it('w_pz_pzmb_add / w_pz_pzmb_main：编码名称必填、四位上限、重复、改名改码、删除及失效引用可见', async () => {
  const data = await base();
  const input = { code: 'A01', name: '费用', voucherTypeId: data.voucherTypeId, lines: data.lines };
  for (const patch of [{ code: '' }, { code: '12345' }, { name: '' }])
    expect((await code(api().saveTemplate({ ...input, ...patch }))).code).toBe('BAD_REQUEST');
  const templateId = await api().saveTemplate(input);
  expect((await code(api().saveTemplate(input))).code).toBe('ENTRY_TEMPLATE_DUPLICATE');
  await api().saveTemplate({ ...input, id: templateId, revision: 1, code: 'B01', name: '改名' });
  const t = await api().template({ id: templateId });
  expect(t).toMatchObject({ code: 'B01', name: '改名', revision: 2 });
  expect(Object.keys(t.lines[0]!)).not.toContain('id');
  await app.svc.db
    .updateTable('account')
    .set({ disabled: 1 })
    .where('id', '=', data.lines[0]!.accountId!)
    .execute();
  expect((await api().template({ id: templateId })).validation.problems.length).toBeGreaterThan(0);
  expect((await code(api().saveTemplate({ ...input, id: templateId, revision: 2 }))).code).toBe(
    'ENTRY_INVALID',
  );
  await api().removeTemplate({ id: templateId, revision: 2 });
  expect(await api().templates({ keyword: 'B' })).toEqual([]);
});

it('wf_pzmb_save：事务中途失败，头与分录没有半成品；凭证和编辑缓冲同样回滚', async () => {
  const data = await base();
  const svc = app.svcFor('voucher-entry');
  const original = svc.tx.bind(svc);
  vi.spyOn(svc, 'tx').mockImplementation((fn) =>
    original(async (tsvc) => {
      const out = await fn(tsvc);
      throw new Error(`模拟事务提交前失败 ${String(out)}`);
    }),
  );
  await expect(
    entryService(svc).saveTemplate({
      code: 'A',
      name: '事务测试',
      voucherTypeId: data.voucherTypeId,
      lines: data.lines,
    }),
  ).rejects.toThrow(/模拟/);
  expect(await api().templates({})).toEqual([]);
  await expect(entryService(svc).save({ key: 'rollback', data })).rejects.toThrow(/模拟/);
  expect((await app.svc.vouchers.list({})).total).toBe(0);
  expect(await api().buffer({ key: 'rollback' })).toBeNull();
  const db = app.svc.db.withTables<EntryTables>();
  expect(await db.selectFrom('voucher_entry_template_line').selectAll().execute()).toEqual([]);
});

it('w_pz_pzedit：Excel 粘贴严格按编码解析、逐行错误、精确分，不写数据库', async () => {
  const result = await api().paste({
    text: '精度\t6603\t0.29\t0\t01\n坏行\t财务费用\tNaN\t1\t不存在',
    mapping: ['summary', 'account', 'debit', 'credit', 'department'],
  });
  expect(result.lines[0]?.debit).toBe(29);
  expect(result.rows[1]?.errors.length).toBeGreaterThanOrEqual(2);
  expect((await app.svc.vouchers.list({})).total).toBe(0);
});

it('w_pz_pzedit_b：期间/类型/编号稳定移动及边界禁用', async () => {
  const data = await base();
  const a = (await save({ ...data, number: 3 })).voucher!;
  const b = (await save({ ...data, number: 1 })).voucher!;
  const c = (await save({ ...data, date: '2026-02-03' }, { confirmFuture: true })).voucher!;
  expect(await api().neighbors({ id: b.id })).toEqual({
    first: null,
    previous: null,
    next: a.id,
    last: c.id,
  });
  expect((await api().neighbors({ id: c.id })).next).toBeNull();
});

describe('w_pz_pzedit：fast-check 会计不变量', () => {
  it('随机平衡分录保存读回总借=总贷', async () => {
    const data = await base();
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 10000000 }), { minLength: 1, maxLength: 8 }),
        fc.boolean(),
        async (amounts, red) => {
          const sign = red ? -1 : 1;
          const amount = amounts.reduce((total, n) => total + n * sign, 0);
          const result = await save({
            ...data,
            lines: [
              ...amounts.map((n) => ({ ...data.lines[0]!, debit: n * sign })),
              { ...data.lines[1]!, credit: amount },
            ],
          });
          const v = (await api().get({ id: result.voucher!.id })).voucher;
          expect(v.debitTotal).toBe(v.creditTotal);
          expect(v.debitTotal).toBe(amount);
          expect(v.lines).toHaveLength(amounts.length + 1);
        },
      ),
      { numRuns: 30 },
    );
  });
  it('找平仅修改指定金额格且总借等于总贷', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            debit: fc.integer({ min: -100000, max: 100000 }),
            credit: fc.integer({ min: -100000, max: 100000 }),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        fc.nat(),
        fc.boolean(),
        (lines, seed, debit) => {
          const index = seed % lines.length;
          const side = debit ? 'debit' : 'credit';
          const result = balanceCell(lines, index, side);
          expect(result.reduce((n, l) => n + (l.debit ?? 0) - (l.credit ?? 0), 0)).toBe(0);
          for (let i = 0; i < lines.length; i++)
            for (const field of ['debit', 'credit'] as const)
              if (i !== index || field !== side) expect(result[i]![field]).toBe(lines[i]![field]);
        },
      ),
    );
  });
  it('数量×单价、汇率换算按独立整数有理数模型舍入可复现', () => {
    const round = (n: bigint, d: bigint) =>
      Number(((n < 0n ? -1n : 1n) * ((n < 0n ? -n : n) + d / 2n)) / d);
    fc.assert(
      fc.property(
        fc.integer({ min: -10000000, max: 10000000 }),
        fc.integer({ min: 1, max: 1000000 }),
        (quantityE6, priceE4) => {
          const quantity = new Decimal(quantityE6).div('1000000').toFixed();
          const price = new Decimal(priceE4).div('10000').toFixed();
          expect(quantityAmount(quantity, price)).toBe(
            round(BigInt(quantityE6) * BigInt(priceE4), 100000000n),
          );
          expect(foreignAmount(quantityE6, price)).toBe(
            round(BigInt(quantityE6) * BigInt(priceE4), 10000n),
          );
          expect(quantityAmount(quantity, price)).toBe(quantityAmount(quantity, price));
        },
      ),
    );
  });
});

it('wf_pzmb_save / w_pz_pzedit.u_pzclock：模版与审核导航边界同样核验现金流量，未知方向显式返回待办', async () => {
  const data = await base();
  const cf = await itemId('cashflow', 'CF01');
  const line = { ...data.lines[0]!, accountId: await id('1001'), dimensions: {} };
  const template = {
    code: 'CF',
    name: '现金流量规则',
    voucherTypeId: data.voucherTypeId,
    lines: [line, data.lines[1]!],
  };
  expect((await code(api().saveTemplate(template))).code).toBe('ENTRY_INVALID');
  const current = await app.svc.vouchers.create({ ...data, lines: [line, data.lines[1]!] });
  expect((await code(api().reviewCheck({ id: current.id }))).code).toBe('ENTRY_INVALID');
  const selected = { ...line, dimensions: { cashflow: cf } };
  expect(
    (await code(api().saveTemplate({ ...template, lines: [selected, data.lines[1]!] }))).code,
  ).toBe('ENTRY_CASHFLOW_UNKNOWN');
  const unknown = await app.svc.vouchers.create({ ...data, lines: [selected, data.lines[1]!] });
  expect((await api().reviewCheck({ id: unknown.id })).warnings[0]?.message).toContain(
    '方向未配置，无法核验',
  );
  await app.svc.db
    .updateTable('dimension_item')
    .set({ attrs: JSON.stringify({ cashflowDirection: 'outflow' }) })
    .where('id', '=', cf)
    .execute();
  expect(
    (await code(api().saveTemplate({ ...template, lines: [selected, data.lines[1]!] }))).code,
  ).toBe('ENTRY_INVALID');
  expect((await code(api().reviewCheck({ id: unknown.id }))).code).toBe('ENTRY_INVALID');
});

it('w_pz_pzedit：缓冲绑定 core revision，读取可识别陈旧缓冲；用户缓冲隔离', async () => {
  const data = await base();
  const saved = await save({ ...data, draft: true }, { key: 'bound' });
  const v = saved.voucher!;
  await app.svc.vouchers.update(
    v.id,
    { ...data, draft: true, attachments: 2 },
    { expectedRevision: v.revision },
  );
  const buffer = await api().buffer({ key: 'bound' });
  expect(buffer?.voucherRevision).toBe(v.revision);
  expect((await api().get({ id: v.id })).voucher.revision).toBeGreaterThan(
    buffer!.voucherRevision!,
  );
  const token = await app.addUser('other', { permissions: ['voucher-entry.view'] });
  expect(await app.call(server, token).buffer({ key: 'bound' })).toBeNull();
});

it('w_pz_pzedit：金额溢出和早于核心日期范围有可用错误，Excel超大数字为逐行错误', async () => {
  const data = await base();
  expect((await code(save({ ...data, date: '0001-01-01' }))).code).toBe('BAD_REQUEST');
  const amount = Number.MAX_SAFE_INTEGER;
  const r = await entryService(app.svc).inspect(
    [
      { ...data.lines[0]!, debit: amount },
      { ...data.lines[0]!, debit: amount },
    ],
    true,
  );
  expect(r.problems.some((p) => p.message.includes('超出可保存'))).toBe(true);
  const preview = await api().paste({
    text: '大额\t6603\t9999999999999999999999\t0',
    mapping: ['summary', 'account', 'debit', 'credit'],
  });
  expect(preview.rows[0]?.errors).toContain('借方格式错误');
  expect(() =>
    balanceCell([{ debit: amount }, { debit: amount }, { debit: 0 }], 2, 'debit'),
  ).toThrow(/找平金额超出/);
});

it('w_pz_pzedit：缺汇率不会默认为1；缺失科目草稿仅保存缓冲且清楚返回原因', async () => {
  const data = await base();
  await app.svc.db.deleteFrom('exchange_rate').execute();
  const accountId = await id('100202');
  expect((await api().context({ accountId, date: data.date })).rate).toBeNull();
  const first = await save({
    ...data,
    draft: true,
    lines: [{ ...data.lines[0]!, accountId: 99999 }],
  });
  expect(first.voucher).toBeNull();
  expect(first.coreError).toMatch(/不存在/);
});

it('w_pz_pzedit / wf_pzmb_save：停用币种、过小/超范围数量给具体行而不发生内部错误', async () => {
  const data = await base();
  const quantity = {
    ...data.lines[0]!,
    accountId: await id('1403'),
    unitPrice: '1',
    quantity: '0.0000001',
  };
  for (const q of ['0.0000001', '999999999999999999999'])
    expect(
      (await code(save({ ...data, lines: [{ ...quantity, quantity: q }, data.lines[1]!] }))).code,
    ).toBe('ENTRY_INVALID');
  await app.svc.db.updateTable('currency').set({ disabled: 1 }).where('code', '=', 'USD').execute();
  const foreign = {
    ...data.lines[0]!,
    accountId: await id('100202'),
    currency: 'USD',
    exchangeRate: '7.1',
    fcAmount: 100,
    dimensions: { cashflow: await itemId('cashflow', 'CF01') },
  };
  expect(
    (
      await code(
        save({ ...data, lines: [foreign, data.lines[1]!] }, { acknowledgeCashflowUnknown: true }),
      )
    ).message,
  ).toContain('币种 USD 不存在或已停用');
});

it('w_pz_pzedit：2050年有效凭证不受旧版升级有效期门槛限制', async () => {
  const data = await base();
  app.runtime.now = () => new Date('2050-01-15T12:00:00Z');
  await app.svc.periods.ensureYear(2050);
  expect((await save({ ...data, date: '2050-01-10' })).voucher?.status).toBe('pending');
});

it('w_pz_pzedit：Excel预览提前列出必填辅助、方向与数量业务错误，无效行不能应用后自动入草稿', async () => {
  const p = await api().paste({
    text: '部门缺失\t6602\t10\t0\n收入\t6001\t0\t10',
    mapping: ['summary', 'account', 'debit', 'credit'],
  });
  expect(p.rows[0]?.errors.some((e) => e.includes('需要选择部门'))).toBe(true);
  const cf = await itemId('cashflow', 'CF01');
  await app.svc.db
    .updateTable('dimension_item')
    .set({ attrs: JSON.stringify({ cashflowDirection: 'outflow' }) })
    .where('id', '=', cf)
    .execute();
  const cash = await api().paste({
    text: '方向错误\t1001\t10\t0\tCF01\n收入\t6001\t0\t10',
    mapping: ['summary', 'account', 'debit', 'credit', 'cashflow'],
  });
  expect(cash.rows[0]?.errors.some((e) => e.includes('方向'))).toBe(true);
  const quantity = await api().paste({
    text: '数量金额错误\t1403\t1\t0\t2\t3\n收入\t6001\t0\t1',
    mapping: ['summary', 'account', 'debit', 'credit', 'quantity', 'unitPrice'],
  });
  expect(quantity.rows[0]?.errors.some((e) => e.includes('数量×单价'))).toBe(true);
  expect((await app.svc.vouchers.list({})).total).toBe(0);
});

it('w_pz_pzedit.u_pzsave：借贷已平仍拒绝 USD10×7.1 却录本币100，错误定位当前金额格', async () => {
  const data = await base();
  const cf = await itemId('cashflow', 'CF01');
  await app.svc.db
    .updateTable('dimension_item')
    .set({ attrs: JSON.stringify({ cashflowDirection: 'inflow' }) })
    .where('id', '=', cf)
    .execute();
  const bad = {
    ...data,
    lines: [
      {
        ...data.lines[0]!,
        accountId: await id('100202'),
        dimensions: { cashflow: cf },
        currency: 'USD',
        exchangeRate: '7.1',
        fcAmount: 1000,
        debit: 10000,
      },
      { ...data.lines[1]!, credit: 10000 },
    ],
  };
  const error = await code(save(bad, { key: 'fx-balanced-repro' }));
  expect(error.code).toBe('ENTRY_INVALID');
  expect(error.message).toContain('原币金额×汇率');
  expect(error.message).toContain('71.00');
  expect(error.message).toContain('100.00');
  expect(error.message).toContain('29.00');
  expect(
    'details' in error && (error.details?.problems as { line: number; field: string }[])[0],
  ).toMatchObject({ line: 1, field: 'debit' });
  expect((await app.svc.vouchers.list({ statuses: ['pending'] })).total).toBe(0);
  expect(await api().buffer({ key: 'fx-balanced-repro' })).toBeNull();
});

type FxCase = { side: 'debit' | 'credit'; fcAmount: number | null; rate: string; amount: number };
async function fxEntry({ side, fcAmount, rate, amount }: FxCase): Promise<Entry> {
  const data = await base();
  const cf = await itemId('cashflow', 'CF01');
  const signed = side === 'debit' ? amount : -amount;
  await app.svc.db
    .updateTable('dimension_item')
    .set({ attrs: JSON.stringify({ cashflowDirection: signed < 0 ? 'outflow' : 'inflow' }) })
    .where('id', '=', cf)
    .execute();
  return {
    ...data,
    lines: [
      {
        ...data.lines[0]!,
        accountId: await id('100202'),
        dimensions: { cashflow: cf },
        currency: 'USD',
        fcAmount,
        exchangeRate: rate,
        debit: side === 'debit' ? amount : 0,
        credit: side === 'credit' ? amount : 0,
      },
      {
        ...data.lines[1]!,
        debit: side === 'credit' ? amount : 0,
        credit: side === 'debit' ? amount : 0,
      },
    ],
  };
}

it.each([
  { side: 'debit', fcAmount: 1000, rate: '7.1', amount: 7100 },
  { side: 'credit', fcAmount: 1000, rate: '7.1', amount: 7100 },
  { side: 'debit', fcAmount: -1000, rate: '7.1', amount: -7100 },
  { side: 'credit', fcAmount: -1000, rate: '7.1', amount: -7100 },
  { side: 'debit', fcAmount: 1, rate: '0.5', amount: 1 },
  { side: 'credit', fcAmount: 1, rate: '0.5', amount: 1 },
  { side: 'debit', fcAmount: -1, rate: '0.5', amount: -1 },
  { side: 'credit', fcAmount: -1, rate: '0.5', amount: -1 },
  { side: 'debit', fcAmount: 1, rate: '0.50000000000000000001', amount: 1 },
  { side: 'credit', fcAmount: 1000, rate: '7.10000000000000000000001', amount: 7100 },
  { side: 'debit', fcAmount: Number.MAX_SAFE_INTEGER, rate: '1', amount: Number.MAX_SAFE_INTEGER },
  { side: 'credit', fcAmount: Number.MAX_SAFE_INTEGER, rate: '1', amount: Number.MAX_SAFE_INTEGER },
  {
    side: 'debit',
    fcAmount: -Number.MAX_SAFE_INTEGER,
    rate: '1',
    amount: -Number.MAX_SAFE_INTEGER,
  },
] satisfies FxCase[])(
  'w_pz_pzedit.u_pzsave：外币正数/红字/半分/安全边界正式保存读回 $side $fcAmount×$rate=$amount 分',
  async (input) => {
    const result = await save(await fxEntry(input));
    const restored = (await api().get({ id: result.voucher!.id })).voucher;
    expect(restored.status).toBe('pending');
    expect(restored.lines[0]).toMatchObject({
      [input.side]: input.amount,
      fcAmount: input.fcAmount,
      exchangeRate: input.rate,
      currency: 'USD',
    });
    expect(restored.debitTotal).toBe(restored.creditTotal);
  },
);

it.each([
  { side: 'debit', fcAmount: 1000, rate: '7.1', amount: 10000, message: '原币金额×汇率' },
  { side: 'credit', fcAmount: 1000, rate: '7.1', amount: 10000, message: '原币金额×汇率' },
  { side: 'debit', fcAmount: -1000, rate: '7.1', amount: -10000, message: '原币金额×汇率' },
  { side: 'credit', fcAmount: -1000, rate: '7.1', amount: -10000, message: '原币金额×汇率' },
  { side: 'debit', fcAmount: 1000, rate: '7.1', amount: 7101, message: '差额 0.01' },
  { side: 'credit', fcAmount: 1000, rate: '7.1', amount: 7099, message: '差额 -0.01' },
  { side: 'debit', fcAmount: -1000, rate: '7.1', amount: 7100, message: '差额 142.00' },
  { side: 'credit', fcAmount: 1000, rate: '7.1', amount: -7100, message: '差额 -142.00' },
  { side: 'debit', fcAmount: 1, rate: '0.49999999999999999999', amount: 1, message: '差额 0.01' },
  {
    side: 'credit',
    fcAmount: -1,
    rate: '0.49999999999999999999',
    amount: -1,
    message: '差额 -0.01',
  },
  { side: 'debit', fcAmount: 1000, rate: '7.1', amount: 0, message: '原币金额×汇率' },
  {
    side: 'credit',
    fcAmount: 1,
    rate: '0.49999999999999999999',
    amount: 0,
    message: '请填写借方、贷方、外币金额或数量',
  },
  { side: 'debit', fcAmount: 0, rate: '7.1', amount: 7100, message: '外币金额必填且不能为零' },
  { side: 'credit', fcAmount: null, rate: '7.1', amount: 7100, message: '外币金额必填且不能为零' },
  { side: 'debit', fcAmount: 1000, rate: '0', amount: 7100, message: '汇率必须大于零' },
  { side: 'credit', fcAmount: 1000, rate: '-7.1', amount: 7100, message: '汇率必须大于零' },
  {
    side: 'debit',
    fcAmount: Number.MAX_SAFE_INTEGER,
    rate: '1.0000000000000001',
    amount: Number.MAX_SAFE_INTEGER,
    message: '超出可保存金额范围',
  },
  {
    side: 'credit',
    fcAmount: 1000,
    rate: '99999999999999999999',
    amount: 1,
    message: '超出可保存金额范围',
  },
  {
    side: 'debit',
    fcAmount: -Number.MAX_SAFE_INTEGER,
    rate: '1',
    amount: Number.MAX_SAFE_INTEGER,
    message: '差额 180143985094819.82',
  },
] satisfies (FxCase & { message: string })[])(
  'w_pz_pzedit.u_pzsave：借贷平衡仍拒绝外币矛盾/零/溢出 $side $fcAmount×$rate 与 $amount 分',
  async (input) => {
    const error = await code(save(await fxEntry(input)));
    expect(error.code).toBe('ENTRY_INVALID');
    expect(error.message).toContain(input.message);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  },
);

it('w_pz_pzedit_b：外币折算不一致的更新不改变已存金额、revision 或缓冲', async () => {
  const data = await fxEntry({ side: 'debit', fcAmount: 1000, rate: '7.1', amount: 7100 });
  const saved = await save(data, { key: 'fx-update' });
  const original = saved.voucher!;
  const buffer = await api().buffer({ key: 'fx-update' });
  const bad = {
    ...data,
    lines: [
      { ...data.lines[0]!, debit: 10000 },
      { ...data.lines[1]!, credit: 10000 },
    ],
  };
  const error = await code(
    api().save({
      key: 'fx-update',
      id: original.id,
      expectedRevision: original.revision,
      bufferRevision: saved.bufferRevision,
      data: bad,
    }),
  );
  expect(error.message).toContain('差额 29.00');
  expect(await app.svc.vouchers.get(original.id)).toEqual(original);
  expect(await api().buffer({ key: 'fx-update' })).toEqual(buffer);
});

it('w_pz_pzedit：矛盾金额可明确保留为不入账草稿，不能用同一ID转正式绕过折算', async () => {
  const data = await fxEntry({ side: 'debit', fcAmount: 1000, rate: '7.1', amount: 10000 });
  const draft = await save({ ...data, draft: true }, { key: 'fx-draft' });
  expect(draft.voucher).toMatchObject({ status: 'draft', number: null, debitTotal: 10000 });
  expect(
    await app.svc.ledger.entries({ periodFrom: 202601, periodTo: 202601, includeUnposted: true }),
  ).toEqual([]);
  const error = await code(
    api().save({
      key: 'fx-draft',
      id: draft.voucher!.id,
      expectedRevision: draft.voucher!.revision,
      bufferRevision: draft.bufferRevision,
      data: { ...data, draft: false },
    }),
  );
  expect(error.message).toContain('原币金额×汇率');
  expect((await app.svc.vouchers.get(draft.voucher!.id))!.status).toBe('draft');
  expect((await app.svc.vouchers.list({ statuses: ['pending'] })).total).toBe(0);
});

it('wf_pzmb_save / w_pz_pzedit.u_pzclock / Excel：相同外币一致性规则覆盖模版、审核入口和粘贴预览', async () => {
  const data = await fxEntry({ side: 'debit', fcAmount: 1000, rate: '7.1', amount: 10000 });
  expect(
    (
      await code(
        api().saveTemplate({
          code: 'FX',
          name: '不一致模版',
          voucherTypeId: data.voucherTypeId,
          lines: data.lines,
        }),
      )
    ).message,
  ).toContain('原币金额×汇率');
  expect(await api().templates({})).toEqual([]);
  const preview = await api().paste({
    text: '美元矛盾\t100202\t100\t0\tCF01\tUSD\t7.1\t10\n对方\t6001\t0\t100',
    mapping: [
      'summary',
      'account',
      'debit',
      'credit',
      'cashflow',
      'currency',
      'exchangeRate',
      'fcAmount',
    ],
  });
  expect(preview.rows[0]?.errors.some((e) => e.includes('差额 29.00'))).toBe(true);
  expect((await app.svc.vouchers.list({})).total).toBe(0);
  // 真实 core 暂不兜底；测试只通过 core 造遗留数据，再检查本模块审核导航边界。
  const legacy = await app.svc.vouchers.create(data);
  expect((await code(api().reviewCheck({ id: legacy.id }))).message).toContain('原币金额×汇率');
  expect((await app.svc.vouchers.get(legacy.id))!.revision).toBe(1);
});

it('w_pz_pzedit：fast-check 随机正负原币和汇率经 router 读回一致，差一分必拒绝', async () => {
  const seed = await fxEntry({ side: 'debit', fcAmount: 1000, rate: '7.1', amount: 7100 });
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 1000000 }),
      fc.integer({ min: 10000, max: 100000 }),
      fc.boolean(),
      async (magnitude, rateE4, red) => {
        const fcAmount = red ? -magnitude : magnitude;
        const rate = new Decimal(rateE4).div('10000').toFixed();
        const numerator = BigInt(fcAmount) * BigInt(rateE4);
        const expected = Number(
          (numerator < 0n ? -1n : 1n) *
            (((numerator < 0n ? -numerator : numerator) + 5000n) / 10000n),
        );
        const cf = seed.lines[0]!.dimensions!.cashflow!;
        await app.svc.db
          .updateTable('dimension_item')
          .set({ attrs: JSON.stringify({ cashflowDirection: red ? 'outflow' : 'inflow' }) })
          .where('id', '=', cf)
          .execute();
        const data = {
          ...seed,
          lines: [
            { ...seed.lines[0]!, fcAmount, exchangeRate: rate, debit: expected },
            { ...seed.lines[1]!, credit: expected },
          ],
        };
        const saved = await save(data);
        expect(saved.voucher!.lines[0]).toMatchObject({
          debit: expected,
          fcAmount,
          exchangeRate: rate,
        });
        const error = await code(
          save({
            ...data,
            lines: [
              { ...data.lines[0]!, debit: expected + (red ? -1 : 1) },
              { ...data.lines[1]!, credit: expected + (red ? -1 : 1) },
            ],
          }),
        );
        expect(error.message).toContain('原币金额×汇率');
      },
    ),
    { numRuns: 20 },
  );
});
