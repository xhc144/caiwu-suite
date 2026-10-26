import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import reportServer from '../../server';
import {
  balanceFormula,
  emptyTemplate,
  type BalanceFunction,
  type BalanceOptions,
  type Report,
} from '../../shared';

let app: TestApp;
const caller = () => app.call(reportServer);
beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer], startYear: 2025 });
  await app.svc.periods.ensureYear(2026);
});
afterEach(async () => app.close());

const formula = (metric: BalanceFunction['metric'], account = '1001', options?: BalanceOptions) =>
  balanceFormula({
    account,
    metric,
    unit: 'cents',
    currency: 'CNY',
    direction: 'signed',
    dimension: 'none',
    item: '',
    ...(options ? { options } : {}),
  });
async function report(sources: string[], code = '101') {
  const template = emptyTemplate({ code, name: '独立取数验证', rows: sources.length, cols: 1 });
  template.cells = sources.map((source, i) => ({
    address: `A${i + 1}`,
    kind: 'formula',
    source,
    unit: 'cents',
    currency: 'CNY',
  }));
  return caller().importTemplate(template);
}
const generate = (r: Report, period = 202602, extra = {}) =>
  caller().generate({
    id: r.id,
    expectedRevision: r.revision,
    period,
    requestId: randomUUID(),
    ...extra,
  });
async function values(r: Report, period = 202602, extra = {}) {
  const result = await generate(r, period, extra);
  if (result.kind !== 'generated') throw new Error('意外的未过账确认');
  return result.snapshot.cells.map((c) => c.value);
}
async function seedHistory() {
  const cash = await app.svc.accounts.require('1001');
  await app.svc.opening.upsert({ year: 2025, accountId: cash.id, balance: 101 });
  await seedVouchers(app.svc, [
    {
      date: '2025-02-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: 203 },
        { account: '6001', credit: 203 },
      ],
    },
    {
      date: '2025-12-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: 307 },
        { account: '6001', credit: 307 },
      ],
    },
    {
      date: '2026-01-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: 409 },
        { account: '6001', credit: 409 },
      ],
    },
    {
      date: '2026-02-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: 503 },
        { account: '6001', credit: 503 },
      ],
    },
  ]);
}

