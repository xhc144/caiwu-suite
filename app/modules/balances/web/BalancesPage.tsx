import { useEffect, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { BalancesRouter } from '../server/router';
import { useLocation } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  App,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Typography,
} from 'antd';
import type { Account } from '@caiwu/core';
import {
  getBusinessError,
  notify,
  queryClient,
  showError,
  usePermission,
  useHotkey,
  useRequiredSession,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import {
  ActionAlert,
  AccountSelect,
  DataTable,
  FilterBar,
  PageContainer,
  MoneyText,
  type DataColumn,
} from '@caiwu/ui';
import {
  balanceDisplay,
  DisplaySchema,
  SettingsSchema,
  detailUrl,
  locateRows,
  reportCaption,
  reportTitle,
  reportTables,
  groupCaption,
  type OutputRow,
  type Report,
  type ReportGroup,
  type Settings,
} from '../shared';
import { api } from './api';
import { exportReport, columnsFor } from './output';
import BalancePrintDialog from './BalancePrintDialog';
import { useBalanceFilters } from './use-balance-filters';

export default function BalancesPage() {
  const meta = useQuery(api.metadata.queryOptions(undefined, { meta: { silent: true } }));
  if (meta.isError) return <QueryError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data)
    return (
      <Spin tip="正在读取账套条件">
        <div style={{ height: 120 }} />
      </Spin>
    );
  return <BalanceContent metadata={meta.data} />;
}

type Meta = inferRouterOutputs<BalancesRouter>['metadata'];

