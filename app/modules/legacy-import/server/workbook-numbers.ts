import { Decimal } from '@caiwu/core';

/** 在 ExcelJS 加载前受限扫描 XML 索引/范围与原始数字；不保留 XML 全文。 */
export class WorkbookNumberError extends Error {
  constructor(
    readonly entry: string,
    readonly address: string,
    message: string,
  ) {
    super(message);
  }
}

function xmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1]?.toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      if (
        !Number.isInteger(code) ||
        code < 1 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      )
        throw new Error('工作表含无效字符引用，请重新另存');
      return String.fromCodePoint(code);
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[
      entity.toLowerCase()
    ]!;
  });
}

export type WorkbookXmlBudget = {
  nodes: number;
  rows: number;
  cells: number;
  strings: number;
  mergeCount: number;
  rangeCells: number;
  columns: number;
  worksheets: number;
};
export const workbookXmlBudget = (): WorkbookXmlBudget => ({
  nodes: 0,
  rows: 0,
  cells: 0,
  strings: 0,
  mergeCount: 0,
  rangeCells: 0,
  columns: 0,
  worksheets: 0,
});

export function workbookNumberInspector(entry: string, budget = workbookXmlBudget()) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const worksheet = /xl\/worksheets\/sheet\d+[.]xml/.test(entry);
  if (worksheet && ++budget.worksheets > 16)
    throw new WorkbookNumberError(entry, '', '工作簿超过16张工作表，请分批导入');
  let buffer = '',
    mode: 'text' | 'comment' | 'cdata' | 'pi' = 'text';
  let cellType: string | null = null,
    address = '',
    value: string | null = null;
  let numericValueSeen = false;
  let rowMaximum = 0,
    rowCount = 0,
    definedName: string | null = null;
  const reject = (message: string): never => {
    throw new WorkbookNumberError(entry, address, message);
  };
  const append = (text: string) => {
    if (definedName != null) {
      if (definedName.length + text.length > 4000) reject('工作簿定义名称过长，请另存纯数据表');
      definedName += text;
    }
    if (value == null) return;
    if (value.length + text.length > 4000) reject('数值单元格原文超过4000字，请改为文本并核对');
    value += text;
  };
  const finishValue = () => {
    const raw = xmlText(value ?? '').trim();
    value = null;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw))
      reject('数值单元格原文不是合法数字，请改为文本并核对');
    const digits = raw
      .split(/[eE]/)[0]!
      .replace(/^[+-]/, '')
      .replace('.', '')
      .replace(/^0+/, '')
      .replace(/0+$/, '');
    const number = Number(raw);
    if (
      digits.length > 15 ||
      !Number.isFinite(number) ||
      (number === 0 && digits.length > 0) ||
      (digits.length > 0 && !new Decimal(raw).eq(new Decimal(String(number))))
    )
      reject('数值超出 Excel 精确位数或转换会损失精度，请改为文本后重新导出');
  };
  const attributes = (text: string) => {
    const values = new Map<string, string>();
    let rest = text;
    while (rest.trim()) {
      const match = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(["'])/.exec(rest);
      if (!match) reject('工作表属性损坏，请重新另存');
      const start = match![0].length,
        end = rest.indexOf(match![2]!, start),
        key = match![1]!;
      if (end < 0 || values.has(key)) reject('工作表属性缺失或重复，请重新另存');
      values.set(key, xmlText(rest.slice(start, end)));
      rest = rest.slice(end + 1);
    }
    return values;
  };
  const position = (source: string) => {
    const match = /^\$?([A-Z]+)\$?([1-9]\d*)$/i.exec(source);
    if (!match) reject('工作表单元格地址无效，请重新另存');
    let col = 0;
    for (const c of match![1]!.toUpperCase()) {
      col = col * 26 + c.charCodeAt(0) - 64;
      if (col > 64) reject('工作表地址超过64列，请分批导入');
    }
    const row = Number(match![2]);
    if (!Number.isSafeInteger(row) || row > 50004) reject('工作表地址超过50000行，请分批导入');
    return { row, col };
  };
  const countRow = (row: number) => {
    if (!Number.isSafeInteger(row) || row < 1 || row > 50004)
      reject('工作表行号超过50000行或无效，请分批导入');
    if (row > rowMaximum) {
      budget.rows += row - rowMaximum;
      rowMaximum = row;
    }
    if (budget.rows > 50004) reject('工作簿实际行数超过50000行，请分批导入');
  };
  const range = (source: string, expand = false, merge = false) => {
    const parts = source.split(':');
    if (parts.length > 2) reject('工作簿单元格范围无效，请重新另存');
    const first = position(parts[0]!),
      last = position(parts[1] ?? parts[0]!);
    const area = (Math.abs(last.row - first.row) + 1) * (Math.abs(last.col - first.col) + 1);
    if (merge && area > 4096) reject('合并单元格范围过大，请取消合并后重新导入');
    if (expand) {
      budget.rangeCells += area;
      if (budget.rangeCells > 250000) reject('工作簿展开范围累计超过25万格，请另存纯数据表');
    }
  };
  const finishDefinedName = () => {
    const source = xmlText(definedName ?? '');
    definedName = null;
    // ExcelJS DefinedNames.model 对带美元地址的范围逐格分配，不能只限制字符串长度。
    for (const part of source.split(',')) {
      const ref = part.slice(part.lastIndexOf('!') + 1).trim();
      if (/^\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?$/i.test(ref) || /\$\w+\$\d+/.test(ref))
        range(ref, true);
    }
  };
  const tag = (text: string) => {
    const match = /^\s*(\/?)\s*([A-Za-z_][\w:.-]*)([\s\S]*?)\s*(\/?)\s*$/.exec(text);
    if (!match) reject('工作表标记损坏，请重新另存');
    const name = match![2]!.split(':').at(-1),
      closing = match![1] === '/',
      empty = match![4] === '/';
    if (!closing && ++budget.nodes > 1000000) reject('工作簿XML节点超过100万，请分批导入');
    if (name === 'definedName') {
      if (closing) finishDefinedName();
      else {
        if (definedName != null) reject('工作簿定义名称不能嵌套');
        definedName = '';
        if (empty) finishDefinedName();
      }
    }
    if (name === 'si' && !closing && ++budget.strings > 250000)
      reject('工作簿共享文本超过25万项，请分批导入');
    if (!worksheet) return;
    const attrs =
      !closing &&
      ['row', 'c', 'col', 'mergeCell', 'dataValidation', 'dimension', 'hyperlink'].includes(
        name ?? '',
      )
        ? attributes(match![3]!)
        : undefined;
    if (!closing && name === 'row') {
      rowCount++;
      if (attrs?.has('r') && !/^[1-9]\d*$/.test(attrs.get('r')!))
        reject('工作表行号格式无效，请重新另存');
      countRow(attrs?.has('r') ? Number(attrs.get('r')) : rowCount);
    }
    if (!closing && name === 'c') {
      if (++budget.cells > 250000) reject('工作簿单元格超过25万格，请分批导入');
      if (attrs?.has('r')) {
        address = attrs.get('r')!;
        countRow(position(address).row);
      }
    }
    if (!closing && name === 'col') {
      if (
        !/^[1-9]\d*$/.test(attrs?.get('min') ?? '') ||
        !/^[1-9]\d*$/.test(attrs?.get('max') ?? '')
      )
        reject('工作表列格式范围无效，请重新另存');
      const min = Number(attrs?.get('min')),
        max = Number(attrs?.get('max'));
      if (
        !Number.isSafeInteger(min) ||
        !Number.isSafeInteger(max) ||
        min < 1 ||
        max < min ||
        max > 64
      )
        reject('工作表列格式范围超过64列或无效，请分批导入');
      if (++budget.columns > 1024) reject('工作簿列格式定义过多，请另存纯数据表');
    }
    if (!closing && name === 'mergeCell') {
      if (++budget.mergeCount > 256) reject('工作簿合并范围超过256项，请取消合并后导入');
      range(attrs?.get('ref') ?? '', true, true);
    }
    if (!closing && name === 'dataValidation')
      for (const ref of (attrs?.get('sqref') ?? '').trim().split(/\s+/)) range(ref, true);
    if (!closing && ['dimension', 'hyperlink'].includes(name ?? '') && attrs?.has('ref'))
      range(attrs.get('ref')!);
    if (cellType === 'n' && !['c', 'v', 'f'].includes(name ?? ''))
      reject('数值单元格不能包含文本或其他子标记，请重新另存');
    if (name === 'c') {
      if (value != null) reject('数值单元格标记损坏，请重新另存');
      if (!closing && cellType != null) reject('工作表单元格不能嵌套，请重新另存');
      if (closing || empty) cellType = null;
      else {
        cellType = attrs!.get('t') ?? 'n';
        address = attrs!.get('r') ?? '';
        numericValueSeen = false;
        if (!['n', 's', 'b', 'e', 'str', 'inlineStr'].includes(cellType))
          reject('单元格类型不受支持，请改为文本');
      }
    } else if (name === 'v' && cellType === 'n') {
      if (closing) {
        if (value == null) reject('数值单元格标记损坏，请重新另存');
        finishValue();
      } else {
        if (value != null) reject('数值单元格标记嵌套，请重新另存');
        if (numericValueSeen) reject('数值单元格不能包含多个数值节点，请重新另存');
        numericValueSeen = true;
        value = '';
        if (empty) finishValue();
      }
    } else if (value != null) reject('数值单元格中有嵌套标记，请重新另存');
  };
  const consume = () => {
    while (buffer) {
      if (mode !== 'text') {
        const terminal = mode === 'comment' ? '-->' : mode === 'cdata' ? ']]>' : '?>';
        const end = buffer.indexOf(terminal);
        if (end < 0) {
          const keep = Math.min(terminal.length - 1, buffer.length);
          if (mode === 'cdata') append(buffer.slice(0, buffer.length - keep));
          buffer = buffer.slice(buffer.length - keep);
          return;
        }
        if (mode === 'cdata') append(buffer.slice(0, end));
        buffer = buffer.slice(end + terminal.length);
        mode = 'text';
        continue;
      }
      const start = buffer.indexOf('<');
      if (start < 0) {
        append(buffer);
        buffer = '';
        return;
      }
      if (start > 0) {
        append(buffer.slice(0, start));
        buffer = buffer.slice(start);
      }
      if (
        ['<!--', '<![CDATA[', '<?'].some((prefix) => prefix.startsWith(buffer) && prefix !== buffer)
      )
        return;
      if (buffer.startsWith('<!--')) {
        buffer = buffer.slice(4);
        mode = 'comment';
        continue;
      }
      if (buffer.startsWith('<![CDATA[')) {
        reject('工作簿不支持CDATA，无法保证数值精确位数或文本完整，请重新另存');
      }
      if (buffer.startsWith('<?')) {
        buffer = buffer.slice(2);
        mode = 'pi';
        continue;
      }
      if (buffer.startsWith('<!')) reject('不支持工作表文档类型声明，请重新另存');
      let quote = '',
        end = -1;
      for (let i = 1; i < buffer.length; i++) {
        const c = buffer[i]!;
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') {
          end = i;
          break;
        }
      }
      if (end < 0) {
        if (buffer.length > 4096) reject('工作表标记过长，请重新另存');
        return;
      }
      if (end > 4096) reject('工作表标记过长，请重新另存');
      tag(buffer.slice(1, end));
      buffer = buffer.slice(end + 1);
    }
  };
  const decode = (chunk?: Buffer, stream = false) => {
    try {
      buffer += decoder.decode(chunk, { stream });
    } catch {
      reject('工作表 XML 编码无效，请重新另存为 Excel 工作簿');
    }
    consume();
  };
  return {
    write(chunk: Buffer) {
      decode(chunk, true);
    },
    end() {
      decode();
      if (buffer || mode !== 'text' || value != null || definedName != null)
        reject('工作表 XML 不完整，请重新另存');
    },
  };
}
