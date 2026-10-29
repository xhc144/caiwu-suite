import { useRef, useState } from 'react';
import { Alert, App, Button, Card, Space } from 'antd';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { buildTemplateView, type PrintView } from '@caiwu/print';
import {
  notify,
  queryClient,
  useHotkey,
  usePermission,
  useSession,
  useSubmission,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import { DataTable, PageContainer, useUrlFilters, type DataColumn } from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import { defaultSettings, TemplateSchema, TEMPLATE_FIELDS, type PrintTemplate } from '../shared';
import { api } from './api';
import Preview from './Preview';
import { continueAfterEdit, type UnsavedChoice } from './unsaved';
import './print.css';
type Stored = PrintTemplate & { revision: number };
const blank = (): PrintTemplate => ({
  code: 1,
  name: '新打印格式',
  rows: 5,
  cols: 3,
  rowHeight: 8,
  colWidth: 40,
  cells: [
    { row: 1, col: 1, text: '', field: 'unit', align: 'left' },
    { row: 2, col: 1, text: '打印标题', align: 'center' },
  ],
});
export default function FormatsPage() {
  const navigate = useNavigate();
  const [selection, setSelection] = useUrlFilters({ voucherId: 0 });
  const canPrintVoucher = usePermission('print-settings.voucher.print');
  const voucher = useQuery(
    api.vouchers.queryOptions(
      { voucherId: selection.voucherId || undefined, from: 202601, to: 202601 },
      { enabled: selection.voucherId > 0 && canPrintVoucher },
    ),
  );
  const formats = useQuery(api.formats.queryOptions()),
    settings = useQuery(api.settings.queryOptions());
  const session = useSession();
  const [editing, setEditing] = useState<PrintTemplate | null>(null),
    [revision, setRevision] = useState<number>(),
    [original, setOriginal] = useState(''),
    [preview, setPreview] = useState<PrintView>();
  const canEdit = usePermission('print-settings.format.edit');
  const { modal } = App.useApp();
  const current = useRef(editing);
  current.current = editing;
  const version = JSON.stringify(editing);
  const dirty = !!editing && (revision == null || version !== original);
  const { submit, isSubmitting } = useSubmission();
  const refresh = () => queryClient.invalidateQueries({ queryKey: api.formats.queryKey() });
  const save = useMutation(
    api.saveFormat.mutationOptions({
      onSuccess: () => {
        notify.success('格式已保存');
        void refresh();
      },
    }),
  );
  const remove = useMutation(api.removeFormat.mutationOptions({ onSuccess: () => void refresh() }));
  const copy = useMutation(api.copyFormat.mutationOptions({ onSuccess: () => void refresh() }));
  const persist = () =>
    submit(async () => {
      const snapshot = JSON.stringify(current.current);
      const result = TemplateSchema.safeParse(current.current);
      if (!result.success) {
        notify.error(result.error.issues[0]?.message ?? '格式数据缺失');
        return false;
      }
      const values = await save.mutateAsync({ data: result.data, revision });
      const stored = values.find((x) => x.code === result.data.code)!;
      setRevision(stored.revision);
      setOriginal(JSON.stringify(result.data));
      if (JSON.stringify(current.current) !== snapshot) return false;
      // 同步显示保存时规范化的名称，避免首尾空格被误判为未保存。
      current.current = result.data;
      setEditing(result.data);
      return true;
    });
  useUnsavedChanges({
    title: '特殊打印格式',
    dirty,
    version,
    save: persist,
    discard: async () => {
      await submit(async () => true);
      setEditing(null);
    },
  });
  useHotkey(
    'Ctrl+S',
    () => {
      void persist().catch(() => {});
    },
    { enabled: !!editing },
  );
  const guard = (next: () => void) => {
    if (isSubmitting) return;
    void continueAfterEdit(
      dirty,
      () =>
        new Promise<UnsavedChoice>((resolve) => {
          let choice: UnsavedChoice = 'cancel';
          const dialog = modal.confirm({
            title: '格式尚未保存',
            content: '保存修改后继续，或放弃修改；取消会留在当前格式。',
            okText: '保存并继续',
            cancelText: '取消',
            onOk: () => {
              choice = 'save';
            },
            onCancel: () => {
              choice = 'cancel';
            },
            afterClose: () => resolve(choice),
            footer: (_, { OkBtn, CancelBtn }) => (
              <Space>
                <Button
                  danger
                  onClick={() => {
                    choice = 'discard';
                    dialog.destroy();
                  }}
                >
                  放弃修改
                </Button>
                <CancelBtn />
                <OkBtn />
              </Space>
            ),
          });
        }),
      persist,
      next,
    ).catch(() => {
      /* mutation 已显示具体保存失败原因，继续保留编辑。 */
    });
  };
  const open = (row?: Stored) =>
    guard(() => {
      const data = row ? TemplateSchema.parse(row) : blank();
      setEditing(data);
      setOriginal(JSON.stringify(data));
      setRevision(row?.revision);
      setPreview(undefined);
    });
  const show = (t: PrintTemplate) => {
    try {
      if (selection.voucherId > 0 && !voucher.data)
        throw new Error(
          canPrintVoucher
            ? '凭证尚未读取成功，请核对 ID 后重试'
            : '没有凭证打印权限，不能读取凭证字段',
        );
      const v = voucher.data?.vouchers[0];
      setPreview(
        buildTemplateView(t, settings.data?.ledger ?? defaultSettings.ledger, {
          unit: session?.book?.orgName ?? '',
          title: t.name,
          period: String(v?.period ?? session?.book?.startPeriod ?? ''),
          date: v?.date ?? '',
          voucherNo: v?.displayNo ?? '',
          summary: v?.summary ?? '',
          debit: v ? formatMoney(v.debitTotal) : '',
          credit: v ? formatMoney(v.creditTotal) : '',
          account: v?.lines[0] ? `${v.lines[0].accountCode} ${v.lines[0].accountName}` : '',
        }),
      );
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    }
  };
  const columns: DataColumn<Stored>[] = [
    { key: 'code', title: '编码', dataIndex: 'code', width: 90 },
    { key: 'name', title: '格式名称', dataIndex: 'name', width: 240 },
    { key: 'rows', title: '行数', dataIndex: 'rows', width: 90 },
    { key: 'cols', title: '列数', dataIndex: 'cols', width: 90 },
    {
      key: 'actions',
      title: '操作',
      width: 360,
      noExport: true,
      render: (_, row) => (
        <Space>
          <Button onClick={() => show(row)}>预览</Button>
          {canEdit && (
            <>
              <Button onClick={() => open(row)}>定义 / 修改</Button>
              <Button
                onClick={() => {
                  const code = Array.from({ length: 100 }, (_, i) => (i + 1) % 100).find(
                    (c) => !formats.data?.some((t) => t.code === c),
                  );
                  if (code == null) {
                    notify.error('没有可用编码');
                    return;
                  }
                  modal.confirm({
                    title: `在当前账套复制为编码 ${code}？`,
                    content: '复制后可修改名称和定义。',
                    onOk: () =>
                      copy.mutateAsync({ source: row.code, code, name: `${row.name}（副本）` }),
                  });
                }}
              >
                同账套复制
              </Button>
              <Button
                danger
                onClick={() =>
                  modal.confirm({
                    title: `删除格式“${row.name}”？`,
                    content: '删除后不能恢复。',
                    onOk: () => remove.mutateAsync({ code: row.code, confirmed: true }),
                  })
                }
              >
                删除
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];
  const update = (v: Partial<PrintTemplate>) => setEditing((e) => (e ? { ...e, ...v } : e));
  return (
    <PageContainer
      title="特殊打印格式"
      subtitle="安全结构化模板：文字、白名单字段、行高、列宽和对齐。"
      extra={
        <Space>
          {canEdit && <Button onClick={() => open()}>新建格式</Button>}
          <Button
            onClick={() =>
              guard(() => {
                setEditing(null);
                setPreview(undefined);
                void navigate('/m/print-settings/preview');
              })
            }
          >
            返回打印
          </Button>
        </Space>
      }
    >
      <div className="print-form">
        <label>
          预览取数凭证 ID（可选）
          <input
            type="number"
            min={1}
            value={selection.voucherId || ''}
            onChange={(e) => {
              setSelection({ voucherId: Number(e.target.value) });
              setPreview(undefined);
            }}
          />
        </label>
        <span>留空仅显示文字、单位和期间；选定凭证后可预览凭证字段。</span>
      </div>
      {voucher.error && selection.voucherId > 0 && (
        <Alert type="error" title={voucher.error.message} />
      )}
      {formats.error && <Alert type="error" title={formats.error.message} />}
      <DataTable
        tableId="print-settings.formats"
        rowKey="code"
        columns={columns}
        dataSource={formats.data ?? []}
        loading={formats.isLoading}
      />
      {editing && (
        <Card title="打印格式定义">
          <div className="print-form">
            <label>
              格式编码
              <input
                type="number"
                min={0}
                max={99}
                disabled={revision != null || isSubmitting}
                value={editing.code}
                onChange={(e) => update({ code: Number(e.target.value) })}
              />
            </label>
            <label>
              格式名称
              <input
                value={editing.name}
                maxLength={80}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            {(['rows', 'cols', 'rowHeight', 'colWidth'] as const).map((key, i) => (
              <label key={key}>
                {['最大行数', '最大列数', '行高（毫米）', '列宽（毫米）'][i]}
                <input
                  type="number"
                  min={key === 'rows' || key === 'cols' ? 1 : key === 'rowHeight' ? 3 : 5}
                  max={key === 'rows' ? 999 : key === 'cols' ? 250 : key === 'rowHeight' ? 30 : 100}
                  value={editing[key]}
                  onChange={(e) => update({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <table className="print-cell-table">
            <thead>
              <tr>
                {['行', '列', '文字', '字段（优先）', '对齐', '操作'].map((t) => (
                  <th key={t}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {editing.cells.map((c, i) => {
                const change = (patch: Partial<typeof c>) =>
                  update({
                    cells: editing.cells.map((old, j) => (j === i ? { ...old, ...patch } : old)),
                  });
                return (
                  <tr key={i}>
                    <td>
                      <input
                        aria-label={`单元格${i + 1}行`}
                        type="number"
                        min={1}
                        value={c.row}
                        onChange={(e) => change({ row: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`单元格${i + 1}列`}
                        type="number"
                        min={1}
                        value={c.col}
                        onChange={(e) => change({ col: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`单元格${i + 1}文字`}
                        value={c.text}
                        maxLength={500}
                        onChange={(e) => change({ text: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`单元格${i + 1}字段`}
                        value={c.field ?? ''}
                        onChange={(e) =>
                          change({
                            field: e.target.value ? (e.target.value as typeof c.field) : undefined,
                          })
                        }
                      >
                        <option value="">仅文字</option>
                        {TEMPLATE_FIELDS.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={c.align}
                        onChange={(e) => change({ align: e.target.value as typeof c.align })}
                      >
                        {[
                          ['left', '左'],
                          ['center', '中'],
                          ['right', '右'],
                        ].map(([v, n]) => (
                          <option key={v} value={v}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Button
                        onClick={() => update({ cells: editing.cells.filter((_, j) => j !== i) })}
                      >
                        移除
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Space>
            <Button
              onClick={() =>
                update({
                  cells: [
                    ...editing.cells,
                    {
                      row: Math.min(editing.rows, editing.cells.length + 1),
                      col: 1,
                      text: '新文字',
                      align: 'left',
                    },
                  ],
                })
              }
            >
              增加单元格
            </Button>
            <Button
              type="primary"
              loading={isSubmitting}
              onClick={() => void persist().catch(() => {})}
            >
              保存格式
            </Button>
            <Button onClick={() => show(editing)}>预览定义</Button>
            <Button disabled={isSubmitting} onClick={() => guard(() => setEditing(null))}>
              关闭定义
            </Button>
          </Space>
        </Card>
      )}
      {preview && <Preview view={preview} kind="format" onClose={() => setPreview(undefined)} />}
    </PageContainer>
  );
}
