import { expect, it } from 'vitest';
import { validatePnlClosings } from '../../templates/nonprofit/closing-control';
import {
  lineIdentity,
  mappedRow,
  type ActualLine,
  type Sources,
  type Configuration,
} from '../../templates/nonprofit/model';

function probe() {
  const entries: ActualLine[] = [];
  const add = (
    voucherId: number,
    accountCode: string,
    debit: number,
    credit: number,
    closingKind: string | null = null,
    date = '2026-01-31',
  ) => {
    entries.push({
      voucherId,
      lineId: entries.length + 1,
      revision: 1,
      period: Number(date.slice(0, 7).replace('-', '')),
      date,
      voucherTypeCode: '记',
      number: voucherId,
      displayNo: `记-${voucherId}`,
      status: 'posted',
      lineNo: 1,
      summary: '合成逐笔来源',
      accountId: Number(accountCode),
      accountCode,
      dimensions: {},
      currency: null,
      exchangeRate: null,
      fcAmount: null,
      quantity: null,
      unitPrice: null,
      refNo: null,
      sourceModule: null,
      debit,
      credit,
      closingKind,
    });
  };
  add(1, '4101', 0, 100);
  add(2, '5101', 50, 0);
  add(3, '4101', 100, 0, 'pnl');
  add(3, '3101', 0, 100, 'pnl');
  add(4, '3101', 50, 0, 'pnl');
  add(4, '5101', 0, 50, 'pnl');
  const c = { mappings: [], recognitions: [] } as unknown as Configuration;
  const confirm = () => {
    c.recognitions = entries
      .filter((e) => !e.closingKind)
      .map((e) => ({
        line: lineIdentity(e),
        row: mappedRow(e.accountCode, []) as 'donations' | 'activityCost',
        allocations: [
          {
            resourceId: 'U',
            classification: 'unrestricted',
            debit: e.debit,
            credit: e.credit,
            recognitionReference: '合成凭证原件',
            acquisitionReference: '合成取得U',
            detail: '教育服务',
            charitableTrust: false,
            fundraisingCost: false,
          },
        ],
      }));
  };
  confirm();
  return { s: { entries } as Sources, c, add, confirm };
}

it('w_bb_proc 收入100费用50分两张结转，损益余额均为0且非限定净资产增加50', () => {
  const { s, c } = probe();
  expect(() => validatePnlClosings(s, c)).not.toThrow();
  expect(
    ['4101', '5101', '3101'].map((code) =>
      s.entries.filter((e) => e.accountCode === code).reduce((n, e) => n + e.credit - e.debit, 0),
    ),
  ).toEqual([0, 0, 50]);
  const firstOnly = { ...s, entries: s.entries.filter((e) => e.voucherId !== 4) };
  expect(() => validatePnlClosings(firstOnly, c)).not.toThrow();
});

it('w_bb_proc 分张结转不能留下已结转科目的残留余额', () => {
  const { s, c } = probe();
  s.entries[2]!.debit = 99;
  s.entries[3]!.credit = 99;
  expect(() => validatePnlClosings(s, c)).toThrow(/4101仍有余额/);
});

it('w_bb_proc 损益总额虽结清，非限定资源错转限定净资产仍阻止', () => {
  const { s, c } = probe();
  s.entries[3]!.accountCode = '3102';
  expect(() => validatePnlClosings(s, c)).toThrow(/逐笔资源分类不一致/);
});

it('w_bb_proc 同科目两类资源可分别结转，错误两类金额不被总额抵销', () => {
  const { s, c } = probe();
  c.recognitions[0]!.allocations[0]!.credit = 60;
  c.recognitions[0]!.allocations.push({
    ...c.recognitions[0]!.allocations[0]!,
    resourceId: 'R',
    classification: 'restricted',
    credit: 40,
  });
  s.entries[3]!.credit = 60;
  s.entries.push({ ...s.entries[3]!, lineId: 7, accountCode: '3102', credit: 40 });
  expect(() => validatePnlClosings(s, c)).not.toThrow();
  s.entries[3]!.credit = 61;
  s.entries.at(-1)!.credit = 39;
  expect(() => validatePnlClosings(s, c)).toThrow(/逐笔资源分类不一致/);
});

it('w_bb_proc 次月新增业务按科目承接，不强迫把尚未结转的另一科目一起结转', () => {
  const { s, c, add, confirm } = probe();
  add(5, '4101', 0, 20, null, '2026-02-05');
  add(6, '5101', 10, 0, null, '2026-02-06');
  add(7, '3101', 10, 0, 'pnl', '2026-02-28');
  add(7, '5101', 0, 10, 'pnl', '2026-02-28');
  confirm();
  expect(() => validatePnlClosings(s, c)).not.toThrow();
});
