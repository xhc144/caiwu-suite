import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import type { SourceMode } from '../shared';
import periodCloseServer from '../server';
import { addBucket, canonicalBuckets, type Bucket } from '../server/buckets';
import {
  applySourceActivity,
  selectSourceBuckets,
  type SourceActivity,
} from '../server/source-modes';
import { call, errorData, rule, zeroOpening } from './helpers';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
});
afterEach(async () => app.close());

const modes = [
  ['balance', 14000],
  ['debitBalance', 14000],
  ['creditBalance', 0],
  ['periodDebit', 700],
  ['periodCredit', -200],
  ['periodNet', 500],
] as const;

describe('w_xt_jzwh 的明确转出类型', () => {
  it.each(modes)(
    'w_xt_jzwh / w_zw_ydjz：%s 按期初与本月范围独立取数并生成',
    async (mode, expected) => {
      const api = call(app);
      const sourceId = (await app.svc.accounts.require('4001')).id;
      await app.svc.opening.upsert({ year: 2026, accountId: sourceId, balance: 10000 });
      await app.svc.opening.upsert({
        year: 2026,
        accountId: (await app.svc.accounts.require('4104')).id,
        balance: -10000,
      });
      await seedVouchers(app.svc, [
        {
          date: '2026-01-05',
          status: 'posted',
          lines: [
            { account: '4001', debit: 5000 },
            { account: '4001', credit: 1000 },
            { account: '4001', debit: -500 },
            { account: '4104', credit: 3500 },
          ],
        },
        {
          date: '2026-02-05',
          status: 'posted',
          lines: [
            { account: '4001', debit: 700 },
            { account: '4001', credit: 200 },
            { account: '4104', credit: 500 },
          ],
        },
        {
          date: '2026-03-05',
          status: 'posted',
          lines: [
            { account: '4001', debit: 12345 },
            { account: '4104', credit: 12345 },
          ],
        },
      ]);
      await api.saveRule({
        data: await rule(app, {
          code: 'MODE',
          kind: 'custom',
          sources: [{ accountId: sourceId, mode, ratio: '100' }],
        }),
      });
      expect((await api.rules())[0]!.sources[0]!.mode).toBe(mode);
      const preview = await api.preview({ period: 202602, ruleIds: [1] });
      expect(preview.items[0]!.debit).toBe(Math.abs(expected));
      expect(preview.items[0]!.credit).toBe(Math.abs(expected));
      if (expected !== 0) {
        const source = preview.items[0]!.lines.find((l) => l.accountId === sourceId)!;
        expect(source.debit! - source.credit!).toBe(-expected);
      }
      const input = {
        period: 202602,
        ruleIds: [1],
        previewToken: preview.previewToken,
        confirmed: true,
      };
      const result = await api.generate(input);
      expect(result.generated).toHaveLength(expected === 0 ? 0 : 1);
      for (const generated of result.generated) {
        const voucher = (await app.svc.vouchers.get(generated.id))!;
        expect(voucher).toMatchObject({
          status: 'pending',
          debitTotal: Math.abs(expected),
          creditTotal: Math.abs(expected),
        });
      }
      expect((await api.generate(input)).generated).toEqual(
        result.generated.map((g) => ({ ...g, existing: true })),
      );
    },
  );

  it.each([
    ['debitBalance', 100],
    ['creditBalance', -60],
  ] as const)('w_xt_jzwh：%s 逐辅助项筛选，借贷相抵前保留方向', async (mode, expected) => {
    const api = call(app);
    const source = await app.svc.accounts.create(
      {
        code: '1701',
        name: '分部门余额',
        categoryId: 'asset',
        dimensions: [{ type: 'department', required: true }],
      },
      app.book.codeScheme,
    );
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: source.code, debit: 100, dims: { department: '01' } },
          { account: source.code, credit: 60, dims: { department: '02' } },
          { account: '4001', credit: 40 },
        ],
      },
    ]);
    await api.saveRule({
      data: await rule(app, {
        kind: 'custom',
        sources: [{ accountId: source.id, mode, ratio: '100' }],
      }),
    });
    const preview = await api.preview({ period: 202601, ruleIds: [1] });
    const line = preview.items[0]!.lines.find((l) => l.accountId === source.id)!;
    expect(line.debit! - line.credit!).toBe(-expected);
    expect(line.dimensions?.department).toBe(
      (await app.svc.dimensions.getByCode('department', expected > 0 ? '01' : '02'))!.id,
    );
  });

  it('w_xt_jzwh：本期发生额按红字原侧冲减，保留币种、四类辅助和数量', async () => {
    const api = call(app);
    const source = await app.svc.accounts.create(
      {
        code: '1701',
        name: '外币四维数量',
        categoryId: 'asset',
        currency: 'USD',
        quantityUnit: '件',
        dimensions: [
          { type: 'project', required: true },
          { type: 'partner', required: true },
          { type: 'department', required: true },
          { type: 'person', required: true },
        ],
      },
      app.book.codeScheme,
    );
    const dims = { project: 'XM01', partner: 'C001', department: '01', person: 'P01' };
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          {
            account: source.code,
            debit: 7100,
            currency: 'USD',
            rate: '7.1',
            fcAmount: 1000,
            quantity: '2',
            dims,
          },
          {
            account: source.code,
            debit: -710,
            currency: 'USD',
            rate: '7.1',
            fcAmount: -100,
            quantity: '-0.25',
            dims,
          },
          {
            account: source.code,
            credit: 1420,
            currency: 'USD',
            rate: '7.1',
            fcAmount: 200,
            quantity: '0.5',
            dims,
          },
          { account: '4001', credit: 4970 },
        ],
      },
    ]);
    await api.saveRule({
      data: await rule(app, {
        kind: 'custom',
        sources: [{ accountId: source.id, mode: 'periodDebit', ratio: '50' }],
      }),
    });
    const preview = await api.preview({ period: 202601, ruleIds: [1] });
    expect(preview.items[0]!.lines.find((l) => l.accountId === source.id)).toMatchObject({
      debit: 0,
      credit: 3195,
      currency: 'USD',
      fcAmount: 450,
      quantity: '0.875',
      dimensions: {
        project: (await app.svc.dimensions.getByCode('project', 'XM01'))!.id,
        partner: (await app.svc.dimensions.getByCode('partner', 'C001'))!.id,
        department: (await app.svc.dimensions.getByCode('department', '01'))!.id,
        person: (await app.svc.dimensions.getByCode('person', 'P01'))!.id,
      },
    });
  });

  it('w_zw_ydjz：前序结转加入后序本期发生额，重复核验不重复计算来源凭证', async () => {
    const api = call(app);
    const id = async (code: string) => (await app.svc.accounts.require(code)).id;
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '4001', debit: 1000 },
          { account: '4104', credit: 1000 },
        ],
      },
    ]);
    await api.saveRule({
      data: await rule(app, {
        code: 'FIRST',
        kind: 'custom',
        sources: [{ accountId: await id('4001'), mode: 'balance', ratio: '50' }],
      }),
    });
    await api.saveRule({
      data: await rule(app, {
        code: 'SECOND',
        kind: 'custom',
        order: 2,
        targetAccountId: await id('4104'),
        sources: [{ accountId: await id('4103'), mode: 'periodDebit', ratio: '100' }],
      }),
    });
    const preview = await api.preview({ period: 202601, ruleIds: [2, 1] });
    expect(preview.items.map((i) => i.debit)).toEqual([500, 500]);
    const input = {
      period: 202601,
      ruleIds: [2, 1],
      confirmed: true,
      previewToken: preview.previewToken,
    };
    expect((await api.generate(input)).generated).toHaveLength(2);
    expect((await api.generate(input)).generated.every((g) => g.existing)).toBe(true);
  });

  it('w_zw_ydjz：余额未变但本期借贷发生额变化，旧预览仍失效', async () => {
    const api = call(app);
    const accountId = (await app.svc.accounts.require('4001')).id;
    const add = () =>
      seedVouchers(app.svc, [
        {
          date: '2026-01-05',
          status: 'posted',
          lines: [
            { account: '4001', debit: 100 },
            { account: '4001', credit: 100 },
          ],
        },
      ]);
    await add();
    await api.saveRule({
      data: await rule(app, {
        kind: 'custom',
        sources: [{ accountId, mode: 'periodDebit', ratio: '100' }],
      }),
    });
    const preview = await api.preview({ period: 202601, ruleIds: [1] });
    await add();
    const error = await errorData(
      api.generate({
        period: 202601,
        ruleIds: [1],
        confirmed: true,
        previewToken: preview.previewToken,
      }),
    );
    expect(error.code).toBe('PERIOD_CLOSE_PREVIEW_CHANGED');
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
  });
});

