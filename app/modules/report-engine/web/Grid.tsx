import { Input, InputNumber, Space, Typography } from 'antd';
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { MoneyInput, MoneyText } from '@caiwu/ui';
import { balanceSide } from '@caiwu/core';
import {
  columnName,
  type Cell,
  type CellStyle,
  type ReportSnapshot,
  type ReportTemplate,
} from '../shared';
import { displayValue } from './format';

export { displayValue } from './format';

function borderCss(style: CellStyle['borderTop']) {
  switch (style) {
    case 'none':
      return 'none';
    case 'thin':
      return '1px solid #262626';
    case 'medium':
      return '2px solid #262626';
    case 'dashed':
      return '1px dashed #262626';
    case 'double':
      return '3px double #262626';
    default:
      return '1px solid #d9d9d9';
  }
}

export function ReportGrid({
  template,
  snapshot,
  selected,
  onSelect,
  onChange,
  onPaste,
  disabled = false,
}: {
  template: ReportTemplate;
  snapshot?: ReportSnapshot;
  selected?: string;
  onSelect?(address: string): void;
  onChange?(cell: Cell): void;
  onPaste?(address: string, text: string): void;
  disabled?: boolean;
}) {
  const [requestedRowStart, setRowStart] = useState(1);
  const [requestedColStart, setColStart] = useState(1);
  // 删除末尾行列后仍展示有效窗口；保留请求值以便撤销时恢复原查看位置。
  const rowStart = Math.max(1, Math.min(template.rows, requestedRowStart));
  const colStart = Math.max(1, Math.min(template.cols, requestedColStart));
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
                    const col = j + colStart;
                    const merged = template.merges.find(
                      (m) =>
                        row >= m.row &&
                        row < m.row + m.rows &&
                        col >= m.col &&
                        col < m.col + m.cols,
                    );
                    // 视窗落在合并区内部时，在可见左上角呈现原锚点，而非留下空洞。
                    if (
                      merged &&
                      (Math.max(merged.row, rowStart) !== row ||
                        Math.max(merged.col, colStart) !== col)
                    )
                      return null;
                    const address = merged
                      ? `${columnName(merged.col)}${merged.row}`
                      : `${columnName(col)}${row}`;
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
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        fontWeight: 'inherit',
                        fontStyle: 'inherit',
                        textDecoration: 'inherit',
                        color: 'inherit',
                        minHeight: 32,
                      },
                      onFocus: () => onSelect?.(address),
                      onPaste: (e: ClipboardEvent<HTMLInputElement>) => {
                        if (disabled) {
                          e.preventDefault();
                          return;
                        }
                        const text = e.clipboardData.getData('text/plain');
                        if (onPaste && /[\t\r\n]/.test(text)) {
                          e.preventDefault();
                          onPaste(address, text);
                        }
                      },
                      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
                        rowSpan={
                          merged ? Math.min(merged.row + merged.rows - row, rowEnd - row + 1) : 1
                        }
                        colSpan={
                          merged ? Math.min(merged.col + merged.cols - col, colEnd - col + 1) : 1
                        }
                        style={{
                          borderTop: borderCss(style?.borderTop),
                          borderRight: borderCss(style?.borderRight),
                          borderBottom: borderCss(style?.borderBottom),
                          borderLeft: borderCss(style?.borderLeft),
                          outline: selected === address ? '2px solid #1677ff' : undefined,
                          outlineOffset: -2,
                          textAlign: style?.align ?? 'left',
                          whiteSpace: style?.wrap ? 'pre-wrap' : 'nowrap',
                          fontWeight: style?.bold ? 'bold' : 'normal',
                          fontFamily: style?.fontFamily ?? '宋体',
                          fontSize: `${style?.fontSize ?? 11}pt`,
                          fontStyle: style?.italic ? 'italic' : 'normal',
                          textDecoration: style?.underline ? 'underline' : 'none',
                          color: style?.color,
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
