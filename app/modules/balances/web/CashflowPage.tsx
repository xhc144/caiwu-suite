import { useEffect, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Checkbox, Form, Input, Modal, Select, Space, Spin, Typography } from 'antd';
import { printHtml, renderPrintDocument, type PrintJob } from '@caiwu/print';
import {
  getBusinessError,
  notify,
  queryClient,
  showError,
  useHotkey,
  usePermission,
} from '@caiwu/web-kit';
import {
  ActionAlert,
  DataTable,
  FilterBar,
  MoneyText,
  PageContainer,
  useUrlFilters,
  type DataColumn,
} from '@caiwu/ui';
import type { BalancesRouter } from '../server/router';
import {
  CashflowDisplaySchema,
  cashflowCaption,
  cashflowRows,
  cashflowVoucherUrl,
  defaultCashflowSettings,
  type CashflowDetail,
  type CashflowProject,
} from '../cashflow';
import { api } from './api';
import { cashflowSummary, exportCashflowReport } from './cashflow-output';
import { buildCashflowPrintJob } from './cashflow-book-print';

type Filters = {
  from: string;
  to: string;
  codeFrom: string;
  codeTo: string;
  project: string;
  includeUnposted: boolean;
  allowLarge: boolean;
  sort: string;
  pageSize: number;
  showAccount: boolean;
};
type Meta = inferRouterOutputs<BalancesRouter>['cashflowMetadata'];
export default function CashflowPage() {
  const meta = useQuery(api.cashflowMetadata.queryOptions(undefined, { meta: { silent: true } }));
  if (meta.isError) return <QueryError error={meta.error} />;
  if (!meta.data)
    return (
      <Spin tip="正在读取现金流量条件">
        <div style={{ height: 120 }} />
      </Spin>
    );
  return <CashflowContent metadata={meta.data} />;
}
function CashflowContent({ metadata }: { metadata: Meta }) {
  const { modal } = App.useApp();
  const canExport = usePermission('balances.export');
  const canSettings = usePermission('balances.settings.edit');
  const canVoucherBook = usePermission('voucher-book.view');
  const defaults = metadata.settings.display;
  const [url, setUrl] = useUrlFilters<Filters>({
    from: '',
    to: '',
    codeFrom: '',
    codeTo: '',
    project: '',
    includeUnposted: false,
    allowLarge: false,
    sort: defaults.sort as string,
    pageSize: defaults.pageSize as number,
    showAccount: defaults.showAccount,
  });
  const [filters, setLocal] = useState(url);
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = url;
    setLocal(url);
  }, [url]);
  const change = (patch: Partial<typeof filters>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setLocal(next);
    setUrl(next);
    setPage(1);
    setSelected(null);
  };
  const display = CashflowDisplaySchema.safeParse(filters);
  const format = display.success ? display.data : defaultCashflowSettings.display;
  const [settings, setSettings] = useState(metadata.settings);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PrintJob | null>(null);
  const input = {
    periodFrom: filters.from ? Number(filters.from) : undefined,
    periodTo: filters.to ? Number(filters.to) : undefined,
    codeFrom: filters.codeFrom,
    codeTo: filters.codeTo,
    project: filters.project,
    includeUnposted: filters.includeUnposted,
    allowLarge: filters.allowLarge,
  };
  const report = useQuery(api.cashflow.queryOptions(input, { meta: { silent: true } }));
  const save = useMutation(api.saveCashflowSettings.mutationOptions({ meta: { silent: true } }));
  const rows = report.data ? cashflowRows(report.data, format.sort, search) : [];
  const ask = (title: string, content: string, run: () => void | Promise<void>) =>
    modal.confirm({ title, content, okText: '继续', cancelText: '取消', onOk: run });
  const refresh = () =>
    ask(
      '刷新现金流量',
      '数据较多时刷新可能较慢，可先按项目或科目定位。是否继续读取全部明细？',
      async () => {
        if (!filters.allowLarge) change({ allowLarge: true });
        else await report.refetch();
      },
    );
  const output = async (kind: 'excel' | 'batch' | 'preview' | 'print' | 'continuous') => {
    setBusy(true);
    try {
      const data = await queryClient.fetchQuery({
        ...api.exportCashflow.queryOptions(
          { ...input, project: kind === 'batch' || kind === 'continuous' ? '' : input.project },
          { meta: { silent: true } },
        ),
        staleTime: 0,
      });
      if (kind === 'excel' || kind === 'batch')
        await exportCashflowReport(data, format, kind === 'batch');
      else {
        const job = buildCashflowPrintJob(data, format, kind === 'continuous');
        if (kind === 'preview') setPreview(job);
        else await printHtml(job);
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const saveFormat = (restore: boolean) =>
    ask(
      restore ? '恢复标准格式？' : '保存窗口格式？',
      restore
        ? '恢复日期顺序、每页 50 行并显示科目；只改变窗口格式。'
        : '将当前排序、每页行数和科目显示保存为本账套默认格式。',
      async () => {
        try {
          const next = await save.mutateAsync({
            revision: settings.revision,
            display: restore ? defaultCashflowSettings.display : format,
          });
          setSettings(next);
          if (restore) change(next.display);
          notify.success('窗口格式已保存');
        } catch {
          /* 保留当前视图；错误在页面内显示 */
        }
      },
    );
  const loadFormat = async () => {
    try {
      const fresh = await queryClient.fetchQuery({
        ...api.cashflowMetadata.queryOptions(undefined, { meta: { silent: true } }),
        staleTime: 0,
      });
      setSettings(fresh.settings);
      change(fresh.settings.display);
      save.reset();
    } catch (e) {
      showError(e);
    }
  };
  const move = (target: number) => {
    if (!rows.length) return;
    const index = Math.min(rows.length - 1, Math.max(0, target));
    setSelected(rows[index]!.lineId);
    setPage(Math.floor(index / format.pageSize) + 1);
  };
  const selectedIndex = rows.findIndex((r) => r.lineId === selected);
  useHotkey('Ctrl+Home', () => move(0), { allowInInput: false });
  useHotkey('Ctrl+End', () => move(rows.length - 1), { allowInInput: false });
  useHotkey('ArrowUp', () => move(selectedIndex - 1), { allowInInput: false });
  useHotkey('ArrowDown', () => move(selectedIndex + 1), { allowInInput: false });
  useHotkey('Ctrl+P', () => {
    if (canExport && !busy && report.data) void output('preview');
  });
  const columns: DataColumn<CashflowDetail>[] = [
    { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
    {
      key: 'displayNo',
      title: '凭证字号',
      dataIndex: 'displayNo',
      width: 125,
      render: (_, r) => (
        <a href={cashflowVoucherUrl(r.voucherId)} aria-label={`追查 ${r.displayNo}`}>
          {r.displayNo}
        </a>
      ),
    },
    { key: 'lineNo', title: '分录行', dataIndex: 'lineNo', width: 70 },
    { key: 'summary', title: '摘要', dataIndex: 'summary', width: 240 },
    { key: 'projectName', title: '现金流量项目', dataIndex: 'projectName', width: 250 },
    { key: 'directionName', title: '现金流向', dataIndex: 'directionName', width: 110 },
    {
      key: 'allocated',
      title: '分配状态',
      width: 100,
      render: (_, r) => (r.allocated ? '已分配' : '未分配'),
    },
    ...(format.showAccount
      ? [
          { key: 'accountCode', title: '科目编码', dataIndex: 'accountCode', width: 110 },
          { key: 'accountName', title: '科目名称', dataIndex: 'accountName', width: 200 },
        ]
      : []),
    { key: 'debit', title: '收款（借方）', dataIndex: 'debit', money: true },
    { key: 'credit', title: '付款（贷方）', dataIndex: 'credit', money: true },
    { key: 'runningNet', title: '本期净额累计', dataIndex: 'runningNet', money: true },
  ];
  const projectColumns: DataColumn<CashflowProject>[] = [
    { key: 'code', title: '项目编码', dataIndex: 'code', width: 100 },
    {
      key: 'name',
      title: '现金流量项目',
      dataIndex: 'name',
      width: 300,
      render: (_, r) => (
        <Button type="link" onClick={() => change({ project: r.key })}>
          {r.name}
        </Button>
      ),
    },
    ...(['inflow', 'outflow', 'internalNet', 'unallocatedNet', 'cashNet'] as const).map(
      (key, i) => ({
        key,
        title: ['已分配流入', '已分配流出', '内部互转净额', '未分配差额', '本期净额'][i]!,
        dataIndex: key,
        money: true,
      }),
    ),
    {
      key: 'ytdInflow',
      title: report.data?.ytdComplete === false ? '启用后流入' : '本年流入',
      money: true,
      render: (_, r) => <MoneyText value={r.ytd.inflow} />,
    },
    {
      key: 'ytdOutflow',
      title: report.data?.ytdComplete === false ? '启用后流出' : '本年流出',
      money: true,
      render: (_, r) => <MoneyText value={r.ytd.outflow} />,
    },
    {
      key: 'ytdNet',
      title: report.data?.ytdComplete === false ? '启用后净额' : '本年净额',
      money: true,
      render: (_, r) => <MoneyText value={r.ytd.cashNet} />,
    },
  ];
  return (
    <PageContainer
      title="现金流量试算平衡表"
      subtitle="按真实现金银行分录试算；项目或流向缺失列入未分配，互转单列。"
      extra={
        <>
          <Button onClick={refresh} loading={report.isFetching}>
            刷新
          </Button>
          {canSettings && (
            <>
              <Button onClick={() => saveFormat(false)} loading={save.isPending}>
                保存格式
              </Button>
              <Button onClick={() => saveFormat(true)} disabled={save.isPending}>
                恢复标准格式
              </Button>
              <Button onClick={() => void loadFormat()}>读取已存格式</Button>
            </>
          )}
          {canExport && (
            <>
              {(['excel', 'batch', 'preview', 'print', 'continuous'] as const).map((kind, i) => (
                <Button
                  key={kind}
                  disabled={!report.data || busy || report.isFetching}
                  onClick={() => void output(kind)}
                >
                  {['另存 Excel', '批量转出各项目', '打印预览', '打印', '连续打印各项目'][i]}
                </Button>
              ))}
            </>
          )}
        </>
      }
    >
      <FilterBar<{ from: string; to: string; codeFrom: string; codeTo: string }>
        key={`${filters.from}:${filters.to}:${filters.codeFrom}:${filters.codeTo}`}
        initialValues={filters}
        onSearch={(v) =>
          change({
            from: v.from ?? '',
            to: v.to ?? '',
            codeFrom: v.codeFrom ?? '',
            codeTo: v.codeTo ?? '',
            allowLarge: false,
          })
        }
      >
        <Form.Item name="from" label="开始期间">
          <Input
            aria-label="开始期间"
            placeholder={String(metadata.current)}
            style={{ width: 110 }}
          />
        </Form.Item>
        <Form.Item name="to" label="结束期间">
          <Input
            aria-label="结束期间"
            placeholder={String(metadata.current)}
            style={{ width: 110 }}
          />
        </Form.Item>
        <Form.Item name="codeFrom" label="开始科目">
          <Input aria-label="开始科目" list="cashflow-accounts" style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name="codeTo" label="结束科目">
          <Input aria-label="结束科目" list="cashflow-accounts" style={{ width: 140 }} />
        </Form.Item>
      </FilterBar>
      <datalist id="cashflow-accounts">
        {metadata.accounts
          .filter((a) => a.isCash || a.isBank || a.cashflowRequired)
          .map((a) => (
            <option key={a.id} value={a.code}>
              {a.fullName}
            </option>
          ))}
      </datalist>
      <Space wrap style={{ marginBottom: 12 }}>
        <label>
          现金流量项目{' '}
          <Select
            aria-label="现金流量项目"
            style={{ width: 350 }}
            value={filters.project}
            showSearch={{ optionFilterProp: 'label' }}
            onChange={(project) => change({ project })}
            options={[
              { value: '', label: '全部项目' },
              { value: 'unallocated', label: '未分配（项目或流向缺失）' },
              ...metadata.projects.map((p) => ({
                value: String(p.id),
                label: `${p.code} ${p.name}`,
              })),
            ]}
          />
        </label>
        <Checkbox
          checked={filters.includeUnposted}
          onChange={(e) => {
            if (!e.target.checked) change({ includeUnposted: false });
            else
              ask('包含未过账凭证？', '将包含待审核、已审核、已过账凭证，排除草稿和作废。', () =>
                change({ includeUnposted: true }),
              );
          }}
        >
          包含未过账凭证
        </Checkbox>
        <label>
          排序{' '}
          <select
            aria-label="排序"
            value={format.sort}
            onChange={(e) => change({ sort: e.target.value })}
          >
            <option value="date">日期顺序</option>
            <option value="account">科目顺序</option>
            <option value="amount">净额从大到小</option>
          </select>
        </label>
        <label>
          每页{' '}
          <select
            aria-label="每页行数"
            value={format.pageSize}
            onChange={(e) => change({ pageSize: Number(e.target.value) })}
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} 行
              </option>
            ))}
          </select>
        </label>
        <Checkbox
          checked={format.showAccount}
          onChange={(e) => change({ showAccount: e.target.checked })}
        >
          显示科目
        </Checkbox>
      </Space>
      {save.isError && <QueryError error={save.error} />}
      {report.isError ? (
        <>
          <QueryError error={report.error} />
          {getBusinessError(report.error)?.code === 'BALANCES_CASHFLOW_LARGE' && (
            <Button onClick={refresh}>继续查询全部明细</Button>
          )}
        </>
      ) : !report.data ? (
        <Spin tip="正在试算现金流量">
          <div style={{ height: 180 }} />
        </Spin>
      ) : (
        <>
          <Typography.Paragraph>{cashflowCaption(report.data)}</Typography.Paragraph>
          <Typography.Paragraph>
            顶部始终核对所选科目全部项目；项目选择只筛下表。本年累计按结束期间所在年度计算。历史空流向不自动推断。
          </Typography.Paragraph>
          <section aria-label="现金流量核对">
            <Space wrap>
              {cashflowSummary(report.data).map(([label, value]) => (
                <span key={label} style={{ marginRight: 20 }}>
                  {label}：<MoneyText value={value} />
                </span>
              ))}
            </Space>
            <p role="status">
              未分配 {report.data.totals.unallocatedCount} 行；
              {report.data.balanceDifference === 0
                ? '现金银行余额与分录净变动一致'
                : '余额与分录净变动不一致，请核对'}
              。
            </p>
          </section>
          {!!report.data.internalUnbalancedVouchers.length && (
            <ActionAlert
              type="warning"
              title="存在内部互转未配平凭证"
              description={`共 ${report.data.internalUnbalancedVouchers.length} 张凭证的内部互转借贷未配平，请追查并核对项目及流向。`}
              actions={report.data.internalUnbalancedVouchers.map((id, i) => ({
                label: `追查第 ${i + 1} 张凭证`,
                onClick: () => window.location.assign(cashflowVoucherUrl(id)),
              }))}
            />
          )}
          <section aria-label="现金流量项目汇总">
            <DataTable
              tableId="balances.cashflow.projects"
              rowKey="key"
              columns={projectColumns}
              dataSource={report.data.projects}
              loading={report.isFetching}
            />
          </section>
          <Space wrap style={{ margin: '12px 0' }}>
            <Input.Search
              aria-label="明细定位"
              placeholder="摘要、凭证号、科目或项目"
              allowClear
              onSearch={(s) => {
                setSearch(s);
                setPage(1);
                setSelected(null);
              }}
              style={{ width: 330 }}
            />
            <Button onClick={() => move(0)}>首项</Button>
            <Button onClick={() => move(selectedIndex - 1)}>上移</Button>
            <Button onClick={() => move(selectedIndex + 1)}>下移</Button>
            <Button onClick={() => move(rows.length - 1)}>末项</Button>
            {canVoucherBook && selectedIndex >= 0 && (
              <Button href={`/m/voucher-book?id=${rows[selectedIndex]!.voucherId}`}>
                审核及删除所选凭证
              </Button>
            )}
            <span>
              明细 {rows.length} / {report.data.rows.length} 行；定位不改变合计及导出范围。
            </span>
          </Space>
          <p>
            本期净额累计从零开始，按日期和分录顺序计算；排序后仍保留原累计值。双击或点击凭证追查，修改及删除请在凭证页面按权限办理。
          </p>
          <section aria-label="现金流量明细">
            <DataTable<CashflowDetail>
              tableId="balances.cashflow.details"
              rowKey="lineId"
              columns={columns}
              dataSource={rows}
              loading={report.isFetching}
              pagination={{
                current: page,
                pageSize: format.pageSize,
                showSizeChanger: false,
                onChange: setPage,
              }}
              onRow={(r) => ({
                onClick: () => setSelected(r.lineId),
                onDoubleClick: () => window.location.assign(cashflowVoucherUrl(r.voucherId)),
                style: r.lineId === selected ? { background: '#e6f4ff' } : undefined,
              })}
            />
          </section>
        </>
      )}
      <Modal
        title="现金流量打印预览"
        open={!!preview}
        onCancel={() => setPreview(null)}
        width="95vw"
        footer={
          <Button onClick={() => preview && void printHtml(preview).catch(showError)}>
            打印此预览
          </Button>
        }
      >
        {preview && (
          <iframe
            title="现金流量试算打印预览"
            sandbox=""
            srcDoc={renderPrintDocument(preview)}
            style={{ width: '100%', height: '65vh', border: 0 }}
          />
        )}
      </Modal>
    </PageContainer>
  );
}
function QueryError({ error }: { error: unknown }) {
  const data = getBusinessError(error);
  return (
    <ActionAlert
      type="error"
      title={data?.message ?? '读取失败'}
      description={data?.hint ?? (error instanceof Error ? error.message : '请重试')}
    />
  );
}
