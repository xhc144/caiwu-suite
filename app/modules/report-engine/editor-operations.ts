import Decimal from 'decimal.js';
import {
  columnName,
  coordinates,
  ReportTemplateSchema,
  type Cell,
  type CellStyle,
  type ReportTemplate,
} from './shared';
import { rewriteReferences } from './editor-references';

export type StructureChange = {
  axis: 'row' | 'col';
  kind: 'insert' | 'delete';
  index: number;
  count: number;
};

function checked(template: ReportTemplate) {
  const parsed = ReportTemplateSchema.safeParse(template);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('；'));
  return parsed.data;
}

function position(n: number, change: StructureChange): number | null {
  if (change.kind === 'insert') return n >= change.index ? n + change.count : n;
  if (n >= change.index && n < change.index + change.count) return null;
  return n >= change.index + change.count ? n - change.count : n;
}

function interval(start: number, length: number, change: StructureChange) {
  const end = start + length - 1;
  if (change.kind === 'insert') {
    return {
      start: start >= change.index ? start + change.count : start,
      length: start < change.index && end >= change.index ? length + change.count : length,
    };
  }
  const removed = Math.max(
    0,
    Math.min(end, change.index + change.count - 1) - Math.max(start, change.index) + 1,
  );
  return {
    start: start >= change.index ? Math.max(change.index, start - change.count) : start,
    length: length - removed,
  };
}

/** 先计算整个候选定义，校验通过才替换；任何引用或边界错误都不产生半次编辑。 */
export function changeStructure(template: ReportTemplate, change: StructureChange): ReportTemplate {
  const size = change.axis === 'row' ? template.rows : template.cols;
  if (
    !Number.isInteger(change.index) ||
    !Number.isInteger(change.count) ||
    change.count < 1 ||
    change.index < 1 ||
    change.index > size + (change.kind === 'insert' ? 1 : 0)
  )
    throw new Error('插删位置或数量不正确，请重新选择行列');
  if (change.kind === 'delete' && change.index + change.count - 1 > size)
    throw new Error('删除范围超出报表，请减少删除数量');
  const nextSize = size + (change.kind === 'insert' ? change.count : -change.count);
  const limit = change.axis === 'row' ? 999 : 250;
  if (nextSize < 1 || nextSize > limit)
    throw new Error(
      `报表必须保留至少一${change.axis === 'row' ? '行' : '列'}，且不能超过${limit}${change.axis === 'row' ? '行' : '列'}`,
    );
  const address = (a: string) => {
    const p = coordinates(a);
    const next = position(p[change.axis], change);
    if (next === null) return null;
    return change.axis === 'row' ? `${columnName(p.col)}${next}` : `${columnName(next)}${p.row}`;
  };
  const cells = template.cells.flatMap((cell) => {
    const next = address(cell.address);
    if (!next) return [];
    return [
      {
        ...cell,
        address: next,
        source:
          cell.kind === 'formula'
            ? rewriteReferences(cell.source, change, template.code)
            : cell.source,
      },
    ];
  });
  const styles = template.styles.flatMap((style) => {
    const next = address(style.address);
    return next ? [{ ...style, address: next }] : [];
  });
  const merges = template.merges.flatMap((merge) => {
    const transformed = interval(
      merge[change.axis],
      change.axis === 'row' ? merge.rows : merge.cols,
      change,
    );
    if (transformed.length <= 0) return [];
    const next = {
      ...merge,
      [change.axis]: transformed.start,
      [change.axis === 'row' ? 'rows' : 'cols']: transformed.length,
    };
    return next.rows === 1 && next.cols === 1 ? [] : [next];
  });
  const next: ReportTemplate = {
    ...template,
    [change.axis === 'row' ? 'rows' : 'cols']: nextSize,
    cells,
    styles,
    merges,
    checks: template.checks.map((check) => ({
      ...check,
      left: rewriteReferences(check.left, change, template.code),
      right: rewriteReferences(check.right, change, template.code),
      ...(check.condition !== undefined
        ? { condition: rewriteReferences(check.condition, change, template.code) }
        : {}),
    })),
    rowHeights:
      change.axis !== 'row'
        ? template.rowHeights
        : template.rowHeights.flatMap((item) => {
            const row = position(item.row, change);
            return row === null ? [] : [{ ...item, row }];
          }),
    colWidths:
      change.axis !== 'col'
        ? template.colWidths
        : template.colWidths.flatMap((item) => {
            const col = position(item.col, change);
            return col === null ? [] : [{ ...item, col }];
          }),
  };
  if (template.print && change.axis === 'row') {
    const repeatRows =
      template.print.repeatRows === 0
        ? 0
        : change.kind === 'insert' && change.index <= template.print.repeatRows
          ? template.print.repeatRows + change.count
          : interval(1, template.print.repeatRows, change).length;
    next.print = {
      ...template.print,
      repeatRows: Math.min(repeatRows, next.rows - 1),
      rowBreaks: [
        ...new Set(template.print.rowBreaks.map((n) => position(n, change) ?? change.index)),
      ]
        .filter((n) => n > repeatRows && n > 1 && n <= next.rows)
        .sort((a, b) => a - b),
    };
  }
  return checked(next);
}

