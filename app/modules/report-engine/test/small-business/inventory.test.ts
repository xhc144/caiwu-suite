import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedVouchers, type TestApp } from '@caiwu/testkit';
import reportServer from '../../server';
import { parseFormula } from '../../server/formula';
import {
  balanceFormula,
  ReportTemplateSchema,
  type Report,
  type ReportSnapshot,
} from '../../shared';
import balanceJson from '../../templates/small-business/301.json';
import { balanceAddress } from '../../templates/small-business/catalogue';
import { extendedBalanceSheetTemplate } from '../../templates/small-business/extended';
import {
  inventoryRoles,
  officialInventoryMapping,
  validateInventoryMapping,
  type InventoryMapping,
} from '../../templates/small-business/inventory-balance';
import { smallBusinessApp } from './fixture';
import { inventoryGolden, seedInventoryBook, storeInventoryYearOpening } from './inventory-fixture';

let app: TestApp;
beforeEach(async () => {
  app = await smallBusinessApp(1, 2025);
});
afterEach(async () => app.close());
const api = () => app.call(reportServer);
async function generate(report: Report, period = 202602) {
  const result = await api().generate({
    id: report.id,
    expectedRevision: report.revision,
    period,
    requestId: randomUUID(),
  });
  if (result.kind !== 'generated') throw new Error('意外的未过账凭证确认');
  return result.snapshot;
}
const value = (s: ReportSnapshot, line: number, column: 'closing' | 'yearOpening') => {
  const cell = s.cells.find((c) => c.address === balanceAddress(line, column));
  if (!cell) throw new Error(`缺少行次${line}`);
  expect(cell.unit).toBe('cents');
  return cell.value;
};
function expectGolden(
  s: ReportSnapshot,
  closing: typeof inventoryGolden.january2026 | typeof inventoryGolden.february2026,
) {
  for (const [line, key] of [
    [9, 'inventory'],
    [10, 'rawMaterials'],
    [11, 'workInProgress'],
    [12, 'finishedGoods'],
    [13, 'turnoverMaterials'],
  ] as const) {
    expect(value(s, line, 'closing')).toBe(String(closing[key]));
    expect(value(s, line, 'yearOpening')).toBe(String(inventoryGolden.yearOpening2026[key]));
  }
  expect(s.checks).toHaveLength(6);
  expect(s.checks.every((c) => c.status === 'pass')).toBe(true);
}

/**
 * 仅复现7189100已导入旧模板的两个P1。旧版本把不存在编为0、把明细冻结为清单；
 * 这个不安全夹具只供反例测试，不是产品构造器，不能用作新模板的回退路径。
 */
function legacyInventoryTemplate(kind: 'absent-1421' | 'raw-material-leaves') {
  const t = ReportTemplateSchema.parse(structuredClone(balanceJson));
  const root = kind === 'absent-1421' ? '1421' : '1403';
  const codes = kind === 'absent-1421' ? [] : ['140301', '140302'];
  for (const [metric, selector] of [
    ['closing', 'current'],
    ['opening', 'yearStart'],
  ] as const) {
    const formula = (account: string) =>
      balanceFormula({
        account,
        metric,
        unit: 'cents',
        currency: 'CNY',
        direction: 'signed',
        dimension: 'none',
        item: '',
        options: { from: selector, to: selector },
      });
    const oldSource = formula(root);
    const unsafeSource = codes.length ? codes.map(formula).join('+') : '0';
    for (const c of t.cells) c.source = c.source.replaceAll(oldSource, unsafeSource);
    for (const check of t.checks) {
      check.left = check.left.replaceAll(oldSource, unsafeSource);
      check.right = check.right.replaceAll(oldSource, unsafeSource);
    }
  }
  if (kind === 'absent-1421')
    t.cells.find((c) => c.address === 'A2')!.source +=
      ' 消耗性生物资产不存在依据：构造时完整科目表无1421；这是用于复现旧P1的冻结声明。';
  return ReportTemplateSchema.parse(t);
}

async function outcome<T>(operation: Promise<T>) {
  try {
    return { status: 'fulfilled', value: await operation } as const;
  } catch (error) {
    return { status: 'rejected', error } as const;
  }
}

