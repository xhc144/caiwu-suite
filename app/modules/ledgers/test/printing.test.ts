import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import ExcelJS from 'exceljs';
import { assertSafePrintContent, renderPrintDocument } from '@caiwu/print';
import { createTestApp, seedVouchers } from '@caiwu/testkit';
import { buildLedgerPrintView, PrintOptionsSchema } from '../printing';
import { reportColumns } from '../presentation';
import { QuerySchema, type LedgerReport, type LedgerRow } from '../shared';
import { assertExportColumns } from '../server/output';
import server from '../server';

const query = () =>
  QuerySchema.parse({ kind: 'detail', periodFrom: 202602, periodTo: 202602, account: '1001' });
function row(id: string, kind: LedgerRow['kind'], amount: number, balance: number): LedgerRow {
  return {
    id,
    kind,
    date: '2026-02-01',
    account: '1001 库存现金',
    summary: id,
    voucherNo: kind === 'entry' ? '记-0001' : '',
    voucherId: null,
    href: null,
    status: '',
    dimensions: '',
    currency: '',
    refNo: '',
    debit: amount,
    credit: 0,
    side: balance ? '借' : '平',
    balance: Math.abs(balance),
    signedBalance: balance,
  };
}
function model(values = [100, 200, -30, 40, 500, 60, 70]): LedgerReport {
  let balance = 1000;
  return {
    query: query(),
    title: '三栏明细账',
    orgName: '合成测试单位',
    scope: '仅已过账',
    entryCount: values.length,
    rows: [
      row('opening', 'opening', 0, balance),
      ...values.map((value, index) => row(`entry-${index}`, 'entry', value, (balance += value))),
      row(
        'month',
        'month',
        values.reduce((n, v) => n + v, 0),
        balance,
      ),
      row('ytd', 'ytd', 999999, balance),
      row('closing', 'closing', 0, balance),
    ],
  };
}
const columns = (report: LedgerReport) =>
  reportColumns(report, ['summary', 'debit', 'credit', 'balance']);
const carries = (html: string, which: 'from' | 'to') =>
  [
    ...html.matchAll(
      new RegExp(`<tr class="ledger-carry" data-carry="${which}">[\\s\\S]*?<\\/tr>`, 'g'),
    ),
  ].map((match) => match[0]);
const asFrom = (value: string) =>
  value.replace('data-carry="to"', 'data-carry="from"').replace('过次页', '承前页');

