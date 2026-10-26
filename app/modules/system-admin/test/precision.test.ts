import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import server from '../server';

const MAX = Number.MAX_SAFE_INTEGER;
const cases = [
  { values: [MAX, 2, -MAX, -1], expected: 1 },
  { values: [-MAX, -2, MAX, 1], expected: -1 },
  { values: [MAX, 2, -MAX, -2], expected: 0 },
];
let app: TestApp;
const api = () => app.call(server);
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  await app.close();
});

async function opening(values: number[]) {
  const accounts = (await app.svc.accounts.list())
    .filter((a) => a.isLeaf && !a.currency && !a.quantityUnit && a.dimensions.length === 0)
    .slice(0, values.length);
  expect(accounts).toHaveLength(values.length);
  for (const [index, balance] of values.entries())
    await app.svc.opening.upsert({ year: 2026, accountId: accounts[index]!.id, balance });
}
async function posted(values: number[]) {
  return seedVouchers(
    app.svc,
    values.map((amount) => ({
      date: '2026-01-10',
      status: 'posted',
      lines: [
        { account: '1001', debit: amount },
        { account: '6001', credit: amount },
      ],
    })),
  );
}

describe('w_zh_zhjc / w_bf_98001 安全整数分抵销精度', () => {
  it.each(cases)(
    '期初真实账套：中间超出安全范围，最终合计 $expected 分仍精确检查和导出',
    async ({ values, expected }) => {
      await opening(values);
      const check = (await api().checks()).find((row) => row.category === '期初试算');
      expect(check?.status).toBe(expected === 0 ? '通过' : '不通过');
      expect(check?.message).toBe(`期初借正贷负合计 ${expected} 分`);
      const input = { year: 2026, scopes: ['opening'] as ['opening'] };
      const preview = await api().audit.preview(input);
      expect(preview.totals.openingBalance).toBe(expected);
      const file = await api().audit.export({ ...input, digest: preview.digest });
      const data = JSON.parse(file.content) as {
        totals: { openingBalance: number };
        opening: { balance: number }[];
      };
      expect(data.totals.openingBalance).toBe(expected);
      expect(data.opening.map((row) => row.balance)).toEqual(values);
      expect((await app.svc.opening.list(2026)).map((row) => row.balance)).toEqual(values);
    },
  );

  it.each(cases)(
    '凭证真实账套：借/贷发生额和审计合计精确抵销为 $expected 分',
    async ({ values, expected }) => {
      await posted(values);
      const input = { year: 2026, scopes: ['vouchers'] as ['vouchers'] };
      const preview = await api().audit.preview(input);
      expect(preview.totals).toEqual({ debit: expected, credit: expected, openingBalance: 0 });
      const file = await api().audit.export({ ...input, digest: preview.digest });
      expect((JSON.parse(file.content) as { totals: unknown }).totals).toEqual(preview.totals);
      const checks = await api().checks();
      expect(
        checks
          .filter((row) => row.category === '凭证借贷及头行')
          .every((row) => row.status === '通过'),
      ).toBe(true);
      expect(
        checks.find((row) => row.category === '余额与凭证取数' && row.target === '202601')?.status,
      ).toBe('通过');
    },
  );

  it('w_zh_zhjc 真实草稿的头合计即使同样发生舍入，也不能把精确分录合计误判一致', async () => {
    const cash = await app.svc.accounts.require('1001');
    const income = await app.svc.accounts.require('6001');
    const voucher = await app.svc.vouchers.create({
      date: '2026-01-10',
      voucherTypeId: 1,
      draft: true,
      lines: cases[0]!.values.flatMap((amount) => [
        { accountId: cash.id, summary: '合成借方', debit: amount },
        { accountId: income.id, summary: '合成贷方', credit: amount },
      ]),
    });
    const header = await app.svc.db
      .selectFrom('voucher')
      .select(['debit_total', 'credit_total'])
      .where('id', '=', voucher.id)
      .executeTakeFirstOrThrow();
    const check = (await api().checks()).find(
      (row) => row.category === '凭证借贷及头行' && row.target.includes(`ID ${voucher.id}`),
    );
    if (header.debit_total === 1 && header.credit_total === 1) expect(check?.status).toBe('通过');
    else {
      expect(check?.status).toBe('不通过');
      expect(check?.message).toContain('凭证头合计与分录不一致');
    }
  });

  it.each([
    [MAX, 1],
    [-MAX, -1],
  ])('期初最终溢出 %j 时不能假报试算通过或生成审计文件', async (...values) => {
    await opening(values);
    const check = (await api().checks()).find((row) => row.category === '期初试算');
    expect(check?.status).toBe('无法检查');
    expect(check?.message).toContain('安全整数范围');
    const input = { year: 2026, scopes: ['opening'] as ['opening'] };
    await expect(api().audit.preview(input)).rejects.toMatchObject({
      cause: { data: { code: 'AMOUNT_OVERFLOW' } },
    });
    await expect(api().audit.export({ ...input, digest: '0'.repeat(64) })).rejects.toMatchObject({
      cause: { data: { code: 'AMOUNT_OVERFLOW' } },
    });
    expect(
      (await app.svc.log.list()).some((row) => row.action === 'system-admin.audit.export'),
    ).toBe(false);
  });
});