/**
 * 公共P1验收断言，不标skip/预期失败。当前共享实现缺guard，静态判断仍不能满足；
 * 若旧行为继续返回漏项快照，先保留其错误金额/审核全过反例，再严格要求生成和导出拒绝。
 */
async function requireLegacyGuard(report: Report, missingInventory: string, missingRaw?: string) {
  const generation = await outcome(generate(report));
  const exported = await outcome(api().exportResult({ id: report.id, period: 202602 }));
  if (generation.status === 'fulfilled') {
    expect(value(generation.value, 9, 'closing')).toBe(missingInventory);
    if (missingRaw) expect(value(generation.value, 10, 'closing')).toBe(missingRaw);
    expect(generation.value.checks.every((c) => c.status === 'pass')).toBe(true);
  }
  if (exported.status === 'fulfilled')
    expect(value(exported.value!.snapshot, 9, 'closing')).toBe(missingInventory);
  expect([generation.status, exported.status]).toEqual(['rejected', 'rejected']);
  for (const result of [generation, exported])
    if (result.status === 'rejected')
      expect(result.error).toMatchObject({
        message: expect.stringMatching(/绑定|版本|科目.*变更|profile|guard/),
      });
}

describe('w_bb_get / w_bb_proc / w_bb_saveas 小企业301存货', () => {
  it('发布JSON与构造器一致，53项完整保留；第9/11行四格真实公式且年初不是本月期初', () => {
    const t = extendedBalanceSheetTemplate();
    expect(ReportTemplateSchema.parse(balanceJson)).toEqual(t);
    for (const line of [9, 11])
      for (const column of ['closing', 'yearOpening'] as const) {
        const c = t.cells.find((c) => c.address === balanceAddress(line, column))!;
        expect(c.kind).toBe('formula');
        expect(() => parseFormula(c.source)).not.toThrow();
        expect(c.source).toContain('"signed"');
        if (column === 'yearOpening') expect(c.source).toContain('yearStart');
      }
    expect(t.cells.find((c) => c.address === balanceAddress(15, 'closing'))!.source).toContain(
      '未实现',
    );
    expect(t.name).toContain('未完成');
  });

  it('黄金跨月：十项完整、借贷差异不二扣、生产成本真实末级；router生成和xlsx十格读回', async () => {
    await seedInventoryBook(app.svc);
    const r = await api().importTemplate(ReportTemplateSchema.parse(balanceJson));
    expectGolden(await generate(r, 202601), inventoryGolden.january2026);
    const before = await app.svc.ledger.balances({
      periodFrom: 202602,
      periodTo: 202602,
      rollup: false,
      includeZero: true,
    });
    const february = await generate(r);
    expectGolden(february, inventoryGolden.february2026);
    expect(
      await app.svc.ledger.balances({
        periodFrom: 202602,
        periodTo: 202602,
        rollup: false,
        includeZero: true,
      }),
    ).toEqual(before);
    const trial = await app.svc.ledger.trialBalance(202501, 202602);
    expect(trial.closingDebit).toBe(trial.closingCredit);
    const exported = await api().exportResult({ id: r.id, period: 202602 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(exported!.base64, 'base64')).buffer);
    for (const [address, amount] of [
      ['C14', 286.88],
      ['D14', 275.88],
      ['C15', 27.88],
      ['D15', 31.15],
      ['C16', 91.97],
      ['D16', 88.9],
      ['C17', 140.42],
      ['D17', 133.41],
      ['C18', 8.6],
      ['D18', 10.09],
    ] as const)
      expect(wb.worksheets[0]!.getCell(address).value).toBe(amount);
    expect(wb.worksheets[0]!.getCell('C16').note).toContain('4001');
    expect(wb.worksheets[0]!.getCell('D16').note).toContain('yearStart');
    expect(wb.worksheets[0]!.getCell('A2').value).toContain('尚未完成');
    expect(wb.worksheets[1]!.getCell('B3').value).toBe('仅已过账');
    expect(await api().snapshot({ id: r.id, period: 202602 })).toEqual(february);
  });

  it('黄金跨年及年结：2025期初27381，2026年度期初27588；储存年度期初前后完全一致', async () => {
    await seedInventoryBook(app.svc);
    const r = await api().importTemplate(ReportTemplateSchema.parse(balanceJson));
    const previous = await generate(r, 202512);
    expect(value(previous, 9, 'yearOpening')).toBe('27381');
    expect(value(previous, 11, 'yearOpening')).toBe('9004');
    expect(value(previous, 9, 'closing')).toBe('27588');
    expect(value(previous, 11, 'closing')).toBe('8890');
    expectGolden(await generate(r), inventoryGolden.february2026);
    await storeInventoryYearOpening(app.svc);
    expectGolden(await generate(r), inventoryGolden.february2026);
  });

  it('母科目动态包含父子明细；完整兄弟清单带公共绑定可输出，错误映射仍拒绝', async () => {
    await seedInventoryBook(app.svc);
    const accounts = await app.svc.accounts.list();
    const mapping: InventoryMapping = {
      ...officialInventoryMapping,
      rawMaterials: { accounts: ['140301', '140302'] },
      workInProgress: { accounts: ['400101', '400102'] },
    };
    expect(() => validateInventoryMapping(mapping, accounts)).not.toThrow();
    expect(extendedBalanceSheetTemplate({ mapping, accounts }).profile?.kind).toBe('small-business-inventory');
    const r = await api().importTemplate(
      extendedBalanceSheetTemplate({ mapping: officialInventoryMapping, accounts }),
    );
    expectGolden(await generate(r), inventoryGolden.february2026);
    for (const rawMaterials of [
      { accounts: ['1403', '140301'] },
      { accounts: ['140301', '140301'] },
      { accounts: ['140301'] },
      { accounts: [] },
      { accounts: ['1405'] },
    ])
      expect(() => validateInventoryMapping({ ...mapping, rawMaterials }, accounts)).toThrow(
        /重复|重叠|完整|空数组|1403/,
      );
    const missing: Partial<InventoryMapping> = { ...mapping };
    delete missing.inTransit;
    expect(() => validateInventoryMapping(missing as InventoryMapping, accounts)).toThrow(
      /缺少.*在途物资/,
    );
    expect(() =>
      validateInventoryMapping(
        { ...mapping, workInProgress: { accounts: ['40010101'] } },
        accounts,
      ),
    ).toThrow(/完整/);
    expect(() =>
      validateInventoryMapping(
        Object.assign({}, mapping, { unknown: { accounts: ['9999'] } }),
        accounts,
      ),
    ).toThrow(/未知/);
  });

  it('不存在角色须有明确依据和完整科目表佐证，输出零必须携带公共profile', async () => {
    await app.svc.periods.ensureYear(2026);
    const accounts = await app.svc.accounts.list();
    const mapping: InventoryMapping = {
      ...officialInventoryMapping,
      consumableBiologicalAssets: {
        absent: { reason: '已核对本合成账套完整科目表，无消耗性生物资产业务及对应科目' },
      },
    };
    expect(() => validateInventoryMapping(mapping, accounts)).toThrow(/仍然存在/);
    await app.svc.db.deleteFrom('account').where('code', '=', '1421').execute();
    const actual = await app.svc.accounts.list();
    expect(() =>
      validateInventoryMapping(
        { ...mapping, consumableBiologicalAssets: { absent: { reason: '  ' } } },
        actual,
      ),
    ).toThrow(/明确依据/);
    expect(() => validateInventoryMapping(mapping, actual)).not.toThrow();
    expect(extendedBalanceSheetTemplate({ mapping, accounts: actual }).profile?.mapping).toEqual({ inventory: mapping });
    expect(await api().list({})).toHaveLength(0);
  });

  it('旧absent反例：导入后新增1421借12345会漏项且审核全过；新构造器拒绝，默认母科目动态计入', async () => {
    await app.svc.periods.ensureYear(2026);
    await app.svc.db.deleteFrom('account').where('code', '=', '1421').execute();
    const accounts = await app.svc.accounts.list();
    const mapping: InventoryMapping = {
      ...officialInventoryMapping,
      consumableBiologicalAssets: { absent: { reason: '构造时完整科目表中无1421' } },
    };
    expect(() => validateInventoryMapping(mapping, accounts)).not.toThrow();
    expect(extendedBalanceSheetTemplate({ mapping, accounts }).profile).toBeDefined();

    // 已导入的旧无guard模板仍是公共P1；保留原来的0值及全过断言，揭示虚假自洽。
    const legacy = legacyInventoryTemplate('absent-1421');
    expect(legacy.cells.find((c) => c.address === 'A2')!.source).toContain('不存在依据');
    delete legacy.profile;
    const old = await api().importTemplate({ ...legacy, code: '312' });
    await expect(generate(old)).rejects.toThrow(/旧无guard|缺少持久/);
    const r = await api().importTemplate(extendedBalanceSheetTemplate({ mapping, accounts, period: 202602 }));
    const before = await generate(r);
    expect(value(before, 9, 'closing')).toBe('0');
    expect(before.checks.every((c) => c.status === 'pass')).toBe(true);
    const dynamic = ReportTemplateSchema.parse(structuredClone(balanceJson));
    dynamic.code = '311';
    const dynamicReport = await api().importTemplate(dynamic);
    await expect(generate(dynamicReport)).rejects.toThrow(/1421/);
    expect(await api().snapshot({ id: dynamicReport.id, period: 202602 })).toBeNull();
    await app.svc.accounts.create(
      { code: '1421', name: '消耗性生物资产', categoryId: 'asset' },
      [4, 2, 2],
    );
    await seedVouchers(app.svc, [
      {
        date: '2026-02-12',
        status: 'posted',
        lines: [
          { account: '1421', debit: 12345 },
          { account: '3001', credit: 12345 },
        ],
      },
    ]);
    const ledger = await app.svc.ledger.balances({
      periodFrom: 202602,
      periodTo: 202602,
      accountCodes: ['1421'],
      rollup: false,
    });
    expect(ledger.reduce((sum, row) => sum + row.closing, 0)).toBe(12345);
    expect(extendedBalanceSheetTemplate({ mapping, accounts }).profile).toBeDefined();
    const currentAccounts = await app.svc.accounts.list();
    expect(() => validateInventoryMapping(mapping, currentAccounts)).toThrow(/仍然存在/);
    const current = await generate(dynamicReport);
    expect(value(current, 9, 'closing')).toBe('12345');
    expect(value(current, 9, 'yearOpening')).toBe('0');
    expect(current.checks.every((c) => c.status === 'pass')).toBe(true);
    await requireLegacyGuard(r, '0');
  });

  it('旧明细清单反例：新增140303借777后漏项；默认母科目增至29465/3565且不禁止合法新增', async () => {
    await seedInventoryBook(app.svc);
    const accounts = await app.svc.accounts.list();
    const mapping: InventoryMapping = {
      ...officialInventoryMapping,
      rawMaterials: { accounts: ['140301', '140302'] },
    };
    expect(() => validateInventoryMapping(mapping, accounts)).not.toThrow();
    expect(extendedBalanceSheetTemplate({ mapping, accounts }).profile).toBeDefined();
    const legacy = legacyInventoryTemplate('raw-material-leaves'); delete legacy.profile;
    const old = await api().importTemplate({ ...legacy, code: '312' });
    await expect(generate(old)).rejects.toThrow(/旧无guard|缺少持久/);
    const r = await api().importTemplate(extendedBalanceSheetTemplate({ mapping, accounts, period: 202602 }));
    expectGolden(await generate(r), inventoryGolden.february2026);
    const dynamic = ReportTemplateSchema.parse(structuredClone(balanceJson));
    dynamic.code = '311';
    const dynamicReport = await api().importTemplate(dynamic);
    expectGolden(await generate(dynamicReport), inventoryGolden.february2026);
    await app.svc.accounts.create({ code: '140303', name: '新增材料丙' }, [4, 2, 2]);
    await seedVouchers(app.svc, [
      {
        date: '2026-02-12',
        status: 'posted',
        lines: [
          { account: '140303', debit: 777 },
          { account: '3001', credit: 777 },
        ],
      },
    ]);
    const currentAccounts = await app.svc.accounts.list();
    expect(() => validateInventoryMapping(mapping, currentAccounts)).toThrow(/未完整覆盖/);
    const current = await generate(dynamicReport);
    expect(value(current, 9, 'closing')).toBe('29465');
    expect(value(current, 10, 'closing')).toBe('3565');
    expect(value(current, 9, 'yearOpening')).toBe('27588');
    expect(value(current, 10, 'yearOpening')).toBe('3115');
    expect(current.checks.every((c) => c.status === 'pass')).toBe(true);
    await requireLegacyGuard(r, '28688', '2788');
  });

  it.each(inventoryRoles)('默认模板缺$name科目明确生成失败，不把漏项当零', async ({ code }) => {
    await app.svc.periods.ensureYear(2026);
    const r = await api().importTemplate(ReportTemplateSchema.parse(balanceJson));
    await app.svc.db.deleteFrom('account').where('code', '=', code).execute();
    await expect(generate(r)).rejects.toThrow(new RegExp(code));
    expect(await api().snapshot({ id: r.id, period: 202602 })).toBeNull();
  });

  it('包含关系审核识别自定义试算其中项误填，公共审核失败强制禁止导出', async () => {
    await seedInventoryBook(app.svc);
    const t = extendedBalanceSheetTemplate();
    delete t.profile; delete t.reportIdentity;
    const cell = t.cells.find((c) => c.address === balanceAddress(10, 'closing'))!;
    cell.source = `(${cell.source})*100`;
    const r = await api().importTemplate(t);
    const s = await generate(r);
    expect(s.checks.find((c) => c.name.startsWith('期末存货剔除'))).toMatchObject({
      status: 'fail',
      difference: '-1',
    });
    await expect(api().exportResult({ id: r.id, period: 202602 })).rejects.toThrow(/审核/);
  });

  it('随机整数分：两项差异任意借贷，生产成本父级不重计；总账试算及十项BigInt独算一致', async () => {
    await app.close();
    app = await smallBusinessApp();
    await app.svc.accounts.create({ code: '400101', name: '基本生产' }, [4, 2, 2]);
    await app.svc.accounts.create({ code: '400102', name: '辅助生产' }, [4, 2, 2]);
    const r = await api().importTemplate(ReportTemplateSchema.parse(balanceJson));
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 100000 }), { minLength: 10, maxLength: 10 }),
        fc.integer({ min: -100000, max: 100000 }),
        fc.integer({ min: -100000, max: 100000 }),
        async (positive, material, merchandise) => {
          const amounts = [...positive];
          amounts[3] = material;
          amounts[6] = merchandise;
          for (const [i, { code }] of inventoryRoles.entries()) {
            const amount = amounts[i]!;
            if (code === '4001') {
              const first = Math.floor(amount / 2);
              for (const [leaf, balance] of [
                ['400101', first],
                ['400102', amount - first],
              ] as const)
                await app.svc.opening.upsert({
                  year: 2026,
                  accountId: (await app.svc.accounts.require(leaf)).id,
                  balance,
                });
            } else
              await app.svc.opening.upsert({
                year: 2026,
                accountId: (await app.svc.accounts.require(code)).id,
                balance: amount,
              });
          }
          const expected = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
          await app.svc.opening.upsert({
            year: 2026,
            accountId: (await app.svc.accounts.require('3001')).id,
            balance: -Number(expected),
          });
          const s = await generate(r);
          for (const column of ['closing', 'yearOpening'] as const) {
            expect(value(s, 9, column)).toBe(String(expected));
            expect(value(s, 11, column)).toBe(String(amounts[4]));
          }
          expect(s.checks.every((c) => c.status === 'pass')).toBe(true);
          const trial = await app.svc.ledger.trialBalance(202601, 202602);
          expect(trial.closingDebit).toBe(trial.closingCredit);
        },
      ),
      { numRuns: 16 },
    );
  });
});
