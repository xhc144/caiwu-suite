import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import {
  buildLedgerView,
  buildTemplateView,
  buildVoucherView,
  defaultLayout,
  escapeHtml,
  layoutGeometry,
  parsePageRange,
  renderPrintDocument,
  runPrintBatch,
  viewToPrintJob,
  wrapPrintText,
  type LedgerPrintModel,
} from './index';
let book: TestBook;
beforeEach(async () => {
  book = await createTestBook();
});
afterEach(async () => book.close());
async function model() {
  const vouchers = await seedVouchers(book.svc, [
    {
      date: '2026-01-05',
      attachments: 2,
      lines: [
        { account: '1001', debit: 12345, summary: '购买用品' },
        { account: '6603', credit: 12345, summary: '购买用品' },
      ],
    },
  ]);
  return {
    unit: '测试单位',
    vouchers: vouchers.map((v) => ({ ...v, auxiliary: v.lines.map(() => '部门01') })),
  };
}
describe('凭证打印与范围', () => {
  it.each([1, 2, 3] as const)('w_pz_prn_1_a4 每页 %s 张边界，没有尾空白页', async (perPage) => {
    const m = await model(),
      v = m.vouchers[0]!;
    m.vouchers = Array.from({ length: 7 }, (_, i) => ({
      ...v,
      id: i + 1,
      displayNo: `记-${i + 1}`,
    }));
    const view = buildVoucherView(m, { ...defaultLayout, perPage });
    expect(view.pages).toHaveLength(Math.ceil(7 / perPage));
    expect(renderPrintDocument(viewToPrintJob(view)).match(/class="print-sheet"/g)).toHaveLength(
      Math.ceil(7 / perPage),
    );
  });
  it('w_pz_prn_3 三张简单凭证每页两张为两页', async () => {
    const m = await model();
    m.vouchers = Array(3).fill(m.vouchers[0]!);
    expect(buildVoucherView(m, { ...defaultLayout, perPage: 2 }).pages).toHaveLength(2);
  });
  it('w_pz_prn_1 长摘要/科目分片不覆盖金额、不丢原文，实际金额只打印一次', async () => {
    const m = await model(),
      v = m.vouchers[0]!,
      text = '中文摘要及长科目'.repeat(80);
    v.lines[0]!.summary = text;
    v.lines[0]!.accountName = text;
    const view = buildVoucherView(m, { ...defaultLayout, perPage: 3, rows: 4 });
    expect(view.pages.length).toBeGreaterThan(1);
    const html = view.pages.map((p) => p.html).join('');
    expect(
      html.match(new RegExp(`data-line="${v.lines[0]!.id}" data-fragment="0"`, 'g')),
    ).toHaveLength(1);
    const pieces = [
      ...html.matchAll(new RegExp(`<tr data-line="${v.lines[0]!.id}"[^>]*><td>(.*?)</td>`, 'g')),
    ]
      .map((x) => x[1])
      .join('');
    expect(pieces).toBe(text);
    expect(html).toContain('123.45');
    expect(html).toContain('附件：2');
    expect(html).toContain('制单：');
  });
  it('w_pz_prn_1 随机分录分页保持 ID、整数分和总额', async () => {
    const base = (await model()).vouchers[0]!;
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100000 }), { minLength: 1, maxLength: 80 }),
        fc.constantFrom(1, 2, 3),
        (amounts, per) => {
          const lines = amounts.map((a, i) => ({
            ...base.lines[0]!,
            id: i + 1,
            lineNo: i + 1,
            summary: '摘要'.repeat((i % 20) + 1),
            debit: a,
            credit: 0,
          }));
          const total = amounts.reduce((a, b) => a + b, 0);
          const v = {
            ...base,
            lines,
            debitTotal: total,
            creditTotal: 0,
            auxiliary: lines.map(() => ''),
          };
          const view = buildVoucherView(
            { unit: '单位', vouchers: [v] },
            { ...defaultLayout, perPage: per as 1 | 2 | 3, rows: 6 },
          );
          const html = view.pages.map((p) => p.html).join('');
          const ids = [...html.matchAll(/data-line="(\d+)" data-fragment="0"/g)].map((x) =>
            Number(x[1]),
          );
          expect(ids).toEqual(lines.map((l) => l.id));
          expect(v.debitTotal).toBe(total);
        },
      ),
      { numRuns: 60 },
    );
  });
  it('w_xt_tz_zc 摘要去重、科目码、辅助、主管和字体实际影响输出', async () => {
    const m = await model();
    const view = buildVoucherView(m, {
      ...defaultLayout,
      deduplicateSummary: true,
      showAccountCode: false,
      showAuxiliary: false,
      supervisor: '主管甲',
      fontSize: 11,
      color: true,
    });
    const html = view.pages[0]!.html;
    expect(html.match(/购买用品/g)).toHaveLength(1);
    expect(html).not.toContain('1001');
    expect(html).not.toContain('部门01');
    expect(html).toContain('主管甲');
    expect(viewToPrintJob(view).css).toContain('#173f69');
  });
  it.each(['', '0', '-1', '2-1', '1,', '1,,2', '1.5', 'x', '1-99', '4'])(
    'w_print_1 / w_print_2 拒绝非法范围 %s',
    (text) => expect(() => parsePageRange(text, 3)).toThrow(),
  );
  it('w_print_1 列表区间去重并稳定排序', () =>
    expect(parsePageRange('1,3,5-12,3', 12)).toEqual([1, 3, 5, 6, 7, 8, 9, 10, 11, 12]));
  it('w_print / w_print_root / w_preview / w_preview_zzsmxz 空数据明确拒绝', () => {
    expect(() => buildVoucherView({ unit: '', vouchers: [] }, defaultLayout)).toThrow('无记录');
    expect(() => renderPrintDocument({ title: '空', html: '' })).toThrow('无记录');
    expect(() => parsePageRange('1', 0)).toThrow('无记录');
  });
  it.each([
    { rows: 0 },
    { startPage: 0 },
    { copies: 0 },
    { copies: 100 },
    { fontSize: 25 },
    { offsetX: 11 },
    { margins: { top: 100, right: 100, bottom: 100, left: 100 } },
    { widthMm: 0 },
    { scale: 101 },
  ])('w_print_zc_pg / w_xt_tz_zc 拒绝越界设置 %j', (patch) =>
    expect(() => layoutGeometry({ ...defaultLayout, ...patch })).toThrow(),
  );
  it('w_pz_prn_1 自定义横向纸张和打印比例独立于屏幕', async () => {
    const view = buildVoucherView(await model(), {
      ...defaultLayout,
      paper: 'custom',
      widthMm: 220,
      heightMm: 140,
      landscape: true,
      scale: 50,
    });
    const doc = renderPrintDocument(viewToPrintJob(view));
    expect(doc).toContain('size:140mm 220mm');
    expect(doc).toContain('zoom:0.5');
  });
});
const ledgerModel: LedgerPrintModel = {
  unit: '单位',
  title: '明细账',
  kind: 'detail',
  period: '202601',
  account: '1001 现金',
  opening: 100,
  debit: 1000,
  credit: 0,
  ytdDebit: 2000,
  ytdCredit: 0,
  rows: Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    date: '2026-01-01',
    voucherNo: `记-${i + 1}`,
    summary: '业务',
    debit: 100,
    credit: 0,
    balance: 100 + (i + 1) * 100,
    counterpart: '6603 财务费用',
    refNo: '票-001',
    quantity: '1.234567',
  })),
};
describe('账册与批次', () => {
  it('w_print_zc / w_preview_zc 过次页和承前页保持累计，不重复计入本期', () => {
    const view = buildLedgerView(ledgerModel, { ...defaultLayout, rows: 3, startPage: 10 });
    expect(view.pages).toHaveLength(4);
    expect(view.pages[0]!.html).toContain('过次页');
    expect(view.pages[1]!.html).toContain('承前页');
    expect(view.pages[1]!.html).toContain('3.00');
    expect(view.pages[3]!.html).toContain('本期合计');
    expect(view.pages[3]!.html).toContain('10.00');
    expect(view.pages[3]!.html).toContain('本年累计');
    expect(view.pages[3]!.html).toContain('第 13 页');
    expect(view.pages[0]!.html).not.toContain('本期合计');
  });
  it('w_print_zc 现金/银行格式带对方科目/票号，数量精度正确', () => {
    expect(
      buildLedgerView({ ...ledgerModel, kind: 'cash' }, defaultLayout).pages[0]!.html,
    ).toContain('6603 财');
    expect(
      buildLedgerView({ ...ledgerModel, kind: 'bank' }, defaultLayout).pages[0]!.html,
    ).toContain('票-001');
    expect(
      buildLedgerView(ledgerModel, { ...defaultLayout, quantityDecimals: 4 }).pages[0]!.html,
    ).toContain('1.2346');
  });
  it('w_preview_zc 奇页后翻面确认，取消不发送偶页', async () => {
    const view = buildLedgerView(ledgerModel, { ...defaultLayout, rows: 3 });
    const send = vi.fn(async () => {}),
      confirm = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await runPrintBatch(view, {
      pages: [1, 2, 3, 4],
      copies: 1,
      pause: 'none',
      duplex: true,
      confirm,
      send,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      sent: [1, 3],
      cancelled: true,
      blankPages: 0,
      resume: { key: expect.any(String), nextStep: 1 },
    });
    expect(confirm.mock.calls[0]![0]).toContain('奇页');
    expect(confirm.mock.calls[1]![0]).toContain('翻面');
  });
  it('w_pz_prn_2 / w_pz_prn_3 暂停列凭证年月字号，取消后不重印', async () => {
    const m = await model();
    m.vouchers = Array.from({ length: 3 }, (_, i) => ({
      ...m.vouchers[0]!,
      id: i + 1,
      displayNo: `记-${i + 1}`,
    }));
    const view = buildVoucherView(m, defaultLayout);
    const send = vi.fn(async () => {}),
      confirm = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await runPrintBatch(view, {
      pages: [1, 2, 3],
      copies: 2,
      pause: 'voucher',
      confirm,
      send,
    });
    expect(confirm.mock.calls[0]![0]).toContain('2026-01 记-1');
    expect(result.sent).toEqual([1]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('w_pz_prn_2 批次失败不继续后续；已取消信号不输出', async () => {
    const view = buildVoucherView(await model(), defaultLayout),
      send = vi.fn().mockRejectedValue(new Error('打印机离线'));
    await expect(
      runPrintBatch(view, {
        pages: [1],
        copies: 2,
        pause: 'none',
        confirm: async () => true,
        send,
      }),
    ).rejects.toThrow('离线');
    expect(send).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await runPrintBatch(view, {
          pages: [1],
          copies: 1,
          pause: 'none',
          confirm: async () => true,
          signal: controller.signal,
          send,
        })
      ).sent,
    ).toEqual([]);
  });
});
describe('安全模板与金额', () => {
  it('w_preview_report_base 审核结果普通列表与空列表可打印，名称仍作为转义文字', () => {
    const name = '<script src="https://example.invalid/x">审核</script>';
    const html = `<h1>现金报表</h1><table><tr><td>124.00</td></tr></table><ul><li>${escapeHtml(name)}：通过；差额 0；阈值 1（金额为分）</li><li><strong>第二项</strong>：不通过</li></ul><ul></ul>`;
    const doc = renderPrintDocument({ title: '现金报表', html });
    expect(doc).toContain('<td>124.00</td>');
    expect(doc).toContain('<ul><li>&lt;script');
    expect(doc).toContain('<li><strong>第二项</strong>：不通过</li>');
    expect(doc).toContain('<ul></ul>');
    expect(doc).not.toContain('<script');
  });
  it.each([
    '<ul onclick="x()"><li>审核</li></ul>',
    '<ul><li onmouseover="x()">审核</li></ul>',
    '<ul><li><script>x()</script></li></ul>',
    '<ul><li><iframe src="https://example.invalid"></iframe></li></ul>',
    '<ul><li><img src="https://example.invalid/x"></li></ul>',
    '<ul><li><a href="https://example.invalid">审核</a></li></ul>',
    '<ul><li background="https://example.invalid/x">审核</li></ul>',
    '<ul style="background:url(https://example.invalid/x)"><li>审核</li></ul>',
    '<ul><li style="width:expression(x())">审核</li></ul>',
    '<ul><li style="background:u&#114;l(https://example.invalid/x)">审核</li></ul>',
    '<ul><li style="background:u\\72l(https://example.invalid/x)">审核</li></ul>',
    '<ul><li style="background:image-set(\'https://example.invalid/x\')">审核</li></ul>',
    '<ul><li><style>@import "https://example.invalid/x";</style></li></ul>',
    '<ul><li/onload="x()">审核</li></ul>',
  ])('w_preview_report_base 列表仍拒绝可执行内容、资源及危险样式 %s', (html) =>
    expect(() => renderPrintDocument({ title: '审核列表', html })).toThrow(),
  );
  it.each([
    '<script>alert(1)</script>',
    '<img src="https://x/track">',
    '<div onclick="x()">x</div>',
    '<a href="https://x">x</a>',
    '<div style="background:url(https://x)">x</div>',
  ])('w_bb_def_gs 拒绝危险 HTML %s', (html) =>
    expect(() => renderPrintDocument({ title: 'x', html })).toThrow(),
  );
  it.each([
    '@import "https://x";',
    'body{background:image-set("https://x")}',
    'body{background:u\\72l(https://x)}',
    '</style><script>x</script>',
  ])('w_bb_def_gs 拒绝危险 CSS %s', (css) =>
    expect(() => renderPrintDocument({ title: 'x', html: '<p>安全</p>', css })).toThrow(),
  );
  it('w_pz_prn_1 用户脚本文本被 escape，可正常打印且无事件或网络资源', async () => {
    const m = await model();
    m.vouchers[0]!.lines[0]!.summary = '<script onerror="x">远程 url(test)</script>';
    const doc = renderPrintDocument(viewToPrintJob(buildVoucherView(m, defaultLayout)));
    expect(doc).toContain('&lt;script');
    expect(doc).not.toContain('<script');
    expect(doc).toContain('default-src');
    expect(escapeHtml(`'"<&>`)).toBe('&#39;&quot;&lt;&amp;&gt;');
  });
  it('w_pz_prn_1 分录与合计不一致、非整数分必须拒绝', async () => {
    const m = await model();
    m.vouchers[0]!.lines[0]!.debit = 0.5;
    expect(() => buildVoucherView(m, defaultLayout)).toThrow();
  });
  it('w_preview_dlz 模板正附页页码清晰，字段和文字仅转义输出', () => {
    const view = buildTemplateView(
      {
        name: '模板',
        rows: 1,
        cols: 10,
        rowHeight: 8,
        colWidth: 40,
        cells: [{ row: 1, col: 1, text: '<script>x</script>', align: 'left' }],
      },
      defaultLayout,
    );
    expect(view.pages).toHaveLength(3);
    expect(view.pages[0]!.html).toContain('正页');
    expect(view.pages[1]!.html).toContain('附页 1');
    expect(view.pages[0]!.html).toContain('&lt;script&gt;');
  });
  it('w_print_root 保留换行和原文', () =>
    expect(wrapPrintText('甲乙\n丙丁', 100, 10)).toEqual(['甲乙', '丙丁']));
});

it('w_xt_tz_zc 多科目连续页码开关实际影响下一科目', async () => {
  const { buildLedgerBookView } = await import('./index');
  const models = [
    { ...ledgerModel, rows: ledgerModel.rows.slice(0, 1) },
    { ...ledgerModel, account: '6603 财务费用', rows: ledgerModel.rows.slice(0, 1) },
  ];
  const on = buildLedgerBookView(models, { ...defaultLayout, startPage: 5, continuousPage: true });
  const off = buildLedgerBookView(models, {
    ...defaultLayout,
    startPage: 5,
    continuousPage: false,
  });
  expect(on.pages[1]!.html).toContain('第 6 页');
  expect(off.pages[1]!.html).toContain('第 5 页');
});
it('w_pz_prn_3 每张暂停把同一凭证所有续页作为一个批次', async () => {
  const m = await model();
  m.vouchers[0]!.lines[0]!.summary = '长摘要'.repeat(30);
  const view = buildVoucherView(m, { ...defaultLayout, rows: 2 });
  const send = vi.fn(async () => {}),
    confirm = vi.fn(async () => true);
  expect(view.pages.length).toBeGreaterThan(1);
  await runPrintBatch(view, {
    pages: view.pages.map((_, i) => i + 1),
    copies: 1,
    pause: 'voucher',
    confirm,
    send,
  });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
});
it('w_pz_prn_1 高字体和长单位不能覆盖下一张；空间不足明确阻止', async () => {
  const m = await model();
  m.unit = '很长的单位名称'.repeat(30);
  expect(() => buildVoucherView(m, { ...defaultLayout, perPage: 3, fontSize: 24 })).toThrow(
    '页眉和签名',
  );
});
it('w_pz_prn_2 连续打印多份一次提交，系统取消不会自动弹出下一份', async () => {
  const view = buildVoucherView(await model(), defaultLayout);
  const send = vi.fn(async (_job: { html: string }) => {});
  const result = await runPrintBatch(view, {
    pages: [1],
    copies: 3,
    pause: 'none',
    confirm: async () => true,
    send,
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0].html.match(/class="print-sheet"/g)).toHaveLength(3);
  expect(result.sent).toEqual([1, 1, 1]);
});
it('w_pz_prn_3 暂停中取消后即使继续确认也不发送', async () => {
  const view = buildVoucherView(await model(), defaultLayout),
    controller = new AbortController();
  const send = vi.fn(async () => {});
  const result = await runPrintBatch(view, {
    pages: [1],
    copies: 1,
    pause: 'page',
    signal: controller.signal,
    confirm: async () => {
      controller.abort();
      return true;
    },
    send,
  });
  expect(send).not.toHaveBeenCalled();
  expect(result.cancelled).toBe(true);
});
it('w_pz_prn_1 23 个 W/M 必须预分行，保留混合字、完整 emoji 和 tab 空格', () => {
  for (const char of ['W', 'M']) {
    const text = char.repeat(23),
      lines = wrapPrintText(text, 60.8, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(text);
  }
  const mixed = 'W中文M👨‍👩‍👧‍👦🇨🇳\tMW'.replace('\\t', '\t');
  const lines = wrapPrintText(mixed, 25, 10);
  expect(lines.join('')).toBe(mixed.replace(/\t/g, '    '));
  const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
  const flattened = lines.flatMap((line) => [...graphemes.segment(line)].map((x) => x.segment));
  expect(flattened).toContain('👨‍👩‍👧‍👦');
  expect(flattened).toContain('🇨🇳');
});

it('w_print_2_zw 每科目提示包含所有续页，取消后不发送下一科目', async () => {
  const { buildLedgerBookView } = await import('./index');
  const view = buildLedgerBookView([ledgerModel, { ...ledgerModel, account: '6603 财务费用' }], {
    ...defaultLayout,
    rows: 3,
  });
  const send = vi.fn(async () => {});
  const confirm = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const result = await runPrintBatch(view, {
    pages: view.pages.map((_, i) => i + 1),
    copies: 1,
    pause: 'account',
    send,
    confirm,
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ sent: [1, 2, 3, 4], cancelled: true });
  expect(confirm.mock.calls[0]![0]).toContain('1001 现金');
  expect(confirm.mock.calls[1]![0]).toContain('6603 财务费用');
});

it('w_preview_zc 重置科目页码时按印刷页码分奇偶，单页科目背面仍保留空白纸槽', async () => {
  const { buildLedgerBookView } = await import('./index');
  const view = buildLedgerBookView([ledgerModel, { ...ledgerModel, account: '6603 财务费用' }], {
    ...defaultLayout,
    rows: 100,
    startPage: 5,
    continuousPage: false,
  });
  const send = vi.fn(async () => {});
  const confirm = vi.fn(async () => true);
  const result = await runPrintBatch(view, {
    pages: [1, 2],
    copies: 1,
    pause: 'none',
    duplex: true,
    send,
    confirm,
  });
  expect(view.pages.map((p) => p.pageNumber)).toEqual([5, 5]);
  expect(send).toHaveBeenCalledTimes(4);
  expect(confirm).toHaveBeenCalledTimes(4);
  expect(result.sent).toEqual([1, 2]);
  expect(result.blankPages).toBe(2);
});

it('w_print_zc 承前过次跨长摘要仍按分录首次分片累计，红字金额不重复', () => {
  const rows = ledgerModel.rows.map((r, i) => ({
    ...r,
    summary: '跨页摘要'.repeat(12),
    debit: i % 2 ? -100 : 100,
    balance: i % 2 ? 100 : 200,
  }));
  const view = buildLedgerView(
    { ...ledgerModel, debit: 0, ytdDebit: 0, rows },
    { ...defaultLayout, rows: 2 },
  );
  const html = view.pages.map((p) => p.html).join('');
  expect([...html.matchAll(/data-ledger-line="[^"]+" data-fragment="0"/g)]).toHaveLength(
    rows.length,
  );
  for (let i = 1; i < view.pages.length; i++) {
    const previous = /<tr>(?:(?!<tr>)[\s\S])*?<td>过次页<\/td>[\s\S]*?<\/tr>/.exec(
      view.pages[i - 1]!.html,
    )?.[0];
    const current = /<tr>(?:(?!<tr>)[\s\S])*?<td>承前页<\/td>[\s\S]*?<\/tr>/.exec(
      view.pages[i]!.html,
    )?.[0];
    expect(previous).toBeDefined();
    expect(current).toBe(previous!.replace('过次页', '承前页'));
  }
  expect(html).toContain('-1.00');
});

it.each([
  ['A5', 148, 210],
  ['B5', 176, 250],
] as const)('w_print %s 标准纸张与横向尺寸一致', async (paper, width, height) => {
  const view = buildVoucherView(await model(), { ...defaultLayout, paper, landscape: true });
  expect(layoutGeometry(view.layout)).toMatchObject({ width: height, height: width });
  expect(renderPrintDocument(viewToPrintJob(view))).toContain(`size:${height}mm ${width}mm`);
});

it('w_pz_prn_3 合并间距挤占槽高，过大时阻止，不静默截断', async () => {
  const m = await model();
  m.vouchers.push({ ...m.vouchers[0]!, id: 2 });
  const view = buildVoucherView(m, { ...defaultLayout, perPage: 2, voucherGapMm: 8 });
  expect(view.pages).toHaveLength(1);
  expect(viewToPrintJob(view).css).toContain('margin-bottom:8mm');
  expect(() =>
    layoutGeometry({ ...defaultLayout, paper: 'A5', perPage: 3, voucherGapMm: 50 }),
  ).toThrow('可打印区域');
});
