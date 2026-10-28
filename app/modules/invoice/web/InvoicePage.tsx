import { useInvoiceFilters } from './useInvoiceFilters';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { today } from '@caiwu/core';
import { notify, queryClient, showError, usePermission } from '@caiwu/web-kit';
import {
  DataTable,
  FilterBar,
  MoneyInput,
  PageContainer,
  PeriodPicker,
  exportToExcel,
  type DataColumn,
} from '@caiwu/ui';
import type {
  Direction,
  ImportFile,
  Invoice,
  InvoiceData,
  InvoiceInput,
  InvoiceFilter,
} from '../shared';
import { sampleHeaders, sampleRows } from '../samples';
import { api } from './api';
import { exportInvoices, invoiceColumns, Nav, QueryError } from './common';

function ImportDrawer({
  direction,
  onClose,
  onSaved,
}: {
  direction: Direction;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [file, setFile] = useState<ImportFile | null>(null);
  const preview = useMutation(api.previewImport.mutationOptions());
  const commit = useMutation(
    api.commitImport.mutationOptions({
      onSuccess: (r) => {
        notify.success(`已导入 ${r.ids.length} 张发票`);
        onSaved();
      },
    }),
  );
  async function readFile(f: File) {
    preview.reset();
    setFile(null);
    if (f.size > 5_000_000) {
      notify.error('文件超过 5 MB');
      return;
    }
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]!);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(f);
    });
    const input = { direction, fileName: f.name, base64: encoded };
    setFile(input);
    preview.mutate(input);
  }
  const p = preview.data;
  return (
    <Drawer title="Excel 发票导入预览" open width="90%" onClose={onClose}>
      <Alert
        type="info"
        title="支持首行表头、单工作表的 XLSX 平台表格导出和本页模板"
        description="未知列/格式明确拒绝；不支持 PDF/OFD/XML。金额为元，税率可写 10% 或 0.1，号码/税号/代码用文本；同票商品行金额应为各行金额。汇总票请删去商品列，不伪造明细。"
      />
      <Space style={{ margin: '16px 0' }}>
        <label>
          选择 Excel 文件{' '}
          <input
            aria-label="选择 Excel 文件"
            type="file"
            accept=".xlsx"
            disabled={preview.isPending || commit.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f).catch(showError);
            }}
          />
        </label>
        <Button
          onClick={() =>
            void exportToExcel({
              fileName: '合成进项5票样例',
              columns: sampleHeaders.map((title, i) => ({ title, value: (r: string[]) => r[i] })),
              rows: sampleRows,
            })
          }
        >
          下载合成5票样例
        </Button>
      </Space>
      {preview.isPending && <p>正在解析和校验…</p>}
      {preview.error && <Alert type="error" title={preview.error.message} />}
      {p && (
        <>
          <h4>列映射（已知表头别名）</h4>
          <Table
            size="small"
            pagination={false}
            rowKey="field"
            dataSource={p.mapping}
            columns={[
              { title: '文件表头', dataIndex: 'header' },
              { title: '映射字段', dataIndex: 'label' },
            ]}
          />
          <h4>
            预览 {p.invoices.length} 张发票 / 错误 {p.errors.length} 行 / 重复或冲突{' '}
            {p.duplicates.length} 张
          </h4>
          {p.errors.map((e, i) => (
            <Alert key={i} type="error" title={`第 ${e.row} 行：${e.message}`} />
          ))}
          {p.duplicates.map((d) => (
            <Alert
              key={d.id}
              type="warning"
              title={`${d.number}：${d.conflict ? '与既有内容冲突' : '已存在（重复）'}，原记录 #${d.id}，不会覆盖`}
            />
          ))}
          <DataTable<{ rows: number[]; data: InvoiceData }>
            tableId="invoice-import"
            rowKey={(r) => r.data.number + r.data.sellerTaxId}
            dataSource={p.invoices}
            columns={[
              { key: 'rows', title: '原行号', width: 100, render: (_, r) => r.rows.join(',') },
              ...(
                ['number', 'sellerName', 'date', 'confirmDate', 'amount', 'tax', 'total'] as const
              ).map((f) => ({
                key: f,
                title: {
                  number: '发票号码',
                  sellerName: '销售方',
                  date: '开票日期',
                  confirmDate: '确认日期',
                  amount: '不含税金额',
                  tax: '税额',
                  total: '价税合计',
                }[f],
                dataIndex: ['data', f],
                money: ['amount', 'tax', 'total'].includes(f),
                width: 160,
              })),
              {
                key: 'lines',
                title: '商品行数',
                width: 100,
                render: (_, r) => r.data.lines.length || '仅汇总',
              },
            ]}
          />
          <Popconfirm
            title="确认整批保存以上发票？存在任一错误或重复将整批不变。"
            onConfirm={() => file && commit.mutate(file)}
          >
            <Button
              type="primary"
              loading={commit.isPending}
              disabled={
                !file || p.errors.length > 0 || p.duplicates.length > 0 || !p.invoices.length
              }
            >
              确认导入
            </Button>
          </Popconfirm>
        </>
      )}
    </Drawer>
  );
}
function DeleteDrawer({
  filter,
  onClose,
  onSaved,
}: {
  filter: InvoiceFilter;
  onClose: () => void;
  onSaved: () => void;
}) {
  const query = useQuery(api.previewDelete.queryOptions(filter));
  const [confirmed, setConfirmed] = useState(false);
  const remove = useMutation(
    api.deleteBatch.mutationOptions({
      onSuccess: (r) => {
        notify.success(`已删除 ${r.deleted} 张，跳过 ${r.skipped.length} 张`);
        onSaved();
      },
    }),
  );
  return (
    <Drawer title="批量删除当前查询预览" open width={760} onClose={onClose}>
      <Alert type="warning" title="先核对查询范围和逐项跳过原因，再二次确认。只删除可编辑草稿。" />
      <QueryError error={query.error} retry={query.refetch} />
      <DataTable
        tableId="invoice-delete-preview"
        rowKey="id"
        loading={query.isPending}
        dataSource={query.data?.items ?? []}
        columns={[
          { key: 'number', title: '发票号码', dataIndex: 'number', width: 260 },
          {
            key: 'reason',
            title: '处理结果预览',
            width: 350,
            render: (_, r) => r.reason ?? '将删除',
          },
        ]}
      />
      {!confirmed ? (
        <Button disabled={!query.data?.items.length} onClick={() => setConfirmed(true)}>
          确认以上查询范围
        </Button>
      ) : (
        <Popconfirm
          title="再次确认：删除以上标记为将删除的发票？"
          onConfirm={() =>
            query.data &&
            remove.mutate({
              filter,
              fingerprint: query.data.fingerprint,
              confirmed: true,
              secondConfirmed: true,
            })
          }
        >
          <Button danger loading={remove.isPending}>
            二次确认删除
          </Button>
        </Popconfirm>
      )}
    </Drawer>
  );
}
function Editor({
  record,
  direction,
  onClose,
  onSaved,
  readOnly,
}: {
  readOnly: boolean;
  record: Invoice | 'new';
  direction: Direction;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<InvoiceInput>();
  const [dirty, setDirty] = useState(false);
  const { modal } = App.useApp();
  const save = useMutation(
    api.save.mutationOptions({
      onSuccess: () => {
        setDirty(false);
        onSaved();
      },
    }),
  );
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const close = () => {
    if (!dirty) onClose();
    else
      modal.confirm({
        title: '有未保存的发票，确认放弃修改？',
        okText: '放弃修改',
        cancelText: '继续编辑',
        onOk: onClose,
      });
  };
  const locked = readOnly || (record !== 'new' && record.state !== 'draft');
  return (
    <Drawer
      title={record === 'new' ? '新增发票' : '发票详情/修改'}
      open
      width="90%"
      onClose={close}
      extra={
        !locked && (
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>
            保存发票
          </Button>
        )
      }
    >
      {locked && (
        <Alert
          type="warning"
          title={
            readOnly
              ? '仅有查看权限，不能编辑发票'
              : record !== 'new' && record.inventoryDocumentId != null
                ? '发票已转出库，票面与审核状态已锁定。收入凭证在发票处理生成；调整出库单须先撤销未审核收入凭证，再到发票转出库重新生成；已审核或核算的原单须先解除相应业务锁。'
                : '发票已审核或制证，已锁定编辑。先整体撤销未审核来源凭证，再取消发票审核。'
          }
        />
      )}
      <Form
        name={`invoice-editor-${direction}`}
        form={form}
        layout="vertical"
        disabled={locked}
        initialValues={
          record === 'new'
            ? {
                direction,
                date: today(),
                confirmDate: direction === 'input' ? today() : null,
                code: '',
                buyerTaxId: '',
                invoiceStatus: 'normal',
                lines: [],
                note: '',
              }
            : record
        }
        onValuesChange={() => setDirty(true)}
        onFinish={(v) =>
          save.mutate({
            id: record === 'new' ? undefined : record.id,
            revision: record === 'new' ? undefined : record.revision,
            data: {
              ...v,
              direction,
              confirmDate: v.confirmDate || null,
              lines: v.lines?.map((l) => ({
                ...l,
                quantity: l.quantity || null,
                unitPrice: l.unitPrice || null,
                taxRate: l.taxRate || null,
              })),
            },
          })
        }
      >
        <Space align="start" wrap>
          <Form.Item name="code" label="发票代码">
            <Input />
          </Form.Item>
          <Form.Item name="number" label="发票号码" rules={[{ required: true }]}>
            <Input style={{ width: 260 }} />
          </Form.Item>
          <Form.Item name="date" label="开票日期" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          {direction === 'input' && (
            <Form.Item name="confirmDate" label="确认日期" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
          )}
          <Form.Item name="kind" label="票种" rules={[{ required: true }]}>
            <Input placeholder="按票面填写，无预设资格" />
          </Form.Item>
          <Form.Item name="invoiceStatus" label="票面状态">
            <Select
              style={{ width: 120 }}
              options={[
                { value: 'normal', label: '正常' },
                { value: 'void', label: '作废' },
              ]}
            />
          </Form.Item>
        </Space>
        <Space align="start" wrap>
          {[
            ['sellerName', '销售方名称'],
            ['sellerTaxId', '销售方税号'],
            ['buyerName', '购买方名称'],
            ['buyerTaxId', '购买方税号'],
          ].map(([name, label]) => (
            <Form.Item
              key={name}
              name={name}
              label={label}
              rules={name === 'buyerTaxId' ? [] : [{ required: true }]}
            >
              <Input style={{ width: 240 }} />
            </Form.Item>
          ))}
        </Space>
        <Space>
          {[
            ['amount', '不含税金额'],
            ['tax', '税额'],
            ['total', '价税合计'],
          ].map(([name, label]) => (
            <Form.Item key={name} name={name} label={label} rules={[{ required: true }]}>
              <MoneyInput />
            </Form.Item>
          ))}
        </Space>
        <p>
          只有汇总信息可保留空明细。明细税率输入小数（如 0.1）；免税请明确选择免税。销项数量单价差额
          ≥0.01 元、税额差额 ≥0.02 元时拒绝保存。
        </p>
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Space
                  key={field.key}
                  align="start"
                  wrap
                  style={{ borderBottom: '1px solid #ddd' }}
                >
                  <Form.Item
                    name={[field.name, 'name']}
                    label="商品名称"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item name={[field.name, 'specification']} label="规格">
                    <Input style={{ width: 100 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'unit']} label="单位">
                    <Input style={{ width: 70 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'quantity']} label="数量">
                    <Input style={{ width: 100 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'unitPrice']} label="单价（元）">
                    <Input style={{ width: 100 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'taxMark']} label="税率标记">
                    <Select
                      style={{ width: 130 }}
                      options={[
                        { value: 'rate', label: '按税率' },
                        { value: 'exempt', label: '免税' },
                        { value: 'unspecified', label: '未注明税率' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'taxRate']} label="税率（小数）">
                    <Input style={{ width: 100 }} />
                  </Form.Item>
                  {(['amount', 'tax', 'total'] as const).map((f) => (
                    <Form.Item
                      key={f}
                      name={[field.name, f]}
                      label={f === 'amount' ? '行金额' : f === 'tax' ? '行税额' : '行合计'}
                    >
                      <MoneyInput style={{ width: 120 }} />
                    </Form.Item>
                  ))}
                  <Button
                    danger
                    onClick={() => {
                      remove(field.name);
                      setDirty(true);
                    }}
                  >
                    移除明细
                  </Button>
                </Space>
              ))}
              <Button
                onClick={() => {
                  add({
                    name: '',
                    specification: '',
                    unit: '',
                    quantity: null,
                    unitPrice: null,
                    taxRate: null,
                    taxMark: 'unspecified',
                    amount: 0,
                    tax: 0,
                    total: 0,
                  });
                  setDirty(true);
                }}
              >
                增加商品明细
              </Button>
            </>
          )}
        </Form.List>
        <Form.Item name="note" label="备注">
          <Input.TextArea />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
