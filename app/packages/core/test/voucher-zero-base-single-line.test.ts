import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import type { VoucherInput, VoucherLineInput } from '../src';

let book: TestBook;
let voucherTypeId: number;
beforeEach(async () => {
  book = await createTestBook();
  voucherTypeId = (await book.svc.reference.voucherTypes())[0]!.id;
});
afterEach(async () => book?.close());

const owner = () => book.forModule('costing');
const input = (line: VoucherLineInput): VoucherInput => ({
  voucherTypeId,
  date: '2026-01-10',
  source: { type: 'costing', id: 'synthetic-zero-base' },
  lines: [line],
});
const quantityLine = async (): Promise<VoucherLineInput> => ({
  summary: '零成本数量调整',
  accountId: (await book.svc.accounts.require('1403')).id,
  debit: 0,
  credit: 0,
  entrySide: 'debit',
  quantity: '2',
});
const foreignLine = async (): Promise<VoucherLineInput> => ({
  summary: '零本币外币调整',
  accountId: (await book.svc.accounts.require('100202')).id,
  debit: 0,
  credit: 0,
  entrySide: 'debit',
  currency: 'USD',
  exchangeRate: '7.1',
  fcAmount: 100,
});
async function assertNoWrites() {
  expect((await owner().vouchers.list()).total).toBe(0);
  expect(book.book.raw.prepare('SELECT count(*) FROM voucher_line').pluck().get()).toBe(0);
  expect(
    book.book.raw
      .prepare("SELECT count(*) FROM operation_log WHERE target_type='voucher'")
      .pluck()
      .get(),
  ).toBe(0);
  expect(await owner().vouchers.nextNumber(202601, voucherTypeId)).toBe(1);
}

it('w_pz_pzedit：最小反例，单行零本币非零数量的来源凭证可保存且只分配一个编号', async () => {
  const voucher = await owner().vouchers.create(input(await quantityLine()));
  expect(voucher).toMatchObject({
    number: 1,
    status: 'pending',
    debitTotal: 0,
    creditTotal: 0,
    source: { module: 'costing', type: 'costing', id: 'synthetic-zero-base' },
  });
  expect(voucher.lines).toHaveLength(1);
  expect(voucher.lines[0]).toMatchObject({
    debit: 0,
    credit: 0,
    quantity: '2',
    entrySide: 'debit',
  });
  expect(
    book.book.raw
      .prepare('SELECT quantity_e6,entry_side FROM voucher_line WHERE voucher_id=?')
      .get(voucher.id),
  ).toEqual({ quantity_e6: 2_000_000, entry_side: 'debit' });
  expect(await owner().vouchers.nextNumber(202601, voucherTypeId)).toBe(2);
});

it.each([
  ['debit', '2', '2'],
  ['credit', '2', '-2'],
  ['debit', '-2', '-2'],
  ['credit', '-2', '2'],
] as const)(
  'w_pz_pzedit/w_zw_jz：单行数量 %s/%s 过账和反号冲销保留方向，数量余额先为%s后归零',
  async (entrySide, quantity, closing) => {
    const svc = owner();
    const line = { ...(await quantityLine()), entrySide, quantity };
    const voucher = await svc.vouchers.create(input(line));
    await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
    await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
    const balances = () =>
      svc.ledger.quantityBalances({
        periodFrom: 202601,
        periodTo: 202601,
        accountCodes: ['1403'],
        quantityUnit: '千克',
        rollup: false,
        includeZero: true,
      });
    expect((await balances())[0]!.qtyClosing).toBe(closing);
    const reversal = await svc.vouchers.create({
      ...input({
        ...line,
        quantity: quantity.startsWith('-') ? quantity.slice(1) : `-${quantity}`,
      }),
      source: { type: 'costing', id: 'synthetic-reversal' },
      reversalOfId: voucher.id,
    });
    expect(reversal.lines[0]!.entrySide).toBe(entrySide);
    await svc.vouchers.changeStatus({ ids: [reversal.id], to: 'audited' });
    await svc.vouchers.changeStatus({ ids: [reversal.id], to: 'posted' });
    expect((await balances())[0]!.qtyClosing).toBe('0');
    expect(await svc.ledger.trialBalance(202601, 202601)).toMatchObject({ balanced: true });
  },
);