function BalanceContent({ metadata }: { metadata: Meta }) {
  const location = useLocation();
  const mode = location.pathname.endsWith('/foreign')
    ? ('foreign' as const)
    : location.pathname.endsWith('/quantity')
      ? ('quantity' as const)
      : ('summary' as const);
  const auxiliary = location.pathname.includes('/auxiliary');
  const [filters, setFilters] = useBalanceFilters(metadata.settings, auxiliary);
  const input = {
    mode,
    periodFrom: filters.from ? Number(filters.from) : undefined,
    periodTo: filters.to ? Number(filters.to) : undefined,
    codeFrom: filters.codeFrom,
    codeTo: filters.codeTo,
    currency: filters.currency,
    dims: filters.dims,
    includeUnposted: filters.includeUnposted,
    onlyActivity: filters.onlyActivity,
    dimension: filters.dimension as '' | 'project' | 'partner' | 'department' | 'person',
    dimensionFrom: filters.dimensionFrom,
    dimensionTo: filters.dimensionTo,
    dimensionChildren: filters.dimensionChildren,
    dimensionLevel: filters.dimensionLevel,
    dimensionOrder: filters.dimensionOrder as 'dimension' | 'account',
  };
  const report = useQuery(api.query.queryOptions(input, { meta: { silent: true } }));
  const canExport = usePermission('balances.export');
  const canSettings = usePermission('balances.settings.edit');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSnapshot, setSettingsSnapshot] = useState(metadata.settings);
  const [openingSettings, setOpeningSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printReport, setPrintReport] = useState<Report | null>(null);
  const [locate, setLocate] = useState('');
  const expanded = filters.expanded
    .split(',')
    .map(Number)
    .filter((v) => Number.isSafeInteger(v) && v > 0);
  const level =
    Number.isInteger(filters.level) && filters.level >= -1 && filters.level <= 20
      ? filters.level
      : 1;
  const title = reportTitle({ mode, auxiliary: auxiliary || !!filters.dimension });
  const items = metadata.dimensions[input.dimension || 'project'] ?? [];
  const openSettings = async () => {
    setOpeningSettings(true);
    try {
      // 关闭冲突草稿后重新打开必须取得最新版本，不能再次拿页面缓存的旧 revision。
      const fresh = await queryClient.fetchQuery({
        ...api.metadata.queryOptions(undefined, { meta: { silent: true } }),
        staleTime: 0,
      });
      setSettingsSnapshot(fresh.settings);
      setSettingsOpen(true);
    } catch (error) {
      showError(error);
    } finally {
      setOpeningSettings(false);
    }
  };
  const runOutput = async (kind: 'excel' | 'print') => {
    setBusy(true);
    try {
      const data = await queryClient.fetchQuery({
        ...api.export.queryOptions(input, { meta: { silent: true } }),
        staleTime: 0,
      });
      queryClient.setQueryData(api.query.queryKey(input), data);
      if (kind === 'excel') await exportReport(data, level, expanded);
      else setPrintReport(data);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  useHotkey(
    'Ctrl+P',
    () => {
      if (canExport && !busy && report.data && !report.isFetching) void runOutput('print');
    },
    { allowInInput: false },
  );
  return (
    <PageContainer
      title={title}
      subtitle="期初、期末按实际借贷方向展示；红色及“逆向”提示表示与科目正常方向相反。双击科目或按明细按钮可查账。"
      extra={
        <>
          <Button
            href={`/m/balances${mode === 'summary' ? '/foreign' : ''}${window.location.search}`}
          >
            {mode === 'summary' ? '外币余额表' : '汇总余额表'}
          </Button>
          <Button
            href={`/m/balances${auxiliary ? '/auxiliary' : ''}/quantity${window.location.search}`}
          >
            数量余额表
          </Button>
          <Button
            href={`/m/balances/auxiliary${mode === 'summary' ? '' : `/${mode}`}${window.location.search}`}
          >
            辅助查询
          </Button>
          {canSettings && (
            <Button
              aria-label="展示设置"
              aria-busy={openingSettings}
              loading={openingSettings}
              disabled={openingSettings}
              onClick={() => void openSettings()}
            >
              展示设置
            </Button>
          )}
          {canExport && (
            <>
              <Button
                loading={busy}
                disabled={!report.data || report.isFetching}
                onClick={() => void runOutput('excel')}
              >
                导出 Excel
              </Button>
              <Button
                disabled={!report.data || busy || report.isFetching}
                onClick={() => void runOutput('print')}
              >
                打印
              </Button>
            </>
          )}
        </>
      }
    >
      <FilterBar<{ from: string; to: string; codeFrom: string; codeTo: string }>
        key={`${filters.from}:${filters.to}:${filters.codeFrom}:${filters.codeTo}`}
        initialValues={{
          from: filters.from,
          to: filters.to,
          codeFrom: filters.codeFrom,
          codeTo: filters.codeTo,
        }}
        onSearch={(v) =>
          setFilters({
            from: v.from ?? '',
            to: v.to ?? '',
            codeFrom: v.codeFrom ?? '',
            codeTo: v.codeTo ?? '',
          })
        }
      >
        <Form.Item name="from" label="开始期间">
          <Input
            style={{ width: 110 }}
            placeholder={String(metadata.current)}
            aria-label="开始期间"
          />
        </Form.Item>
        <Form.Item name="to" label="结束期间">
          <Input
            style={{ width: 110 }}
            placeholder={String(metadata.current)}
            aria-label="结束期间"
          />
        </Form.Item>
        <Form.Item name="codeFrom" label="开始科目">
          <AccountRangeSelect accounts={metadata.accounts} label="开始科目" />
        </Form.Item>
        <Form.Item name="codeTo" label="结束科目">
          <AccountRangeSelect accounts={metadata.accounts} label="结束科目" />
        </Form.Item>
      </FilterBar>
      <Space wrap style={{ marginBottom: 12 }}>
        <label>
          核算类型{' '}
          <select
            aria-label="核算类型"
            value={filters.dimension}
            onChange={(e) =>
              setFilters({ dimension: e.target.value, dimensionFrom: '', dimensionTo: '' })
            }
          >
            <option value="">不按辅助项展开</option>
            <option value="project">项目</option>
            <option value="partner">客户/供应商</option>
            <option value="department">部门</option>
            <option value="person">个人</option>
          </select>
        </label>
        {filters.dimension && (
          <>
            {(['dimensionFrom', 'dimensionTo'] as const).map((key) => (
              <label key={key}>
                {key === 'dimensionFrom' ? '开始辅助项' : '结束辅助项'}{' '}
                <Select
                  aria-label={key === 'dimensionFrom' ? '开始辅助项' : '结束辅助项'}
                  style={{ width: 220 }}
                  allowClear
                  showSearch={{ optionFilterProp: 'label' }}
                  value={filters[key] || undefined}
                  placeholder="全部"
                  options={items.map((item) => ({
                    value: item.code,
                    label: `${item.code} ${item.name}${item.disabled ? '（停用）' : ''}`,
                  }))}
                  onChange={(code) => setFilters({ [key]: code ?? '' })}
                />
              </label>
            ))}
            <Typography.Text type="secondary">
              范围为空取全部，按编码含两端；每个辅助项分别列示。
            </Typography.Text>
            <Checkbox
              checked={filters.dimensionChildren}
              onChange={(e) => setFilters({ dimensionChildren: e.target.checked })}
            >
              选中父项时包含下级
            </Checkbox>
            <label>
              辅助显示级次{' '}
              <select
                aria-label="辅助显示级次"
                value={filters.dimensionLevel}
                onChange={(e) => setFilters({ dimensionLevel: Number(e.target.value) })}
              >
                <option value={0}>各明细项</option>
                {Array.from({ length: 20 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1} 级汇总
                  </option>
                ))}
              </select>
            </label>
            <label>
              排列方式{' '}
              <select
                aria-label="排列方式"
                value={filters.dimensionOrder}
                onChange={(e) => setFilters({ dimensionOrder: e.target.value })}
              >
                <option value="dimension">按辅助项</option>
                <option value="account">按科目</option>
              </select>
            </label>
          </>
        )}
      </Space>
      <Space wrap style={{ marginBottom: 12 }}>
        <Checkbox
          checked={filters.includeUnposted}
          onChange={(e) => setFilters({ includeUnposted: e.target.checked })}
        >
          包含未过账凭证
        </Checkbox>
        <Checkbox
          checked={filters.onlyActivity}
          onChange={(e) => setFilters({ onlyActivity: e.target.checked })}
        >
          只显示有发生额
        </Checkbox>
        <label>
          显示级次{' '}
          <select
            aria-label="显示级次"
            value={level}
            onChange={(e) =>
              setFilters({
                level: Number(e.target.value),
                expanded: metadata.accounts
                  .filter((a) => !a.isLeaf)
                  .map((a) => a.id)
                  .join(','),
              })
            }
          >
            <option value={0}>全部级次</option>
            <option value={-1}>仅末级</option>
            {Array.from(new Set(metadata.accounts.map((a) => a.level)))
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n} 级
                </option>
              ))}
          </select>
        </label>
        <Button
          onClick={() =>
            setFilters({
              level: 0,
              expanded: metadata.accounts
                .filter((a) => !a.isLeaf)
                .map((a) => a.id)
                .join(','),
            })
          }
        >
          展开到末级
        </Button>
        <Button onClick={() => setFilters({ expanded: '' })}>全部折叠</Button>
        <label>
          币种{' '}
          <Select
            aria-label="币种"
            style={{ width: 170 }}
            value={filters.currency || undefined}
            allowClear
            placeholder={mode === 'foreign' ? '全部（逐币列示）' : '全部（折合本位币）'}
            options={metadata.currencies
              .filter((c) => !c.isBase)
              .map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }))}
            onChange={(v) => setFilters({ currency: v ?? '' })}
          />
        </label>
        <Typography.Text type="secondary">
          期间为空取当前工作期间；科目范围为空取全部。
        </Typography.Text>
      </Space>
      <Space style={{ margin: '12px 0' }} wrap>
        <Input.Search
          aria-label="余额结果定位"
          placeholder="科目编码或名称，可查折叠下级"
          allowClear
          onSearch={setLocate}
          style={{ width: 320 }}
        />
        <Typography.Text type="secondary">
          定位只筛选显示行，原范围合计、导出和打印条件不变。
        </Typography.Text>
      </Space>
      {report.data &&
        Math.floor(report.data.periodFrom / 100) !== Math.floor(report.data.periodTo / 100) && (
          <ActionAlert
            type="info"
            title="查询跨越会计年度"
            description="期初与期末连续承接；本年累计仅包含结束期间所在年度。"
          />
        )}
      {report.isError ? (
        <QueryError error={report.error} retry={() => void report.refetch()} />
      ) : !report.data ? (
        <Spin tip="正在查询余额">
          <div style={{ height: 160 }} />
        </Spin>
      ) : (
        <>
          {report.data.groups.length === 0 && (
            <Empty
              description={
                mode === 'foreign' && !metadata.currencies.some((c) => !c.isBase)
                  ? '账套没有外币，请先维护外币档案'
                  : '当前范围没有可显示的余额，请调整科目或辅助项条件'
              }
            />
          )}
          {reportTables(report.data, level, expanded, locate).map(({ group, rows }, index) => (
            <BalanceTable
              key={JSON.stringify([group.currency, group.unit, group.dimension?.id, index])}
              group={group}
              orderedRows={report.data.order === 'account' ? rows : undefined}
              locate={locate}
              report={report.data}
              level={level}
              expanded={expanded}
              loading={report.isFetching}
              onToggle={(id) =>
                setFilters({
                  expanded: (expanded.includes(id)
                    ? expanded.filter((v) => v !== id)
                    : [...expanded, id]
                  ).join(','),
                })
              }
            />
          ))}
        </>
      )}
      {printReport && (
        <BalancePrintDialog
          report={printReport}
          level={level}
          expanded={expanded}
          onClose={() => setPrintReport(null)}
        />
      )}
      {settingsOpen && (
        <SettingsDrawer
          title={title}
          settings={settingsSnapshot}
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            setFilters({
              level: s.display.level,
              onlyActivity: s.display.onlyActivity,
              dimensionChildren: s.display.dimensionChildren ?? false,
              dimensionLevel: s.display.dimensionLevel ?? 0,
              dimensionOrder: s.display.dimensionOrder ?? 'dimension',
            });
            void queryClient.invalidateQueries({ queryKey: api.metadata.queryKey() });
            setSettingsOpen(false);
          }}
        />
      )}
    </PageContainer>
  );
}

