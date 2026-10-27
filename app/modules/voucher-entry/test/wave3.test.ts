import { afterEach, beforeEach, expect, it } from 'vitest';
import { BusinessError, type VoucherLineInput } from '@caiwu/core';
import { createTestApp, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { entryService } from '../server/service';
import { blankLine, isEmptyEntryLine, type Entry, type SaveInput } from '../shared';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => app.close());
const input = async (): Promise<Entry> =>
  voucherInputFromSpec(app.svc, {
    date: '2026-01-10',
    lines: [
      { account: '6603', debit: 100001, summary: '费用' },
      { account: '6001', credit: 100001, summary: '收入' },
    ],
  });

it.each(['首', '中', '尾', '首中尾'])(
  'w_pz_pzedit / w_pz_pzedit_mb：忽略%s空行，正式记录与模板仅保留有效行，缓冲保留原编辑布局',
  async (position) => {
    const data = await input();
    if (position.includes('首')) data.lines.unshift(blankLine());
    if (position.includes('中')) data.lines.splice(data.lines.length - 1, 0, blankLine());
    if (position.includes('尾')) data.lines.push(blankLine());
    const api = app.call(server);
    const saved = await api.save({ key: 'empty-rows', data });
    expect(saved.voucher?.lines.map((l) => [l.debit, l.credit])).toEqual([
      [100001, 0],
      [0, 100001],
    ]);
    expect((await api.buffer({ key: 'empty-rows' }))?.data.lines).toHaveLength(data.lines.length);
    const id = await api.saveTemplate({
      code: 'EMP',
      name: '空行模板',
      voucherTypeId: data.voucherTypeId,
      lines: data.lines,
    });
    expect((await api.template({ id })).lines).toHaveLength(2);
  },
);

it('w_pz_pzedit：全部空白不能生成凭证，失败无业务写入', async () => {
  const data = { ...(await input()), lines: [blankLine(), blankLine(), blankLine()] };
  await expect(app.call(server).save({ key: 'all-empty', data })).rejects.toThrow(/至少录入两条/);
  expect((await app.svc.vouchers.list({})).total).toBe(0);
  expect(await app.call(server).buffer({ key: 'all-empty' })).toBeNull();
});

it.each([
  { summary: '只有摘要' },
  { accountId: 999999 },
  { dimensions: { project: 999999 } },
  { refNo: '票号' },
  { bizDate: '2026-01-10' },
  { debit: 1 },
])('w_pz_pzedit / w_pz_pzedit_mb：半填行不吞掉并定位原第三行 $summary $refNo', async (partial) => {
  const data = await input();
  const row = { ...blankLine(), ...partial };
  data.lines.splice(1, 0, blankLine(), row);
  const checked = await entryService(app.svc).inspect(data.lines, true);
  expect(checked.lines).toHaveLength(3);
  expect(checked.problems[0]).toMatchObject({ line: 3, field: 'accountId' });
  expect(isEmptyEntryLine(row)).toBe(false);
  await expect(app.call(server).save({ key: 'partial', data })).rejects.toThrow(/第3行/);
  expect(data.lines[2]).toEqual(row);
});

it.each(['debit', 'credit', 'fcAmount', 'quantity', 'exchangeRate'] as const)(
  'w_pz_pzedit：非法%s数字返回原第三行，先前缓冲不丢失',
  async (field) => {
    const data: Entry = { ...(await input()), draft: true };
    const api = app.call(server);
    const saved = await api.save({ key: 'bad-number', data });
    const before = await api.buffer({ key: 'bad-number' });
    const bad = {
      ...data,
      draft: false,
      lines: [data.lines[0]!, blankLine(), { ...blankLine(), [field]: '不是数字' }, data.lines[1]!],
    };
    const request = {
      key: 'bad-number',
      id: saved.voucher!.id,
      expectedRevision: saved.voucher!.revision,
      bufferRevision: saved.bufferRevision,
      data: bad,
    } as SaveInput;
    const error: unknown = await api.save(request).catch((e: unknown) => e);
    const cause = (error as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(BusinessError);
    expect((cause as BusinessError).data).toMatchObject({
      code: 'ENTRY_INVALID',
      details: { problems: [{ line: 3, field }] },
    });
    expect(await api.buffer({ key: 'bad-number' })).toEqual(before);
  },
);

it('w_pz_pzedit：零本币但非零外币或数量不是空行，交给完整校验且不改输入', async () => {
  const foreign = { ...blankLine(), fcAmount: 1, currency: 'USD', exchangeRate: '0.1' };
  const quantity = { ...blankLine(), quantity: '1.000001' };
  const illegal = { ...blankLine(), debit: NaN };
  const rows: VoucherLineInput[] = [blankLine(), foreign, quantity, illegal];
  const before = structuredClone(rows);
  for (const row of rows.slice(1)) expect(isEmptyEntryLine(row)).toBe(false);
  const checked = await entryService(app.svc).inspect(rows, true);
  expect(checked.lines).toHaveLength(3);
  expect(checked.problems.filter((p) => p.field === 'accountId').map((p) => p.line)).toEqual([
    2, 3, 4,
  ]);
  expect(rows).toEqual(before);
});

it('w_pz_pzedit：合法零本币外币/数量行通过本域完整检查并原样交给凭证服务', async () => {
  const quantityAccount = await app.svc.accounts.require('1405');
  const quantityRows: VoucherLineInput[] = [1, -1].map((quantity) => ({
    ...blankLine(),
    accountId: quantityAccount.id,
    summary: '数量调整',
    quantity: String(quantity),
    unitPrice: '0',
  }));
  const checked = await entryService(app.svc).inspect([blankLine(), ...quantityRows], true);
  expect(checked.problems).toEqual([]);
  expect(checked.lines).toEqual(quantityRows);
  const foreign = await app.svc.accounts.require('100202');
  const flow = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!;
  const foreignRows: VoucherLineInput[] = [1, -1].map((amount) => ({
    ...blankLine(),
    accountId: foreign.id,
    summary: '原币尾差',
    currency: 'USD',
    fcAmount: amount,
    exchangeRate: '0.1',
    dimensions: { cashflow: flow.id },
  }));
  const fx = await entryService(app.svc).inspect([blankLine(), ...foreignRows], true);
  expect(fx.problems).toEqual([]);
  expect(fx.lines).toEqual(foreignRows);
});
