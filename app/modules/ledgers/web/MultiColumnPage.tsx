import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Form, Select, Space, Spin, Typography } from 'antd';
import { makePeriod, periodYear } from '@caiwu/core';
import {
  queryClient,
  showError,
  useAccounts,
  useCurrentPeriod,
  usePermission,
} from '@caiwu/web-kit';
import {
  AccountSelect,
  DataTable,
  downloadBlob,
  FilterBar,
  MoneyText,
  PageContainer,
  PeriodPicker,
  useUrlFilters,
  type DataColumn,
} from '@caiwu/ui';
import { MULTI_MODES, parseMultiUrl, type MultiQuery, type MultiRow } from '../multicolumn';
import { api } from './api';
import './ledger.css';

const defaults = { account: '', from: '', to: '', mode: '', includeEmpty: '', includeUnposted: '' };
function useMultiFilters() {
  const location = useLocation();
  const [persisted, persist] = useUrlFilters(defaults);
  const source = `${location.key}:${JSON.stringify(persisted)}`;
  const [applied, setApplied] = useState<{ source: string; values: typeof defaults } | null>(null);
  const values = applied?.source === source ? applied.values : persisted;
  return [
    values,
    (next: Partial<typeof defaults>) => {
      const updated = { ...values, ...next };
      setApplied({ source, values: updated });
      persist(updated);
    },
  ] as const;
}

