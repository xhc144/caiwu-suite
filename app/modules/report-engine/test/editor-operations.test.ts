import { describe, expect, it } from 'vitest';
import {
  applyStyle,
  changeStructure,
  createHistory,
  parseClipboard,
  pasteCells,
  recordEdit,
  redoEdit,
  undoEdit,
} from '../editor-operations';
import { emptyTemplate, PrintSettingsSchema, type Cell, type ReportTemplate } from '../shared';

const template = (rows = 8, cols = 6) =>
  emptyTemplate({ code: '101', name: '经营报表', rows, cols });
const text = (address: string, source: string): Cell => ({
  address,
  kind: 'text',
  source,
  unit: 'number',
  currency: 'CNY',
});
const number = (address: string, source: string): Cell => ({
  ...text(address, source),
  kind: 'number',
});
const formula = (address: string, source: string): Cell => ({
  ...text(address, source),
  kind: 'formula',
});
const at = (t: ReportTemplate, address: string) => t.cells.find((cell) => cell.address === address);

describe('w_bb_def 插删行列', () => {
  it('插入合并区内部行时联动内容、公式、审核、样式、行高和分页，保留原定义', () => {
    const original = template();
    original.cells = [
      text('A2', '收入'),
      number('B2', '10'),
      number('B3', '20'),
      number('B4', '30'),
      number('D5', '40'),
      formula('E6', '=SUM(B2:B4)+REF("101","D5")+REF("102","C3")'),
    ];
    original.merges = [{ row: 2, col: 1, rows: 2, cols: 1 }];
    original.styles = [
      { address: 'B4', align: 'right', bold: true, wrap: false, format: 'decimal2' },
    ];
    original.rowHeights = [
      { row: 2, height: 40 },
      { row: 4, height: 55 },
    ];
    original.colWidths = [{ col: 2, width: 120 }];
    original.checks = [{ name: '合计核对', left: 'E6', right: 'D5', tolerance: '0' }];
    original.print = PrintSettingsSchema.parse({ rowBreaks: [6], repeatRows: 1 });
    const before = structuredClone(original);

    const changed = changeStructure(original, { axis: 'row', kind: 'insert', index: 3, count: 2 });

    expect(changed.rows).toBe(10);
    expect(changed.cols).toBe(6);
    expect(at(changed, 'A2')?.source).toBe('收入');
    expect(at(changed, 'B5')?.source).toBe('20');
    expect(at(changed, 'B6')?.source).toBe('30');
    expect(at(changed, 'E8')?.source).toBe('=SUM(B2:B6)+REF("101","D7")+REF("102","C3")');
    expect(changed.merges).toEqual([{ row: 2, col: 1, rows: 4, cols: 1 }]);
    expect(changed.styles[0]).toMatchObject({ address: 'B6', bold: true });
    expect(changed.rowHeights).toEqual([
      { row: 2, height: 40 },
      { row: 6, height: 55 },
    ]);
    expect(changed.colWidths).toEqual(original.colWidths);
    expect(changed.checks[0]).toMatchObject({ left: 'E8', right: 'D7' });
    expect(changed.print).toMatchObject({ rowBreaks: [8], repeatRows: 1 });
    expect(original).toEqual(before);
  });

  it('删除行移除被删内容并收缩 SUM 区域，合并单格恢复普通格', () => {
    const original = template();
    original.cells = [
      text('A2', '小计'),
      number('B2', '10'),
      number('B3', '20'),
      number('B4', '30'),
      formula('E6', '=SUM(B2:B4)'),
    ];
    original.merges = [{ row: 2, col: 1, rows: 2, cols: 1 }];
    original.rowHeights = [
      { row: 3, height: 45 },
      { row: 4, height: 60 },
    ];
    original.print = PrintSettingsSchema.parse({ rowBreaks: [6] });

    const changed = changeStructure(original, { axis: 'row', kind: 'delete', index: 3, count: 1 });

    expect(changed.rows).toBe(7);
    expect(at(changed, 'B3')?.source).toBe('30');
    expect(changed.cells.some((cell) => cell.source === '20')).toBe(false);
    expect(at(changed, 'E5')?.source).toBe('=SUM(B2:B3)');
    expect(changed.merges).toEqual([]);
    expect(changed.rowHeights).toEqual([{ row: 3, height: 60 }]);
    expect(changed.print?.rowBreaks).toEqual([5]);
  });

  it('插删列时列宽、样式、合并区和字母引用同步移动，其他报表引用不变', () => {
    const original = template(5, 6);
    original.cells = [
      text('B2', '标题'),
      number('B4', '1'),
      formula('F5', '=SUM(B4:D4)+REF("102","B4")'),
    ];
    original.merges = [{ row: 2, col: 2, rows: 1, cols: 2 }];
    original.colWidths = [
      { col: 2, width: 90 },
      { col: 4, width: 200 },
    ];
    original.styles = [
      { address: 'D4', align: 'center', bold: false, wrap: true, format: 'general' },
    ];

    const inserted = changeStructure(original, { axis: 'col', kind: 'insert', index: 3, count: 1 });
    expect(inserted.cols).toBe(7);
    expect(inserted.merges).toEqual([{ row: 2, col: 2, rows: 1, cols: 3 }]);
    expect(at(inserted, 'G5')?.source).toBe('=SUM(B4:E4)+REF("102","B4")');
    expect(inserted.colWidths).toEqual([
      { col: 2, width: 90 },
      { col: 5, width: 200 },
    ]);
    expect(inserted.styles[0]?.address).toBe('E4');

    const deleted = changeStructure(inserted, { axis: 'col', kind: 'delete', index: 3, count: 1 });
    expect(deleted).toEqual(original);
  });

  it('删除直接被引用的行时整次操作失败，原内容和审核公式都保留', () => {
    const original = template();
    original.cells = [number('A2', '12'), formula('B5', '=A2+1')];
    const before = structuredClone(original);
    expect(() =>
      changeStructure(original, { axis: 'row', kind: 'delete', index: 2, count: 1 }),
    ).toThrow(/引用|删除/);
    expect(original).toEqual(before);

    original.cells = [number('A2', '12')];
    original.checks = [{ name: '引用校验', left: 'A2', right: '0', tolerance: '0' }];
    const withChecks = structuredClone(original);
    expect(() =>
      changeStructure(original, { axis: 'row', kind: 'delete', index: 2, count: 1 }),
    ).toThrow(/引用|删除/);
    expect(original).toEqual(withChecks);
  });

  it('在首行插入时原重复表头仍完整重复，删除标题行后重复行数收缩', () => {
    const original = template();
    original.print = PrintSettingsSchema.parse({ repeatRows: 2, rowBreaks: [6] });
    const inserted = changeStructure(original, { axis: 'row', kind: 'insert', index: 1, count: 2 });
    expect(inserted.print).toMatchObject({ repeatRows: 4, rowBreaks: [8] });
    const deleted = changeStructure(inserted, { axis: 'row', kind: 'delete', index: 2, count: 2 });
    expect(deleted.print).toMatchObject({ repeatRows: 2, rowBreaks: [6] });
  });

  it.each([
    { axis: 'row' as const, kind: 'delete' as const, index: 1, count: 8 },
    { axis: 'col' as const, kind: 'delete' as const, index: 6, count: 2 },
    { axis: 'row' as const, kind: 'insert' as const, index: 0, count: 1 },
    { axis: 'col' as const, kind: 'insert' as const, index: 1, count: 245 },
  ])('拒绝空报表、越界或不合法的插删 %j', (change) => {
    expect(() => changeStructure(template(), change)).toThrow();
  });
});

