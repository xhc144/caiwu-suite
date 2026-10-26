import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import {
  call,
  errorData,
  generateAll,
  rule,
  snapshot,
  zeroOpening,
  seedCashflowDirections,
} from './helpers';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
  await seedCashflowDirections(app);
});
afterEach(async () => app.close());
const id = async (code: string) => (await app.svc.accounts.require(code)).id;
const outflow = async () => ({ out: (await app.svc.dimensions.getByCode('cashflow', 'CF02'))!.id });
describe('结转定义和原子生成', () => {
  it('w_xt_jzwh / f_ydjz_1_bak/_bak1/_new_bak：凭证类型、唯一末级转入、至少一个转出及重复校验', async () => {
    const api = call(app);
    const base = await rule(app, { kind: 'custom' });
    await expect(api.saveRule({ data: { ...base, voucherTypeId: 0 } })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect((await errorData(api.saveRule({ data: { ...base, voucherTypeId: 999 } }))).code).toBe(
      'PERIOD_CLOSE_TYPE_REQUIRED',
    );
    await expect(
      api.saveRule({ data: { ...base, targetAccountId: [] as unknown as number } }),
    ).rejects.toThrow();
    expect(
      (await errorData(api.saveRule({ data: { ...base, targetAccountId: await id('1002') } })))
        .code,
    ).toBe('PERIOD_CLOSE_TARGET_LEAF');
    expect((await errorData(api.saveRule({ data: base }))).code).toBe(
      'PERIOD_CLOSE_SOURCE_REQUIRED',
    );
    const source = {
      accountId: await id('1001'),
      mode: 'balance' as const,
      ratio: '100',
      cashflows: await outflow(),
    };
    expect(
      (await errorData(api.saveRule({ data: { ...base, sources: [source, source] } }))).code,
    ).toBe('PERIOD_CLOSE_DUPLICATE_ACCOUNT');
    expect(
      (
        await errorData(
          api.saveRule({ data: { ...base, targetAccountId: source.accountId, sources: [source] } }),
        )
      ).code,
    ).toBe('PERIOD_CLOSE_DUPLICATE_ACCOUNT');
    await expect(
      api.saveRule({
        data: { ...base, sources: [{ ...source, mode: '旧版未知类型' as 'balance' }] },
      }),
    ).rejects.toThrow();
    expect(
      (
        await errorData(
          api.saveRule({ data: { ...base, sources: [{ ...source, ratio: '100.01' }] } }),
        )
      ).code,
    ).toBe('PERIOD_CLOSE_RATIO');
    await api.saveRule({ data: { ...base, sources: [source] } });
    const saved = (await api.rules())[0]!;
    await api.saveRule({
      id: saved.id,
      revision: saved.revision,
      data: { ...saved, enabled: false },
    });
    expect((await errorData(api.preview({ period: 202601, ruleIds: [saved.id] }))).code).toBe(
      'PERIOD_CLOSE_RULE_DISABLED',
    );
    await api.removeRule({ id: saved.id });
    expect(await api.rules()).toEqual([]);
  });
  it('w_zw_ydjz_1：预览严格逐步更新基数，自定义比例四舍五入到分，取消不写', async () => {
    const api = call(app);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-02',
        status: 'posted',
        lines: [
          { account: '1001', debit: 101 },
          { account: '4001', credit: 101 },
        ],
      },
    ]);
    await api.saveRule({
      data: await rule(app, {
        code: 'A',
        kind: 'custom',
        sources: [
          { accountId: await id('1001'), mode: 'balance', ratio: '50', cashflows: await outflow() },
        ],
      }),
    });
    await api.saveRule({
      data: await rule(app, {
        code: 'B',
        kind: 'custom',
        order: 2,
        targetAccountId: await id('4104'),
        sources: [{ accountId: await id('4103'), mode: 'balance', ratio: '100' }],
      }),
    });
    const preview = await api.preview({ period: 202601, ruleIds: [2, 1] });
    expect(preview.items.map((i) => [i.code, i.debit, i.credit])).toEqual([
      ['A', 51, 51],
      ['B', 51, 51],
    ]);
    const before = snapshot(app);
    await expect(
      api.generate({
        period: 202601,
        ruleIds: [2, 1],
        confirmed: false,
        previewToken: preview.previewToken,
      }),
    ).rejects.toThrow();
    expect(snapshot(app)).toBe(before);
    const { result, input } = await generateAll(app);
    expect(result.generated).toHaveLength(2);
    expect((await api.generate(input)).generated.map((v) => v.id)).toEqual(
      result.generated.map((v) => v.id),
    );
    expect(
      (await errorData(api.deleteGenerated({ period: 202601, ruleId: 1, confirmed: true }))).code,
    ).toBe('PERIOD_CLOSE_DEPENDENT_TRANSFER');
    await api.deleteGenerated({ period: 202601, ruleId: 2, confirmed: true });
    await api.deleteGenerated({ period: 202601, ruleId: 1, confirmed: true });
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
  });
  it('w_zw_ydjz_1_bak：转出零不生成空凭证，并发重复请求幂等', async () => {
    const api = call(app);
    await api.saveRule({ data: await rule(app) });
    const empty = await generateAll(app);
    expect(empty.result.generated).toEqual([]);
    expect(empty.result.message).toContain('零');
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 1 },
          { account: '6001', credit: 1 },
        ],
      },
    ]);
    const preview = await api.preview({ period: 202601, ruleIds: [1] });
    const input = {
      period: 202601,
      ruleIds: [1],
      confirmed: true,
      previewToken: preview.previewToken,
    };
    const output = await Promise.all([api.generate(input), api.generate(input)]);
    expect(output[0]!.generated[0]!.id).toBe(output[1]!.generated[0]!.id);
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(1);
  });
  it('w_zw_ydjz_1_bak：一批后半失败连同凭证、来源、日志全部回滚', async () => {
    const api = call(app);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 101 },
          { account: '4001', credit: 101 },
        ],
      },
    ]);
    await api.saveRule({
      data: await rule(app, {
        code: 'A',
        kind: 'custom',
        sources: [
          { accountId: await id('1001'), mode: 'balance', ratio: '50', cashflows: await outflow() },
        ],
      }),
    });
    await api.saveRule({
      data: await rule(app, {
        code: 'B',
        kind: 'custom',
        order: 2,
        targetAccountId: await id('4104'),
        sources: [{ accountId: await id('4103'), mode: 'balance', ratio: '100' }],
      }),
    });
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TRIGGER period_close_test_fail BEFORE INSERT ON period_close_run WHEN NEW.rule_id = 2 BEGIN SELECT RAISE(ABORT,'测试后半失败'); END",
    );
    const before = snapshot(app);
    await expect(generateAll(app)).rejects.toThrow('测试后半失败');
    expect(snapshot(app)).toBe(before);
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
  });
  it('w_zw_jz：批量状态中途失败全部回滚，分页读取超过10000张且无试用500限制', async () => {
    const api = call(app);
    const cash = await id('1001');
    const equity = await id('4001');
    const type = (await app.svc.reference.voucherTypes())[0]!.id;
    await app.svc.tx(async (t) => {
      for (let i = 0; i < 10001; i++) {
        const v = await t.vouchers.create({
          voucherTypeId: type,
          date: '2026-01-05',
          lines: [
            { summary: '分页', accountId: cash, debit: 1 },
            { summary: '分页', accountId: equity, credit: 1 },
          ],
        });
        await t.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
      }
      await t.vouchers.create({
        voucherTypeId: type,
        date: '2026-01-05',
        lines: [
          { summary: '后页未审核', accountId: cash, debit: 1 },
          { summary: '后页未审核', accountId: equity, credit: 1 },
        ],
      });
    });
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TRIGGER period_close_test_status BEFORE UPDATE OF status ON voucher WHEN NEW.id = 10001 AND NEW.status = 'posted' BEGIN SELECT RAISE(ABORT,'测试状态后半失败'); END",
    );
    const before = snapshot(app);
    await expect(api.post({ from: 202601, to: 202601 })).rejects.toThrow('测试状态后半失败');
    expect(snapshot(app)).toBe(before);
    raw.exec('DROP TRIGGER period_close_test_status');
    const out = await api.post({ from: 202601, to: 202601 });
    expect(out.count).toBe(10001);
    expect(out.skipped).toMatchObject([{ id: 10002, reason: '待审核，请其他操作员审核' }]);
    const check = await api.check({ period: 202601 });
    expect(check.vouchers).toMatchObject([{ id: 10002 }]);
    expect(
      (await errorData(api.close({ period: 202601, confirmed: true }))).details?.vouchers,
    ).toMatchObject([{ id: 10002 }]);
  }, 120000);
  it('w_zw_ydjz：类别识别及必填辅助/外币/数量不丢，使用负数红字余额', async () => {
    const api = call(app);
    const scheme = app.book.codeScheme;
    const account = await app.svc.accounts.create(
      {
        code: '6999',
        name: '自定义损益',
        categoryId: 'pnl',
        currency: 'USD',
        quantityUnit: '件',
        dimensions: [{ type: 'department' }],
      },
      scheme,
    );
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: -710 },
          {
            account: account.code,
            credit: -710,
            currency: 'USD',
            rate: '7.1',
            fcAmount: -100,
            quantity: '-0.125',
            dims: { department: '02' },
          },
        ],
      },
    ]);
    await api.saveRule({ data: await rule(app) });
    const { result } = await generateAll(app);
    const v = (await app.svc.vouchers.get(result.generated[0]!.id))!;
    const line = v.lines.find((l) => l.accountId === account.id)!;
    expect(line).toMatchObject({
      credit: 710,
      debit: 0,
      currency: 'USD',
      fcAmount: 100,
      quantity: '0.125',
    });
    expect(line.dimensions.department).toBe(
      (await app.svc.dimensions.getByCode('department', '02'))!.id,
    );
    await app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    await api.post({ from: 202601, to: 202601 });
    expect((await api.check({ period: 202601 })).pnl).toEqual([]);
  });
});