it.each([
  ['debit', 100, 100],
  ['credit', 100, -100],
  ['debit', -100, -100],
  ['credit', -100, 100],
] as const)(
  'w_pz_pzedit/w_zw_jz：单行外币 %s/%s 过账保存原币余额%s，冲销后归零',
  async (entrySide, fcAmount, closing) => {
    const svc = owner();
    const line = { ...(await foreignLine()), entrySide, fcAmount };
    const voucher = await svc.vouchers.create(input(line));
    expect(voucher).toMatchObject({ number: 1, debitTotal: 0, creditTotal: 0 });
    await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
    await svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
    const balances = () =>
      svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        accountCodes: ['100202'],
        currency: 'USD',
        rollup: false,
        includeZero: true,
      });
    expect((await balances())[0]!.fcClosing).toBe(closing);
    const reversal = await svc.vouchers.create({
      ...input({ ...line, fcAmount: -fcAmount }),
      source: { type: 'costing', id: 'synthetic-reversal' },
      reversalOfId: voucher.id,
    });
    expect(reversal.lines[0]!.entrySide).toBe(entrySide);
    await svc.vouchers.changeStatus({ ids: [reversal.id], to: 'audited' });
    await svc.vouchers.changeStatus({ ids: [reversal.id], to: 'posted' });
    expect((await balances())[0]!.fcClosing).toBe(0);
  },
);

it.each(['quantity', 'foreign'] as const)(
  'w_pz_pzedit：单行%s草稿转正式与后续修改复用同一校验且不重复编号',
  async (kind) => {
    const svc = owner();
    const line = kind === 'quantity' ? await quantityLine() : await foreignLine();
    const draft = await svc.vouchers.create({ ...input(line), draft: true });
    expect(draft).toMatchObject({ status: 'draft', number: null });
    const promoted = await svc.vouchers.update(draft.id, input(line), {
      expectedRevision: draft.revision,
    });
    expect(promoted).toMatchObject({ status: 'pending', number: 1, debitTotal: 0, creditTotal: 0 });
    const modifiedLine =
      kind === 'quantity' ? { ...line, quantity: '3' } : { ...line, fcAmount: 200 };
    const modified = await svc.vouchers.update(promoted.id, input(modifiedLine), {
      expectedRevision: promoted.revision,
    });
    expect(modified.number).toBe(1);
    expect(modified.lines).toHaveLength(1);
    expect(modified.lines[0]).toMatchObject(
      kind === 'quantity' ? { quantity: '3' } : { fcAmount: 200 },
    );
    const before = await svc.vouchers.get(modified.id);
    await expect(
      svc.vouchers.update(modified.id, input({ ...modifiedLine, debit: 1 }), {
        expectedRevision: modified.revision,
      }),
    ).rejects.toThrow();
    expect(await svc.vouchers.get(modified.id)).toEqual(before);
    expect(await svc.vouchers.nextNumber(202601, voucherTypeId)).toBe(2);
  },
);