/** Excel/表格复制的文本支持引号、字段内换行和双引号转义。 */
export function parseClipboard(text: string): string[][] {
  if (text.length > 1_000_000) throw new Error('粘贴内容过大，请分批粘贴');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(field);
    if (row.length > 5000) throw new Error('一次最多粘贴5000个单元格，请分批粘贴');
    field = '';
    closed = false;
  };
  const line = () => {
    cell();
    rows.push(row);
    if (rows.length > 5000) throw new Error('一次最多粘贴5000个单元格，请分批粘贴');
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        closed = true;
      } else field += ch;
      continue;
    }
    if (closed && !['\t', '\r', '\n'].includes(ch))
      throw new Error('粘贴文本的引号格式不完整，请重新从表格复制');
    if (ch === '"' && field === '' && !closed) quoted = true;
    else if (ch === '\t') cell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line();
    } else field += ch;
  }
  if (quoted) throw new Error('粘贴文本的引号未闭合，请重新从表格复制');
  if (field !== '' || row.length > 0 || rows.length === 0 || closed) line();
  const width = Math.max(...rows.map((r) => r.length));
  if (rows.length * width > 5000) throw new Error('一次最多粘贴5000个单元格，请分批粘贴');
  return rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
}

export type PasteMode = 'auto' | 'text' | 'money' | 'number';
export function rangeAddresses(template: ReportTemplate, range: string) {
  const parts = range.trim().toUpperCase().split(':');
  const a = coordinates(parts[0] ?? ''),
    b = coordinates(parts[1] ?? parts[0] ?? '');
  if (
    parts.length > 2 ||
    a.row < 1 ||
    a.col < 1 ||
    b.row < a.row ||
    b.col < a.col ||
    b.row > template.rows ||
    b.col > template.cols
  )
    throw new Error('格式范围须为报表内的单元格或区域，例如 A1 或 A1:C3');
  if ((b.row - a.row + 1) * (b.col - a.col + 1) > 5000)
    throw new Error('一次最多设置5000个单元格的格式，请分批设置');
  return Array.from({ length: b.row - a.row + 1 }, (_, i) =>
    Array.from({ length: b.col - a.col + 1 }, (_, j) => `${columnName(a.col + j)}${a.row + i}`),
  ).flat();
}
export function pasteCells(
  template: ReportTemplate,
  start: string,
  text: string,
  mode: PasteMode = 'auto',
): ReportTemplate {
  const data = parseClipboard(text),
    p = coordinates(start);
  if (
    p.row < 1 ||
    p.col < 1 ||
    p.row + data.length - 1 > template.rows ||
    p.col + data[0]!.length - 1 > template.cols
  )
    throw new Error('粘贴范围超出报表边界，请先增加行列或选择更靠前的起始单元格');
  const cells = new Map(template.cells.map((c) => [c.address, c]));
  data.forEach((row, i) =>
    row.forEach((raw, j) => {
      const row = p.row + i,
        col = p.col + j,
        address = `${columnName(col)}${row}`;
      if (
        template.merges.some(
          (m) =>
            row >= m.row &&
            row < m.row + m.rows &&
            col >= m.col &&
            col < m.col + m.cols &&
            (row !== m.row || col !== m.col),
        )
      )
        throw new Error(`粘贴范围包含合并单元格内部 ${address}，请先拆分合并`);
      if (raw === '') {
        cells.delete(address);
        return;
      }
      const old = cells.get(address);
      const base = { address, currency: old?.currency ?? 'CNY' };
      let cell: Cell;
      if (mode === 'text') cell = { ...base, kind: 'text', source: raw, unit: 'number' };
      else if (mode === 'auto' && raw.startsWith('='))
        cell = {
          ...base,
          kind: 'formula',
          source: raw,
          unit: old && old.kind !== 'text' ? old.unit : 'number',
        };
      else {
        const normalized = raw.trim().normalize('NFKC');
        const numeric = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized);
        const number = normalized.replaceAll(',', '');
        const money =
          mode === 'money' ||
          (mode === 'auto' &&
            old &&
            (old.kind === 'money' || ['cents', 'foreignCents'].includes(old.unit)));
        if (money || mode === 'number') {
          if (!numeric)
            throw new Error(`${address} 不是有效${money ? '金额' : '数值'}，本次粘贴未应用`);
          const n = new Decimal(number);
          if (money) {
            const cents = n.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
            if (!Number.isSafeInteger(cents.toNumber()))
              throw new Error(`${address} 金额超出可保存范围`);
            cell = {
              ...base,
              kind: 'money',
              source: cents.toFixed(0),
              unit: old?.unit === 'foreignCents' ? 'foreignCents' : 'cents',
            };
          } else
            cell = {
              ...base,
              kind: 'number',
              source: n.toFixed(),
              unit: old?.unit === 'quantity' ? 'quantity' : 'number',
            };
        } else if (numeric && mode === 'auto' && !/^0\d/.test(number))
          cell = { ...base, kind: 'number', source: new Decimal(number).toFixed(), unit: 'number' };
        else cell = { ...base, kind: 'text', source: raw, unit: 'number' };
      }
      cells.set(address, cell);
    }),
  );
  return checked({ ...template, cells: [...cells.values()] });
}