function AccountRangeSelect({
  value,
  onChange,
  accounts,
  label,
}: {
  value?: string;
  onChange?: (code: string) => void;
  accounts: Account[];
  label: string;
}) {
  return (
    <AccountSelect
      aria-label={label}
      value={accounts.find((a) => a.code === value)?.id}
      onChange={(id) => onChange?.(accounts.find((a) => a.id === id)?.code ?? '')}
      leafOnly={false}
      includeDisabled
      allowClear
      style={{ width: 200 }}
      placeholder="全部科目"
    />
  );
}

function BalanceTable({
  group,
  orderedRows,
  report,
  locate,
  level,
  expanded,
  loading,
  onToggle,
}: {
  group: ReportGroup;
  orderedRows?: OutputRow[];
  report: Report;
  locate: string;
  level: number;
  expanded: number[];
  loading: boolean;
  onToggle: (id: number) => void;
}) {
  const [drill, setDrill] = useState<OutputRow | null>(null);
  const rowGroup = (row: OutputRow) => row.outputGroup ?? group;
  const canDrill = (row: OutputRow) =>
    row.source &&
    (!rowGroup(row).dimension || rowGroup(row).dimension!.id != null) &&
    (report.mode !== 'quantity' || row.source.isLeaf);
  const target = (row: OutputRow, memberId?: number | null) => {
    const g = rowGroup(row);
    const dimensions = { ...row.source!.dimensions };
    if (g.dimension && memberId != null)
      dimensions[g.dimension.type as keyof typeof dimensions] = memberId;
    return detailUrl(report, { ...row.source!, dimensions }, g.currency);
  };
  const openDetail = (row: OutputRow) => {
    if (!canDrill(row)) return;
    const members = rowGroup(row).dimension?.members;
    if (members && members.length > 1) setDrill(row);
    else window.location.assign(target(row, members?.[0]?.id));
  };
  const columns: DataColumn<OutputRow>[] = columnsFor(report).map((c) => ({
    key: c.key,
    title: c.title,
    dataIndex: c.key,
    width: c.key === 'name' ? 260 : 140,
    align: c.money ? 'right' : 'left',
    render: (value: string | number, r) => {
      if (c.key === 'code' && r.source) {
        const source = r.source;
        const hasChildren =
          !orderedRows &&
          level !== -1 &&
          (level === 0 || source.level < level) &&
          group.rows.some((v) => v.parentId === source.accountId);
        return (
          <Space style={{ paddingLeft: (source.level - 1) * 12 }}>
            {hasChildren && (
              <Button
                size="small"
                aria-label={`${expanded.includes(source.accountId) ? '折叠' : '展开'} ${source.accountCode}`}
                aria-expanded={expanded.includes(source.accountId)}
                onClick={() => onToggle(source.accountId)}
              >
                {expanded.includes(source.accountId) ? '−' : '+'}
              </Button>
            )}
            <span>{r.code}</span>
          </Space>
        );
      }
      const reverse =
        r.source &&
        (c.key === 'opening' || c.key === 'closing') &&
        balanceDisplay(r.source[c.key], r.source).reverse;
      return (
        <span style={reverse ? { color: '#cf1322' } : undefined}>
          {c.money && typeof value === 'number' ? <MoneyText value={value} /> : (value ?? '—')}
          {reverse && '（逆向）'}
        </span>
      );
    },
  }));
  columns.push({
    key: 'detail',
    title: '操作',
    width: 100,
    render: (_, r) =>
      canDrill(r) &&
      ((rowGroup(r).dimension?.members?.length ?? 0) > 1 ? (
        <Button type="link" aria-label={`明细 ${r.code}`} onClick={() => setDrill(r)}>
          明细
        </Button>
      ) : (
        <Button
          type="link"
          aria-label={`明细 ${r.code}`}
          href={target(r, rowGroup(r).dimension?.members?.[0]?.id)}
        >
          明细
        </Button>
      )),
  });
  return (
    <section
      aria-label={`${group.currency ? `${group.currency}余额` : '本位币余额'}${group.unit != null ? ` ${group.unit}` : ''}${group.dimension ? ` ${group.dimension.code} ${group.dimension.name}` : ''}`}
    >
      <Typography.Paragraph>{reportCaption(report, group.currency)}</Typography.Paragraph>
      {groupCaption(group) && <Typography.Paragraph>{groupCaption(group)}</Typography.Paragraph>}
      {group.rows.some((r) => r.dimensionYtdMissing) && (
        <Typography.Paragraph type="warning">
          启用前原币、数量累计缺少来源，累计列显示“—”；请勿按零使用。
        </Typography.Paragraph>
      )}
      {group.dimension?.id === null && (
        <Typography.Paragraph type="secondary">
          未指定辅助项的余额单独列示；当前明细账接口不能精确过滤空辅助项，暂不提供该组钻取。
        </Typography.Paragraph>
      )}
      {report.mode === 'quantity' && (
        <Typography.Paragraph type="secondary">
          数量按借正贷负、十进制原值列示；父科目仅汇总本表单位，明细入口位于末级科目。
        </Typography.Paragraph>
      )}
      {report.mode === 'foreign' && (
        <Typography.Paragraph type="secondary">
          外币金额按借正贷负列示；不同币种分别合计。本位币列仅包含本币种对应的账务金额。
        </Typography.Paragraph>
      )}
      {group.rows.length === 0 && (
        <Empty description="当前条件没有余额或发生额；可扩大期间或科目范围，或关闭只发生额" />
      )}
      <DataTable<OutputRow>
        tableId={`balances.${report.mode}`}
        rowKey="key"
        columns={columns}
        dataSource={orderedRows ?? locateRows(group, level, expanded, locate)}
        loading={loading}
        onRow={(row) => ({
          onDoubleClick: () => openDetail(row),
        })}
      />
      <Modal title="选择辅助分项明细" open={!!drill} onCancel={() => setDrill(null)} footer={null}>
        <p>本行汇总了以下辅助分项。选择一个分项，按其实际辅助项追查明细。</p>
        {drill &&
          rowGroup(drill).dimension?.members?.map((member) => (
            <p key={member.id ?? 'empty'}>
              {member.id == null ? (
                '未指定辅助项：当前明细账尚不支持精确查询空辅助项。'
              ) : (
                <a href={target(drill, member.id)}>
                  {member.code} {member.name}
                </a>
              )}
            </p>
          ))}
      </Modal>
    </section>
  );
}