export default function InvoicePage() {
  const direction: Direction = useLocation().pathname.endsWith('/output') ? 'output' : 'input';
  const navigate = useNavigate();
  const [filters, setFilters] = useInvoiceFilters({
    id: 0,
    period: 0,
    dateFrom: '',
    dateTo: '',
    partner: '',
    kind: '',
    unvouchered: false,
  });
  const filter = {
    direction,
    id: filters.id || undefined,
    period: filters.period || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    partner: filters.partner || undefined,
    kind: filters.kind || undefined,
    unvouchered: filters.unvouchered,
  };
  const list = useQuery(api.list.queryOptions(filter));
  const [editor, setEditor] = useState<Invoice | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [keys, setKeys] = useState<React.Key[]>([]);
  const edit = usePermission('invoice.edit'),
    canImport = usePermission('invoice.import'),
    canAudit = usePermission('invoice.audit'),
    canExport = usePermission('invoice.export');
  const refresh = () => {
    setKeys([]);
    return queryClient.invalidateQueries({ queryKey: api.list.queryKey() });
  };
  const audit = useMutation(api.audit.mutationOptions({ onSuccess: () => void refresh() }));
  const remove = useMutation(api.remove.mutationOptions({ onSuccess: () => void refresh() }));
  const rows = list.data ?? [];
  const selection = rows
    .filter((r) => keys.includes(r.id))
    .map((r) => ({ id: r.id, revision: r.revision }));
  const cols: DataColumn<Invoice>[] = [
    ...invoiceColumns,
    {
      key: 'actions',
      title: '操作',
      width: 210,
      noExport: true,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => setEditor(r)}>
            {r.state === 'draft' && edit ? '修改' : '详情'}
          </Button>
          {edit && r.state === 'draft' && (
            <Popconfirm
              title="删除这张发票？"
              onConfirm={() => remove.mutate({ id: r.id, revision: r.revision, confirmed: true })}
            >
              <Button size="small" danger loading={remove.isPending}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];
  return (
    <PageContainer
      title={direction === 'input' ? '进项发票' : '销项发票'}
      subtitle={
        direction === 'input'
          ? '归属确认月份；保存时同时检查开票及确认月份是否结账'
          : '归属开票月份；数量、单价及税额使用十进制校验'
      }
    >
      <Nav />
      <FilterBar
        initialValues={filters}
        onSearch={(v) => {
          setFilters(v);
          setKeys([]);
        }}
        extra={<Button onClick={() => void list.refetch()}>刷新</Button>}
      >
        <Form.Item name="dateFrom" label="开票从">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="dateTo" label="至">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="period" label="归属月份">
          <PeriodPicker allowClear />
        </Form.Item>
        <Form.Item name="partner" label="单位">
          <Input />
        </Form.Item>
        <Form.Item name="kind" label="票种">
          <Input />
        </Form.Item>
        <Form.Item name="unvouchered" valuePropName="checked">
          <Checkbox>仅未制证</Checkbox>
        </Form.Item>
      </FilterBar>
      <Space wrap style={{ marginBottom: 16 }}>
        {filters.id > 0 && <Button onClick={() => setFilters({ id: 0 })}>清除发票定位</Button>}
        {edit && (
          <Button type="primary" onClick={() => setEditor('new')}>
            新增发票
          </Button>
        )}
        {edit && (
          <Button danger onClick={() => setDeleting(true)}>
            批量删除当前查询
          </Button>
        )}
        {canImport && <Button onClick={() => setImporting(true)}>导入 Excel</Button>}
        {canAudit && (
          <>
            <Button
              disabled={!selection.length}
              loading={audit.isPending}
              onClick={() => audit.mutate({ selection, to: 'audited' })}
            >
              审核所选
            </Button>
            <Popconfirm
              title="取消所选发票审核？已制证或结账票会整批阻止。"
              onConfirm={() => audit.mutate({ selection, to: 'draft' })}
            >
              <Button disabled={!selection.length}>取消审核</Button>
            </Popconfirm>
          </>
        )}
        <Button
          onClick={() =>
            void navigate(
              `/m/invoice/process?direction=${direction}&period=${filters.period || ''}&ids=${selection.map((s) => s.id).join(',')}`,
            )
          }
        >
          去发票处理
        </Button>
        {canExport && (
          <>
            <Button onClick={() => void exportInvoices(filter).catch(showError)}>导出 Excel</Button>
            <Button onClick={() => void exportInvoices(filter, true).catch(showError)}>打印</Button>
          </>
        )}
      </Space>
      <QueryError error={list.error} retry={list.refetch} />
      <DataTable
        tableId={`invoice-${direction}`}
        columns={cols}
        dataSource={rows}
        loading={list.isPending}
        rowKey="id"
        rowSelection={{ selectedRowKeys: keys, onChange: setKeys }}
        locale={{ emptyText: '当前筛选没有发票，可录入或导入 Excel' }}
      />
      {editor && (
        <Editor
          key={editor === 'new' ? 'new' : `${editor.id}-${editor.revision}`}
          record={editor}
          readOnly={!edit}
          direction={direction}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void refresh();
          }}
        />
      )}
      {deleting && (
        <DeleteDrawer
          filter={filter}
          onClose={() => setDeleting(false)}
          onSaved={() => {
            setDeleting(false);
            void refresh();
          }}
        />
      )}
      {importing && (
        <ImportDrawer
          direction={direction}
          onClose={() => setImporting(false)}
          onSaved={() => {
            setImporting(false);
            void refresh();
          }}
        />
      )}
    </PageContainer>
  );
}