export function applyStyle(
  template: ReportTemplate,
  addresses: string[],
  patch: Partial<CellStyle>,
) {
  const styles = new Map(template.styles.map((s) => [s.address, s]));
  for (const address of addresses)
    styles.set(address, {
      align: 'left',
      wrap: false,
      bold: false,
      format: 'general',
      ...styles.get(address),
      ...patch,
      address,
    });
  return checked({ ...template, styles: [...styles.values()] });
}

export type EditorHistory = {
  past: ReportTemplate[];
  present: ReportTemplate;
  future: ReportTemplate[];
  changes: StructureChange[];
  pastChanges: StructureChange[][];
  futureChanges: StructureChange[][];
};
export const createHistory = (
  present: ReportTemplate,
  changes: StructureChange[] = [],
): EditorHistory => ({
  past: [],
  present,
  future: [],
  changes,
  pastChanges: [],
  futureChanges: [],
});
export function recordEdit(
  history: EditorHistory,
  present: ReportTemplate,
  change?: StructureChange,
): EditorHistory {
  if (JSON.stringify(history.present) === JSON.stringify(present)) return history;
  return {
    past: [...history.past.slice(-99), history.present],
    present,
    future: [],
    changes: change ? [...history.changes, change] : history.changes,
    pastChanges: [...history.pastChanges.slice(-99), history.changes],
    futureChanges: [],
  };
}
export function undoEdit(history: EditorHistory): EditorHistory {
  const present = history.past.at(-1);
  return present
    ? {
        past: history.past.slice(0, -1),
        present,
        future: [history.present, ...history.future],
        changes: history.pastChanges.at(-1) ?? [],
        pastChanges: history.pastChanges.slice(0, -1),
        futureChanges: [history.changes, ...history.futureChanges],
      }
    : history;
}
export function redoEdit(history: EditorHistory): EditorHistory {
  const present = history.future[0];
  return present
    ? {
        past: [...history.past.slice(-99), history.present],
        present,
        future: history.future.slice(1),
        changes: history.futureChanges[0] ?? [],
        pastChanges: [...history.pastChanges.slice(-99), history.changes],
        futureChanges: history.futureChanges.slice(1),
      }
    : history;
}
/** 从上次保存的操作路径走到当前路径，支持保存后撤销、分支编辑和草稿恢复。 */
export function structureDelta(saved: StructureChange[], current: StructureChange[]) {
  let common = 0;
  while (
    common < saved.length &&
    common < current.length &&
    JSON.stringify(saved[common]) === JSON.stringify(current[common])
  )
    common++;
  return [
    ...saved
      .slice(common)
      .reverse()
      .map((c) => ({
        ...c,
        kind: c.kind === 'insert' ? ('delete' as const) : ('insert' as const),
      })),
    ...current.slice(common),
  ];
}