it.each([
  '没有分录',
  '全空行',
  '零数量',
  '数量舍入为零',
  '未填数量',
  '数量科目不符',
  '零外币',
  '缺汇率',
  '外币科目不符',
  '缺借贷方向',
  '未选科目',
  '单行本币金额',
  '借贷不平衡',
] as const)('w_pz_pzedit：单行放行不绕过%s检查，拒绝后无数据、日志或编号写入', async (fault) => {
  const expectedMessage = {
    没有分录: /至少要有两行/,
    全空行: /至少要有两行/,
    零数量: /本币、外币和数量均为 0/,
    数量舍入为零: /本币、外币和数量均为 0/,
    未填数量: /需要填写数量/,
    数量科目不符: /没有启用数量核算/,
    零外币: /本币、外币和数量均为 0/,
    缺汇率: /需要填写汇率和外币金额/,
    外币科目不符: /没有启用外币核算/,
    缺借贷方向: /必须明确选择借方或贷方/,
    未选科目: /没有选择科目/,
    单行本币金额: /至少要有两行/,
    借贷不平衡: /借贷不平衡/,
  }[fault];
  const line = await quantityLine();
  let lines: VoucherLineInput[] = [line];
  if (fault === '没有分录') lines = [];
  if (fault === '全空行') lines = [{ debit: 0, credit: 0 }];
  if (fault === '零数量') lines = [{ ...line, quantity: '0' }];
  if (fault === '数量舍入为零') lines = [{ ...line, quantity: '0.00000049' }];
  if (fault === '未填数量') lines = [{ ...line, quantity: undefined }];
  if (fault === '数量科目不符')
    lines = [{ ...line, accountId: (await book.svc.accounts.require('6001')).id }];
  if (fault === '零外币') lines = [{ ...(await foreignLine()), fcAmount: 0 }];
  if (fault === '缺汇率') lines = [{ ...(await foreignLine()), exchangeRate: undefined }];
  if (fault === '外币科目不符') lines = [{ ...(await foreignLine()), accountId: line.accountId }];
  if (fault === '缺借贷方向') lines = [{ ...line, entrySide: undefined }];
  if (fault === '未选科目') lines = [{ ...line, accountId: null }];
  if (fault === '单行本币金额') lines = [{ ...line, debit: 1 }];
  if (fault === '借贷不平衡')
    lines = [
      { ...line, debit: 100 },
      {
        summary: '不平衡对方',
        accountId: (await book.svc.accounts.require('6001')).id,
        debit: 0,
        credit: 50,
      },
    ];
  await expect(owner().vouchers.create({ ...input(line), lines })).rejects.toMatchObject({
    data: {
      code: 'VOUCHER_INVALID',
      details: {
        problems: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringMatching(expectedMessage) }),
        ]),
      },
    },
  });
  await assertNoWrites();
  expect((await owner().vouchers.create(input(line))).number).toBe(1);
});

it.each([
  ['0.0000005', '0.000001', 1],
  ['-0.0000005', '-0.000001', -1],
] as const)('w_pz_pzedit：单行数量%s以非零六位落库值%s正式保存', async (quantity, stored, e6) => {
  const voucher = await owner().vouchers.create(input({ ...(await quantityLine()), quantity }));
  expect(voucher.lines).toHaveLength(1);
  expect(voucher.lines[0]!.quantity).toBe(stored);
  expect(
    book.book.raw
      .prepare('SELECT quantity_e6 FROM voucher_line WHERE voucher_id=?')
      .pluck()
      .get(voucher.id),
  ).toBe(e6);
});

it('w_pz_pzedit：来源业务事务后续失败时单行凭证和编号一起回滚，重试仍取得首号', async () => {
  const value = input(await quantityLine());
  await expect(
    owner().tx(async (svc) => {
      expect((await svc.vouchers.create(value)).number).toBe(1);
      throw new Error('合成来源业务写入失败');
    }),
  ).rejects.toThrow('合成来源业务写入失败');
  await assertNoWrites();
  expect((await owner().vouchers.create(value)).number).toBe(1);
});

it('w_pz_pzedit：并发生成单行来源凭证仍在事务内依次分配唯一编号', async () => {
  const value = input(await quantityLine());
  const vouchers = await Promise.all(
    ['synthetic-a', 'synthetic-b'].map((id) =>
      owner().vouchers.create({ ...value, source: { type: 'costing', id } }),
    ),
  );
  expect(vouchers.map((v) => v.number).sort()).toEqual([1, 2]);
  expect(new Set(vouchers.map((v) => v.id)).size).toBe(2);
  expect(await owner().vouchers.nextNumber(202601, voucherTypeId)).toBe(3);
});
