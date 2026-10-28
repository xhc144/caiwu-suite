import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  rewriteReferences,
  rewriteReportReferences,
  type ReferenceChange,
} from '../editor-references';

const rowInsert: ReferenceChange = { axis: 'row', kind: 'insert', index: 3, count: 2 };

describe('w_bb_def 插删行列时的公式引用', () => {
  it('移动本地单元格并保留原有空白、符号和取数字符串', () => {
    const source =
      '= SUM ( A1 : B4 ) + a3 + BALANCE("1001","closing","cents","CNY","signed","none","")';
    expect(rewriteReferences(source, rowInsert, '1')).toBe(
      '= SUM ( A1 : B6 ) + A5 + BALANCE("1001","closing","cents","CNY","signed","none","")',
    );
    expect(rewriteReferences('"A3"+"REF(\\"1\\",\\"A3\\")"', rowInsert, '1')).toBe(
      '"A3"+"REF(\\"1\\",\\"A3\\")"',
    );
  });

  it('只移动本报表的 REF 地址，报表编号的前导零按同一编号比较', () => {
    expect(
      rewriteReferences('REF("001", "a3") + REF("2","A3") + REF ( \'1\', \'B5\' )', rowInsert, '1'),
    ).toBe('REF("001", "A5") + REF("2","A3") + REF ( \'1\', \'B7\' )');
    expect(rewriteReferences('REF("2","A3")', { ...rowInsert, kind: 'delete' }, '1')).toBe(
      'REF("2","A3")',
    );
  });

  it.each([
    ['A1:A4', 1, 1, 'B1:B4'],
    ['B1:D4', 2, 2, 'D1:F4'],
    ['B1:D4', 3, 1, 'B1:E4'],
    ['B1:D4', 5, 1, 'B1:D4'],
  ])('插入列 %s 在起点整体移动、内部扩展、范围后保持', (source, index, count, result) => {
    expect(
      rewriteReferences(`SUM(${source})`, { axis: 'col', kind: 'insert', index, count }, '1'),
    ).toBe(`SUM(${result})`);
  });

  it.each([
    ['B2:E8', 'row', 2, 2, 'B2:E6'],
    ['B2:E8', 'row', 4, 2, 'B2:E6'],
    ['B2:E8', 'row', 7, 2, 'B2:E6'],
    ['B2:E8', 'col', 2, 1, 'B2:D8'],
    ['B2:E8', 'col', 3, 2, 'B2:C8'],
    ['B2:E8', 'col', 4, 2, 'B2:C8'],
    ['B2:E8', 'row', 1, 1, 'B1:E7'],
    ['B2:E8', 'row', 9, 1, 'B2:E8'],
  ] as const)('部分删除区域 %s 的 %s 时缩小范围', (source, axis, index, count, result) => {
    expect(rewriteReferences(`SUM(${source})`, { axis, kind: 'delete', index, count }, '1')).toBe(
      `SUM(${result})`,
    );
  });

  it('删除直接引用或整个区域时阻止操作，给出被引用的位置', () => {
    const change = { axis: 'row', kind: 'delete', index: 3, count: 2 } as const;
    expect(() => rewriteReferences('A3+B7', change, '1')).toThrow(/直接引用.*A3.*先修改引用/);
    expect(() => rewriteReferences('SUM(B3:D4)', change, '1')).toThrow(/B3:D4.*全部删除/);
    expect(() => rewriteReferences('REF("1","A4")', change, '1')).toThrow(/直接引用.*A4/);
    expect(rewriteReferences('A2+B7', change, '1')).toBe('A2+B5');
  });

  it('函数名称不被误作地址；非法字符串和越界调整会给出明确错误', () => {
    expect(rewriteReferences('S1("A3")', rowInsert, '1')).toBe('S1("A3")');
    expect(rewriteReferences('1E3+1001A3+_A3', rowInsert, '1')).toBe('1E3+1001A3+_A3');
    expect(() => rewriteReferences('"A3', rowInsert, '1')).toThrow(/字符串没有结束/);
    expect(() => rewriteReferences('A999', rowInsert, '1')).toThrow(/超出报表行列上限/);
    expect(() => rewriteReferences('A1', { ...rowInsert, count: 0 }, '1')).toThrow(/正整数/);
  });

  it('随机验证：插入后删除同一批空白行可还原所有未受删引用', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 800 }),
        fc.integer({ min: 1, max: 800 }),
        fc.integer({ min: 1, max: 50 }),
        (row, index, count) => {
          const source = `A${row}+REF("1","B${row}")+REF("2","C${row}")`;
          const inserted = rewriteReferences(
            source,
            { axis: 'row', kind: 'insert', index, count },
            '1',
          );
          expect(
            rewriteReferences(inserted, { axis: 'row', kind: 'delete', index, count }, '1'),
          ).toBe(source);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('w_bb_def 其他报表保存时同步入向引用', () => {
  it('只移动目标报表 REF 第二参，保留本地单元格、区域和普通字符串', () => {
    const source = '=A3+SUM(B3:C8)+REF("002", "A3")+REF("1","A3")+"A3"+"REF(\\"2\\",\\"A3\\")"';
    expect(rewriteReportReferences(source, rowInsert, '2')).toBe(
      '=A3+SUM(B3:C8)+REF("002", "A5")+REF("1","A3")+"A3"+"REF(\\"2\\",\\"A3\\")"',
    );
  });

  it('同一目标的多次 REF 和列编号跨过 Z 时一起移动，保留原空白与引号', () => {
    const change = { axis: 'col', kind: 'insert', index: 26, count: 2 } as const;
    expect(
      rewriteReportReferences(
        'ref ( \'12\', \'Z3\' )+REF("012","AA9")+REF("1","Z3")',
        change,
        '12',
      ),
    ).toBe('ref ( \'12\', \'AB3\' )+REF("012","AC9")+REF("1","Z3")');
  });

  it('删除目标引用格会阻止整次保存；其他报表的同地址与本地范围不受影响', () => {
    const change = { axis: 'row', kind: 'delete', index: 3, count: 2 } as const;
    expect(() => rewriteReportReferences('SUM(A3:B4)+REF("2","C4")', change, '2')).toThrow(
      /直接引用.*C4.*先修改引用/,
    );
    expect(rewriteReportReferences('SUM(A3:B4)+REF("3","C4")+REF("2","C8")', change, '2')).toBe(
      'SUM(A3:B4)+REF("3","C4")+REF("2","C6")',
    );
  });

  it('没有目标入向引用时即使局部引用会超界或被删也不更改', () => {
    expect(rewriteReportReferences('A999+SUM(A3:B4)+REF("9","A999")', rowInsert, '2')).toBe(
      'A999+SUM(A3:B4)+REF("9","A999")',
    );
  });
});