function SettingsDrawer({
  title,
  settings,
  onClose,
  onSaved,
}: {
  title: string;
  settings: Settings;
  onClose: () => void;
  onSaved: (settings: Settings) => void;
}) {
  const { modal } = App.useApp();
  const { bookId } = useRequiredSession();
  const storageKey = `balances.settingsDraft.${bookId}`;
  const [initial] = useState(() => {
    try {
      const raw = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as {
        base: unknown;
        display: unknown;
      } | null;
      if (raw)
        return {
          base: SettingsSchema.parse(raw.base),
          display: DisplaySchema.parse(raw.display),
          restored: true,
        };
    } catch {
      /* 无效草稿不影响正常读取账套设置 */
    }
    return { base: settings, display: settings.display, restored: false };
  });
  const [draft, setDraft] = useState(initial.display);
  const [base, setBase] = useState(initial.base);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.display);
  const save = useMutation(api.saveSettings.mutationOptions({ meta: { silent: true } }));
  const clearDraft = () => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* 禁用存储时仍可正常编辑 */
    }
  };
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify({ base, display: draft }));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* 禁用存储时靠关闭确认保护当前编辑 */
    }
  }, [dirty, draft, base, storageKey]);
  const close = () => {
    if (save.isPending) return;
    if (!dirty) {
      clearDraft();
      onClose();
    } else
      modal.confirm({
        title: '展示设置尚未保存',
        content: '放弃本次修改并关闭？余额查询结果不会被修改。',
        okText: '放弃修改',
        cancelText: '继续编辑',
        onOk: () => {
          clearDraft();
          onClose();
        },
      });
  };
  const submit = async () => {
    if (save.isPending) return false;
    const snapshot = draft;
    try {
      const saved = await save.mutateAsync({ revision: base.revision, display: snapshot });
      setBase(saved);
      if (JSON.stringify(latestDraft.current) !== JSON.stringify(snapshot)) {
        notify.info('已保存提交时的展示设置，之后的新修改仍保留，请再次保存');
        return false;
      }
      clearDraft();
      onSaved(saved);
      notify.success('展示设置已保存');
      return true;
    } catch {
      /* 在抽屉中提示原因，保留当前编辑值和草稿 */
      return false;
    }
  };
  useUnsavedChanges({
    title: `${title}展示设置`,
    dirty,
    version: JSON.stringify([base.revision, draft]),
    save: submit,
    discard: () => {
      clearDraft();
      onClose();
    },
  });
  return (
    <Drawer
      open
      title="展示设置"
      onClose={close}
      keyboard={!save.isPending}
      maskClosable={!save.isPending}
      footer={
        <Space>
          <Button disabled={save.isPending} onClick={close}>
            取消
          </Button>
          <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
            保存设置
          </Button>
        </Space>
      }
    >
      <p>保存为本账套的默认展示方式；地址栏的查询条件优先。查询余额为只读数据。</p>
      {initial.restored && <p role="status">已恢复此窗口尚未保存的展示设置草稿。</p>}
      <label>
        默认显示级次{' '}
        <select
          aria-label="默认显示级次"
          value={draft.level}
          onChange={(e) => setDraft({ ...draft, level: Number(e.target.value) })}
        >
          <option value={-1}>仅末级</option>
          <option value={0}>全部级次</option>
          {Array.from({ length: 20 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1} 级
            </option>
          ))}
        </select>
      </label>
      <p>
        <Checkbox
          checked={draft.onlyActivity}
          onChange={(e) => setDraft({ ...draft, onlyActivity: e.target.checked })}
        >
          默认只显示有发生额
        </Checkbox>
      </p>
      <p>
        <Checkbox
          checked={draft.dimensionChildren ?? false}
          onChange={(e) => setDraft({ ...draft, dimensionChildren: e.target.checked })}
        >
          默认包含辅助父项的下级
        </Checkbox>
      </p>
      <p>
        <label>
          默认辅助显示级次{' '}
          <select
            aria-label="默认辅助显示级次"
            value={draft.dimensionLevel ?? 0}
            onChange={(e) => setDraft({ ...draft, dimensionLevel: Number(e.target.value) })}
          >
            <option value={0}>各明细项</option>
            {Array.from({ length: 20 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1} 级汇总
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          默认辅助排列{' '}
          <select
            aria-label="默认辅助排列"
            value={draft.dimensionOrder ?? 'dimension'}
            onChange={(e) =>
              setDraft({ ...draft, dimensionOrder: e.target.value as 'dimension' | 'account' })
            }
          >
            <option value="dimension">按辅助项</option>
            <option value="account">按科目</option>
          </select>
        </label>
      </p>
      {save.isError && <QueryError error={save.error} />}
    </Drawer>
  );
}

function QueryError({ error, retry }: { error: unknown; retry?: () => void }) {
  const data = getBusinessError(error);
  return (
    <ActionAlert
      type="error"
      title={data?.message ?? '读取失败'}
      description={data?.hint ?? (error instanceof Error ? error.message : '请重试')}
      actions={[
        ...(data?.actions ?? []).map((action) => ({
          label: action.label,
          onClick: () => window.location.assign(action.to),
        })),
        ...(retry ? [{ label: '重试', onClick: retry }] : []),
      ]}
    />
  );
}