describe('w_bb_def 批量粘贴', () => {
  it('解析 Excel 引号字段、制表符、字段内换行、双引号转义与 CRLF，不额外增加末行', () => {
    expect(parseClipboard('"收入\t合计"\t"第一行\n第二行"\r\n"他说""好"""\t001\r\n')).toEqual([
      ['收入\t合计', '第一行\n第二行'],
      ['他说"好"', '001'],
    ]);
    expect(parseClipboard('A\tB\nC')).toEqual([
      ['A', 'B'],
      ['C', ''],
    ]);
    expect(() => parseClipboard('"未结束\t1')).toThrow(/引号/);
  });

  it('自动区分文字、前导零编码、数值和公式，文本模式保留等号公式为文字', () => {
    const changed = pasteCells(template(), 'B2', '001\t12.50\t=SUM(C2:C2)\n项目\t-2\t');
    expect(at(changed, 'B2')).toMatchObject({ kind: 'text', source: '001' });
    expect(at(changed, 'C2')).toMatchObject({ kind: 'number', source: '12.5', unit: 'number' });
    expect(at(changed, 'D2')).toMatchObject({
      kind: 'formula',
      source: '=SUM(C2:C2)',
      unit: 'number',
    });
    expect(at(changed, 'C3')).toMatchObject({ kind: 'number', source: '-2' });
    expect(at(changed, 'D3')).toBeUndefined();
    expect(at(pasteCells(template(), 'A1', '=2+2', 'text'), 'A1')).toMatchObject({
      kind: 'text',
      source: '=2+2',
    });
  });

  it('金额按元粘贴并精确四舍五入到分，自动粘贴保留外币币种', () => {
    const original = template();
    original.cells = [
      { address: 'B2', source: '0', kind: 'money', unit: 'foreignCents', currency: 'USD' },
    ];
    const changed = pasteCells(original, 'B2', '1.005\t-1.005\t1,234.56', 'money');
    expect(at(changed, 'B2')).toMatchObject({
      source: '101',
      unit: 'foreignCents',
      currency: 'USD',
    });
    expect(at(changed, 'C2')).toMatchObject({ source: '-101', unit: 'cents' });
    expect(at(changed, 'D2')).toMatchObject({ source: '123456', unit: 'cents' });
    expect(at(pasteCells(original, 'B2', '0.29'), 'B2')).toMatchObject({
      source: '29',
      currency: 'USD',
    });
  });

  it('空字段清空目标格；无效金额、合并内部及越界失败都不应用前半批内容', () => {
    const original = template(3, 3);
    original.cells = [text('A1', '保留'), text('B1', '旧内容'), text('B2', '原金额')];
    const before = structuredClone(original);
    expect(at(pasteCells(original, 'A1', '\t新内容'), 'A1')).toBeUndefined();
    expect(() => pasteCells(original, 'A1', '1.25\t不是金额', 'money')).toThrow(/金额/);
    expect(original).toEqual(before);
    expect(() => pasteCells(original, 'C3', '修改\t越界')).toThrow(/边界/);
    expect(original).toEqual(before);

    original.merges = [{ row: 2, col: 1, rows: 1, cols: 2 }];
    original.cells = [text('A1', '保留')];
    const merged = structuredClone(original);
    expect(() => pasteCells(original, 'A1', '前半批\t1\n合并\t2')).toThrow(/合并/);
    expect(original).toEqual(merged);
  });

  it('过大金额和超过5000格的输入被拒绝', () => {
    expect(() => pasteCells(template(), 'A1', '90071992547409.92', 'money')).toThrow(/范围/);
    expect(() => parseClipboard(Array<string>(5001).fill('1').join('\t'))).toThrow(/5000/);
  });

  it('金额拒绝不合法千分位且整批不变，全角合法金额按分精确保存', () => {
    const original = template();
    original.cells = [text('A1', '原内容'), number('B1', '9')];
    const before = structuredClone(original);
    expect(() => pasteCells(original, 'A1', '1.25\t12,34', 'money')).toThrow(/B1.*金额/);
    expect(original).toEqual(before);

    const fullWidth = pasteCells(original, 'A1', '１，２３４．５６', 'money');
    expect(at(fullWidth, 'A1')).toMatchObject({
      kind: 'money',
      source: '123456',
      unit: 'cents',
    });
    expect(original).toEqual(before);
  });

  it('超过5000行立即提示粘贴上限，后续坏字段和超长行列表不会触发其他错误', () => {
    expect(() => parseClipboard(`${'1\n'.repeat(5001)}"后续未闭合字段`)).toThrow(/5000/);
    expect(() => parseClipboard(Array<string>(150_000).fill('1').join('\n'))).toThrow(/5000/);
  });
});