describe('账簿连续打印和套打', () => {
  it('w_zc_slz_1/w_print_2_zw：承前过次页相同，月计累计不重复计入', () => {
    const report = model();
    const before = structuredClone(report);
    const job = buildLedgerPrintView(report, columns(report), { rowsPerPage: 3 });
    expect(job.pages).toHaveLength(4);
    expect(carries(job.html, 'to')).toHaveLength(3);
    expect(carries(job.html, 'from')).toEqual(carries(job.html, 'to').map(asFrom));
    expect(carries(job.html, 'to')[0]).toContain('3.00');
    expect(carries(job.html, 'to').at(-1)).toContain('9.40');
    expect(carries(job.html, 'to').at(-1)).not.toContain('9999.99');
    expect([...job.html.matchAll(/data-ledger-row="entry-\d+"/g)]).toHaveLength(7);
    expect(report).toEqual(before);
    expect(() => assertSafePrintContent(job.html, job.css)).not.toThrow();
    expect(renderPrintDocument(job)).toContain('@page');
  });
  it('w_zc_slz_1：红字随机序列跨页累计相等', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -10000, max: 10000 }), { minLength: 2, maxLength: 12 }),
        (values) => {
          const report = model(values);
          const job = buildLedgerPrintView(report, columns(report), { rowsPerPage: 2 });
          expect(carries(job.html, 'from')).toEqual(carries(job.html, 'to').map(asFrom));
          expect([
            ...job.html.matchAll(/data-ledger-row="entry-\d+" data-fragment="0"/g),
          ]).toHaveLength(values.length);
        },
      ),
      { numRuns: 20 },
    );
  });
  it('w_print_2_zw：独立科目换页、连续或各自编号、科目和发生条件筛选', () => {
    const report = model([100]);
    report.rows.push(
      ...model([200]).rows.map((value) => ({
        ...value,
        id: `other-${value.id}`,
        account: '1002 银行存款',
      })),
    );
    expect(
      buildLedgerPrintView(report, columns(report), { rowsPerPage: 60, startPage: 10 }).pages.map(
        (p) => p.number,
      ),
    ).toEqual([10, 11]);
    expect(
      buildLedgerPrintView(report, columns(report), {
        rowsPerPage: 60,
        startPage: 10,
        continuousPage: false,
      }).pages.map((p) => p.number),
    ).toEqual([10, 10]);
    const selected = buildLedgerPrintView(report, columns(report), { accountCodes: ['1002'] });
    expect(selected.pages.every((p) => p.account === '1002 银行存款')).toBe(true);
    expect(selected.html).not.toContain('1001 库存现金');
    expect(() => buildLedgerPrintView(report, columns(report), { accountCodes: ['9999'] })).toThrow(
      /不在当前/,
    );
    const noEntries = {
      ...model([]),
      rows: [row('opening', 'opening', 0, 1000), row('closing', 'closing', 0, 1000)],
    };
    expect(() =>
      buildLedgerPrintView(noEntries, columns(noEntries), { content: 'entries' }),
    ).toThrow(/没有账簿记录/);
    expect(
      buildLedgerPrintView(noEntries, columns(noEntries), { content: 'balance' }).pages,
    ).toHaveLength(1);
    const notes = model([]);
    notes.rows.forEach((value) => {
      value.signedBalance = 0;
      value.debit = 0;
      value.values = { dimensionYtdMissing: '缺少历史' };
    });
    expect(() => buildLedgerPrintView(notes, columns(notes), { content: 'balance' })).toThrow(
      /没有账簿记录/,
    );
  });
  it('w_zc_fhslz_1：同科目辅助对象分别成账，不在对象之间承前', () => {
    const report = model([100]);
    report.rows = report.rows.map((value) => ({ ...value, sectionKey: '1001|C001' }));
    report.rows.push(
      ...model([200]).rows.map((value) => ({
        ...value,
        id: `second-${value.id}`,
        sectionKey: '1001|C002',
        dimensions: '客供：乙客户',
      })),
    );
    const job = buildLedgerPrintView(report, columns(report), { rowsPerPage: 60 });
    expect(job.pages.map((page) => page.section)).toEqual(['1001|C001', '1001|C002']);
    expect(carries(job.html, 'from')).toEqual([]);
    const longDimension = model([100, 200, 300]);
    longDimension.rows.forEach((value) => {
      value.sectionKey = 'department-1';
      value.dimensions = '部门：很长的行政部完整名称'.repeat(4);
    });
    const detail = buildLedgerPrintView(
      longDimension,
      reportColumns(longDimension, [
        'date',
        'account',
        'summary',
        'dimensions',
        'debit',
        'balance',
      ]),
      { rowsPerPage: 2 },
    );
    for (const carried of [...carries(detail.html, 'to'), ...carries(detail.html, 'from')]) {
      expect(carried).not.toContain('很长的行政部');
      expect(carried).not.toContain('1001 库存现金');
    }
  });
  it('w_print_1/w_print_2：页序号解析、选页保留承接，拒绝越界或反向', () => {
    const report = model();
    const job = buildLedgerPrintView(report, columns(report), {
      rowsPerPage: 3,
      startPage: 10,
      pageRange: '2,4',
    });
    expect(job.totalPages).toBe(4);
    expect(job.pages.map((p) => p.number)).toEqual([11, 13]);
    expect(job.pages.map((p) => p.index)).toEqual([2, 4]);
    expect(carries(job.html, 'from')[0]).toContain('3.00');
    for (const pageRange of ['0', '5', '3-2', '1,,2', '<script>', '1.5', '1-999999'])
      expect(() =>
        buildLedgerPrintView(report, columns(report), { rowsPerPage: 3, pageRange }),
      ).toThrow(/范围/);
  });
  it('w_zc_dlz_1/w_zc_fhdlz_1：正附页不丢栏目，超过248栏目阻止另存', () => {
    const report = model([100, -20]);
    report.query.kind = 'multi';
    report.dynamicColumns = Array.from({ length: 13 }, (_, index) => ({
      id: `multi_${index}`,
      label: `栏目${index}`,
      money: true,
    }));
    report.rows = report.rows.map((value) => ({
      ...value,
      values: Object.fromEntries(
        report.dynamicColumns!.map((column) => [
          column.id,
          value.kind === 'entry' ? value.debit : 999999,
        ]),
      ),
    }));
    const job = buildLedgerPrintView(report, reportColumns(report, ['summary']), {
      columnsPerPage: 2,
      rowsPerPage: 60,
    });
    expect(job.pages.some((page) => page.label.includes('附页'))).toBe(true);
    for (let index = 0; index < 13; index++) expect(job.html).toContain(`<th>栏目${index}</th>`);
    report.dynamicColumns = Array.from({ length: 248 }, (_, index) => ({
      id: `multi_${index}`,
      label: `栏目${index}`,
      money: true,
    }));
    expect(() => assertExportColumns(report)).not.toThrow();
    report.dynamicColumns.push({ id: 'multi_extra', label: '额外', money: true });
    expect(() => assertExportColumns(report)).toThrow(/248/);
    expect(
      buildLedgerPrintView(report, reportColumns(report, ['summary']), { rowsPerPage: 60 })
        .totalPages,
    ).toBeGreaterThan(1);
  });
  it('w_zc_slz_sl/w_zc_slz_fb：数量与原币跨页精确累计', () => {
    const report = model([0, 0, 0]);
    report.dynamicColumns = [
      { id: 'fcDebit', label: '原币借方', money: true },
      { id: 'qtyDebit', label: '借方数量', money: false },
      { id: 'qtyBalance', label: '数量余额', money: false },
    ];
    report.rows.forEach((value, index) => {
      value.values = {
        fcDebit: value.kind === 'entry' ? 1 : 999,
        qtyDebit: value.kind === 'entry' ? '0.000001' : '999',
        qtyBalance: String(index),
      };
    });
    const job = buildLedgerPrintView(report, reportColumns(report, ['summary']), {
      rowsPerPage: 2,
    });
    expect(carries(job.html, 'to')[0]).toContain('0.01');
    expect(carries(job.html, 'to')[0]).toContain('0.000001');
    expect(carries(job.html, 'to')[1]).toContain('0.03');
    expect(carries(job.html, 'to')[1]).toContain('0.000003');
  });
  it('w_zc_slz_1：长摘要完整跨页后才列金额，不提前将未印完分录计入承前', () => {
    const report = model([100]);
    report.rows[1]!.summary = '这是很长的中文摘要'.repeat(30);
    const job = buildLedgerPrintView(report, columns(report), { rowsPerPage: 2 });
    const firstCarry = carries(job.html, 'to')[0]!;
    expect(firstCarry).toContain('0.00');
    expect(firstCarry).toContain('10.00');
    expect(firstCarry).not.toContain('11.00');
    const entryFragments = [
      ...job.html.matchAll(/<tr data-ledger-row="entry-0"[\s\S]*?<\/tr>/g),
    ].map((match) => match[0]);
    expect(entryFragments.filter((value) => value.includes('>1.00</td>'))).toHaveLength(1);
    expect(entryFragments.at(-1)).toContain('>1.00</td>');
    expect(entryFragments.at(-1)).toContain('>11.00</td>');
  });
  it('w_print：套打毫米几何、偏移越界拒绝与文本安全转义', () => {
    const report = model([100]);
    report.rows[1]!.summary = '<img src=x onerror=alert(1)> & "测试"';
    const job = buildLedgerPrintView(report, columns(report), {
      orientation: 'portrait',
      paper: 'B5',
      overlay: true,
      offsetX: 2,
      offsetY: -2,
    });
    expect(job.pageSize).toEqual({ widthMm: 176, heightMm: 250 });
    expect(job.css).toContain('left:2mm;top:-2mm');
    expect(job.css).toContain('border-color:transparent');
    expect(job.html).not.toContain('<img');
    expect(job.html).toContain('&lt;img');
    expect(() => assertSafePrintContent(job.html, job.css)).not.toThrow();
    expect(() => buildLedgerPrintView(report, columns(report), { offsetX: 11 })).toThrow(/截断/);
    expect(() => PrintOptionsSchema.parse({ rowsPerPage: 0 })).toThrow();
    const custom = buildLedgerPrintView(report, columns(report), {
      paper: 'custom',
      widthMm: 240,
      heightMm: 280,
      orientation: 'portrait',
      rowHeightMm: 8,
    });
    expect(custom.pageSize).toEqual({ widthMm: 240, heightMm: 280 });
    expect(custom.css).toContain('height:8mm');
    expect(() => buildLedgerPrintView(report, columns(report), { rowHeightMm: 3 })).toThrow(/行高/);
  });
  it('w_zc_zzs：分类及未分类栏目只累计分录，不再叠加月计和本年累计', () => {
    const report = model([100, -20, 30]);
    report.query.kind = 'vat';
    report.rows.forEach((value) => {
      value.sectionKey = 'vat';
      value.values = {
        vat_input: value.kind === 'entry' ? value.debit : 999999,
        vat_unclassified_credit: value.kind === 'entry' ? 1 : 999999,
      };
    });
    report.dynamicColumns = [
      { id: 'vat_input', label: '进项税额', money: true },
      { id: 'vat_unclassified_credit', label: '未分类贷方', money: true },
    ];
    const job = buildLedgerPrintView(report, reportColumns(report, ['summary']), {
      rowsPerPage: 2,
    });
    expect(carries(job.html, 'to')[0]).toContain('1.00');
    expect(carries(job.html, 'to')[1]).toContain('1.10');
    expect(carries(job.html, 'to')[1]).toContain('0.03');
    expect(carries(job.html, 'to')[1]).not.toContain('9999.99');
  });
  it('w_zc_slz_sl/_fb：零本币纯数量、纯原币期初仍可选择有余额打印', () => {
    const balances: Record<string, string | number | null>[] = [
      { fcBalance: 5 },
      { qtyBalance: '0.000001' },
    ];
    for (const values of balances) {
      const report = model([]);
      report.rows.forEach((value) => {
        value.signedBalance = 0;
        value.debit = 0;
        value.credit = 0;
        value.values = value.kind === 'opening' ? values : {};
      });
      expect(
        buildLedgerPrintView(report, columns(report), { content: 'balance' }).pages,
      ).toHaveLength(1);
    }
  });
  it('w_print_2_zw：跨年本期承接累加实际分录，不被本年累计重置或重复相加', () => {
    const report = model([100, 200]);
    report.query.periodFrom = 202612;
    report.query.periodTo = 202701;
    const entries = report.rows.filter((value) => value.kind === 'entry');
    report.rows = [
      report.rows[0]!,
      entries[0]!,
      { ...row('dec-ytd', 'ytd', 999999, 1100), date: '202612' },
      { ...entries[1]!, date: '2027-01-01' },
      row('jan-month', 'month', 200, 1300),
      row('jan-ytd', 'ytd', 200, 1300),
      row('closing', 'closing', 0, 1300),
    ];
    const job = buildLedgerPrintView(report, columns(report), { rowsPerPage: 2 });
    expect(carries(job.html, 'to')[1]).toContain('3.00');
    expect(carries(job.html, 'to')[1]).toContain('13.00');
    expect(carries(job.html, 'from')).toEqual(carries(job.html, 'to').map(asFrom));
  });
  it('w_print：仅金融列也保留摘要承前标识且不覆盖金额，未知或空全零累计不误计', () => {
    const report = model();
    const job = buildLedgerPrintView(report, reportColumns(report, ['debit', 'balance']), {
      rowsPerPage: 3,
    });
    expect(job.html).toContain('<th>摘要</th>');
    expect(carries(job.html, 'to')[0]).toContain('3.00');
    expect(carries(job.html, 'to')[0]).toContain('13.00');
    const dateOnly = buildLedgerPrintView(
      report,
      reportColumns(report, ['date', 'debit', 'balance']),
      { rowsPerPage: 3 },
    );
    expect(carries(dateOnly.html, 'to')[0]).toContain('过次页');
    expect(() => assertSafePrintContent(dateOnly.html, dateOnly.css)).not.toThrow();
  });
  it('w_zc_zc_1：总账启用前未知月额跨页承接仍留空，不印成零', () => {
    const report = model([100]);
    report.query.kind = 'general';
    report.rows = [
      row('unknown', 'month', 0, 0),
      row('known', 'month', 100, 100),
      row('closing', 'closing', 0, 100),
    ];
    report.rows[0] = {
      ...report.rows[0]!,
      debit: null,
      credit: null,
      balance: null,
      signedBalance: null,
      side: '未知',
    };
    const job = buildLedgerPrintView(report, columns(report), { rowsPerPage: 1 });
    expect(carries(job.html, 'to')[0]).not.toContain('0.00');
    expect(carries(job.html, 'from')[0]).toContain('承前页');
    expect(carries(job.html, 'to')[1]).not.toContain('>1.00</td><td');
  });
  it('w_zc_saveas：选择完整科目账页批量转出，拒绝非法选择，原页面完整取数不变', async () => {
    const app = await createTestApp({ modules: [server] });
    try {
      await seedVouchers(app.svc, [
        {
          date: '2026-02-01',
          status: 'posted',
          lines: [
            { account: '1001', debit: 123 },
            { account: '4001', credit: 123 },
          ],
        },
      ]);
      const api = app.call(server);
      const input = QuerySchema.parse({ ...query(), account: '' });
      const before = await api.report(input);
      const file = await api.export({
        ...input,
        columns: ['account', 'summary', 'debit', 'balance'],
        accountCodes: ['1001'],
      });
      expect(file.report.rows.every((value) => value.account.startsWith('1001 '))).toBe(true);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(Buffer.from(file.base64, 'base64')).buffer);
      expect(
        workbook.worksheets[0]!.getColumn(1)
          .values.filter((value) => typeof value === 'string')
          .some((value) => String(value).startsWith('4001 ')),
      ).toBe(false);
      expect(await api.report(input)).toEqual(before);
      await expect(
        api.export({ ...input, columns: ['summary'], accountCodes: ['9999'] }),
      ).rejects.toThrow(/不在当前/);
    } finally {
      await app.close();
    }
  });
  it('w_print_2_zw：真实接口分页不改变取数，打印权限仍由服务端检查', async () => {
    const app = await createTestApp({ modules: [server] });
    try {
      await seedVouchers(
        app.svc,
        [1, 2, 3].map((amount) => ({
          date: '2026-02-01',
          status: 'posted' as const,
          lines: [
            { account: '1001', debit: amount },
            { account: '4001', credit: amount },
          ],
        })),
      );
      const api = app.call(server);
      const before = await api.report(query());
      const job = await api.print({
        ...query(),
        columns: ['summary', 'debit', 'balance'],
        printOptions: { rowsPerPage: 2 },
      });
      expect(job.pages.length).toBeGreaterThan(1);
      expect(job.report).toEqual(before);
      expect(await api.report(query())).toEqual(before);
      const viewer = app.call(
        server,
        await app.addUser('print-viewer', { permissions: ['ledgers.view'] }),
      );
      await expect(
        viewer.print({ ...query(), columns: ['summary'], printOptions: { overlay: true } }),
      ).rejects.toThrow(/权限/);
    } finally {
      await app.close();
    }
  });
});