type Filters = {
  account?: number;
  from: number;
  to: number;
  mode: MultiQuery['mode'];
  includeEmpty: boolean;
  includeUnposted: boolean;
};
export default function MultiColumnPage() {
  const current = useCurrentPeriod();
  if (!current)
    return (
      <Spin tip="正在读取会计期间">
        <div style={{ minHeight: 160 }} />
      </Spin>
    );
  return <MultiContent current={current.period} />;
}
function MultiContent({ current }: { current: number }) {
  const navigate = useNavigate();
  const { byId, byCode } = useAccounts();
  const [url, setUrl] = useMultiFilters();
  const parsed = parseMultiUrl(url, current);
  const input = parsed.query;
  const fallback: MultiQuery = {
    account: '',
    periodFrom: current,
    periodTo: current,
    mode: 'debit',
    includeEmpty: false,
    includeUnposted: false,
  };
  const list = useQuery({ ...api.multiReport.queryOptions(input ?? fallback), enabled: !!input });
  const canExport = usePermission('ledgers.export');
  const [exporting, setExporting] = useState(false);
  const resetting = useRef(false);
  const reset = () => setUrl({ ...defaults });
  const columns: DataColumn<MultiRow>[] = [
    { key: 'date', title: '日期/期间', dataIndex: 'date', width: 145, fixed: 'left' },
    { key: 'summary', title: '摘要', dataIndex: 'summary', width: 220 },
    {
      key: 'voucherNo',
      title: '凭证号',
      width: 125,
      render: (_, row) =>
        row.href ? (
          <Typography.Link
            href={row.href}
            onClick={(e) => {
              e.preventDefault();
              void navigate(row.href!);
            }}
          >
            {row.voucherNo}
          </Typography.Link>
        ) : null,
    },
    { key: 'status', title: '状态', dataIndex: 'status', width: 100 },
    { key: 'debit', title: '借方', dataIndex: 'debit', money: true, width: 135 },
    { key: 'credit', title: '贷方', dataIndex: 'credit', money: true, width: 135 },
    { key: 'side', title: '方向', dataIndex: 'side', width: 70 },
    { key: 'balance', title: '余额', dataIndex: 'balance', money: true, width: 150 },
    ...(list.data?.columns ?? []).map((c): DataColumn<MultiRow> => ({
      key: `child-${c.id}`,
      title: `${c.code} ${c.name}（${MULTI_MODES[list.data?.query.mode ?? input?.mode ?? 'debit']}）`,
      money: true,
      width: 185,
      render: (_, row) => {
        const value = row.values[c.id];
        if (value == null || !input) return null;
        const p = row.period;
        const start =
          row.kind === 'ytd'
            ? Math.max(makePeriod(periodYear(p), 1), list.data?.startPeriod ?? p)
            : p;
        // 累计追溯覆盖本年实际启用后的全部月份；明细页仍显示核心YTD及账前累计。
        const href = `/m/ledgers/detail?${new URLSearchParams({ account: c.code, from: String(start), to: String(p), includeUnposted: (list.data?.query.includeUnposted ?? input.includeUnposted) ? '1' : '0' })}`;
        return (
          <Typography.Link
            href={href}
            onClick={(e) => {
              e.preventDefault();
              void navigate(href);
            }}
          >
            <MoneyText value={value} />
          </Typography.Link>
        );
      },
    })),
  ];
  const runExport = async () => {
    if (!input || exporting) return;
    setExporting(true);
    try {
      const file = await queryClient.fetchQuery({
        ...api.multiExport.queryOptions(input),
        staleTime: 0,
      });
      queryClient.setQueryData(api.multiReport.queryKey(input), file.report);
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      downloadBlob(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        file.fileName,
      );
    } catch (error) {
      showError(error);
    } finally {
      setExporting(false);
    }
  };
  return (
    <PageContainer
      title="多栏账"
      subtitle="选择非末级科目，按直属下级自动分栏；各栏汇总其完整下级，点击分栏金额查看明细，点击凭证号查看原凭证。"
    >
      <FilterBar<Filters>
        key={JSON.stringify(url) + byCode.size}
        initialValues={{
          account: byCode.get(url.account)?.id,
          from: input?.periodFrom ?? current,
          to: input?.periodTo ?? current,
          mode: input?.mode ?? 'debit',
          includeEmpty: input?.includeEmpty ?? false,
          includeUnposted: input?.includeUnposted ?? false,
        }}
        onReset={() => {
          resetting.current = true;
        }}
        onSearch={(v) => {
          if (resetting.current) {
            resetting.current = false;
            reset();
            return;
          }
          setUrl({
            account: v.account ? (byId.get(v.account)?.code ?? '') : '',
            from: String(v.from),
            to: String(v.to),
            mode: v.mode,
            includeEmpty: v.includeEmpty ? '1' : '0',
            includeUnposted: v.includeUnposted ? '1' : '0',
          });
        }}
      >
        <Form.Item name="account" label="上级科目">
          <AccountSelect leafOnly={false} includeDisabled allowClear style={{ width: 240 }} />
        </Form.Item>
        <Form.Item name="from" label="开始期间">
          <PeriodPicker />
        </Form.Item>
        <Form.Item name="to" label="结束期间">
          <PeriodPicker />
        </Form.Item>
        <Form.Item name="mode" label="分栏取数">
          <Select
            style={{ width: 160 }}
            options={Object.entries(MULTI_MODES).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item name="includeEmpty" valuePropName="checked">
          <Checkbox>含没有数据的科目</Checkbox>
        </Form.Item>
        <Form.Item name="includeUnposted" valuePropName="checked">
          <Checkbox>包含未过账凭证</Checkbox>
        </Form.Item>
      </FilterBar>
      {!url.account ? (
        <Alert type="info" title="请选择含下级科目的上级科目后查询" />
      ) : (
        parsed.error && (
          <Alert
            type="error"
            title="筛选条件无效"
            description={parsed.error}
            action={<Button onClick={reset}>重置筛选</Button>}
          />
        )
      )}
      {list.error && <Alert type="error" title="查询失败" description={list.error.message} />}
      {list.data && !list.error && (
        <Alert
          type={input?.includeUnposted ? 'warning' : 'info'}
          title={list.data.accountName}
          description={list.data.scope}
        />
      )}
      <Space wrap style={{ marginBlock: 12 }}>
        <Button onClick={() => void list.refetch()} disabled={!input} loading={list.isFetching}>
          刷新
        </Button>
        {canExport && (
          <Button
            onClick={() => void runExport()}
            disabled={!input || !!list.error || list.isFetching}
            loading={exporting}
          >
            导出 Excel
          </Button>
        )}
        <Typography.Text type="secondary">
          金额单位：元；本位币。科目分栏超过248列时拒绝导出；当前提供自动分栏及通用Excel。
        </Typography.Text>
      </Space>
      <DataTable<MultiRow>
        tableId="ledgers.multicolumn"
        rowKey="id"
        columns={columns}
        dataSource={input && !list.error ? (list.data?.rows ?? []) : []}
        loading={list.isFetching}
        pagination={{ pageSize: 100, showSizeChanger: true }}
        rowClassName={(r) => (r.kind === 'entry' ? '' : `ledgers-summary ledgers-${r.kind}`)}
        locale={{ emptyText: '当前条件没有多栏账记录，请选择上级科目或调整期间' }}
      />
    </PageContainer>
  );
}
