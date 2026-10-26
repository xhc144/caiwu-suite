import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Empty,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, VOUCHER_STATUS_LABELS, type Voucher, type VoucherInput } from '@caiwu/core';
import { notify, queryClient, useHotkey, usePermission, useVoucherTypes } from '@caiwu/web-kit';
import {
  DataTable,
  PageContainer,
  downloadBlob,
  type DataColumn,
  AccountSelect,
  MoneyInput,
} from '@caiwu/ui';
import {
  type Action,
  type ActionResult,
  type Preview,
  type PreviewInput,
  type Selection,
} from '../shared';
import { api } from './api';
import { Filters, useBookFilters } from './filters';
import { ImportDrawer } from './ImportDrawer';
import { ResultDrawer } from './ResultDrawer';

const labels: Record<Action, string> = {
  audit: '审核',
  unaudit: '取消审核',
  delete: '删除',
  void: '作废',
  unvoid: '取消作废',
  copy: '复制',
  reverse: '红字冲销',
  insert: '插入',
  renumber: '编号整理',
  modify: '批量修改',
};
type Row = Voucher & { readonlyReasons: string[]; sourceUrl: string | null };
export default function BookPage() {
  const navigate = useNavigate();
  const filters = useBookFilters();
  const filterArea = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [scope, setScope] = useState(false);
  const [compactAfter, setCompactAfter] = useState(false);
  const [plan, setPlan] = useState<Preview | null>(null);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [numberConfirmed, setNumberConfirmed] = useState(false);
  const [operation, setOperation] = useState<{
    action: 'copy' | 'reverse' | 'insert' | 'renumber' | 'modify';
    original?: Voucher;
  } | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const list = useQuery(api.list.queryOptions(filters.filter ?? {}, { enabled: !!filters.filter }));
  const canAudit = usePermission('voucher-book.audit'),
    canUnaudit = usePermission('voucher-book.unaudit'),
    canDelete = usePermission('voucher-book.delete');
  const canVoid = usePermission('voucher-book.void'),
    canCopy = usePermission('voucher-book.copy'),
    canReverse = usePermission('voucher-book.reverse');
  const canInsert = usePermission('voucher-book.insert'),
    canRenumber = usePermission('voucher-book.renumber'),
    canExport = usePermission('voucher-book.export'),
    canImport = usePermission('voucher-book.import');
  const canNew = usePermission('voucher-entry.edit');
  const canModify = usePermission('voucher-book.modify');
  const refresh = () => {
    setSelected([]);
    void queryClient.invalidateQueries({ queryKey: api.list.queryKey() });
    void queryClient.invalidateQueries({ queryKey: api.detail.queryKey() });
  };
  const ready = (p: Preview) => {
    setPlan(p);
    setCashConfirmed(false);
    setNumberConfirmed(false);
    setOperation(null);
  };
  const previews = {
    audit: useMutation(api.preview.audit.mutationOptions({ onSuccess: ready })),
    unaudit: useMutation(api.preview.unaudit.mutationOptions({ onSuccess: ready })),
    delete: useMutation(api.preview.delete.mutationOptions({ onSuccess: ready })),
    void: useMutation(api.preview.void.mutationOptions({ onSuccess: ready })),
    unvoid: useMutation(api.preview.unvoid.mutationOptions({ onSuccess: ready })),
    copy: useMutation(api.preview.copy.mutationOptions({ onSuccess: ready })),
    reverse: useMutation(api.preview.reverse.mutationOptions({ onSuccess: ready })),
    insert: useMutation(api.preview.insert.mutationOptions({ onSuccess: ready })),
    modify: useMutation(api.preview.modify.mutationOptions({ onSuccess: ready })),
    renumber: useMutation(api.preview.renumber.mutationOptions({ onSuccess: ready })),
  };
  const busy = Object.values(previews).some((p) => p.isPending);
  const mutation = useMutation(
    api.commit.mutationOptions({
      onSuccess: (r) => {
        setResult(r);
        setPlan(null);
        refresh();
      },
    }),
  );
  const selection = (): Selection | null => {
    if (!filters.filter) {
      notify.warning('请先改正查询条件');
      return null;
    }
    if (scope) return { filter: filters.filter };
    if (!selected.length) {
      notify.warning('请先勾选凭证，或选择当前查询全部结果');
      return null;
    }
    return { ids: selected };
  };
  const start = (action: Action) => {
    const s = selection();
    if (!s) return;
    if (['copy', 'reverse', 'insert'].includes(action)) {
      if (selected.length !== 1 || scope) {
        notify.warning('请只勾选一张原凭证');
        return;
      }
      const original = list.data?.items.find((v) => v.id === selected[0]);
      if (!original) {
        notify.warning('请在当前页重新选择原凭证');
        return;
      }
      setOperation({ action: action as 'copy' | 'reverse' | 'insert', original });
    } else if (action === 'renumber' || action === 'modify') setOperation({ action });
    else
      previews[action].mutate({
        action,
        selection: s,
        compactAfter: action === 'delete' && compactAfter,
      });
  };
  useHotkey('Ctrl+N', () => canNew && void navigate('/m/voucher-entry/new'), {
    enabled: !plan && !operation,
  });
  useHotkey('Ctrl+T', () => canCopy && start('copy'), { enabled: !plan && !operation });
  useHotkey('Delete', () => canDelete && start('delete'), {
    allowInInput: false,
    enabled: !plan && !operation,
  });
  const auditSingle = () => {
    if (selected.length !== 1 || scope) {
      notify.warning('单张审核请只勾选一张凭证；批量处理请使用批量审核');
      return;
    }
    previews.audit.mutate({ action: 'audit', selection: { ids: [selected[0]!] } });
  };
  useHotkey('F4', () => canAudit && auditSingle(), { enabled: !plan && !operation });
  useHotkey('F5', refresh);
  useHotkey('Ctrl+Q', () =>
    filterArea.current?.querySelector<HTMLInputElement>('[data-voucher-summary]')?.focus(),
  );
  const exportRange = async (format: 'xlsx' | 'json') => {
    if (!filters.filter) return;
    const f = await queryClient.fetchQuery({
      ...api.export.queryOptions({ filter: filters.filter, format }),
      staleTime: 0,
    });
    const bytes = f.base64 ? Uint8Array.from(atob(f.file), (c) => c.charCodeAt(0)) : f.file;
    downloadBlob(new Blob([bytes]), f.name);
    notify.success('导出成功');
  };
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
      { key: 'number', title: '字号', dataIndex: 'displayNo', width: 120 },
      { key: 'summary', title: '摘要', dataIndex: 'summary', width: 200 },
      { key: 'debit', title: '借方合计', dataIndex: 'debitTotal', money: true },
      { key: 'credit', title: '贷方合计', dataIndex: 'creditTotal', money: true },
      { key: 'attachments', title: '附单数', dataIndex: 'attachments', width: 80 },
      {
        key: 'creator',
        title: '制单人',
        render: (_, v) => `${v.createdBy.name} (${v.createdBy.id})`,
        width: 120,
      },
      { key: 'auditor', title: '审核人', render: (_, v) => v.auditedBy?.name ?? '—', width: 100 },
      { key: 'poster', title: '记账人', render: (_, v) => v.postedBy?.name ?? '—', width: 100 },
      {
        key: 'status',
        title: '状态',
        render: (_, v) => (
          <Space>
            <Tag color={v.voided ? 'red' : 'blue'}>
              {v.voided ? '已作废' : VOUCHER_STATUS_LABELS[v.status]}
            </Tag>
            {v.reversalOfId && <Tag>冲销 #{v.reversalOfId}</Tag>}
          </Space>
        ),
        width: 160,
      },
      {
        key: 'open',
        title: '操作',
        width: 170,
        render: (_, v) => (
          <Space>
            <Button type="link" onClick={() => setView(v.id)}>
              浏览
            </Button>
            <Button
              type="link"
              onClick={() => {
                if (v.readonlyReasons.length) notify.info(v.readonlyReasons.join('；'));
                void navigate(`/m/voucher-entry/edit?id=${v.id}`);
              }}
            >
              打开
            </Button>
          </Space>
        ),
      },
    ],
    [navigate],
  );
  return (
    <PageContainer
      title="凭证序时簿"
      subtitle="查询范围、审核人与来源保护均由服务端核验；金额筛选使用整数分"
      extra={
        canNew && (
          <Button type="primary" onClick={() => void navigate('/m/voucher-entry/new')}>
            新增 Ctrl+N
          </Button>
        )
      }
    >
      <div ref={filterArea}>
        <Filters
          {...filters}
          set={(v) => {
            setSelected([]);
            filters.set(v);
          }}
        />
      </div>
      {result && (
        <Alert
          title={result.message}
          type={result.skippedCount ? 'warning' : 'success'}
          closable
          onClose={() => setResult(null)}
          action={result.rows && <Button onClick={() => setResultOpen(true)}>查看处理清单</Button>}
        />
      )}
      <Space wrap style={{ margin: '12px 0' }}>
        <Checkbox checked={scope} onChange={(e) => setScope(e.target.checked)}>
          当前查询全部结果（共 {filters.filter ? (list.data?.total ?? 0) : 0} 张）
        </Checkbox>
        {canAudit && (
          <Button disabled={busy || !filters.filter} onClick={auditSingle}>
            审核 F4
          </Button>
        )}
        {canAudit && (
          <Button disabled={busy || !filters.filter} onClick={() => start('audit')}>
            批量审核
          </Button>
        )}
        {canUnaudit && (
          <Button disabled={busy} onClick={() => start('unaudit')}>
            取消审核
          </Button>
        )}
        {canDelete && canRenumber && (
          <Checkbox checked={compactAfter} onChange={(e) => setCompactAfter(e.target.checked)}>
            删除后整理编号（另行预览确认）
          </Checkbox>
        )}
        {canDelete && (
          <Button danger disabled={busy} onClick={() => start('delete')}>
            删除
          </Button>
        )}
        {canVoid && (
          <>
            <Button disabled={busy} onClick={() => start('void')}>
              作废
            </Button>
            <Button disabled={busy} onClick={() => start('unvoid')}>
              取消作废
            </Button>
          </>
        )}
        {canModify && (
          <Button disabled={busy} onClick={() => start('modify')}>
            批量修改
          </Button>
        )}
        {canCopy && (
          <Button disabled={busy} onClick={() => start('copy')}>
            复制 Ctrl+T
          </Button>
        )}
        {canReverse && (
          <Button disabled={busy} onClick={() => start('reverse')}>
            红字冲销
          </Button>
        )}
        {canInsert && (
          <Button disabled={busy} onClick={() => start('insert')}>
            插入
          </Button>
        )}
        {canRenumber && (
          <Button disabled={busy} onClick={() => setOperation({ action: 'renumber' })}>
            编号整理
          </Button>
        )}
        <Button onClick={refresh}>刷新 F5</Button>
        {canExport && (
          <>
            <Button onClick={() => void exportRange('xlsx')}>导出 Excel</Button>
            <Button onClick={() => void exportRange('json')}>凭证转出</Button>
          </>
        )}
        {canImport && <Button onClick={() => setImporting(true)}>导入 / 转入</Button>}
        <Button onClick={() => void navigate(`/m/voucher-book/summary${location.search}`)}>
          科目汇总
        </Button>
        <Button onClick={() => void navigate(`/m/voucher-book/t-account${location.search}`)}>
          丁字帐户
        </Button>
      </Space>
      {list.isError && <Alert type="error" title="查询失败" description={list.error.message} />}
      <DataTable<Row>
        tableId="voucher-book.list"
        key={JSON.stringify(filters.filter)}
        rowKey="id"
        columns={columns}
        dataSource={filters.filter ? (list.data?.items ?? []) : []}
        loading={list.isLoading}
        locale={{
          emptyText: (
            <Empty
              description={
                filters.error ? '请改正查询条件后重试' : '没有符合条件的凭证，请调整筛选范围'
              }
            />
          ),
        }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys.map(Number)),
          preserveSelectedRowKeys: false,
        }}
        pagination={{
          total: filters.filter ? (list.data?.total ?? 0) : 0,
          current: Number(filters.values.page) || 1,
          pageSize: Number(filters.values.size) || 30,
          showSizeChanger: true,
          pageSizeOptions: [10, 30, 50, 100],
          showTotal: (n) => `共 ${n} 张`,
          onChange: (page, size) => {
            setSelected([]);
            filters.set({ page: String(page), size: String(size) });
          },
        }}
        expandable={{
          expandedRowRender: (v) => (
            <>
              {v.sourceUrl && <a href={v.sourceUrl}>查看来源单据</a>}
              <VoucherLines voucher={v} />
            </>
          ),
          rowExpandable: (v) => v.lines.length > 0,
        }}
      />
      <Drawer
        open={!!plan}
        title={plan ? `${labels[plan.action]}预览` : ''}
        size={850}
        onClose={() => setPlan(null)}
        destroyOnHidden
        footer={
          <Space>
            <Button onClick={() => setPlan(null)}>取消</Button>
            <Button
              type="primary"
              danger={plan?.action === 'delete'}
              disabled={
                !plan?.eligibleCount ||
                (!!plan.rows.some((r) => r.eligible && r.warnings.length) && !cashConfirmed) ||
                ((!!plan.mappings.some((m) => m.from !== m.to) || plan.action === 'modify') &&
                  !numberConfirmed)
              }
              loading={mutation.isPending}
              onClick={() =>
                plan &&
                mutation.mutate({
                  token: plan.token,
                  confirmed: true,
                  cashflowConfirmed: cashConfirmed,
                  numberingConfirmed: numberConfirmed,
                })
              }
            >
              确认执行
            </Button>
          </Space>
        }
      >
        {plan && (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Alert
              type={plan.eligibleCount ? 'info' : 'warning'}
              title={`可处理 ${plan.eligibleCount} 张，跳过 ${plan.skippedCount} 张`}
              description={plan.warnings.join('；')}
            />
            {plan.generatedDebit != null && (
              <span>新凭证借方 / 贷方合计：{formatMoney(plan.generatedDebit)}；原凭证保持原样</span>
            )}
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={plan.rows}
              columns={[
                { title: '凭证', dataIndex: 'label' },
                {
                  title: '处理结果',
                  render: (_, r) => (
                    <>
                      <Tag color={r.eligible ? 'green' : 'orange'}>
                        {r.eligible ? '可处理' : '跳过'}
                      </Tag>
                      {r.reasons.concat(r.warnings).join('；')}
                      {r.sourceUrl && <a href={r.sourceUrl}>查看来源</a>}
                      {r.reasons.some((x) => x.includes('结账') || x.includes('过账')) && (
                        <a href={r.periodUrl}>去期间处理</a>
                      )}
                    </>
                  ),
                },
              ]}
            />
            {plan.rows.some((r) => r.eligible && r.warnings.length) && (
              <Checkbox
                checked={cashConfirmed}
                onChange={(e) => setCashConfirmed(e.target.checked)}
              >
                已逐项核对现金流量缺失或无法核验提示，确认继续审核
              </Checkbox>
            )}
            {plan.action === 'modify' && (
              <Checkbox
                checked={numberConfirmed}
                onChange={(e) => setNumberConfirmed(e.target.checked)}
              >
                再次确认修改日期或类型，已核对编号影响，不改变账套编号设置
              </Checkbox>
            )}
            {!!plan.mappings.length && (
              <>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="id"
                  dataSource={plan.mappings}
                  columns={[
                    { title: '凭证', dataIndex: 'label' },
                    { title: '旧号', dataIndex: 'from' },
                    { title: '新号', dataIndex: 'to' },
                  ]}
                />
                <Checkbox
                  checked={numberConfirmed}
                  onChange={(e) => setNumberConfirmed(e.target.checked)}
                >
                  确认编号变化，已了解已打印凭证和账册可能失配
                </Checkbox>
              </>
            )}
          </Space>
        )}
      </Drawer>
      <OperationDrawer
        key={operation ? `${operation.action}:${operation.original?.id ?? ''}` : 'closed'}
        operation={operation}
        onClose={() => setOperation(null)}
        onPreview={(v) => {
          const s = v.action === 'modify' ? selection() : v.selection;
          if (s) previews[v.action].mutate({ ...v, selection: s });
        }}
        busy={busy}
        period={filters.values.period}
        type={filters.values.type}
      />
      <ViewDrawer id={view} onClose={() => setView(null)} />
      <ResultDrawer
        result={result}
        open={resultOpen}
        onClose={() => setResultOpen(false)}
        onInspect={(id) => {
          setResultOpen(false);
          setView(id);
        }}
      />
      <ImportDrawer
        open={importing}
        onClose={() => setImporting(false)}
        onSaved={(r) => {
          setResult(r);
          refresh();
        }}
      />
    </PageContainer>
  );
}
function OperationDrawer({
  operation,
  onClose,
  onPreview,
  busy,
  period,
  type,
}: {
  operation: {
    action: 'copy' | 'reverse' | 'insert' | 'renumber' | 'modify';
    original?: Voucher;
  } | null;
  onClose: () => void;
  onPreview: (v: PreviewInput) => void;
  busy: boolean;
  period: string;
  type: string;
}) {
  const types = useVoucherTypes();
  const [form] = Form.useForm<{
    date: string;
    type: number;
    period: string;
    byDate: boolean;
    lines: VoucherInput['lines'];
    changeField: 'date' | 'type';
    keepDay: boolean;
  }>();
  const original = operation?.original;
  return (
    <Drawer
      open={!!operation}
      title={operation ? `${labels[operation.action]}设置` : ''}
      size={920}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={() =>
              void form.validateFields().then((v) => {
                if (!operation) return;
                onPreview({
                  action: operation.action,
                  selection: { ids: original ? [original.id] : [] },
                  date: v.date || undefined,
                  voucherTypeId: v.type,
                  period: Number(v.period) || undefined,
                  byDate: v.byDate,
                  change:
                    operation.action === 'modify'
                      ? {
                          field: v.changeField,
                          date: v.date,
                          voucherTypeId: v.type,
                          keepDay: v.keepDay,
                        }
                      : undefined,
                  input:
                    operation.action === 'insert'
                      ? {
                          date: v.date,
                          voucherTypeId: v.type,
                          attachments: original?.attachments ?? 0,
                          lines: v.lines,
                        }
                      : undefined,
                });
              })
            }
          >
            生成预览
          </Button>
        </Space>
      }
    >
      <Form
        disabled={busy}
        name="voucher-book-operation"
        form={form}
        layout="vertical"
        initialValues={{
          date: original?.date ?? '',
          type: original?.voucherTypeId ?? (Number(type) || undefined),
          period: period || String(original?.period ?? ''),
          byDate: false,
          changeField: 'date',
          keepDay: false,
          lines: original?.lines.map((l) => ({ ...l })) ?? [],
        }}
      >
        {operation?.action === 'modify' && (
          <Form.Item name="changeField" label="修改内容">
            <Select
              options={[
                { value: 'date', label: '修改日期' },
                { value: 'type', label: '修改凭证类型' },
              ]}
            />
          </Form.Item>
        )}
        {operation?.action === 'modify' && (
          <Form.Item name="keepDay" valuePropName="checked">
            <Checkbox>只修改年月，保留原凭证日</Checkbox>
          </Form.Item>
        )}
        {operation?.action === 'renumber' ? (
          <>
            <Form.Item name="period" label="期间" rules={[{ required: true }]}>
              <Input placeholder="202601" />
            </Form.Item>
            <Form.Item name="byDate" valuePropName="checked">
              <Checkbox>按照日期、旧号、ID重新排序</Checkbox>
            </Form.Item>
          </>
        ) : (
          <Form.Item
            name="date"
            label="目标日期"
            rules={[{ required: operation?.action !== 'modify' }]}
          >
            <Input type="date" />
          </Form.Item>
        )}
        <Form.Item
          name="type"
          label="目标凭证类型"
          rules={[{ required: operation?.action !== 'modify' }]}
        >
          <Select
            options={types.filter((t) => !t.disabled).map((t) => ({ value: t.id, label: t.code }))}
          />
        </Form.Item>
        {original && (
          <Alert
            type="info"
            title={`原凭证：${original.date} ${original.displayNo}`}
            description={
              operation?.action === 'reverse'
                ? '红字同向负数：借贷金额、原币与数量取反，汇率和单价保持；保留辅助项，并建立双向关联'
                : operation?.action === 'insert'
                  ? '以下内容初始复制自所选凭证，可直接修改摘要、科目和金额。保存后是完整待审核凭证；所选号及其后编号加一'
                  : '生成新的手工待审核凭证，使用新编号和当前制单人'
            }
          />
        )}
        {operation?.action === 'insert' && (
          <Form.List name="lines">
            {(fields) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="start" wrap>
                    <Form.Item
                      name={[field.name, 'summary']}
                      label={`第${field.name + 1}行摘要`}
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'accountId']}
                      label="科目"
                      rules={[{ required: true }]}
                    >
                      <AccountSelect style={{ width: 200 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'debit']} label="借方">
                      <MoneyInput />
                    </Form.Item>
                    <Form.Item name={[field.name, 'credit']} label="贷方">
                      <MoneyInput />
                    </Form.Item>
                  </Space>
                ))}
              </>
            )}
          </Form.List>
        )}
      </Form>
    </Drawer>
  );
}
export function VoucherLines({ voucher }: { voucher: Voucher }) {
  const navigate = useNavigate();
  return (
    <>
      <Space wrap>
        {voucher.source && (
          <Tag>
            来源 {voucher.source.module}/{voucher.source.type}/{voucher.source.id}
          </Tag>
        )}
        {voucher.reversalOfId && (
          <a href={`/m/voucher-book?id=${voucher.reversalOfId}`}>原凭证 #{voucher.reversalOfId}</a>
        )}
        {voucher.note && <span>{voucher.note}</span>}
      </Space>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={voucher.lines}
        columns={[
          { title: '行', dataIndex: 'lineNo' },
          { title: '摘要', dataIndex: 'summary' },
          {
            title: '科目（双击明细账）',
            render: (_, l) => (
              <a
                onDoubleClick={() => {
                  void queryClient
                    .fetchQuery({
                      ...api.ledgerLink.queryOptions({ id: voucher.id, lineId: l.id }),
                      staleTime: 0,
                    })
                    .then((to) => navigate(to));
                }}
              >
                {l.accountCode} {l.accountName}
              </a>
            ),
          },
          {
            title: '辅助项ID',
            render: (_, l) =>
              Object.entries(l.dimensions)
                .filter(([, id]) => id != null)
                .map(
                  ([t, id]) =>
                    `${({ project: '项目', partner: '客供', department: '部门', person: '个人', cashflow: '现金流量' } as Record<string, string>)[t] ?? t}:${id}`,
                )
                .join(' / '),
          },
          { title: '借方', render: (_, l) => formatMoney(l.debit) },
          { title: '贷方', render: (_, l) => formatMoney(l.credit) },
          {
            title: '币种/汇率/原币',
            render: (_, l) =>
              l.currency
                ? `${l.currency} / ${l.exchangeRate} / ${formatMoney(l.fcAmount ?? 0)}`
                : '—',
          },
          { title: '数量/单价', render: (_, l) => `${l.quantity ?? '—'} / ${l.unitPrice ?? '—'}` },
          { title: '票号/业务日期', render: (_, l) => `${l.refNo ?? '—'} / ${l.bizDate ?? '—'}` },
        ]}
      />
    </>
  );
}
function ViewDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const v = useQuery(api.detail.queryOptions({ id: id ?? 1 }, { enabled: id != null }));
  return (
    <Drawer open={id != null} title="凭证浏览" size={1100} onClose={onClose} destroyOnHidden>
      {v.data && (
        <>
          <h4>
            {v.data.date} {v.data.displayNo} · {VOUCHER_STATUS_LABELS[v.data.status]}
          </h4>
          {!!v.data.readonlyReasons.length && (
            <Alert title="只读原因" description={v.data.readonlyReasons.join('；')} type="info" />
          )}
          {v.data.sourceUrl && <a href={v.data.sourceUrl}>查看来源</a>}
          <VoucherLines voucher={v.data} />
          <p>
            制单人：{v.data.createdBy.name}；审核人：{v.data.auditedBy?.name ?? '—'}；记账人：
            {v.data.postedBy?.name ?? '—'}
          </p>
          {v.data.reversals.map((r) => (
            <p key={r.id}>
              <a href={`/m/voucher-book?id=${r.id}`}>
                冲销凭证 #{r.id} · {r.date} · {formatMoney(r.debit_total)}
              </a>
            </p>
          ))}
        </>
      )}
      {v.isError && <Alert type="error" title={v.error.message} />}
    </Drawer>
  );
}
