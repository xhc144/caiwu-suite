import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { calculateEnterprise } from '../../templates/enterprise/calculate';
import type { EnterpriseResult } from '../../templates/enterprise/model';
import { createFixedBook } from './fixed-book';
import {
  expectedBalance,
  expectedProfit,
  expectedCashflow,
  expectedEquity,
} from './fixed-book-expected';

let book: Awaited<ReturnType<typeof createFixedBook>>;
beforeAll(async () => {
  book = await createFixedBook();
}, 20000);
afterAll(async () => {
  await book?.app.close();
});

describe('w_bb_proc 企业固定账套：真实期初、两年逐月业务与损益结转', () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))(
    '第%i月本月及累计：三表本期/上年比较逐行与手算一致',
    async (month) => {
      for (const scope of ['month', 'yearToDate'] as const) {
        const c = { ...book.c, period: 202600 + month, scope };
        const source = await book.source(c);
        const lineIds = new Set(source.entries.map((e) => e.lineId));
        // 各月配置只引用当时存在的已过账来源；不把12月分类伪装为早期月份已确认资料。
        const result = calculateEnterprise(
          {
            ...c,
            cashAllocations: c.cashAllocations.filter((x) => lineIds.has(x.lineId)),
            equityEvents: c.equityEvents.filter((x) => lineIds.has(x.lineId)),
            oci: c.oci.filter((x) => lineIds.has(x.lineId)),
            discontinued: c.discontinued.filter((x) => lineIds.has(x.lineId)),
          },
          source,
        );
        expect(result.balance.current, `${month}月${scope}资产负债表`).toEqual(
          expectedBalance(2026, month),
        );
        expect(result.balance.previous).toEqual(expectedBalance(2025, 12));
        expect(result.profit.current).toEqual(expectedProfit(2026, month, scope === 'yearToDate'));
        expect(result.profit.previous).toEqual(expectedProfit(2025, month, scope === 'yearToDate'));
        expect(result.cashflow.current).toEqual(
          expectedCashflow(2026, month, scope === 'yearToDate'),
        );
        expect(result.cashflow.previous).toEqual(
          expectedCashflow(2025, month, scope === 'yearToDate'),
        );
        expect(result.equity).toEqual({ current: {}, previous: {} });
        expect(result.checks.filter((check) => check.difference !== '0')).toEqual([]);
      }
    },
  );

  it('四张年报逐行逐权益格：备抵、重分类、利息其中项、税后OCI、股份及三类现金流勾稽', async () => {
    const d = await book.source(book.c),
      result = calculateEnterprise(book.c, d);
    expect(d.accounts).toHaveLength(71);
    expect(d.vouchers).toHaveLength(56);
    expect(d.vouchers.filter((v) => v.closingKind === 'pnl')).toHaveLength(24);
    expect(d.entries).toHaveLength(2010);
    expect(result.balance).toEqual({
      current: expectedBalance(2026, 12),
      previous: expectedBalance(2025, 12),
    });
    expect(result.profit).toEqual({
      current: expectedProfit(2026, 12, true),
      previous: expectedProfit(2025, 12, true),
    });
    expect(result.cashflow).toEqual({
      current: expectedCashflow(2026, 12, true),
      previous: expectedCashflow(2025, 12, true),
    });
    expect(result.equity).toEqual({
      current: expectedEquity(2026),
      previous: expectedEquity(2025),
    });
    expect(result.checks.filter((check) => check.difference !== '0')).toEqual([]);
    // 独立年末锚点，防止修改手算台账时把整体偏差一起带入。
    expect(result.balance.current.assetsTotal).toBe('2179840');
    expect(result.balance.previous.assetsTotal).toBe('1822420');
    expect(result.profit.current.netProfit).toBe('295620');
    expect(result.profit.previous.netProfit).toBe('225420');
    expect(result.cashflow.current.cashIncrease).toBe('282180');
    expect(result.cashflow.previous.cashIncrease).toBe('205980');
  });

  it('w_bb_main/proc/saveas 固定账套四表生成、成功快照及数值Excel/打印使用同一手算结果', async () => {
    const api = book.app.call(book.mod).statutory;
    for (const [key, code] of [
      ['balance', '201'],
      ['profit', '202'],
      ['cashflow', '203'],
      ['equity', '204'],
    ] as const) {
      const profile = await api.save({
        definitionId: book.c.format,
        definitionRevision: 1,
        reportKey: key,
        code,
        name: `合成企业${code}`,
        configuration: book.c,
      });
      const generated = await api.generate({
        id: profile.id,
        expectedRevision: profile.revision,
        period: 202612,
        requestId: randomUUID(),
      });
      expect(generated.kind).toBe('generated');
      if (generated.kind !== 'generated') throw new Error('合成账套不应出现待过账确认');
      const result = generated.snapshot.result as EnterpriseResult;
      expect(result.balance.current).toEqual(expectedBalance(2026, 12));
      expect(result.profit.current).toEqual(expectedProfit(2026, 12, true));
      expect(result.cashflow.current).toEqual(expectedCashflow(2026, 12, true));
      expect(result.equity.current).toEqual(expectedEquity(2026));
      const selection = {
        id: profile.id,
        expectedRevision: profile.revision,
        period: 202612,
        snapshotId: generated.snapshot.id,
      };
      const xlsx = await api.output({ ...selection, format: 'xlsx' });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(Buffer.from(xlsx.data, 'base64')).buffer);
      const cells = workbook.worksheets.flatMap((sheet) => {
        const values: unknown[] = [];
        sheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
        return values;
      });
      const anchor =
        key === 'balance'
          ? 21798.4
          : key === 'profit'
            ? 2956.2
            : key === 'cashflow'
              ? 2821.8
              : 17825.4;
      expect(cells).toContain(anchor);
      const print = await api.output({ ...selection, format: 'print' });
      expect(print.snapshotId).toBe(xlsx.snapshotId);
      expect(print.data).toContain(anchor.toFixed(2));
      expect(print.printJob?.css).toContain('A4');
    }
  });
});
