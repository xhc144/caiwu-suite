import { parseMoney } from '@caiwu/core';
import {
  columnName,
  coordinates,
  ReportTemplateSchema,
  type Cell,
  type ReportTemplate,
} from '../shared';

export type PasteMode = 'target' | Cell['kind'];

/** Excel/表格的制表符文本；双引号包裹的字段可包含换行、制表符和双引号。 */
function tableText(raw: string): string[][] {
  if (!raw || raw.length > 1_000_000) throw new Error('请粘贴非空文本，最多1MB');
  const text = raw.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false,
    closed = false,
    count = 0;
  const field = () => {
    if (++count > 500) throw new Error('每次最多粘贴500个单元格，请分批操作');
    if (value.length > 2000) throw new Error('单元格内容最多2000字');
    row.push(value);
    value = '';
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += ch;
    } else if (ch === '\t' || ch === '\n') {
      field();
      if (ch === '\n') {
        rows.push(row);
        row = [];
      }
    } else if (ch === '"' && !value && !closed) quoted = true;
    else {
      if (closed) throw new Error('引号字段结束后只能接制表符或换行');
      value += ch;
    }
  }
  if (quoted) throw new Error('粘贴文本中有未结束的引号字段');
  if (row.length || value || closed || !text.endsWith('\n')) {
    field();
    rows.push(row);
  }
  if (!rows.length || rows.some((r) => r.length !== rows[0]!.length))
    throw new Error('每行列数须相同，请粘贴完整矩形区域');
  return rows;
}

export function preparePaste(
  template: ReportTemplate,
  start: string,
  raw: string,
  mode: PasteMode,
) {
  const matrix = tableText(raw),
    origin = coordinates(start);
  const endRow = origin.row + matrix.length - 1,
    endCol = origin.col + matrix[0]!.length - 1;
  if (!origin.row || endRow > template.rows || endCol > template.cols)
    throw new Error('粘贴范围超出报表行列边界，请先扩大报表尺寸');
  if (
    template.merges.some(
      (m) =>
        m.row <= endRow &&
        m.row + m.rows > origin.row &&
        m.col <= endCol &&
        m.col + m.cols > origin.col,
    )
  )
    throw new Error('粘贴范围包含合并单元格，请先拆分后再粘贴');
  const cells = new Map(template.cells.map((c) => [c.address, c]));
  const changes: Cell[] = [];
  let overwritten = 0;
  matrix.forEach((row, r) =>
    row.forEach((input, c) => {
      const address = `${columnName(origin.col + c)}${origin.row + r}`;
      const old = cells.get(address);
      if (old?.source) overwritten++;
      cells.delete(address);
      if (input === '') return;
      const kind = mode === 'target' ? (old?.kind ?? 'text') : mode;
      const unit =
        kind === 'text'
          ? 'number'
          : kind === 'money'
            ? old?.unit === 'foreignCents'
              ? 'foreignCents'
              : 'cents'
            : kind === 'number'
              ? old?.unit === 'quantity'
                ? 'quantity'
                : 'number'
              : (old?.unit ?? 'cents');
      let source = input;
      if (kind === 'money') {
        let cents: number | null;
        try {
          cents = parseMoney(input);
        } catch {
          cents = null;
        }
        if (cents == null)
          throw new Error(`${address}：金额须为有效的元金额，且转换后不能超出安全整数分`);
        source = String(cents);
      }
      const cell: Cell = {
        address,
        kind,
        source,
        unit,
        currency: unit === 'foreignCents' ? (old?.currency ?? 'CNY') : 'CNY',
      };
      cells.set(address, cell);
      changes.push(cell);
    }),
  );
  const parsed = ReportTemplateSchema.safeParse({ ...template, cells: [...cells.values()] });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('；'));
  return {
    template: parsed.data,
    changes,
    count: matrix.length * matrix[0]!.length,
    overwritten,
    range: `${start}:${columnName(endCol)}${endRow}`,
  };
}
