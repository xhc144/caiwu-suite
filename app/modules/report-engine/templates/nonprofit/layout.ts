import { emptyTemplate, ReportTemplateSchema, type ReportSnapshot } from '../../shared';
import type { Statement } from './model';

/** 唯一金额数据由同一有效快照提供；此处仅序列化布局，不再取数。 */
export function statementSnapshot(
  s: Statement,
  identity: { reportId: number; revision: number; generatedAt: string; id: number },
): ReportSnapshot {
  const cols = s.columns.length + 1,
    body = s.rows.length,
    notes = s.notes.length;
  const t = emptyTemplate({ code: s.code, name: s.name, rows: body + notes + 5, cols });
  t.readOnly = true;
  const cells: ReportSnapshot['cells'] = [];
  const text = (address: string, value: string) => {
    t.cells.push({ address, kind: 'text', source: value, unit: 'number', currency: 'CNY' });
    cells.push({ address, value, unit: 'text', currency: 'CNY' });
  };
  for (const [i, value] of [
    s.name,
    `编制单位：${s.organization}`,
    `${s.period.from}至${s.period.to}；单位：元`,
  ].entries()) {
    text(`A${i + 1}`, value);
    t.merges.push({ row: i + 1, col: 1, rows: 1, cols });
  }
  text('A4', '项目');
  s.columns.forEach((label, i) => text(`${String.fromCharCode(66 + i)}4`, label));
  s.rows.forEach((row, i) => {
    const r = i + 5;
    text(`A${r}`, row.label);
    row.values.forEach((n, j) => {
      const address = `${String.fromCharCode(66 + j)}${r}`;
      if (typeof n === 'string') text(address, n);
      else {
        if (!Number.isSafeInteger(n)) throw new Error(`${row.label}金额缺少真实来源`);
        t.cells.push({ address, kind: 'money', source: String(n), unit: 'cents', currency: 'CNY' });
        cells.push({ address, value: String(n), unit: 'cents', currency: 'CNY' });
      }
    });
  });
  s.notes.forEach((n, i) => {
    const row = body + i + 5;
    text(`A${row}`, n);
    t.merges.push({ row, col: 1, rows: 1, cols });
  });
  t.colWidths = Array.from({ length: cols }, (_, i) => ({
    col: i + 1,
    width: i === 0 ? 320 : cols > 7 ? 95 : cols > 4 ? 120 : 145,
  }));
  t.rowHeights = Array.from({ length: t.rows }, (_, i) => ({
    row: i + 1,
    height: i === 3 ? 58 : 28,
  }));
  t.styles = t.cells.map((c) => ({
    address: c.address,
    align: c.kind === 'money' ? 'right' : 'left',
    wrap: true,
    bold: Number(c.address.match(/\d+/)?.[0]) <= 4,
    format: c.kind === 'money' ? 'decimal2' : 'general',
  }));
  return {
    ...identity,
    period: s.period.to,
    includeUnposted: false,
    unpostedCount: s.unpostedCount,
    template: ReportTemplateSchema.parse(t),
    cells,
    checks: s.checks.map((c) => ({
      name: `${c.row}·${c.column}：${c.name}`,
      status: c.difference === 0 ? 'pass' : 'fail',
      difference: String(c.difference),
      tolerance: '0',
      reason: `${c.from}至${c.to}；${c.sources.join('；')}`,
    })),
    dependencies: [],
  };
}