it('fast-check w_xt_jzwh：各类型只筛选其基数，不改原始余额；红字及零本币原侧正确累计', () => {
  fc.assert(
    fc.property(
      fc.record({
        amount: fc.integer({ min: -100000, max: 100000 }),
        foreign: fc.integer({ min: -10000, max: 10000 }),
        qty: fc.integer({ min: -1000000, max: 1000000 }),
      }),
      ({ amount, foreign, qty }) => {
        const balances = new Map<string, Bucket>();
        const bucket: Bucket = {
          accountId: 1,
          dimensions: { department: 2 },
          currency: 'USD',
          amount,
          fc: foreign,
          qty,
        };
        addBucket(balances, bucket);
        const activity: SourceActivity = { debit: new Map(), credit: new Map(), net: new Map() };
        applySourceActivity(activity, [
          {
            accountId: 1,
            debit: 0,
            credit: 0,
            entrySide: 'debit',
            currency: 'USD',
            fcAmount: foreign,
            quantity: String(qty / 1000000),
            dimensions: { department: 2 },
          },
        ]);
        expect([...activity.debit.values()][0]).toMatchObject({ amount: 0, fc: foreign, qty });
        expect(activity.credit.size).toBe(0);
        const original = canonicalBuckets(balances);
        for (const mode of [
          'balance',
          'debitBalance',
          'creditBalance',
          'periodDebit',
          'periodCredit',
          'periodNet',
        ] satisfies SourceMode[]) {
          const result = selectSourceBuckets(balances, activity, new Map([[1, mode]]));
          for (const b of result.values()) {
            if (mode === 'debitBalance') expect(Math.sign(b.amount || b.fc || b.qty)).toBe(1);
            if (mode === 'creditBalance') expect(Math.sign(b.amount || b.fc || b.qty)).toBe(-1);
            b.amount = 123456;
          }
          expect(canonicalBuckets(balances)).toEqual(original);
        }
      },
    ),
  );
});
