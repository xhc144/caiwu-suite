import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import { applyExchangeRate, changeEntryDate, type Entry } from '../shared';
import server from '../server';

let app: TestApp | undefined;
afterEach(async () => app?.close());

it('w_pz_pzedit：日期逐字输入经过无效中间态不沿用旧期间汇率，同月保留手工汇率', () => {
  const data: Entry = {
    date: '2026-01-10',
    voucherTypeId: 1,
    number: 8,
    lines: [
      { accountId: 1, currency: 'USD', exchangeRate: '7.1', fcAmount: 1000, debit: 7100 },
      { accountId: 2, credit: 7100 },
    ],
  };
  expect(changeEntryDate(data, '2026-01-31')).toMatchObject({
    number: 8,
    lines: [{ exchangeRate: '7.1' }, {}],
  });
  const typing = changeEntryDate(data, '2026-0');
  expect(typing.lines[0]).toMatchObject({ exchangeRate: null, fcAmount: 1000, debit: 7100 });
  expect(changeEntryDate(typing, '2026-02-10').lines[0]?.exchangeRate).toBeNull();
  expect(changeEntryDate(data, '2026-02-10').number).toBeNull();
  expect(data.lines[0]?.exchangeRate).toBe('7.1');
});

it.each([
  { side: 'debit', fc: 1000, rate: '7.2', amount: 7200 },
  { side: 'credit', fc: 1000, rate: '7.2', amount: 7200 },
  { side: 'debit', fc: -1000, rate: '7.2', amount: -7200 },
  { side: 'credit', fc: -1000, rate: '7.2', amount: -7200 },
  { side: 'credit', fc: -1, rate: '0.5', amount: -1 },
] as const)(
  'w_pz_flxx1：带入期间汇率保留 $side 侧和红字，$fc×$rate=$amount 分',
  ({ side, fc, rate, amount }) => {
    const line = { fcAmount: fc, debit: 0, credit: 0, [side]: fc };
    expect(applyExchangeRate(line, rate)).toEqual({ ...line, exchangeRate: rate, [side]: amount });
    expect(line[side]).toBe(fc);
  },
);

it('w_pz_flxx1：汇率折算溢出保持原行，未填原币时只带汇率', () => {
  const line = { fcAmount: Number.MAX_SAFE_INTEGER, debit: Number.MAX_SAFE_INTEGER };
  expect(() => applyExchangeRate(line, '2')).toThrow();
  expect(line.debit).toBe(Number.MAX_SAFE_INTEGER);
  expect(applyExchangeRate({ debit: 100, fcAmount: null }, '7.2')).toEqual({
    debit: 100,
    fcAmount: null,
    exchangeRate: '7.2',
  });
});

it('w_pz_flxx1：零本币外币调整带入新汇率仍保留明确的贷方方向', () => {
  const line = { fcAmount: 100, debit: 0, credit: 0, entrySide: 'credit' as const };
  expect(applyExchangeRate(line, '7.2')).toEqual({ ...line, exchangeRate: '7.2', credit: 720 });
  expect(line.credit).toBe(0);
});

it('w_pz_flxx1：余额按当前辅助组合过滤，含已保存未过账，排除草稿和其它组合', async () => {
  app = await createTestApp({ modules: [server] });
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      lines: [
        { account: '6602', debit: 1234, dims: { department: '01' } },
        { account: '6001', credit: 1234 },
      ],
    },
    {
      date: '2026-01-06',
      status: 'posted',
      lines: [
        { account: '6602', debit: 5678, dims: { department: '02' } },
        { account: '6001', credit: 5678 },
      ],
    },
    {
      date: '2026-01-07',
      status: 'draft',
      lines: [
        { account: '6602', debit: 9999, dims: { department: '01' } },
        { account: '6001', credit: 9999 },
      ],
    },
  ]);
  const api = app.call(server);
  const accountId = (await app.svc.accounts.require('6602')).id;
  const department = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  expect(await api.context({ accountId, date: '2026-01-10' })).toMatchObject({ balance: 6912 });
  expect(
    await api.context({ accountId, date: '2026-01-10', dimensions: { department } }),
  ).toMatchObject({ balance: 1234, includeUnposted: true });
});