describe('w_bb_proc / w_bb_def_help 法定报表共享取数合同', () => {
  it.each([false, true])(
    '首次确认已覆盖未来和比较期，确认数字与最终快照一致；includeUnposted=%s',
    async (includeUnposted) => {
      await seedVouchers(app.svc, [
        {
          date: '2025-02-01',
          status: 'pending',
          lines: [
            { account: '1001', debit: 11 },
            { account: '6001', credit: 11 },
          ],
        },
        {
          date: '2026-03-01',
          status: 'pending',
          lines: [
            { account: '1001', debit: 13 },
            { account: '6001', credit: 13 },
          ],
        },
      ]);
      const r = await report([
        formula('debit', '1001', { from: 'previousYear', to: 'previousYear' }),
        formula('debit', '1001', { from: '202603', to: '202603' }),
      ]);
      const first = await generate(r, 202602, { includeUnposted });
      expect(first).toMatchObject({ kind: 'confirmation', count: 2 });
      if (first.kind === 'confirmation')
        expect(first.links).toContainEqual({
          label: '待审核凭证',
          to: '/m/voucher-book?period=202603&status=pending',
        });
      expect(await caller().snapshot({ id: r.id, period: 202602, includeUnposted })).toBeNull();
      const final = await generate(r, 202602, { confirmUnposted: true, includeUnposted });
      expect(final.kind).toBe('generated');
      if (final.kind === 'generated') {
        expect(final.snapshot.unpostedCount).toBe(2);
        expect(final.snapshot.cells.map((c) => c.value)).toEqual(
          includeUnposted ? ['11', '13'] : ['0', '0'],
        );
      }
    },
  );
  it('旧七参数保持本月口径；年初、上年同期、上年年初及明确跨年区间均为独立手算金额', async () => {
    await seedHistory();
    expect(
      await values(
        await report([
          formula('debit'),
          formula('opening', '1001', { from: 'yearStart', to: 'current' }),
          formula('debit', '1001', { from: 'yearStart', to: 'current' }),
          formula('debit', '1001', { from: 'previousYear', to: 'previousYear' }),
          formula('opening', '1001', { from: 'previousYearStart', to: 'previousYear' }),
          formula('debit', '1001', { from: '202512', to: '202601' }),
          formula('closing'),
          formula('debit', '1001', { from: 'previousMonth', to: 'previousMonth' }),
          formula('closing', '1001', { from: 'previousYearEnd', to: 'previousYearEnd' }),
          formula('debit', '1001', { from: 'previousYearSameMonth', to: 'previousYearSameMonth' }),
        ]),
      ),
    ).toEqual(['503', '611', '912', '203', '101', '716', '1523', '409', '611', '203']);
  });

  it('已年结保存新年度期初后，年初和上年比较仍正确，不重复累计历史', async () => {
    await seedHistory();
    await app.svc.tx(async (svc) => {
      const cash = await svc.accounts.require('1001');
      await svc.opening.replaceYear(2026, [{ accountId: cash.id, balance: 611 }]);
    });
    expect(
      await values(
        await report([
          formula('opening', '1001', { from: 'yearStart', to: 'current' }),
          formula('closing'),
          formula('closing', '1001', { from: '202512', to: '202512' }),
        ]),
      ),
    ).toEqual(['611', '1523', '611']);
  });

  it('排除closingKind凭证的发生额与本年累计；相同摘要的正常凭证仍计入', async () => {
    await seedHistory();
    const input = await voucherInputFromSpec(app.svc, {
      date: '2026-02-28',
      summary: '本月损益结转',
      lines: [
        { account: '6001', debit: 912 },
        { account: '4103', credit: 912 },
      ],
    });
    const closing = await app.svc.vouchers.create({ ...input, closingKind: 'pnl' });
    await app.svc.vouchers.changeStatus({ ids: [closing.id], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [closing.id], to: 'posted' });
    await seedVouchers(app.svc, [
      {
        date: '2026-02-28',
        summary: '本月损益结转',
        status: 'posted',
        lines: [
          { account: '6001', debit: -7 },
          { account: '4103', credit: -7 },
        ],
      },
    ]);
    expect(
      await values(
        await report([
          formula('debit', '6001'),
          formula('debit', '6001', { closing: 'exclude' }),
          formula('ytdCredit', '6001', { closing: 'exclude' }),
          formula('ytdDebit', '6001', { closing: 'exclude' }),
          formula('closing', '6001'),
        ]),
      ),
    ).toEqual(['905', '-7', '912', '-7', '-517']);
    const entries = await app.svc.ledger.entries({
      periodFrom: 202602,
      periodTo: 202602,
      accountCode: '6001',
      excludeClosing: true,
    });
    expect(entries.map((e) => e.voucherId)).not.toContain(closing.id);
    expect(entries.map((e) => e.debit)).toContain(-7);
  });

  it('只排除pnl时保留真实自定义结转与普通凭证，不能把全部转账都当损益结转', async () => {
    for (const [kind, amount] of [
      [null, 103],
      ['pnl', 211],
      ['period-close:001', 307],
    ] as const) {
      const v = await app.svc.vouchers.create({
        ...(await voucherInputFromSpec(app.svc, {
          date: '2026-02-28',
          summary: '相同摘要',
          lines: [
            { account: '6001', debit: amount },
            { account: '4103', credit: amount },
          ],
        })),
        closingKind: kind,
      });
      await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
      await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
    }
    expect(
      await values(
        await report([
          formula('debit', '6001', { closing: 'include' }),
          formula('debit', '6001', { closing: 'exclude' }),
          formula('debit', '6001', { closing: 'excludePnl' }),
          formula('ytdDebit', '6001', { closing: 'excludePnl' }),
          formula('closing', '6001'),
        ]),
      ),
    ).toEqual(['621', '103', '410', '410', '621']);
    expect(
      (
        await app.svc.ledger.entries({
          periodFrom: 202602,
          periodTo: 202602,
          accountCode: '6001',
          excludeClosingKinds: ['pnl'],
        })
      ).map((e) => e.debit),
    ).toEqual([103, 307]);
  });

  it('一月的previousMonth跨年为上年十二月，不能按整数减一取出无效期间', async () => {
    await seedHistory();
    expect(
      await values(
        await report([
          formula('debit', '1001', {
            from: 'previousMonth',
            to: 'previousMonth',
          }),
        ]),
        202601,
      ),
    ).toEqual(['307']);
  });

  it('明细重分类先按末级科目及往来对象分组，不能把借100/贷60抵销为借40', async () => {
    await app.svc.dimensions.create({ type: 'partner', code: 'C002', name: '另一客户' });
    await seedVouchers(app.svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '1122', debit: 10001, dims: { partner: 'C001' } },
          { account: '6001', credit: 10001 },
        ],
      },
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '1122', credit: 6003, dims: { partner: 'C002' } },
          { account: '4001', debit: 6003 },
        ],
      },
    ]);
    expect(
      await values(
        await report([
          formula('closing', '1122'),
          formula('closing', '1122', { side: 'debit', groupBy: ['partner'] }),
          formula('closing', '1122', { side: 'credit', groupBy: ['partner'] }),
          formula('closing', '1122', { side: 'debit' }),
        ]),
      ),
    ).toEqual(['3998', '10001', '6003', '3998']);
  });

  it('父科目借贷末级分别取数，不把父级和末级重复相加', async () => {
    await seedVouchers(app.svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '100201', debit: 301, dims: { cashflow: 'CF01' } },
          { account: '6001', credit: 301 },
        ],
      },
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '100202', credit: 103, currency: 'USD', rate: '1', fcAmount: 103 },
          { account: '4001', debit: 103 },
        ],
      },
    ]);
    expect(
      await values(
        await report([
          formula('closing', '1002'),
          formula('closing', '1002', { side: 'debit' }),
          formula('closing', '1002', { side: 'credit' }),
        ]),
      ),
    ).toEqual(['198', '301', '103']);
  });

  it('IF比较和MAX采用整数分、金额单位及惰性分支；负金额不会变成浮点数', async () => {
    await seedHistory();
    const amount = formula('closing');
    expect(
      await values(
        await report([
          `IF(${amount}>0,${amount},0)`,
          `IF(${amount}<0,1/0,0)`,
          `MAX(-${amount},0)`,
          `MAX(0,${amount})*0.5`,
        ]),
      ),
    ).toEqual(['1523', '0', '0', '762']);
  });

  it.each([
    { from: 'previousYearStart', to: 'previousYearStart' },
    { from: '202701', to: '202701' },
    { from: '202603', to: '202602' },
  ] as BalanceOptions[])('缺失/启用前/倒置期间不能取零 %j', async (options) => {
    const r = await report([formula('closing', '1001', options)]);
    await expect(generate(r, 202502)).rejects.toThrow(/早于|没有建立|不能晚于/);
    expect(await caller().snapshot({ id: r.id, period: 202502 })).toBeNull();
  });

  it('区间内部年度缺失也报错，即使两端年度已经建立', async () => {
    await app.svc.periods.ensureYear(2028);
    const r = await report([formula('debit', '1001', { from: '202601', to: '202801' })]);
    await expect(generate(r)).rejects.toThrow(/范围内有尚未建立/);
  });

  it('未知科目不能取零；失败事务保留上次成功快照', async () => {
    const r = await report([formula('closing')]);
    await values(r);
    const previous = await caller().snapshot({ id: r.id, period: 202602 });
    const updated = await caller().save({
      id: r.id,
      expectedRevision: r.revision,
      template: {
        ...r.template,
        cells: [{ ...r.template.cells[0]!, source: formula('closing', '9999') }],
      },
    });
    await expect(generate(updated)).rejects.toThrow(/科目.*不存在/);
    expect((await caller().snapshot({ id: r.id, period: 202602 }))!.id).toBe(previous!.id);
  });

  it('扩展到未来期间也确认未过账数量，确认前不保存快照，纳入口径可验证', async () => {
    await seedVouchers(app.svc, [
      {
        date: '2026-03-01',
        status: 'pending',
        lines: [
          { account: '1001', debit: 37 },
          { account: '6001', credit: 37 },
        ],
      },
    ]);
    const r = await report([formula('debit', '1001', { from: '202603', to: '202603' })]);
    expect(await generate(r)).toMatchObject({ kind: 'confirmation', count: 1 });
    expect(await caller().snapshot({ id: r.id, period: 202602 })).toBeNull();
    expect(await values(r, 202602, { confirmUnposted: true })).toEqual(['0']);
    expect(await values(r, 202602, { confirmUnposted: true, includeUnposted: true })).toEqual([
      '37',
    ]);
  });

  it('新增取数仍受生成权限约束，不能靠比较期或JSON选项绕过权限', async () => {
    const r = await report([
      formula('debit', '1001', { from: 'previousYear', to: 'previousYear' }),
    ]);
    const viewer = app.call(
      reportServer,
      await app.addUser('reader', { permissions: ['report-engine.view'] }),
    );
    await expect(
      viewer.generate({
        id: r.id,
        expectedRevision: 1,
        period: 202602,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(/权限/);
    expect(await caller().snapshot({ id: r.id, period: 202602 })).toBeNull();
  });
});
