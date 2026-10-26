import { Input, InputNumber, Space, Typography } from 'antd';
import Decimal from 'decimal.js';
import { useRef, useState, type KeyboardEvent } from 'react';
import { MoneyInput, MoneyText } from '@caiwu/ui';
import { balanceSide } from '@caiwu/core';
import {
  columnName,
  type Cell,
  type ReportSnapshot,
  type ReportTemplate,
  type ResultCell,
} from '../shared';

export function displayValue(c: ResultCell, format = 'general') {
  if (c.unit === 'text') return c.value;
  const amount = new Decimal(c.value);
  const n = ['cents', 'foreignCents'].includes(c.unit) ? amount.div(100) : amount;
  return format === 'percent'
    ? `${n.times(100).toFixed(2)}%`
    : format === 'decimal2' || ['cents', 'foreignCents'].includes(c.unit)
      ? n.toFixed(2)
      : n.toFixed();
}
export function ReportGrid({
  template,
  snapshot,
  selected,
  onSelect,
  onChange,
  disabled = false,
}: {
  template: ReportTemplate;
  snapshot?: ReportSnapshot;
  selected?: string;
  onSelect?(address: string): void;
  onChange?(cell: Cell): void;
  disabled?: boolean;
}) {
  const [rowStart, setRowStart] = useState(1);
  const [colStart, setColStart] = useState(1);
  const grid = useRef<HTMLDivElement>(null);
  const cells = new Map(template.cells.map((c) => [c.address, c]));
  const results = new Map(snapshot?.cells.map((c) => [c.address, c]));
  const styles = new Map(template.styles.map((c) => [c.address, c]));
  const rowEnd = Math.min(template.rows, rowStart + 29),
    colEnd = Math.min(template.cols, colStart + 19);
  const focus = (row: number, col: number, dr = 0, dc = 0) => {
    while (row >= 1 && row <= template.rows && col >= 1 && col <= template.cols) {
      const hidden = template.merges.some(
        (m) =>
          row >= m.row &&
          row < m.row + m.rows &&
          col >= m.col &&
          col < m.col + m.cols &&
          (row !== m.row || col !== m.col),
      );
      if (!hidden) break;
      row += dr;
      col += dc;
    }
    if (row < 1 || col < 1 || row > template.rows || col > template.cols) return;
    const address = `${columnName(col)}${row}`;
    if (row < rowStart || row > rowEnd) setRowStart(Math.max(1, row - 14));
    if (col < colStart || col > colEnd) setColStart(Math.max(1, col - 9));
    onSelect?.(address);
    setTimeout(
      () =>
        grid.current?.querySelector<HTMLInputElement>(`input[aria-label="${address}"]`)?.focus(),
      0,
    );
  };
  return (
    <>
      {(template.rows > 30 || template.cols > 20) && (
        <Space style={{ marginBlock: 8 }}>
          <Typography.Text>网格窗口起始行</Typography.Text>
          <InputNumber
            aria-label="网格起始行"
            min={1}
            max={template.rows}
            value={rowStart}
            onChange={(n) => setRowStart(n ?? 1)}
          />
          <Typography.Text>起始列</Typography.Text>
          <InputNumber
            aria-label="网格起始列"
            min={1}
            max={template.cols}
            value={colStart}
            onChange={(n) => setColStart(n ?? 1)}
          />
          <span>
            当前 {rowStart}–{rowEnd} 行 / {columnName(colStart)}–{columnName(colEnd)}{' '}
            列；方向键可继续移动
          </span>
        </Space>
      )}
      <div
        ref={grid}
        style={{ overflow: 'auto', maxHeight: 620, border: '1px solid #d9d9d9', marginBlock: 12 }}
      >
        <table
          aria-label={snapshot ? '报表结果网格' : '报表定义网格'}
          style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '100%' }}
        >
          <colgroup>
            <col style={{ width: 44 }} />
            {Array.from({ length: colEnd - colStart + 1 }, (_, i) => {
              const col = colStart + i;
              return (
                <col
                  key={col}
                  style={{ width: template.colWidths.find((c) => c.col === col)?.width ?? 160 }}
                />
              );
            })}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">行</th>
              {Array.from({ length: colEnd - colStart + 1 }, (_, i) => (
                <th
                  key={i}
                  scope="col"
                  style={{ border: '1px solid #d9d9d9', background: '#f5f5f5' }}
                >
                  {columnName(i + colStart)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowEnd - rowStart + 1 }, (_, i) => {
              const row = i + rowStart;
              return (
                <tr
                  key={row}
                  style={{ height: template.rowHeights.find((r) => r.row === row)?.height ?? 36 }}
                >
                  <th scope="row" style={{ background: '#f5f5f5' }}>
                    {row}
                  </th>
                  {Array.from({ length: colEnd - colStart + 1 }, (_, j) => {
                    const col = j + colStart,
                      address = `${columnName(col)}${row}`;
                    const merged = template.merges.find(
                      (m) =>
                        row >= m.row &&
                        row < m.row + m.rows &&
                        col >= m.col &&
                        col < m.col + m.cols,
                    );
                    if (merged && (merged.row !== row || merged.col !== col)) return null;
                    const cell = cells.get(address) ?? {
                      address,
                      kind: 'text',
                      source: '',
                      unit: 'number',
                      currency: 'CNY',
                    };
                    const style = styles.get(address),
                      result = results.get(address);
                    const money = result && ['cents', 'foreignCents'].includes(result.unit);
                    const inputProps = {
                      'aria-label': address,
                      readOnly: disabled,
                      variant: 'borderless' as const,
                      style: {
                        textAlign: style?.align ?? 'left',
                        fontWeight: style?.bold ? ('bold' as const) : ('normal' as const),
                        minHeight: 32,
                      },
                      onFocus: () => onSelect?.(address),
                      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
                        const move: Record<string, [number, number]> = {
                          ArrowDown: [1, 0],
                          Enter: [1, 0],
                          ArrowUp: [-1, 0],
                          ArrowLeft: [0, -1],
                          ArrowRight: [0, 1],
                        };
                        const delta = move[e.key];
                        if (delta) {
                          e.preventDefault();
                          focus(row + delta[0], col + delta[1], ...delta);
                        }
                      },
                    };
                    return (
                      <td
                        key={col}
                        rowSpan={merged ? Math.min(merged.rows, rowEnd - row + 1) : 1}
                        colSpan={merged ? Math.min(merged.cols, colEnd - col + 1) : 1}
                        style={{
                          border: selected === address ? '2px solid #1677ff' : '1px solid #d9d9d9',
                          textAlign: style?.align ?? 'left',
                          whiteSpace: style?.wrap ? 'pre-wrap' : 'nowrap',
                          fontWeight: style?.bold ? 'bold' : 'normal',
                          padding: snapshot ? '6px 8px' : 0,
                        }}
                      >
                        {snapshot ? (
                          <span
                            data-testid={`result-${address}`}
                            title={
                              money
                                ? cell.source.includes('"normal"')
                                  ? '按公式指定的科目正常方向取值；金额原值为分'
                                  : `${balanceSide(Number(result.value), 'debit').side}；有符号净额借正贷负；金额原值为分`
                                : undefined
                            }
                          >
                            {money && style?.format !== 'percent' ? (
                              <MoneyText value={Number(result.value)} />
                            ) : result ? (
                              displayValue(result, style?.format)
                            ) : (
                              ''
                            )}
                          </span>
                        ) : cell.kind === 'money' ? (
                          <MoneyInput
                            {...inputProps}
                            value={Number(cell.source)}
                            onChange={(cents) =>
                              onChange?.({ ...cell, source: String(cents ?? 0) })
                            }
                          />
                        ) : (
                          <Input
                            {...inputProps}
                            value={cell.source}
                            onChange={(e) => {
                              const source = e.target.value;
                              onChange?.({
                                ...cell,
                                source,
                                ...(source.startsWith('=')
                                  ? {
                                      kind: 'formula' as const,
                                      unit: cell.unit === 'number' ? ('cents' as const) : cell.unit,
                                    }
                                  : {}),
                              });
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
