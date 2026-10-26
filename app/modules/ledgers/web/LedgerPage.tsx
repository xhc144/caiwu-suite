import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Modal,
  Select,
  Space,
  Spin,
  Typography,
} from 'antd';
import { DIMENSION_TYPES, type DimensionValues } from '@caiwu/core';
import {
  coreApi,
  notify,
  queryClient,
  showError,
  useAccounts,
  useCurrentPeriod,
  usePermission,
} from '@caiwu/web-kit';
import {
  AccountSelect,
  DataTable,
  DimensionSelect,
  FilterBar,
  PageContainer,
  PeriodPicker,
  downloadBlob,
  type DataColumn,
} from '@caiwu/ui';
import { printHtml } from '@caiwu/print';
import { displayColumns } from '../presentation';
import {
  COLUMN_IDS,
  DEFAULT_COLUMNS,
  parseLedgerUrl,
  TITLES,
  type ColumnId,
  type LedgerFormat,
  type LedgerKind,
  type LedgerRow,
} from '../shared';
import { api } from './api';
import { useLedgerFilters } from './filters';
import './ledger.css';

type Filters = {
  from: number;
  to: number;
  account?: number;
  accountTo?: number;
  dimensions: DimensionValues;
  currency: string;
  includeUnposted: boolean;
};

