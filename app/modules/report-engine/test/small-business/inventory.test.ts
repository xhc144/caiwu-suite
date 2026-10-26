import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestApp } from '@caiwu/testkit';
import reportServer from '../../server';
import { parseFormula } from '../../server/formula';
import { ReportTemplateSchema, type Report, type ReportSnapshot } from '../../shared';
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

  it('父子/兄弟完整映射只计一次；遗漏、空数组、未知角色、错母科目及父子重复均拒绝', async () => {
    await seedInventoryBook(app.svc);
    const accounts = await app.svc.accounts.list();
    const mapping: InventoryMapping = {
      ...officialInventoryMapping,
      rawMaterials: { accounts: ['140301', '140302'] },
      workInProgress: { accounts: ['400101', '400102'] },
    };
    const r = await api().importTemplate(extendedBalanceSheetTemplate({ mapping, accounts }));
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

  it('不存在角色须有明确依据且当前完整科目表中不存在；不能凭空声明零', async () => {
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
    const t = extendedBalanceSheetTemplate({ mapping, accounts: actual });
    expect(t.cells.find((c) => c.address === 'A2')!.source).toContain('不存在依据');
    const s = await generate(await api().importTemplate(t));
    expect(value(s, 9, 'closing')).toBe('0');
    expect(s.checks.every((c) => c.status === 'pass')).toBe(true);
    // 这是显式构造能力；公共路由不会重新绑定或校验此absence依据，缺口继续保留。
  });

  it.each(inventoryRoles)('默认模板缺$name科目明确生成失败，不把漏项当零', async ({ code }) => {
    await app.svc.periods.ensureYear(2026);
    const r = await api().importTemplate(ReportTemplateSchema.parse(balanceJson));
    await app.svc.db.deleteFrom('account').where('code', '=', code).execute();
    await expect(generate(r)).rejects.toThrow(new RegExp(code));
    expect(await api().snapshot({ id: r.id, period: 202602 })).toBeNull();
  });

  it('包含关系审核识别其中项误填；当前公共审核失败仍能导出，不能声称已强制阻止', async () => {
    await seedInventoryBook(app.svc);
    const t = extendedBalanceSheetTemplate();
    const cell = t.cells.find((c) => c.address === balanceAddress(10, 'closing'))!;
    cell.source = `(${cell.source})*100`;
    const r = await api().importTemplate(t);
    const s = await generate(r);
    expect(s.checks.find((c) => c.name.startsWith('期末存货剔除'))).toMatchObject({
      status: 'fail',
      difference: '-1',
    });
    expect(
      (await api().exportResult({ id: r.id, period: 202602 }))!.snapshot.checks.some(
        (c) => c.status === 'fail',
      ),
    ).toBe(true);
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
