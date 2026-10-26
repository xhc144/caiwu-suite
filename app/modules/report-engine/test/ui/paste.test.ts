import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatMoney } from '@caiwu/core';
import { emptyTemplate } from '../../shared';
import { preparePaste } from '../../web/paste';

const template = () => emptyTemplate({ code: '101', name: '区域粘贴', rows: 3, cols: 3 });
describe('w_bb_def 复制/粘贴区域', () => {
  it('粘贴矩形保留目标类型/单位/格式，空白清空，未定义格按文本；不改原草稿', () => {
    const t = template();
    t.cells = [
      { address: 'A1', kind: 'money', source: '120', unit: 'foreignCents', currency: 'USD' },
      { address: 'B1', kind: 'number', source: '2.5', unit: 'quantity', currency: 'CNY' },
      { address: 'A2', kind: 'text', source: '原文', unit: 'number', currency: 'CNY' },
    ];
    t.styles = [{ address: 'A1', align: 'right', wrap: false, bold: true, format: 'decimal2' }];
    const original = JSON.stringify(t);
    const out = preparePaste(t, 'A1', '-1.005\t3.125\r\n\t=SUM(A1:B1)\r\n', 'target');
    expect(out.count).toBe(4);
    expect(out.overwritten).toBe(3);
    expect(out.range).toBe('A1:B2');
    expect(out.template.styles).toEqual(t.styles);
    expect(out.template.cells).toEqual([
      { address: 'A1', kind: 'money', source: '-101', unit: 'foreignCents', currency: 'USD' },
      { address: 'B1', kind: 'number', source: '3.125', unit: 'quantity', currency: 'CNY' },
      { address: 'B2', kind: 'text', source: '=SUM(A1:B1)', unit: 'number', currency: 'CNY' },
    ]);
    expect(JSON.stringify(t)).toBe(original);
  });
  it('支持带引号的换行、制表符和双引号字段，不丢尾端空列', () => {
    const out = preparePaste(
      template(),
      'A1',
      '"两行\n文字"\t"含\t制表符"\t"含""引号"\n末行\t\t',
      'text',
    );
    expect(out.count).toBe(6);
    expect(out.template.cells.map((c) => c.source)).toEqual([
      '两行\n文字',
      '含\t制表符',
      '含"引号',
      '末行',
    ]);
  });
  it.each([
    ['A1', '1\t2\n3', 'text', /每行列数/],
    ['C3', '1\t2', 'text', /边界/],
    ['A1', '12\t不是金额', 'money', /B1.*金额/],
    ['A1', '1e3', 'number', /数值/],
    ['A1', '90071992547410', 'money', /安全整数分/],
    ['A1', '"未结束', 'text', /引号/],
    ['A1', '"结束"多余', 'text', /引号/],
    ['A1', 'x'.repeat(2001), 'text', /2000/],
  ] as const)('整批拒绝非法数据 %s %s %s', (start, text, mode, error) => {
    const t = template(),
      before = JSON.stringify(t);
    expect(() => preparePaste(t, start, text, mode)).toThrow(error);
    expect(JSON.stringify(t)).toBe(before);
  });
  it('包含合并格、超过500格、超过1MB或总定义超过5000格均拒绝', () => {
    const t = template();
    t.merges = [{ row: 1, col: 1, rows: 1, cols: 2 }];
    expect(() => preparePaste(t, 'A1', '1', 'text')).toThrow(/先拆分/);
    const large = emptyTemplate({ code: '102', name: '上限', rows: 999, cols: 250 });
    expect(() => preparePaste(large, 'A1', Array(501).fill('a').join('\n'), 'text')).toThrow(/500/);
    expect(() => preparePaste(t, 'A1', 'x'.repeat(1_000_001), 'text')).toThrow(/1MB/);
    large.cells = Array.from({ length: 5000 }, (_, i) => ({
      address: `A${i + 1}`,
      kind: 'text' as const,
      source: 'x',
      unit: 'number' as const,
      currency: 'CNY',
    }));
    // 合法的5000格覆盖20列×250行。
    large.cells = Array.from({ length: 5000 }, (_, i) => ({
      ...large.cells[i]!,
      address: `${String.fromCharCode(65 + Math.floor(i / 250))}${(i % 250) + 1}`,
    }));
    expect(() => preparePaste(large, 'U1', '新格', 'text')).toThrow(/最多定义5000个单元格/);
  });
  it('整数分→元文本→粘贴金额往返保持精确值，含负数与零', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (cents) => {
        const out = preparePaste(template(), 'A1', formatMoney(cents), 'money');
        expect(out.template.cells[0]!.source).toBe(String(cents));
      }),
    );
  });
});