it('w_pz_flxx1：外币/数量余额直接来自 core，不混加币种或把金额当数量', async () => {
  app = await createTestApp({ modules: [server] });
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      lines: [
        {
          account: '100202',
          debit: 7100,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 1000,
          dims: { cashflow: 'CF01' },
        },
        { account: '6001', credit: 7100 },
      ],
    },
    {
      date: '2026-01-06',
      lines: [
        { account: '1403', debit: 6000, quantity: '2', unitPrice: '30' },
        { account: '6001', credit: 6000 },
      ],
    },
  ]);
  const api = app.call(server);
  expect(
    await api.context({
      accountId: (await app.svc.accounts.require('100202')).id,
      date: '2026-01-10',
    }),
  ).toMatchObject({ balance: 7100, fcBalance: 1000, rate: '7.1' });
  expect(
    await api.context({
      accountId: (await app.svc.accounts.require('1403')).id,
      date: '2026-01-10',
    }),
  ).toMatchObject({ balance: 6000, quantityBalance: '2' });
});

it('w_pz_pzmb_main：两个编辑器同 revision 保存只接受一次，不产生混合头与分录', async () => {
  app = await createTestApp({ modules: [server] });
  const api = app.call(server);
  const input = await voucherInputFromSpec(app.svc, {
    date: '2026-01-10',
    lines: [
      { account: '6603', debit: 100 },
      { account: '6001', credit: 100 },
    ],
  });
  const base = {
    code: 'W2',
    name: '原模版',
    voucherTypeId: input.voucherTypeId,
    lines: input.lines,
  };
  const id = await api.saveTemplate(base);
  const outcomes = await Promise.allSettled(
    ['窗口甲', '窗口乙'].map((name) =>
      api.saveTemplate({
        ...base,
        id,
        revision: 1,
        name,
        lines: input.lines.map((line) => ({ ...line, summary: name })),
      }),
    ),
  );
  expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
  const saved = await api.template({ id });
  expect(saved.revision).toBe(2);
  expect(saved.lines.map((line) => line.summary)).toEqual([saved.name, saved.name]);
});

it('w_pz_pzedit：真实在线备份维护期间拒绝保存，备份和原账的凭证/缓冲均未被晚到请求改写', async () => {
  app = await createTestApp({ modules: [server] });
  const api = app.call(server);
  const data = await voucherInputFromSpec(app.svc, {
    date: '2026-01-10',
    lines: [
      { account: '6603', debit: 100 },
      { account: '6001', credit: 100 },
    ],
  });
  const saved = await api.save({ key: 'backup-guard', data });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'voucher-entry-backup-'));
  const file = path.join(dir, 'snapshot.caiwu');
  let release!: () => void;
  let ready!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prepared = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const maintenance = app.runtime.bookStore.maintain(app.book.id, {
    kind: 'reconnect',
    prepare: async (book) => {
      await book.raw.backup(file);
      ready();
      await gate;
    },
  });
  try {
    await prepared;
    await expect(
      api.save({
        key: 'backup-guard',
        id: saved.voucher!.id,
        expectedRevision: saved.voucher!.revision,
        bufferRevision: saved.bufferRevision,
        data: { ...data, attachments: 9 },
      }),
    ).rejects.toThrow(/维护|登录|会话/);
    const backup = new Database(file, { readonly: true });
    try {
      expect(backup.prepare('SELECT attachments, revision FROM voucher').all()).toEqual([
        { attachments: 0, revision: 1 },
      ]);
      expect(backup.prepare('SELECT revision FROM voucher_entry_buffer').all()).toEqual([
        { revision: 1 },
      ]);
    } finally {
      backup.close();
    }
    release();
    await maintenance;
    const fresh = app.call(server, await app.login());
    expect((await fresh.get({ id: saved.voucher!.id })).voucher).toMatchObject({
      attachments: 0,
      revision: 1,
    });
    expect((await fresh.buffer({ key: 'backup-guard' }))?.revision).toBe(1);
  } finally {
    release();
    await maintenance;
    rmSync(dir, { recursive: true, force: true });
  }
});
