import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Form, Input, Select, Space } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable, type DataColumn } from '@caiwu/ui';
import { escapeHtml, printHtml } from '@caiwu/print';
import { formatMoney } from '@caiwu/core';
import { useTab } from '@caiwu/web-kit';
import { api } from './api';
import type { DocumentInput } from '../shared';
/** W0 TabsHost loops while mounting a second lazy module tab. A native location
 * change is the owner-local fallback until its title callback is stabilized.
 * beforeunload guards still protect all unsaved module forms. */
export function useInventoryNavigate() {
  return useCallback((to: string) => {
    window.location.assign(to);
  }, []);
}
export function InventoryNavigation() {
  return (
    <nav
      aria-label="进销存页面入口"
      style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}
    >
      {[
        ['master', '产品与仓库'],
        ['opening', '库存期初'],
        ['receipts', '入库单'],
        ['issues', '出库单'],
        ['contracts', '采购合同'],
        ['stock', '库存台账'],
        ['counts', '月末盘点'],
        ['reports', '汇总与销售明细'],
        ['settings', '仓库设置'],
      ].map(([path, title]) => (
        <a key={path} href={`/m/inventory/${path}`}>
          {title}
        </a>
      ))}
    </nav>
  );
}
export function useCatalog() {
  return {
    products: useQuery(api.products.queryOptions({})).data ?? [],
    warehouses: useQuery(api.warehouses.queryOptions()).data ?? [],
    context: useQuery(api.context.queryOptions()).data,
  };
}
export function useRefresh() {
  const q = useQueryClient();
  return () => q.invalidateQueries();
}
export function useUnsaved(dirty: boolean) {
  const tab = useTab();
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const click = (e: MouseEvent) => {
      if (
        (e.target as Element)
          .closest('.ant-tabs-tab-remove')
          ?.closest('[data-node-key]')
          ?.getAttribute('data-node-key') === tab.key &&
        !window.confirm('有数据未保存，放弃修改并关闭吗？取消后可返回保存。')
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (
        tab.active &&
        e.ctrlKey &&
        e.key === 'F4' &&
        !window.confirm('有数据未保存，放弃修改并关闭吗？取消后可返回保存。')
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('click', click, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [dirty, tab.active, tab.key]);
}
export function mayDiscard(dirty: boolean) {
  return !dirty || window.confirm('有数据未保存，放弃修改吗？取消后可返回保存。');
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <Form.Item label={label}>{children}</Form.Item>;
}
export function TextField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <Field label={label}>
      <Input
        aria-label={label}
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
export function WarehouseSelect({
  value,
  onChange,
  all = false,
}: {
  value?: number;
  onChange: (n: number) => void;
  all?: boolean;
}) {
  const { warehouses } = useCatalog();
  return (
    <Select
      aria-label="当前仓库"
      style={{ minWidth: 200 }}
      value={value}
      onChange={onChange}
      placeholder="请先维护仓库"
      options={[
        ...(all ? [{ value: 0, label: '全部仓库' }] : []),
        ...warehouses.map((w) => ({
          value: w.id,
          label: `${w.code} ${w.name}${w.disabled ? '（停用）' : ''}`,
        })),
      ]}
    />
  );
}
export function ProductSelect({
  value,
  onChange,
  label = '产品',
}: {
  value?: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const { products } = useCatalog();
  return (
    <Select
      aria-label={label}
      value={value || undefined}
      onChange={onChange}
      allowClear
      style={{ minWidth: 200 }}
      options={products.map((p) => ({
        value: p.code,
        label: `${p.code} ${p.name}`,
        search: p.search,
      }))}
      showSearch={{ filterOption: (q, o) => String(o?.search ?? '').includes(q.toLowerCase()) }}
    />
  );
}
export function Grid<T extends object>({
  id,
  title,
  rows,
  columns,
  toolbar,
}: {
  id: string;
  title: string;
  rows: readonly T[];
  columns: DataColumn<T>[];
  toolbar?: ReactNode;
}) {
  const [reset, setReset] = useState(0);
  const cellValue = (r: T, c: DataColumn<T>) => {
    const v = c.exportValue
      ? c.exportValue(r)
      : (r as Record<string, unknown>)[String(c.dataIndex)];
    return c.money && typeof v === 'number' ? formatMoney(v) : v;
  };
  const print = () => {
    if (!rows.length) return;
    void printHtml({
      title,
      orientation: 'landscape',
      html: `<h2>${escapeHtml(title)}</h2><table><thead><tr>${columns
        .filter((c) => !c.noExport)
        .map((c) => `<th>${escapeHtml(c.title)}</th>`)
        .join('')}</tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr>${columns
              .filter((c) => !c.noExport)
              .map((c) => `<td>${escapeHtml(cellValue(r, c))}</td>`)
              .join('')}</tr>`,
        )
        .join('')}</tbody></table>`,
    });
  };
  return (
    <DataTable<T>
      key={reset}
      tableId={`inventory.${id}`}
      rowKey={(r) =>
        String(
          (r as Record<string, unknown>).id ??
            (r as Record<string, unknown>).key ??
            (r as Record<string, unknown>).productCode,
        )
      }
      columns={columns}
      dataSource={rows}
      locale={{ emptyText: '该范围内无数据' }}
      exportName={rows.length ? title : undefined}
      toolbar={
        <Space wrap>
          {toolbar}
          <Button
            disabled={!rows.length}
            onClick={() => {
              if (window.confirm('开始打印当前查询结果吗？')) print();
            }}
          >
            打印
          </Button>
          <Button
            onClick={() => {
              if (window.confirm('恢复默认列宽吗？')) {
                localStorage.removeItem(`caiwu.table.inventory.${id}.widths`);
                setReset((n) => n + 1);
              }
            }}
          >
            恢复默认列宽
          </Button>
        </Space>
      }
    />
  );
}
export type EditLine = DocumentInput['lines'][number];
export const newLine = (): EditLine => ({
  productCode: '',
  quantity: '1',
  unitPrice: '0',
  priceIncludesTax: false,
  note: '',
});
export function LineEditor({
  lines,
  onChange,
  opening = false,
}: {
  lines: EditLine[];
  onChange: (lines: EditLine[]) => void;
  opening?: boolean;
}) {
  const update = (index: number, patch: Partial<EditLine>) =>
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const columns: DataColumn<EditLine & { key: string }>[] = [
    {
      key: 'product',
      title: '产品编号/名称',
      width: 240,
      exportValue: (r) => r.productCode,
      render: (_, r, index) => (
        <ProductSelect
          label={`第${index + 1}行产品`}
          value={r.productCode}
          onChange={(productCode) => update(index, { productCode })}
        />
      ),
    },
    {
      key: 'quantity',
      title: '数量',
      dataIndex: 'quantity',
      width: 150,
      render: (_, r, index) => (
        <Input
          aria-label={`第${index + 1}行数量`}
          value={r.quantity}
          onChange={(e) => update(index, { quantity: e.target.value })}
        />
      ),
    },
    {
      key: 'unitPrice',
      title: '单价（元）',
      dataIndex: 'unitPrice',
      width: 150,
      render: (_, r, index) => (
        <Input
          aria-label={`第${index + 1}行单价`}
          value={r.unitPrice}
          onChange={(e) => update(index, { unitPrice: e.target.value })}
        />
      ),
    },
    ...(!opening
      ? [
          {
            key: 'tax',
            title: '单价口径',
            width: 140,
            exportValue: (r: EditLine) => (r.priceIncludesTax ? '含税' : '不含税'),
            render: (_: unknown, r: EditLine, index: number) => (
              <Select
                aria-label={`第${index + 1}行单价口径`}
                value={String(r.priceIncludesTax ?? false)}
                onChange={(v: string) => update(index, { priceIncludesTax: v === 'true' })}
                options={[
                  { value: 'false', label: '不含税' },
                  { value: 'true', label: '含税' },
                ]}
              />
            ),
          },
          {
            key: 'note',
            title: '说明',
            dataIndex: 'note',
            width: 200,
            render: (_: unknown, r: EditLine, index: number) => (
              <Input
                aria-label={`第${index + 1}行说明`}
                value={r.note}
                onChange={(e) => update(index, { note: e.target.value })}
              />
            ),
          },
        ]
      : []),
    {
      key: 'remove',
      title: '操作',
      noExport: true,
      render: (_, __, index) => (
        <Button danger onClick={() => onChange(lines.filter((_, i) => i !== index))}>
          删行
        </Button>
      ),
    },
  ];
  return (
    <>
      <DataTable
        tableId="inventory.editor"
        rowKey="key"
        columns={columns}
        dataSource={lines.map((l, i) => ({ ...l, key: String(i) }))}
      />
      <Button onClick={() => onChange([...lines, newLine()])}>增加明细行</Button>
    </>
  );
}