describe('w_bb_def 撤销重做与区域格式', () => {
  it('一次批量粘贴作为一步撤销，撤销后新编辑清除旧重做分支', () => {
    const initial = template();
    const pasted = pasteCells(initial, 'A1', '项目\t1\n合计\t2');
    let history = recordEdit(createHistory(initial), pasted);
    expect(history.past).toHaveLength(1);
    history = undoEdit(history);
    expect(history.present).toEqual(initial);
    expect(history.future).toEqual([pasted]);
    expect(redoEdit(history).present).toEqual(pasted);
    const branch = pasteCells(history.present, 'C3', '新分支');
    history = recordEdit(history, branch);
    expect(history.future).toEqual([]);
    expect(redoEdit(history).present).toEqual(branch);
    expect(recordEdit(history, branch)).toBe(history);
  });

  it('区域字体边框一次应用且可整次撤销，未选择格和原定义保持不变', () => {
    const initial = template();
    const changed = applyStyle(initial, ['A1', 'B1'], {
      fontFamily: '仿宋',
      fontSize: 16,
      bold: true,
      italic: true,
      borderBottom: 'double',
      color: '#123456',
    });
    expect(changed.styles).toHaveLength(2);
    expect(
      changed.styles.every(
        (s) => s.fontSize === 16 && s.fontFamily === '仿宋' && s.borderBottom === 'double',
      ),
    ).toBe(true);
    expect(initial.styles).toEqual([]);
    const history = recordEdit(createHistory(initial), changed);
    expect(undoEdit(history).present.styles).toEqual([]);
    expect(() => applyStyle(initial, ['Z999'], { bold: true })).toThrow(/边界/);
  });

  it('历史最多保留100步且边界上的撤销重做为无操作', () => {
    let history = createHistory(template());
    expect(undoEdit(history)).toBe(history);
    expect(redoEdit(history)).toBe(history);
    for (let i = 0; i < 105; i++)
      history = recordEdit(history, { ...history.present, name: `修改${i}` });
    expect(history.past).toHaveLength(100);
    expect(history.past[0]?.name).toBe('修改4');
  });
});
