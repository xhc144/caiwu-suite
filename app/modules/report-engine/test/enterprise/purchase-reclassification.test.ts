import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import reportServer from '../../server';
import type { ReportSnapshot, ReportTemplate } from '../../shared';
import { balanceSheetSlots } from '../../templates/enterprise';
import { purchaseBindings, purchaseTemplate, seedPurchaseFixture } from './purchase-fixture';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer], startYear: 2025 });
  await seedPurchaseFixture(app.svc);
});
afterEach(async () => app.close());
const value = (s: ReportSnapshot, address: string) => s.cells.find((c) => c.address === address)!;

async function generated(t: ReportTemplate) {
  const api = app.call(reportServer);
  const r = await api.importTemplate(t);
  const result = await api.generate({
    id: r.id,
    expectedRevision: r.revision,
    period: 202601,
    requestId: randomUUID(),
  });
  if (result.kind !== 'generated') throw new Error('意外的未过账确认');
  return { r, snapshot: result.snapshot };
}

it('w_bb_proc采购201：逐末级及往来分方向，两日期独立分类；手算13000/5500、4000/15000分，真实xlsx两行两列', async () => {
  // 独立手算：期末借方8000+3000+2000=13000，排除借3000；
  // 期末正贷方仅4000，排除2000+9000；上年末借4000+1500=5500，排除10000；
  // 上年末正贷方3000+12000=15000，排除2000+6000。
  // 同一末级190101的S001借8000与S002贷2000不得抵销；同一S001跨科目也不得抵销。
  const t = await purchaseTemplate(app.svc);
  const { r, snapshot } = await generated(t);
  const expected = [
    [balanceSheetSlots.prepayments!.current, '13000', 130],
    [balanceSheetSlots.prepayments!.comparative, '5500', 55],
    [balanceSheetSlots.accountsPayable!.current, '4000', 40],
    [balanceSheetSlots.accountsPayable!.comparative, '15000', 150],
  ] as const;
  for (const [address, cents] of expected) {
    expect(value(snapshot, address).value).toBe(cents);
    expect(value(snapshot, address).unit).toBe('cents');
  }
  // 逐行检查原始正借/正贷，避免两个汇总偶然对上而掩盖反号或跨末级抵销。
  for (const [prefix, account, partner, debit, credit] of [
    ['本期末 202601', '190101', 'S001', '8000', '0'],
    ['本期末 202601', '190101', 'S002', '0', '2000'],
    ['本期末 202601', '190102', 'S001', '3000', '0'],
    ['本期末 202601', '290101', 'S001', '0', '9000'],
    ['上年年末 202512', '190102', 'S001', '0', '2000'],
  ] as const) {
    const label = t.cells.find((c) =>
      c.source.startsWith(`${prefix}已分类明细 ${account}/${partner}`),
    )!;
    const row = label.address.slice(1);
    expect(value(snapshot, `B${row}`).value).toBe(debit);
    expect(value(snapshot, `E${row}`).value).toBe(credit);
  }
  expect(snapshot.cells.some((c) => c.unit === 'text' && c.value.includes('排除本流动项目'))).toBe(true);
  expect(value(snapshot, balanceSheetSlots.assetsTotal!.current).unit).toBe('text');
  expect(value(snapshot, balanceSheetSlots.contractAssets!.current).unit).toBe('text');
  const out = await app.call(reportServer).exportResult({ id: r.id, period: 202601 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(out!.base64, 'base64')).buffer);
  for (const [address, , yuan] of expected)
    expect(wb.worksheets[0]!.getCell(address).value).toBe(yuan);
  expect(wb.worksheets[0]!.getCell('A3').value).toContain('202512');
});

it('w_bb_get采购201：流动及排除均须依据，两方向及上年末缺任一声明拒绝；不能用整科目替代末级往来', async () => {
  for (const mutate of [
    (b: ReturnType<typeof purchaseBindings>) => {
      b.current.items[0]!.debit.reason = ' ';
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      b.previous.items[0]!.debit.reason = '';
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      Reflect.deleteProperty(b.current.items[1]!.credit, 'destination');
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      Reflect.deleteProperty(b.current.items[0]!, 'credit');
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      Reflect.deleteProperty(b, 'previous');
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      b.current.items[0]!.account = '1901';
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      b.current.items[0]!.partner = '';
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      b.current.items[0]!.partner = '不存在';
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      b.current.prepayments.push('190101');
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      b.current.payables = ['1901'];
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      b.current.prepayments = ['1999'];
    },
    (b: ReturnType<typeof purchaseBindings>) => {
      b.current.items.push(structuredClone(b.current.items[0]!));
    },
  ]) {
    const b = purchaseBindings();
    mutate(b);
    await expect(purchaseTemplate(app.svc, b)).rejects.toThrow();
  }
});

it('w_bb_proc采购201：漏掉有余额往来的流动或排除依据，真实router拒绝生成并不存部分快照', async () => {
  for (const [i, column] of ['current', 'previous'].entries()) {
    const b = purchaseBindings();
    // 上年末第一组为明确排除，本期为流动；两种遗漏均不得当成零。
    b[column as 'current' | 'previous'].items.shift();
    const t = await purchaseTemplate(app.svc, b);
    t.code = String(211 + i);
    const api = app.call(reportServer);
    const r = await api.importTemplate(t);
    await expect(
      api.generate({
        id: r.id,
        expectedRevision: r.revision,
        period: 202601,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(/采购分类缺失|文本，不能作为数值/);
    expect(await api.snapshot({ id: r.id, period: 202601 })).toBeNull();
  }
});

it('w_bb_proc采购201：新增两往来一借一贷净零仍拒绝，不复用旧快照冒充重算成功', async () => {
  const { r, snapshot } = await generated(await purchaseTemplate(app.svc));
  await app.svc.dimensions.create({ type: 'partner', code: 'S003', name: '新增供应商三' });
  await app.svc.dimensions.create({ type: 'partner', code: 'S004', name: '新增供应商四' });
  await seedVouchers(app.svc, [
    {
      date: '2026-01-26',
      status: 'posted',
      lines: [
        { account: '190101', debit: 999, dims: { partner: 'S003' } },
        { account: '190101', credit: 999, dims: { partner: 'S004' } },
      ],
    },
  ]);
  const api = app.call(reportServer);
  await expect(
    api.generate({
      id: r.id,
      expectedRevision: r.revision,
      period: 202601,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow(/文本，不能作为数值/);
  expect((await api.snapshot({ id: r.id, period: 202601 }))!.id).toBe(snapshot.id);
});

it('w_bb_proc采购201：上年末缺真实期间拒绝，不用本月期初或零替代', async () => {
  const api = app.call(reportServer);
  const r = await api.importTemplate(await purchaseTemplate(app.svc));
  await app.svc.db.deleteFrom('period').where('period', '=', 202512).execute();
  await expect(
    api.generate({
      id: r.id,
      expectedRevision: r.revision,
      period: 202601,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow(/尚未建立/);
  expect(await api.snapshot({ id: r.id, period: 202601 })).toBeNull();
});

it('w_bb_saveas公共缺项保留：采购局部正确不代表整表审核通过，公共导出尚未强制拦截', async () => {
  const { r, snapshot } = await generated(await purchaseTemplate(app.svc));
  expect(snapshot.checks.some((c) => c.status === 'error')).toBe(true);
  expect(await app.call(reportServer).exportResult({ id: r.id, period: 202601 })).not.toBeNull();
});