it('w_xt_jzwh：父级转出展开末级，不重复汇总，父子重叠范围拒绝', async () => {
  const api = call(app);
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '100201', debit: 100 },
        { account: '4001', credit: 100 },
      ],
    },
  ]);
  const source = {
    accountId: await id('1002'),
    mode: 'balance' as const,
    ratio: '100',
    cashflows: await outflow(),
  };
  const definition = await rule(app, { code: 'BANK', kind: 'custom', sources: [source] });
  expect(
    (
      await errorData(
        api.saveRule({
          data: { ...definition, sources: [source, { ...source, accountId: await id('100201') }] },
        }),
      )
    ).code,
  ).toBe('PERIOD_CLOSE_DUPLICATE_ACCOUNT');
  await api.saveRule({ data: definition });
  const preview = await api.preview({ period: 202601, ruleIds: [1] });
  expect(preview.items[0]!.debit).toBe(100);
  expect(preview.items[0]!.lines).toHaveLength(2);
  expect(preview.items[0]!.lines.every((l) => l.accountId !== source.accountId)).toBe(true);
});

it('w_zw_jz：不能先过账同批后序结转、把前序待审核结转当正式基数', async () => {
  const api = call(app);
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 100 },
        { account: '4001', credit: 100 },
      ],
    },
  ]);
  await api.saveRule({
    data: await rule(app, {
      code: 'A',
      kind: 'custom',
      sources: [
        { accountId: await id('1001'), mode: 'balance', ratio: '50', cashflows: await outflow() },
      ],
    }),
  });
  await api.saveRule({
    data: await rule(app, {
      code: 'B',
      kind: 'custom',
      order: 2,
      targetAccountId: await id('4104'),
      sources: [{ accountId: await id('4103'), mode: 'balance', ratio: '100' }],
    }),
  });
  const { result } = await generateAll(app);
  const ids = result.generated.map((v) => v.id);
  await app.svc.vouchers.changeStatus({ ids: [ids[1]!], to: 'audited' });
  const before = snapshot(app);
  expect((await errorData(api.post({ from: 202601, to: 202601 }))).code).toBe(
    'PERIOD_CLOSE_DEPENDENT_UNPOSTED',
  );
  expect(snapshot(app)).toBe(before);
  await app.svc.vouchers.changeStatus({ ids: [ids[0]!], to: 'audited' });
  expect((await api.post({ from: 202601, to: 202601 })).count).toBe(2);
});
