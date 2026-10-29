import { memo, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { balanceSide, formatMoney, isValidDate, periodEndDate } from '@caiwu/core';
import {
  useAccounts,
  useHotkey,
  usePermission,
  useRequiredSession,
  queryClient,
  showError,
} from '@caiwu/web-kit';
import {
  AccountSelect,
  ActionAlert,
  DataTable,
  FilterBar,
  PageContainer,
  type DataColumn,
} from '@caiwu/ui';
import {
  AgingFilterSchema,
  DEFAULT_BOUNDS,
  ORIGINAL_AGING_BOUNDS,
  type AgingLot,
  type AgingReport,
  type AgingRow,
} from '../shared';
import { api } from './api';
import {
  downloadWorkbook,
  ledgerLink,
  NoPermission,
  printTable,
  ReportError,
  useReportFilters,
} from './common';

type FormValues = {
  accountId?: number;
  cutoff: string;
  bounds: string;
  direction: string;
  groupBy: string;
  includeUnposted: boolean;
  hideZero: boolean;
};

export const AGING_WIDTH_KEY = 'caiwu.table.analysis.aging.widths';
type WidthStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
class InvalidAgingWidths extends Error {}
export function readAgingWidths(storage: WidthStorage): Record<string, number> {
  const raw = storage.getItem(AGING_WIDTH_KEY);
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new InvalidAgingWidths('列宽设置内容损坏，请恢复默认列宽');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.values(value).some(
      (v) => typeof v !== 'number' || !Number.isFinite(v) || v < 48 || v > 10000,
    )
  )
    throw new InvalidAgingWidths('列宽设置内容无效，请恢复默认列宽');
  return value as Record<string, number>;
}
export function adjustAgingWidth(
  storage: WidthStorage,
  key: string,
  fallback: number,
  delta: -10 | 10,
) {
  const widths = readAgingWidths(storage);
  const next = {
    ...widths,
    [key]: Math.min(10000, Math.max(48, (widths[key] ?? fallback) + delta)),
  };
  storage.setItem(AGING_WIDTH_KEY, JSON.stringify(next));
  if (readAgingWidths(storage)[key] !== next[key])
    throw new Error('列宽写入后未能读取，请检查本地存储');
  return next;
}
export function restoreAgingWidths(storage: WidthStorage) {
  storage.removeItem(AGING_WIDTH_KEY);
  if (storage.getItem(AGING_WIDTH_KEY) !== null)
    throw new Error('默认列宽未能恢复，请检查本地存储');
}
/** w_xt_ye_nf 只更换截止年份；闰日调整到目标年份二月最后一天。 */
export function changeAgingYear(cutoff: string, year: number | null, startPeriod: number) {
  if (!Number.isInteger(year) || year === null || year < 1900 || year > 9999)
    throw new Error('请输入1900至9999之间的整数年份');
  if (year < Math.trunc(startPeriod / 100))
    throw new Error(`所选年份早于账套启用年份，请选择${Math.trunc(startPeriod / 100)}年或以后`);
  if (!isValidDate(cutoff)) throw new Error('当前截止日期无效，请先输入有效日期再选择年份');
  const date = `${year}${cutoff.slice(4)}`;
  if (isValidDate(date)) return { date, adjusted: false };
  if (cutoff.slice(5) === '02-29') return { date: `${year}-02-28`, adjusted: true };
  throw new Error('更换年份后日期无效，请重新输入截止日期');
}
type YearChooserHandle = { open: () => void };
function AgingYearChooser({
  ref,
  startPeriod,
  onNotice,
  onOpenChange,
}: {
  ref: Ref<YearChooserHandle>;
  startPeriod: number;
  onNotice: (notice: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const form = Form.useFormInstance<FormValues>();
  const [open, setOpen] = useState(false),
    [year, setYear] = useState<number | null>(null),
    [error, setError] = useState('');
  const show = () => {
    setYear(
      Number((form.getFieldValue('cutoff') ?? '').slice(0, 4)) || Math.trunc(startPeriod / 100),
    );
    setError('');
    setOpen(true);
    onOpenChange(true);
  };
  useImperativeHandle(ref, () => ({ open: show }));
  return (
    <>
      <Button onClick={show}>选择截止年份</Button>
      <Modal
        open={open}
        title="选择账龄分析年份"
        okText="应用年份并查询"
        cancelText="取消"
        onCancel={() => {
          setOpen(false);
          onOpenChange(false);
        }}
        onOk={() => {
          try {
            const value = changeAgingYear(form.getFieldValue('cutoff'), year, startPeriod);
            form.setFieldValue('cutoff', value.date);
            onNotice(value.adjusted ? `目标年份没有2月29日，截止日期已调整为${value.date}` : '');
            setOpen(false);
            onOpenChange(false);
            form.submit();
          } catch (e) {
            setError(e instanceof Error ? e.message : '年份选择失败，请重试');
          }
        }}
      >
        <p>保留当前截止日期的月、日；目标年份没有2月29日时改为2月28日。不补造启用前数据。</p>
        <label htmlFor="aging-cutoff-year">截止年份</label>
        <InputNumber
          id="aging-cutoff-year"
          aria-label="截止年份"
          value={year}
          min={1900}
          max={9999}
          precision={0}
          onChange={setYear}
        />
        {error && <Alert type="error" title="年份未应用" description={error} />}
      </Modal>
    </>
  );
}
export default memo(AgingPage);

function AgingPage() {
  const session = useRequiredSession();
  const { byId, byCode } = useAccounts();
  const canView = usePermission('analysis.aging.view');
  const canEdit = usePermission('analysis.definition.edit');
  const canExport = usePermission('analysis.export');
  const [filters, setFilters] = useReportFilters({
    accountCode: '',
    cutoff: periodEndDate(session.book.startPeriod),
    bounds: '',
    direction: 'receivable',
    groupBy: 'partner',
    includeUnposted: false as boolean,
    hideZero: true as boolean,
  });
  const config = useQuery({ ...api.config.queryOptions(), enabled: canView });
  const bounds = filters.bounds
    ? filters.bounds.split(',').map((n) => (n.trim() === '' ? NaN : Number(n)))
    : (config.data?.bounds ?? DEFAULT_BOUNDS);
  const parsed = AgingFilterSchema.safeParse({ ...filters, bounds });
  const input = parsed.success ? parsed.data : { accountCode: '', cutoff: filters.cutoff };
  const query = useQuery({
    ...api.aging.queryOptions(input),
    enabled: canView && parsed.success && !config.isPending,
  });
  const [details, setDetails] = useState<AgingRow | null>(null);
  const yearChooser = useRef<YearChooserHandle>(null);
  const [yearNotice, setYearNotice] = useState('');
  const [yearOpen, setYearOpen] = useState(false);
  const [widthColumn, setWidthColumn] = useState('account');
  const [widthVersion, setWidthVersion] = useState(0);
  const [widthState, setWidthState] = useState(() => {
    try {
      return { widths: readAgingWidths(localStorage), error: '', valid: true };
    } catch (e) {
      return {
        widths: {} as Record<string, number>,
        error:
          e instanceof InvalidAgingWidths
            ? e.message
            : '无法读取本机列宽，当前使用默认列宽；请允许本地存储后重试',
        valid: !(e instanceof InvalidAgingWidths),
      };
    }
  });
  const resizing = useRef(false);
  useEffect(() => {
    const finished = () => {
      if (!resizing.current) return;
      resizing.current = false;
      try {
        const widths = readAgingWidths(localStorage);
        // 通用表格会忽略写入异常，此处补充本页的明确反馈。
        localStorage.setItem(AGING_WIDTH_KEY, JSON.stringify(widths));
        setWidthState({ widths, error: '', valid: true });
      } catch (e) {
        setWidthState((current) => ({
          ...current,
          error: `列宽未能保存在当前电脑，刷新后可能恢复原列宽。${e instanceof Error ? e.message : '请检查本地存储权限'}`,
        }));
      }
    };
    window.addEventListener('mouseup', finished);
    return () => window.removeEventListener('mouseup', finished);
  }, []);
  const [exporting, setExporting] = useState(false);
  const save = useMutation(
    api.saveConfig.mutationOptions({
      onSuccess: (result) => queryClient.setQueryData(api.config.queryKey(), result),
    }),
  );
  const report = query.data;
  const doExport = async () => {
    if (!parsed.success) return;
    setExporting(true);
    try {
      const result = await queryClient.fetchQuery({
        ...api.exportAging.queryOptions(parsed.data),
        staleTime: 0,
      });
      queryClient.setQueryData(api.aging.queryKey(input), result.report);
      downloadWorkbook(result.base64, `账龄分析-${result.report.filter.cutoff}`);
    } finally {
      setExporting(false);
    }
  };
  const doPrint = async () => {
    if (!report) return;
    await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('aging'), staleTime: 0 });
    const amounts = (r: {
      buckets: number[];
      unaged: number;
      future: number;
      reverse: number;
      closing: number;
    }) => [...r.buckets, r.unaged, r.future, r.reverse, r.closing].map((n) => formatMoney(n));
    await printTable(
      '账龄分析',
      `截止 ${report.filter.cutoff}；${report.filter.includeUnposted ? '含未过账' : '仅已过账'}；${report.filter.direction === 'receivable' ? '应收' : '应付'}；借正贷负；原始到期日未知，逾期天数未知；本位币 ${report.baseCurrency}；快照 ${report.generatedAt}`,
      [
        '科目',
        '辅助项',
        '交易币种',
        ...report.bucketLabels,
        '期初未分龄',
        '未来业务日期',
        '反向余额',
        '同截止余额',
      ],
      [
        ...report.rows.map((r) => [r.accountCode, r.groupName, r.currency, ...amounts(r)]),
        ['合计', '', '', ...amounts(report.totals)],
      ],
    );
  };
  useHotkey(
    'Ctrl+P',
    () => {
      void doPrint().catch(showError);
    },
    {
      enabled: canView && canExport && !!report && !query.isFetching && !details && !yearOpen,
    },
  );
  const columns: DataColumn<AgingRow>[] = [
    {
      key: 'account',
      title: '科目',
      width: 170,
      render: (_, r) => `${r.accountCode} ${r.accountName}`,
    },
    { key: 'group', title: '辅助项', dataIndex: 'groupName', width: 180 },
    { key: 'currency', title: '交易币种', dataIndex: 'currency', width: 90 },
    ...(report?.bucketLabels ?? []).map((title, i): DataColumn<AgingRow> => ({
      key: `bucket-${i}`,
      title,
      money: true,
      dataIndex: ['buckets', i],
    })),
    { key: 'unaged', title: '期初未分龄', dataIndex: 'unaged', money: true },
    { key: 'future', title: '未来业务日期', dataIndex: 'future', money: true },
    { key: 'reverse', title: '预收 / 预付（反向）', dataIndex: 'reverse', money: true },
    {
      key: 'closing',
      title: '同截止余额（借正贷负）',
      dataIndex: 'closing',
      width: 210,
      render: (_, r) => (
        <Button
          type="link"
          onClick={() => setDetails(r)}
          aria-label={`核销明细 ${r.groupName} ${r.currency}`}
        >
          {formatMoney(r.closing)}
        </Button>
      ),
    },
    {
      key: 'side',
      title: '余额方向',
      width: 90,
      render: (_, r) =>
        balanceSide(r.closing, filters.direction === 'payable' ? 'credit' : 'debit').side,
    },
    {
      key: 'detail',
      title: '操作',
      width: 100,
      render: (_, r) => report && <Link to={ledgerLink(r, report)}>明细账</Link>,
    },
  ];
  const selectedColumn = columns.find((column) => column.key === widthColumn) ?? columns[0]!;
  const changeWidth = (delta: -10 | 10) => {
    try {
      const fallback =
        typeof selectedColumn.width === 'number'
          ? selectedColumn.width
          : selectedColumn.money
            ? 130
            : 100;
      const widths = adjustAgingWidth(localStorage, selectedColumn.key, fallback, delta);
      setWidthState({ widths, error: '', valid: true });
      setWidthVersion((current) => current + 1);
    } catch (e) {
      setWidthState((current) => ({
        ...current,
        error: `列宽未保存，当前显示保持不变。${e instanceof Error ? e.message : '请允许本地存储后重试'}`,
      }));
    }
  };
  const restoreWidths = () => {
    try {
      restoreAgingWidths(localStorage);
      setWidthState({ widths: {}, error: '', valid: true });
      setWidthVersion((current) => current + 1);
    } catch (e) {
      setWidthState((current) => ({
        ...current,
        error: `列宽未恢复，当前显示保持不变。${e instanceof Error ? e.message : '请允许本地存储后重试'}`,
      }));
    }
  };
  return (
    <PageContainer
      title="账龄分析"
      subtitle="按实际期初和分录计算 · FIFO 核销 · 同截止日总账核对"
      extra={<Link to="/m/analysis">科目分析</Link>}
    >
      {!canView ? (
        <NoPermission />
      ) : (
        <>
          <FilterBar<FormValues>
            key={`${JSON.stringify(filters)}-${config.data?.revision}-${byCode.get(filters.accountCode)?.id ?? ''}`}
            initialValues={{
              accountId: byCode.get(filters.accountCode)?.id,
              ...filters,
              bounds: bounds.join(','),
            }}
            onSearch={(v) =>
              setFilters({
                accountCode: v.accountId ? (byId.get(v.accountId)?.code ?? '') : '',
                cutoff: v.cutoff,
                bounds: v.bounds,
                direction: v.direction,
                groupBy: v.groupBy,
                includeUnposted: !!v.includeUnposted,
                hideZero: !!v.hideZero,
              })
            }
          >
            <Form.Item
              name="accountId"
              label="科目"
              rules={[{ required: true, message: '请选择科目' }]}
            >
              <AccountSelect leafOnly={false} includeDisabled style={{ width: 240 }} />
            </Form.Item>
            <Form.Item name="cutoff" label="截止日期" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item>
              <AgingYearChooser
                ref={yearChooser}
                startPeriod={session.book.startPeriod}
                onNotice={setYearNotice}
                onOpenChange={setYearOpen}
              />
            </Form.Item>
            <Form.Item name="direction" label="往来方向">
              <Select
                style={{ width: 100 }}
                options={[
                  { value: 'receivable', label: '应收' },
                  { value: 'payable', label: '应付' },
                ]}
              />
            </Form.Item>
            <Form.Item name="groupBy" label="按辅助项">
              <Select
                style={{ width: 110 }}
                options={[
                  { value: 'partner', label: '客供' },
                  { value: 'project', label: '客供+项目' },
                  { value: 'department', label: '客供+部门' },
                  { value: 'person', label: '客供+个人' },
                  { value: 'none', label: '科目汇总' },
                ]}
              />
            </Form.Item>
            <Form.Item name="bounds" label="区间上限（天）" rules={[{ required: true }]}>
              <Input style={{ width: 220 }} placeholder="30,60,90,180,365" />
            </Form.Item>
            <Form.Item name="includeUnposted" valuePropName="checked">
              <Checkbox>包含未过账</Checkbox>
            </Form.Item>
            <Form.Item name="hideZero" valuePropName="checked">
              <Checkbox>余额为零隐藏</Checkbox>
            </Form.Item>
          </FilterBar>
          {yearNotice && <Alert type="info" title={yearNotice} />}
          <Alert
            type="info"
            showIcon
            title="口径说明：原始到期日未知，逾期天数未知"
            description="凭证日期≤截止日才纳入；账龄天数=截止日−业务日期（未填取凭证日期），当日为0天，区间含两端且连续。期初优先是核销约定，不代表其属于最老账龄；其余按业务日期先进先出，期初缺历史日期的残额单列未分龄。客供、末级科目、交易币种之间不互相核销；所有金额均折合本位币、借正贷负。未来业务日期和反向余额单列。账龄保留全部结转，便于核对原始总账。"
          />
          {config.isError && (
            <ReportError error={config.error} retry={() => void config.refetch()} />
          )}
          {filters.accountCode && !parsed.success && (
            <ActionAlert
              type="error"
              title="筛选条件无效"
              description={parsed.error.issues.map((e) => e.message).join('；')}
            />
          )}
          {!filters.accountCode && (
            <Alert type="info" title="请选择科目后查询账龄；可选择上级科目，系统只累计末级数据" />
          )}
          {query.isError && <ReportError error={query.error} retry={() => void query.refetch()} />}
          <Space wrap>
            <Button onClick={() => setFilters({ bounds: ORIGINAL_AGING_BOUNDS.join(',') })}>
              使用原版15个账龄区间
            </Button>
            {canEdit && (
              <Button
                disabled={!parsed.success || !config.data}
                loading={save.isPending}
                onClick={() =>
                  save.mutate({ bounds, expectedRevision: config.data?.revision ?? 0 })
                }
              >
                保存当前区间为默认
              </Button>
            )}
            {canExport && (
              <>
                <Button
                  disabled={!report || query.isFetching}
                  loading={exporting}
                  onClick={() => void doExport().catch(showError)}
                >
                  导出 Excel
                </Button>
                <Button
                  disabled={!report || query.isFetching}
                  onClick={() => void doPrint().catch(showError)}
                >
                  打印
                </Button>
              </>
            )}
            <Button
              disabled={!parsed.success}
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              刷新分析
            </Button>
          </Space>
          <Space wrap>
            <label htmlFor="aging-width-column">列宽调整</label>
            <Select
              id="aging-width-column"
              aria-label="调整列宽的列"
              value={selectedColumn.key}
              onChange={setWidthColumn}
              options={columns.map((column) => ({ value: column.key, label: column.title }))}
              style={{ minWidth: 190 }}
            />
            <Button aria-label="选中列缩窄10像素" onClick={() => changeWidth(-10)}>
              〈 缩窄
            </Button>
            <Button aria-label="选中列加宽10像素" onClick={() => changeWidth(10)}>
              加宽 〉
            </Button>
            <Button onClick={restoreWidths}>恢复默认列宽</Button>
            <span>
              当前设置：
              {widthState.widths[selectedColumn.key] ??
                (typeof selectedColumn.width === 'number'
                  ? selectedColumn.width
                  : selectedColumn.money
                    ? 130
                    : 100)}
              像素；只保存在当前电脑
            </span>
          </Space>
          {widthState.error && (
            <Alert type="warning" title="本机列宽设置未完成" description={widthState.error} />
          )}
          {save.isError && (
            <Alert
              type="error"
              title="账龄区间未保存，当前输入仍保留"
              description="请检查权限或刷新配置后重试；不会覆盖另一窗口已保存的区间。"
            />
          )}
          {report && (
            <>
              <p data-testid="aging-reconciliation">
                同截止日总账：{formatMoney(report.totals.ledger)}；账龄合计：
                {formatMoney(report.totals.closing)}；核对差额：
                {formatMoney(report.totals.difference)}。快照：{report.generatedAt}
              </p>
              <span>
                已分龄：{formatMoney(report.totals.aged)}
                ；期初未分龄：{formatMoney(report.totals.unaged)}；未来业务日期：
                {formatMoney(report.totals.future)}；反向余额：{formatMoney(report.totals.reverse)}
              </span>
            </>
          )}
          {widthState.valid && (
            <div
              onMouseDownCapture={(e) => {
                if (e.target instanceof Element && e.target.closest('[role="separator"]'))
                  resizing.current = true;
              }}
              onDoubleClick={(e) => {
                if (!(
                  e.target instanceof Element && e.target.closest('button,a,[role="separator"]')
                ))
                  yearChooser.current?.open();
              }}
            >
              <DataTable<AgingRow>
                key={`aging-width-${widthVersion}`}
                tableId="analysis.aging"
                rowKey="key"
                columns={columns}
                dataSource={report?.rows ?? []}
                loading={query.isFetching || config.isPending}
                locale={{
                  emptyText: filters.accountCode
                    ? '当前筛选没有往来余额，可调整日期、隐藏零余额或未过账选项'
                    : '选择科目后查询',
                }}
              />
            </div>
          )}
          {report && (
            <DataTable<AgingReport['controls'][number]>
              tableId="analysis.aging.control"
              rowKey="key"
              columns={[
                { key: 'account', title: '核对科目', dataIndex: 'accountCode', width: 100 },
                { key: 'group', title: '辅助项', dataIndex: 'groupName', width: 180 },
                {
                  key: 'allocated',
                  title: '各币种账龄有符号合计',
                  dataIndex: 'allocated',
                  money: true,
                },
                {
                  key: 'ledger',
                  title: '同截止日总账（非月末）',
                  dataIndex: 'ledger',
                  money: true,
                },
                { key: 'difference', title: '差额', dataIndex: 'difference', money: true },
              ]}
              dataSource={report.controls}
            />
          )}
          <Drawer
            title="FIFO 核销明细"
            open={!!details}
            onClose={() => setDetails(null)}
            size={900}
            destroyOnHidden
          >
            <p>
              {details?.groupName} · {details?.currency}
              。本表使用正向敞口：应收借方为正、应付贷方为正。负额为回款/付款或红字冲减，按业务日期核销最早敞口。核销后的负向残额为预收/预付；科目汇总仍按客供分别核销。期初优先；业务日期相同按凭证日期、凭证ID、行ID排序。
            </p>
            <DataTable<AgingLot>
              tableId="analysis.aging.lots"
              rowKey={(r, i) => String(r.lineId ?? `opening-${i}`)}
              columns={[
                { key: 'group', title: '核销组', dataIndex: 'groupName', width: 180 },
                {
                  key: 'voucher',
                  title: '凭证',
                  width: 110,
                  render: (_, r) =>
                    r.voucherId ? (
                      <Link to={`/m/voucher-entry/edit?id=${r.voucherId}`}>{r.voucherNo}</Link>
                    ) : (
                      '期初未分龄'
                    ),
                },
                { key: 'date', title: '凭证日期', dataIndex: 'date', width: 110 },
                { key: 'biz', title: '起龄日期', dataIndex: 'bizDate', width: 110 },
                {
                  key: 'basis',
                  title: '日期来源',
                  width: 180,
                  render: (_, r) =>
                    r.dateBasis === 'business'
                      ? '原始业务日期'
                      : r.dateBasis === 'voucher'
                        ? '业务日期缺失，取凭证日期'
                        : '期初历史日期未知',
                },
                { key: 'due', title: '原始到期日 / 逾期天数', render: () => '未知', width: 200 },
                { key: 'amount', title: '原始正向金额', dataIndex: 'amount', money: true },
                { key: 'remaining', title: '核销后剩余敞口', dataIndex: 'remaining', money: true },
              ]}
              dataSource={details?.lots ?? []}
            />
          </Drawer>
        </>
      )}
    </PageContainer>
  );
}
