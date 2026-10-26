import { Button, Space, Table, Tooltip, type TableProps } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { DownloadOutlined } from '@ant-design/icons';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ThHTMLAttributes,
} from 'react';
import { MoneyText } from './money';
import { exportToExcel } from './excel';

export interface DataColumn<T> extends Omit<ColumnType<T>, 'title' | 'key'> {
  /** 稳定的列 key：用于记住列宽、导出 */
  key: string;
  title: string;
  /** 金额列（值是分）：右对齐、千分位、负数红字；导出为数字 */
  money?: boolean;
  /** 金额为 0 时显示空白 */
  blankZero?: boolean;
  /** 导出 Excel 时的取值；不给就用 dataIndex 对应的值 */
  exportValue?: (row: T) => string | number | null | undefined;
  /** 不参与导出 */
  noExport?: boolean;
}

export interface DataTableProps<T> extends Omit<TableProps<T>, 'columns' | 'title'> {
  /** 表格 id，用于记住用户拖动后的列宽（每台电脑本地保存） */
  tableId: string;
  columns: DataColumn<T>[];
  /** 给了就显示"导出 Excel"按钮，值是文件名 */
  exportName?: string;
  /** 表格上方右侧的工具按钮 */
  toolbar?: ReactNode;
  /** 表格区域高度；给了就启用虚拟滚动（大数据量用） */
  height?: number;
}

const WIDTH_KEY = (id: string) => `caiwu.table.${id}.widths`;

function loadWidths(id: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(WIDTH_KEY(id)) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function saveWidths(id: string, widths: Record<string, number>) {
  try {
    localStorage.setItem(WIDTH_KEY(id), JSON.stringify(widths));
  } catch {
    // 本地存储不可用就不记了
  }
}

function getValue<T>(row: T, col: DataColumn<T>): unknown {
  const di = col.dataIndex;
  if (di == null) return undefined;
  const path = Array.isArray(di) ? di : [di];
  return path.reduce<unknown>(
    (v, k) => (v == null ? v : (v as Record<string, unknown>)[k as string]),
    row,
  );
}

function ResizableTitle(
  props: ThHTMLAttributes<HTMLTableCellElement> & {
    onResize?: (w: number) => void;
    width?: number;
  },
) {
  const { onResize, width, ...rest } = props;
  const startRef = useRef<{ x: number; w: number } | null>(null);
  if (!onResize || !width) return <th {...rest} />;
  return (
    <th {...rest} style={{ ...rest.style, position: 'relative' }}>
      {rest.children}
      <span
        className="cw-col-resizer"
        role="separator"
        aria-label="拖动调整列宽"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          startRef.current = { x: e.clientX, w: width };
          const move = (ev: MouseEvent) => {
            if (!startRef.current) return;
            onResize(Math.max(48, startRef.current.w + ev.clientX - startRef.current.x));
          };
          const up = () => {
            startRef.current = null;
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      />
    </th>
  );
}

/**
 * 数据表格：在 antd Table 基础上统一了金额列、列宽拖动并记住、导出 Excel、大数据量虚拟滚动。
 * 所有列表页都用它，保证外观和操作一致。
 */
export function DataTable<T extends object>({
  tableId,
  columns,
  exportName,
  toolbar,
  height,
  ...rest
}: DataTableProps<T>) {
  const [widths, setWidths] = useState<Record<string, number>>(() => loadWidths(tableId));
  const setWidth = useCallback(
    (key: string, w: number) =>
      setWidths((prev) => {
        const next = { ...prev, [key]: w };
        saveWidths(tableId, next);
        return next;
      }),
    [tableId],
  );

  const antColumns = useMemo(
    () =>
      columns.map((c) => {
        const { money, blankZero, exportValue: _e, noExport: _n, ...col } = c;
        const width =
          widths[c.key] ?? (typeof c.width === 'number' ? c.width : money ? 130 : undefined);
        return {
          ...col,
          width,
          align: money ? ('right' as const) : col.align,
          render:
            col.render ??
            (money
              ? (v: number | null) => <MoneyText value={v} blankZero={blankZero} />
              : undefined),
          onHeaderCell: () =>
            ({
              width,
              onResize: (w: number) => setWidth(c.key, w),
            }) as ThHTMLAttributes<HTMLTableCellElement>,
        };
      }),
    [columns, widths, setWidth],
  );

  const doExport = async () => {
    const rows = (rest.dataSource ?? []) as readonly T[];
    await exportToExcel({
      fileName: exportName ?? tableId,
      columns: columns
        .filter((c) => !c.noExport)
        .map((c) => ({
          title: c.title,
          money: c.money,
          value: (r: T) =>
            c.exportValue ? c.exportValue(r) : (getValue(r, c) as string | number | null),
        })),
      rows,
    });
  };

  return (
    <div className="cw-data-table">
      {(toolbar || exportName) && (
        <div className="cw-table-toolbar">
          <Space>{toolbar}</Space>
          {exportName && (
            <Tooltip title="导出当前列表为 Excel">
              <Button icon={<DownloadOutlined />} onClick={() => void doExport()}>
                导出 Excel
              </Button>
            </Tooltip>
          )}
        </div>
      )}
      <Table<T>
        size="small"
        bordered
        pagination={false}
        {...rest}
        columns={antColumns}
        components={{ header: { cell: ResizableTitle } }}
        virtual={height != null}
        scroll={
          height != null ? { y: height, x: 'max-content' } : { x: 'max-content', ...rest.scroll }
        }
      />
    </div>
  );
}