export default function LedgerPage() {
  const location = useLocation();
  const current = useCurrentPeriod();
  const kind: LedgerKind = location.pathname.endsWith('/cash')
    ? 'cash'
    : location.pathname.endsWith('/bank')
      ? 'bank'
      : 'detail';
  if (!current)
    return (
      <Spin tip="正在读取会计期间">
        <div style={{ minHeight: 160 }} />
      </Spin>
    );
  return <LedgerContent key={kind} kind={kind} current={current.period} />;
}
function LedgerContent({ kind, current }: { kind: LedgerKind; current: number }) {
  const navigate = useNavigate();
  const { byId, byCode } = useAccounts();
  // 使用字符串默认值，避免 useUrlFilters 自动转换错误布尔值或非法期间。
  const [url, setUrl] = useLedgerFilters();
  const parsed = parseLedgerUrl(url, current, kind);
  const input = parsed.query;
  const fallback = {
    kind,
    periodFrom: current,
    periodTo: current,
    account: '',
    accountTo: '',
    dimensions: {},
    currency: '',
    includeUnposted: false,
  };
  const list = useQuery({ ...api.report.queryOptions(input ?? fallback), enabled: !!input });
  const format = useQuery(api.format.queryOptions({ kind }));
  const currencies = useQuery(coreApi.reference.currencies.queryOptions());
  const canExport = usePermission('ledgers.export');
  const canPrint = usePermission('ledgers.print');
  const canConfig = usePermission('ledgers.config.edit');
  const resetting = useRef(false);
  const [editing, setEditing] = useState(false);
  const [output, setOutput] = useState<'export' | 'print' | null>(null);
  const [modal, modalContext] = Modal.useModal();
  const columns = displayColumns(kind, format.data?.columns ?? DEFAULT_COLUMNS);
  const tableColumns: DataColumn<LedgerRow>[] = columns.map((c) => ({
    key: c.id,
    title: c.label,
    dataIndex: c.id,
    money: c.money,
    width: c.id === 'summary' || c.id === 'account' ? 230 : c.id === 'date' ? 150 : 130,
    ...(c.id === 'voucherNo'
      ? {
          render: (_: unknown, row: LedgerRow) =>
            row.href ? (
              <Typography.Link
                href={row.href}
                onClick={(event) => {
                  event.preventDefault();
                  void navigate(row.href!);
                }}
              >
                {row.voucherNo}
              </Typography.Link>
            ) : null,
        }
      : {}),
  }));
  const reset = () =>
    setUrl({
      from: '',
      to: '',
      account: '',
      accountTo: '',
      dims: '',
      currency: '',
      includeUnposted: '',
    });
  const runOutput = async (mode: 'export' | 'print') => {
    if (!input || output) return;
    setOutput(mode);
    try {
      const request = { ...input, columns: format.data?.columns ?? DEFAULT_COLUMNS };
      if (mode === 'export') {
        const result = await queryClient.fetchQuery({
          ...api.export.queryOptions(request),
          staleTime: 0,
        });
        const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
        downloadBlob(
          new Blob([bytes], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
          result.fileName,
        );
      } else {
        const job = await queryClient.fetchQuery({
          ...api.print.queryOptions(request),
          staleTime: 0,
        });
        await printHtml(job);
      }
    } catch (error) {
      showError(error);
    } finally {
      setOutput(null);
    }
  };
  const restore = async () => {
    const yes = await modal.confirm({
      title: '恢复标准账簿格式？',
      content: '将恢复默认显示列；筛选条件和凭证数据不变。',
      okText: '恢复',
      cancelText: '取消',
    });
    if (!yes || !format.data) return;
    restoreMutation.mutate({
      kind,
      columns: DEFAULT_COLUMNS,
      expectedRevision: format.data.revision,
      confirmed: true,
    });
  };
  const restoreMutation = useMutation(
    api.restoreFormat.mutationOptions({ onSuccess: () => void format.refetch() }),
  );
  const filterKey = JSON.stringify(url) + byCode.size;
  return (
    <PageContainer
      title={TITLES[kind]}
      subtitle="各科目独立成账；点击凭证号或双击分录查看凭证。账簿内不提供凭证修改和删除。"
    >
      {modalContext}
      <FilterBar<Filters>
        onReset={() => {
          resetting.current = true;
        }}
        key={filterKey}
        initialValues={{
          from: input?.periodFrom ?? current,
          to: input?.periodTo ?? current,
          account: byCode.get(url.account)?.id,
          accountTo: byCode.get(url.accountTo)?.id,
          dimensions: input?.dimensions ?? {},
          currency: url.currency,
          includeUnposted: input?.includeUnposted ?? false,
        }}
        onSearch={(v) => {
          if (resetting.current) {
            resetting.current = false;
            reset();
            return;
          }
          const dimensions = Object.fromEntries(
            Object.entries(v.dimensions ?? {}).filter(([, value]) => value != null),
          );
          setUrl({
            from: String(v.from),
            to: String(v.to),
            account: v.account ? (byId.get(v.account)?.code ?? '') : '',
            accountTo: v.accountTo ? (byId.get(v.accountTo)?.code ?? '') : '',
            dims: Object.keys(dimensions).length ? JSON.stringify(dimensions) : '',
            currency: v.currency ?? '',
            includeUnposted: v.includeUnposted ? '1' : '0',
          });
        }}
      >
        <Form.Item name="from" label="开始期间">
          <PeriodPicker />
        </Form.Item>
        <Form.Item name="to" label="结束期间">
          <PeriodPicker />
        </Form.Item>
        <Form.Item name="account" label="科目/范围起">
          <AccountSelect
            leafOnly={false}
            includeDisabled
            allowClear
            filter={(a) => kind === 'detail' || (kind === 'cash' ? a.isCash : a.isBank)}
            style={{ width: 220 }}
          />
        </Form.Item>
        <Form.Item name="accountTo" label="范围止">
          <AccountSelect
            leafOnly={false}
            includeDisabled
            allowClear
            filter={(a) => kind === 'detail' || (kind === 'cash' ? a.isCash : a.isBank)}
            style={{ width: 220 }}
          />
        </Form.Item>
        <Form.Item name="currency" label="币种">
          <Select
            allowClear
            placeholder="全部币种（本位币金额）"
            style={{ width: 230 }}
            options={(currencies.data ?? []).map((c) => ({
              value: c.code,
              label: `${c.code} ${c.name}`,
            }))}
          />
        </Form.Item>
        {DIMENSION_TYPES.map((dt) => (
          <Form.Item key={dt.id} name={['dimensions', dt.id]} label={dt.name}>
            <DimensionSelect type={dt.id} includeDisabled style={{ width: 180 }} />
          </Form.Item>
        ))}
        <Form.Item name="includeUnposted" valuePropName="checked">
          <Checkbox>包含未过账凭证</Checkbox>
        </Form.Item>
      </FilterBar>
      {parsed.error && (
        <Alert
          type="error"
          title="筛选条件无效"
          description={parsed.error}
          action={<Button onClick={reset}>重置筛选</Button>}
        />
      )}
      {list.error && (
        <Alert
          type="error"
          title="查询失败"
          description={list.error.message}
          action={<Button onClick={() => void list.refetch()}>重试</Button>}
        />
      )}
      {format.error && (
        <Alert type="error" title="账簿格式读取失败" description={format.error.message} />
      )}
      {input && (
        <Alert
          type={input.includeUnposted ? 'warning' : 'info'}
          title={
            list.data?.scope ??
            (input.includeUnposted
              ? '包含未过账（待审核、已审核、已过账）；草稿和作废凭证始终排除'
              : '仅已过账；草稿和作废凭证始终排除')
          }
        />
      )}
      <Space wrap style={{ marginBlock: 12 }}>
        <Button onClick={() => void list.refetch()} disabled={!input} loading={list.isFetching}>
          刷新
        </Button>
        {canExport && (
          <Button
            onClick={() => void runOutput('export')}
            loading={output === 'export'}
            disabled={!input || list.isFetching || output != null}
          >
            导出 Excel
          </Button>
        )}
        {canPrint && (
          <Button
            onClick={() => void runOutput('print')}
            loading={output === 'print'}
            disabled={!input || list.isFetching || output != null}
          >
            打印
          </Button>
        )}
        {canConfig && (
          <>
            <Button disabled={!format.data} onClick={() => setEditing(true)}>
              保存显示格式
            </Button>
            <Button
              disabled={!format.data}
              loading={restoreMutation.isPending}
              onClick={() => void restore()}
            >
              恢复标准格式
            </Button>
          </>
        )}
        <Typography.Text type="secondary">
          金额单位：元（本位币）；未填科目范围表示全部，单选上级科目展开下级
        </Typography.Text>
      </Space>
      <DataTable<LedgerRow>
        tableId={`ledgers.${kind}`}
        rowKey="id"
        columns={tableColumns}
        dataSource={input && !list.error ? (list.data?.rows ?? []) : []}
        loading={list.isFetching}
        pagination={{ pageSize: 100, showSizeChanger: true }}
        locale={{ emptyText: '当前筛选没有账簿记录，请调整期间或科目范围' }}
        rowClassName={(r) => (r.kind === 'entry' ? '' : `ledgers-summary ledgers-${r.kind}`)}
        onRow={(r) => ({
          onDoubleClick: () => {
            if (r.href) void navigate(r.href);
          },
        })}
      />
      {format.data && (
        <FormatDrawer
          key={`${editing}-${format.data.revision}`}
          open={editing}
          onClose={() => setEditing(false)}
          kind={kind}
          format={format.data}
          onSaved={() => void format.refetch()}
        />
      )}
    </PageContainer>
  );
}
function FormatDrawer({
  open,
  onClose,
  kind,
  format,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  kind: LedgerKind;
  format: LedgerFormat;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<ColumnId[]>(format.columns);
  const save = useMutation(
    api.saveFormat.mutationOptions({
      onSuccess: () => {
        onSaved();
        onClose();
        notify.success('显示格式已保存');
      },
    }),
  );
  return (
    <Drawer
      title="保存账簿显示格式"
      open={open}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            disabled={!selected.length}
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                kind,
                columns: selected,
                expectedRevision: format.revision,
                confirmed: true,
              })
            }
          >
            确认保存
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph>
        勾选实际显示、导出和打印的列。确认保存后应用到账套；列宽在本机自动记忆。
      </Typography.Paragraph>
      <Checkbox.Group
        value={selected}
        options={displayColumns(kind, [...COLUMN_IDS]).map((c) => ({
          value: c.id,
          label: c.label,
        }))}
        onChange={(value) => setSelected(COLUMN_IDS.filter((id) => value.includes(id)))}
      />
    </Drawer>
  );
}
