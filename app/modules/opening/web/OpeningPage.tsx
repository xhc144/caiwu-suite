import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { balanceSide, formatMoney, type Account, type DimensionValues } from '@caiwu/core';
import type { PrintJob } from '@caiwu/print';
import {
  getBusinessError,
  notify,
  queryClient,
  useHotkey,
  usePermission,
  useSession,
  useTab,
} from '@caiwu/web-kit';
import {
  AccountSelect,
  DataTable,
  DimensionSelect,
  MoneyInput,
  PageContainer,
  type DataColumn,
} from '@caiwu/ui';
import {
  accountTree,
  PrintSchema,
  exactSum,
  openingDimensions,
  rowVersion,
  yearStart,
  type Change,
  type OpeningDimension,
  type SavedRow,
  type SummaryRow,
} from '../shared';
import { api } from './api';
import { resolveLeave } from './draft';
import { useOpeningFilters } from './filters';
import OpeningPrint from './OpeningPrint';

interface Draft {
  id?: number;
  expected?: string;
  accountId?: number;
  dimensions?: DimensionValues;
  currency?: string | null;
  amount?: number | null;
  side: '借' | '贷';
  ytdDebit?: number | null;
  ytdCredit?: number | null;
  fcBalance?: number | null;
  quantity?: string;
}
interface Persisted {
  year: number;
  draft: Draft;
  dirty: boolean;
}
const emptyDraft = (): Draft => ({
  side: '借',
  amount: null,
  ytdDebit: 0,
  ytdCredit: 0,
  fcBalance: 0,
  quantity: '0',
  dimensions: {},
});
function restoreDraft(key: string): Persisted | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as Persisted | null;
  } catch {
    return null;
  }
}
function sideText(value: number, account: Account) {
  const side = balanceSide(value, account.direction);
  return `${side.side} ${formatMoney(side.amount)}`;
}

export default function OpeningPage() {
  const navigate = useNavigate();
  const session = useSession();
  const tab = useTab();
  const canEdit = usePermission('opening.edit'),
    canImport = usePermission('opening.import'),
    canLock = usePermission('opening.lock');
  const [filters, setFilters] = useOpeningFilters();
  const foreignCurrency = filters.currency && filters.currency !== 'base' ? filters.currency : null;
  const dimensionView = openingDimensions.find((d) => d.id === filters.dimension);
  const years = useQuery(api.years.queryOptions());
  const year = filters.year || Math.trunc((years.data?.book.startPeriod ?? 0) / 100);
  const list = useQuery(
    api.list.queryOptions({ year }, { enabled: year > 0, meta: { silent: true } }),
  );
  const trial = useQuery(
    api.trial.queryOptions({ year }, { enabled: year > 0, meta: { silent: true } }),
  );
  const storageKey = `opening.draft.${session?.bookId ?? 'book'}.${tab.key}`;
  const [restored] = useState(() => restoreDraft(storageKey));
  const [draft, setDraft] = useState<Draft | null>(restored?.draft ?? null);
  const [editYear, setEditYear] = useState(restored?.year ?? year);
  const [dirty, setDirty] = useState(restored?.dirty ?? false);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [form] = Form.useForm<Draft>();
  const data = list.data;
  const scopedItem = data?.items.find(
    (item) => item.typeId === dimensionView?.id && String(item.id) === filters.item,
  );
  const watchedAccount = Form.useWatch('accountId', form) as number | undefined;
  const account = data?.accounts.find((a) => a.id === watchedAccount);
  const watchedCurrency = Form.useWatch('currency', form) as string | undefined;
  const watchedSide = Form.useWatch('side', form);
  const watchedAmount = Form.useWatch('amount', form) ?? 0;
  const watchedDebit = Form.useWatch('ytdDebit', form) ?? 0;
  const watchedCredit = Form.useWatch('ytdCredit', form) ?? 0;
  let activationText: string;
  try {
    activationText = formatMoney(
      exactSum([(watchedSide === '贷' ? -1 : 1) * watchedAmount, watchedDebit, -watchedCredit]),
    );
  } catch {
    activationText = '金额超出范围，请修正';
  }
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: api.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: api.trial.queryKey() }),
    ]);
  };
  const saveMutation = useMutation(api.save.mutationOptions());
  const remove = useMutation(api.remove.mutationOptions({ onSuccess: () => void refresh() }));
  const lock = useMutation(api.setLock.mutationOptions({ onSuccess: () => void refresh() }));
  const cleanup = useMutation(api.cleanup.mutationOptions({ onSuccess: () => void refresh() }));
  // 清理预览使用独立查询，仅在用户点击后读取。
  const cleanupPreview = useQuery(api.cleanupPreview.queryOptions({ year }, { enabled: false }));
  const [cleanupOpen, setCleanupOpen] = useState(false),
    [confirmation, setConfirmation] = useState('');
  const [file, setFile] = useState(''),
    [importOpen, setImportOpen] = useState(false),
    [mode, setMode] = useState<'add' | 'overwrite'>('add');
  const preview = useMutation(api.preview.mutationOptions());
  const importRows = useMutation(
    api.import.mutationOptions({
      onSuccess: (r) => {
        notify.success(`已导入 ${r.count} 条`);
        setImportOpen(false);
        void refresh();
      },
    }),
  );
  const [exporting, setExporting] = useState(false);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const readOnly = !canEdit || !!data?.locked || !!data?.posted;
  const containerRef = useRef<HTMLDivElement>(null);
  const bypass = useRef(false);

  useEffect(() => {
    if (draft && dirty)
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ year: editYear, draft, dirty } satisfies Persisted),
      );
    else sessionStorage.removeItem(storageKey);
  }, [draft, dirty, editYear, storageKey]);
  useEffect(() => {
    if (!filters.year && year) setFilters({ year });
  }, [filters.year, year, setFilters]);
  useEffect(() => {
    if (draft) form.setFieldsValue(draft);
  }, [draft, form]);
  const requestLeave = useCallback(
    (action: () => void) => {
      if (dirty) setLeave(() => action);
      else action();
    },
    [dirty],
  );
  const closeDraft = () => {
    setDraft(null);
    setDirty(false);
    setSaveError('');
    sessionStorage.removeItem(storageKey);
  };
  const save = async (): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const values = await form.validateFields();
      if (!values.accountId) {
        notify.warning('请先选择要增加的科目');
        return false;
      }
      const dimension = openingDimensions.find((d) => d.id === filters.dimension)?.id;
      if (dimension && !values.dimensions?.[dimension]) {
        notify.warning(
          `请先选择要增加的${openingDimensions.find((d) => d.id === dimension)!.name}`,
        );
        return false;
      }
      const annual = (values.side === '贷' ? -1 : 1) * (values.amount ?? 0);
      const change: Change = {
        id: draft?.id,
        expected: draft?.expected,
        view: dimension,
        data: {
          year: editYear,
          accountId: values.accountId,
          dimensions: values.dimensions,
          currency: values.currency || null,
          balance: exactSum([annual, values.ytdDebit ?? 0, -(values.ytdCredit ?? 0)]),
          ytdDebit: values.ytdDebit ?? 0,
          ytdCredit: values.ytdCredit ?? 0,
          fcBalance: values.fcBalance ?? 0,
          quantity: values.quantity || '0',
        },
      };
      await saveMutation.mutateAsync({ year: editYear, changes: [change] });
      closeDraft();
      await refresh();
      notify.success('期初已保存，请查看试算结果');
      return true;
    } catch (error) {
      setSaveError(getBusinessError(error)?.message ?? '保存失败，请检查必填项后重试；输入已保留');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  useHotkey('Ctrl+S', () => {
    if (draft) void save();
  });
  useHotkey('Alt+N', () => {
    if (!readOnly) requestLeave(() => start());
  });

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (bypass.current || !tab.active || !(event.target instanceof Element)) return;
      // 壳尚无关闭拦截 API；在本模块内保护常用菜单、标签切换和关闭按钮。
      const element = event.target.closest<HTMLElement>(
        'a, [role="menuitem"], [role="tab"], .ant-tabs-tab-remove',
      );
      if (
        !element ||
        containerRef.current?.contains(element) ||
        element.closest('.ant-modal,.ant-drawer')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestLeave(() => {
        bypass.current = true;
        element.click();
        bypass.current = false;
      });
    };
    const key = (event: KeyboardEvent) => {
      if (!tab.active || bypass.current) return;
      if (
        (event.ctrlKey && event.key === 'F4') ||
        event.key === 'F5' ||
        (event.ctrlKey && event.key.toLowerCase() === 'r')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestLeave(() => (event.key === 'F4' ? tab.close() : window.location.reload()));
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [dirty, requestLeave, tab]);
  function start(a?: Account, row?: SavedRow) {
    const next: Draft = row
      ? {
          id: row.id,
          expected: rowVersion(row),
          accountId: row.accountId,
          dimensions: row.dimensions,
          currency: row.currency ?? '',
          amount: Math.abs(yearStart(row)),
          side: yearStart(row) < 0 ? '贷' : '借',
          ytdDebit: row.ytdDebit,
          ytdCredit: row.ytdCredit,
          fcBalance: row.fcBalance,
          quantity: row.quantity,
        }
      : {
          ...emptyDraft(),
          accountId: a?.id,
          currency: foreignCurrency ?? '',
          dimensions:
            dimensionView && scopedItem && !scopedItem.disabled
              ? { [dimensionView.id]: scopedItem.id }
              : {},
        };
    form.resetFields();
    form.setFieldsValue(next);
    setDraft(next);
    setEditYear(year);
    setDirty(false);
    setSaveError('');
  }
  const setFilter = (next: Partial<typeof filters>) =>
    requestLeave(() => {
      closeDraft();
      setFilters(next);
    });
  const rows = (data?.rows ?? []).filter(
    (r) =>
      (!filters.currency ||
        (filters.currency === 'base' ? r.currency == null : r.currency === filters.currency)) &&
      (!filters.dimension || r.dimensions[filters.dimension as OpeningDimension] != null) &&
      (!filters.item || (dimensionView && String(r.dimensions[dimensionView.id]) === filters.item)),
  );
  const filteredAccounts = (data?.accounts ?? []).filter(
    (a) =>
      (!filters.quantity || !!a.quantityUnit) &&
      (!foreignCurrency || a.currency === foreignCurrency) &&
      (!filters.dimension || a.dimensions.some((d) => d.type === filters.dimension)),
  );
  const tree = accountTree(data?.accounts ?? [], rows);
  const prune = (items: SummaryRow[]): SummaryRow[] =>
    items.flatMap((a) => {
      const children = a.children ? prune(a.children) : undefined;
      const match =
        filteredAccounts.some((x) => x.id === a.id) &&
        (!filters.account ||
          `${a.code} ${a.name} ${a.fullName} ${a.pinyin}`
            .toLowerCase()
            .includes(filters.account.toLowerCase()));
      return match || children?.length
        ? [{ ...a, children: children?.length ? children : undefined }]
        : [];
    });
  const treeColumns: DataColumn<SummaryRow>[] = [
    { key: 'code', title: '科目编码', dataIndex: 'code', width: 150 },
    { key: 'name', title: '科目名称', dataIndex: 'name', width: 190 },
    {
      key: 'direction',
      title: '科目方向',
      width: 85,
      render: (_, a) => (a.direction === 'debit' ? '借' : '贷'),
    },
    {
      key: 'yearStart',
      title: '年初余额（本位币）',
      width: 170,
      render: (_, a) => sideText(a.yearStart, a),
    },
    { key: 'ytdDebit', title: '账前累计借方', dataIndex: 'ytdDebit', money: true },
    { key: 'ytdCredit', title: '账前累计贷方', dataIndex: 'ytdCredit', money: true },
    {
      key: 'balance',
      title: '启用余额（本位币）',
      width: 170,
      render: (_, a) => sideText(a.balance, a),
    },
    ...(filters.currency && filters.currency !== 'base'
      ? [
          {
            key: 'fcBalance',
            title: '外币启用余额',
            dataIndex: 'fcBalance',
            money: true,
          } satisfies DataColumn<SummaryRow>,
        ]
      : []),
    ...(filters.quantity
      ? [
          {
            key: 'quantity',
            title: '启用数量',
            dataIndex: 'quantity',
            width: 120,
          } satisfies DataColumn<SummaryRow>,
        ]
      : []),
    {
      key: 'saved',
      title: '录入状态',
      width: 140,
      render: (_, a) =>
        !a.isLeaf ? '只读汇总' : a.savedCount ? `已保存 ${a.savedCount} 条` : '未录入',
    },
    {
      key: 'actions',
      title: '操作',
      width: 160,
      render: (_, a) =>
        a.isLeaf ? (
          <Button
            disabled={readOnly}
            onClick={() =>
              requestLeave(() => {
                const only = rows.filter((r) => r.accountId === a.id);
                if (only.length === 1 && !a.dimensions.some((d) => d.type !== 'cashflow'))
                  start(a, only[0]);
                else start(a);
              })
            }
          >
            {a.savedCount && !a.dimensions.some((d) => d.type !== 'cashflow') ? '修改' : '录入明细'}
          </Button>
        ) : null,
    },
  ];
  const details = rows.filter((r) =>
    filteredAccounts.some(
      (a) =>
        a.id === r.accountId &&
        (!filters.account ||
          `${a.code} ${a.fullName} ${a.pinyin}`
            .toLowerCase()
            .includes(filters.account.toLowerCase())),
    ),
  );
  const detailColumns: DataColumn<SavedRow>[] = [
    {
      key: 'account',
      title: '科目',
      width: 200,
      render: (_, r) => {
        const a = data?.accounts.find((a) => a.id === r.accountId);
        return `${a?.code} ${a?.fullName}`;
      },
    },
    {
      key: 'dimensions',
      title: '辅助组合',
      width: 240,
      render: (_, r) =>
        openingDimensions
          .filter((d) => r.dimensions[d.id] != null)
          .map((d) => {
            const i = data?.items.find((i) => i.id === r.dimensions[d.id]);
            return `${d.name}：${i?.code} ${i?.name}`;
          })
          .join('；') || '无辅助',
    },
    {
      key: 'currency',
      title: '币种',
      width: 85,
      render: (_, r) => r.currency || data?.book.baseCurrency,
    },
    { key: 'balance', title: '启用余额（借正贷负）', dataIndex: 'balance', money: true },
    { key: 'fcBalance', title: '外币余额（借正贷负）', dataIndex: 'fcBalance', money: true },
    { key: 'quantity', title: '数量', dataIndex: 'quantity', width: 100 },
    {
      key: 'actions',
      title: '操作',
      width: 170,
      render: (_, r) => (
        <Space>
          <Button disabled={readOnly} onClick={() => requestLeave(() => start(undefined, r))}>
            修改
          </Button>
          <Popconfirm
            title={`删除此条期初？${formatMoney(r.balance)} 元`}
            description="请核对本行科目及辅助组合，删除后可重新录入。"
            onConfirm={() =>
              remove.mutate({ year, id: r.id, expected: rowVersion(r), confirmed: true })
            }
          >
            <Button danger disabled={readOnly}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
  async function exportFile() {
    setExporting(true);
    try {
      const output = await queryClient.fetchQuery(api.export.queryOptions({ year }));
      const blob = new Blob([Uint8Array.from(atob(output.file), (c) => c.charCodeAt(0))], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = output.name;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }
  async function previewPrint() {
    if (dirty || preparingPrint || !data) return;
    setPreparingPrint(true);
    try {
      const input = PrintSchema.parse({ ...filters, year });
      setPrintJob(await queryClient.fetchQuery({ ...api.print.queryOptions(input), staleTime: 0 }));
    } catch (error) {
      notify.error(
        getBusinessError(error)?.message ?? '无法生成期初打印预览，请检查筛选条件后重试',
      );
    } finally {
      setPreparingPrint(false);
    }
  }
  useHotkey('Ctrl+P', () => {
    if (!draft && !importOpen && !cleanupOpen && !leave && !printJob) void previewPrint();
  });
  const result = trial.data;
  const listError = getBusinessError(list.error);
  return (
    <div ref={containerRef}>
      <PageContainer
        title="期初余额"
        subtitle="末级录入，父级自动汇总；所有金额以元显示，借正贷负存储。"
        extra={
          <Space>
            <Button onClick={() => requestLeave(() => void navigate('/m/period-close'))}>
              去期末处理
            </Button>
            <Button
              type="primary"
              disabled={readOnly || !data}
              onClick={() => requestLeave(() => start())}
            >
              新增期初
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 16 }}>
          <label>
            年度{' '}
            <InputNumber
              aria-label="年度"
              value={year || undefined}
              min={1900}
              max={9999}
              precision={0}
              onChange={(v) => {
                if (v) setFilter({ year: v });
              }}
            />
          </label>
          <label>
            币种{' '}
            <Select
              aria-label="币种筛选"
              value={filters.currency}
              style={{ width: 150 }}
              options={[
                { value: '', label: '全部币种' },
                { value: 'base', label: `本位币 ${data?.book.baseCurrency ?? ''}` },
                ...(data?.currencies ?? [])
                  .filter((c) => !c.isBase)
                  .map((c) => ({ value: c.code, label: `${c.code} ${c.name}` })),
              ]}
              onChange={(currency) => setFilter({ currency })}
            />
          </label>
          <label>
            期初数量{' '}
            <Switch checked={filters.quantity} onChange={(quantity) => setFilter({ quantity })} />
          </label>
          <Input
            aria-label="科目筛选"
            placeholder="科目编码、名称、拼音"
            style={{ width: 210 }}
            value={filters.account}
            onChange={(e) => setFilters({ account: e.target.value })}
          />
          <Select
            aria-label="期初视图"
            style={{ width: 170 }}
            value={filters.dimension}
            options={[
              { value: '', label: '科目期初' },
              ...openingDimensions.map((d) => ({ value: d.id, label: `${d.name}期初` })),
            ]}
            onChange={(dimension) => setFilter({ dimension, item: '' })}
          />
          {dimensionView && (
            <DimensionSelect
              key={dimensionView.id}
              type={dimensionView.id}
              includeDisabled
              aria-label={`${dimensionView.name}筛选`}
              placeholder={`全部${dimensionView.name}，可搜索编码、名称、拼音`}
              style={{ width: 280 }}
              value={scopedItem?.id}
              onChange={(item) => setFilter({ item: item == null ? '' : String(item) })}
            />
          )}
          <Button onClick={() => void refresh()}>重新读取</Button>
        </Space>
        {restored && draft && (
          <Alert
            type="info"
            title="已恢复本账套上次未保存输入"
            description="请核对年度和原记录；保存失败时草稿仍保留。"
          />
        )}
        {list.isError && (
          <Alert
            type="error"
            title={listError?.message ?? '期初读取失败'}
            description={
              listError?.hint ?? '输入已保留，请检查账套后点击重新读取；不要重复建年度。'
            }
            action={
              <Button onClick={() => requestLeave(() => void navigate('/m/period-close'))}>
                去期末处理
              </Button>
            }
          />
        )}
        {data && (
          <>
            <Alert
              type="info"
              title={`起算期间 ${data.fiscal.opening_period}；年初余额 + 账前累计借方 − 账前累计贷方 = 启用余额`}
              description={
                data.fiscal.opening_period % 100 === 1
                  ? '1 月启用，账前累计必须为零。'
                  : '账前累计指本年启用前发生额；启用余额写入核心起算余额，年初余额单独推导显示。'
              }
            />
            <Space wrap style={{ margin: '16px 0' }}>
              <Tag color={data.locked ? 'red' : 'green'}>
                {data.locked ? '本模块手工锁：已锁定' : '本模块手工锁：未锁定'}
              </Tag>
              {data.posted && <Tag color="red">本年有过账，禁止直接改删；先反过账</Tag>}
              <Button loading={exporting} onClick={() => void exportFile()}>
                导出 Excel
              </Button>
              <Button loading={preparingPrint} disabled={dirty} onClick={() => void previewPrint()}>
                打印预览
              </Button>
              {canImport && (
                <Button
                  disabled={dirty}
                  onClick={() => {
                    setImportOpen(true);
                    preview.reset();
                  }}
                >
                  导入 Excel
                </Button>
              )}
              {canLock && (
                <Popconfirm
                  title={data.locked ? '确认解锁本模块年度期初？' : '校验后锁定本模块年度期初？'}
                  description="此锁只约束本模块写入口，年结由期末处理独立负责。"
                  onConfirm={() => lock.mutate({ year, locked: !data.locked })}
                >
                  <Button
                    loading={lock.isPending}
                    disabled={dirty || (!data.locked && !result?.balanced)}
                  >
                    {data.locked ? '解锁年度期初' : '锁定年度期初'}
                  </Button>
                </Popconfirm>
              )}
              {canEdit && (
                <Button
                  danger
                  disabled={readOnly || dirty}
                  onClick={() =>
                    void cleanupPreview.refetch().then((r) => {
                      if (r.data) {
                        setCleanupOpen(true);
                        setConfirmation('');
                      }
                    })
                  }
                >
                  清理损益年初数
                </Button>
              )}
              <Button onClick={() => requestLeave(() => void navigate('/m/masterdata/accounts'))}>
                科目维护
              </Button>
              <Button
                onClick={() =>
                  requestLeave(
                    () =>
                      void navigate(
                        `/m/masterdata/dimensions?type=${filters.dimension || 'project'}`,
                      ),
                  )
                }
              >
                辅助档案维护
              </Button>
            </Space>
            <Typography.Title level={4}>科目树（父级只读汇总）</Typography.Title>
            <DataTable
              tableId="opening.tree"
              rowKey="id"
              columns={treeColumns}
              dataSource={prune(tree)}
              expandable={{ defaultExpandAllRows: true }}
              loading={list.isLoading}
            />
            <Typography.Title level={4}>已保存的末级明细</Typography.Title>
            <DataTable
              tableId="opening.details"
              rowKey="id"
              columns={detailColumns}
              dataSource={details}
            />
          </>
        )}
        <Typography.Title level={4}>试算平衡</Typography.Title>
        {trial.isError && (
          <Alert
            type="error"
            title="试算读取失败，不能判定平衡或锁定"
            description="编辑输入仍保留；请修复账套起算数据后重新读取。"
          />
        )}
        {result && (
          <>
            <Alert
              data-testid="trial-result"
              type={result.balanced ? 'success' : 'warning'}
              title={
                result.balanced
                  ? '试算平衡通过'
                  : !result.established
                    ? '期初尚未录入；明确保存零也会建立期初'
                    : '期初未平衡或数据无效，已保存内容可继续修正'
              }
              description={
                <div>
                  <div>
                    年初借方 {formatMoney(result.yearDebit)} / 贷方 {formatMoney(result.yearCredit)}
                    ，差额 {formatMoney(result.yearDifference)}
                  </div>
                  <div>
                    账前累计借方 {formatMoney(result.ytdDebit)} / 贷方{' '}
                    {formatMoney(result.ytdCredit)}，差额 {formatMoney(result.ytdDifference)}
                  </div>
                  <div>启用余额本位币差额 {formatMoney(result.difference)}</div>
                  <div>
                    核心期间试算：{result.coreError ?? (result.core?.balanced ? '通过' : '未通过')}
                    。核心试算不单独校验账前累计，本模块已追加检查。
                  </div>
                  {result.validationErrors.map((e, i) => (
                    <div key={i}>{e}</div>
                  ))}
                  <div>总差额不能确定唯一错误科目，请核对以下当前科目。</div>
                </div>
              }
            />
            <Space wrap style={{ margin: '12px 0' }}>
              {result.accounts.map((a) => (
                <Button
                  key={a.id}
                  onClick={() =>
                    setFilters({ account: a.code, dimension: '', currency: '', quantity: false })
                  }
                >
                  定位 {a.code} {a.name}
                </Button>
              ))}
            </Space>
          </>
        )}
      </PageContainer>
      <Drawer
        title={draft?.id ? '修改期初' : '新增期初'}
        open={draft != null}
        size={570}
        destroyOnHidden
        onClose={() => requestLeave(closeDraft)}
        footer={
          <Space>
            <Button onClick={() => requestLeave(closeDraft)}>关闭</Button>
            <Button type="primary" loading={saving} disabled={!canEdit} onClick={() => void save()}>
              保存
            </Button>
          </Space>
        }
      >
        <p>录入年度：{editYear}。留空余额不能保存；填写 0 可明确保存零期初。</p>
        {saveError && (
          <Alert type="error" title={saveError} description="输入已保留，请修正后点击保存重试。" />
        )}
        <Form<Draft>
          form={form}
          layout="vertical"
          initialValues={draft ?? {}}
          onValuesChange={(_, values) => {
            setDraft({ ...draft, ...values });
            setDirty(true);
          }}
        >
          <Form.Item
            name="accountId"
            label="末级科目"
            rules={[{ required: true, message: '请先选择要增加的科目' }]}
          >
            <AccountSelect
              disabled={draft?.id != null}
              filter={(a) => !foreignCurrency || a.currency === foreignCurrency}
              onChange={(accountId) => {
                const selected = data?.accounts.find((a) => a.id === accountId);
                const currency = form.getFieldValue('currency') as string | null | undefined;
                form.setFieldsValue({
                  dimensions: {
                    project: null,
                    partner: null,
                    department: null,
                    person: null,
                    ...(dimensionView &&
                    scopedItem &&
                    !scopedItem.disabled &&
                    selected?.dimensions.some((d) => d.type === dimensionView.id)
                      ? { [dimensionView.id]: scopedItem.id }
                      : {}),
                  },
                  currency: currency && selected?.currency === currency ? currency : '',
                  fcBalance: 0,
                  quantity: '0',
                });
              }}
            />
          </Form.Item>
          {account?.dimensions
            .filter((d) => d.type !== 'cashflow')
            .map((d) => (
              <Form.Item
                key={d.type}
                name={['dimensions', d.type]}
                label={openingDimensions.find((x) => x.id === d.type)?.name}
                rules={[
                  {
                    required: d.required || d.type === filters.dimension,
                    message: '请先选择具体档案，不能使用全部',
                  },
                ]}
              >
                <DimensionSelect type={d.type} disabled={draft?.id != null} />
              </Form.Item>
            ))}
          <Form.Item name="currency" label="录入币种">
            <Select
              disabled={draft?.id != null}
              options={[
                { value: '', label: `本位币 ${data?.book.baseCurrency ?? ''}` },
                ...(account?.currency
                  ? [{ value: account.currency, label: account.currency }]
                  : []),
              ]}
            />
          </Form.Item>
          <Form.Item name="side" label="年初余额方向">
            <Select
              options={[
                { value: '借', label: '借' },
                { value: '贷', label: '贷' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="amount"
            label="年初余额（本位币）"
            rules={[{ required: true, message: '请输入年初余额，明确零请填 0' }]}
          >
            <MoneyInput allowNegative={false} />
          </Form.Item>
          <p>账前累计的同方向红字冲销请填负数，保留原借、贷列。</p>
          <Form.Item name="ytdDebit" label="账前累计借方">
            <MoneyInput allowNegative disabled={(data?.fiscal.opening_period ?? 101) % 100 === 1} />
          </Form.Item>
          <Form.Item name="ytdCredit" label="账前累计贷方">
            <MoneyInput allowNegative disabled={(data?.fiscal.opening_period ?? 101) % 100 === 1} />
          </Form.Item>
          {watchedCurrency && (
            <>
              <Form.Item name="fcBalance" label="外币启用余额（借正贷负）">
                <MoneyInput />
              </Form.Item>
              <p>
                参考汇率：{data?.rates.find((r) => r.code === watchedCurrency)?.rate ?? '未设置'}
                。本位币与外币独立保存，参考汇率不会覆盖输入。
              </p>
            </>
          )}
          {account?.quantityUnit && (
            <Form.Item
              name="quantity"
              label={`启用数量（${account.quantityUnit}，借正贷负）`}
              rules={[{ pattern: /^-?\d+(\.\d{1,6})?$/, message: '数量最多六位小数' }]}
            >
              <Input inputMode="decimal" />
            </Form.Item>
          )}
          <p>启用余额：{activationText} 元</p>
        </Form>
      </Drawer>
      <Modal
        title="有未保存修改"
        open={leave != null}
        closable={!saving}
        maskClosable={!saving}
        onCancel={() => {
          if (!saving) setLeave(null);
        }}
        footer={
          <Space>
            <Button disabled={saving} onClick={() => setLeave(null)}>
              取消退出
            </Button>
            <Button
              danger
              disabled={saving}
              onClick={() => {
                if (leave)
                  void resolveLeave('discard', save, () => {
                    const action = leave;
                    closeDraft();
                    setLeave(null);
                    action();
                  });
              }}
            >
              放弃修改
            </Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => {
                if (leave)
                  void resolveLeave('save', save, () => {
                    const action = leave;
                    setLeave(null);
                    action();
                  });
              }}
            >
              保存后继续
            </Button>
          </Space>
        }
      >
        离开、切换条件或关闭前，可以保存、放弃或取消。保存失败会保留输入并停留在当前页。
      </Modal>
      <Modal
        title="清理损益年初数：请核对"
        open={cleanupOpen}
        onCancel={() => setCleanupOpen(false)}
        okText="二次确认清理"
        okButtonProps={{ disabled: confirmation !== '清理损益年初数', danger: true }}
        onOk={() =>
          void cleanup
            .mutateAsync({ year, expected: cleanupPreview.data?.expected ?? '', confirmation })
            .then(
              () => setCleanupOpen(false),
              () => {},
            )
        }
      >
        <p>
          仅清零列出的本位币年初余额，保留辅助组合、外币启用余额、数量与账前累计。不随分级汇总自动执行。
        </p>
        {cleanupPreview.data?.rows.map((r) => (
          <div key={r.id}>
            {r.accountCode} {r.accountName} / 记录 {r.id} / {r.currency || '本位币'} / 年初{' '}
            {formatMoney(r.yearStart)}
          </div>
        ))}
        <Input
          aria-label="清理确认文字"
          placeholder="输入：清理损益年初数"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </Modal>
      <Modal
        title="Excel 导入预览"
        open={importOpen}
        width={900}
        onCancel={() => setImportOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setImportOpen(false)}>取消导入</Button>
            <Button
              loading={preview.isPending}
              disabled={!file}
              onClick={() => preview.mutate({ year, file, mode })}
            >
              解析预览
            </Button>
            <Button
              type="primary"
              loading={importRows.isPending}
              disabled={!preview.data?.valid}
              onClick={() => {
                if (preview.data)
                  importRows.mutate({
                    year,
                    file,
                    mode,
                    confirmed: true,
                    expected: preview.data.expected,
                  });
              }}
            >
              确认整批写入
            </Button>
          </Space>
        }
      >
        <p>
          沿用导出表头。新增遇重复键报错；覆盖仅更新文件包含的键，其余记录保留。任一错误整批不写入。
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, position: 'relative' }}>
          <Select
            aria-label="导入模式"
            style={{ width: 280, maxWidth: '100%' }}
            getPopupContainer={(trigger) => trigger.parentElement!}
            value={mode}
            onChange={(v) => {
              setMode(v);
              preview.reset();
            }}
            options={[
              { value: 'add', label: '新增（拒绝已有键）' },
              { value: 'overwrite', label: '覆盖（明确修改已有键）' },
            ]}
          />
          <input
            aria-label="选择 Excel 文件"
            style={{ width: 320, maxWidth: '100%', minWidth: 0 }}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              preview.reset();
              setFile('');
              if (f) {
                if (f.size > 650000) {
                  notify.warning('文件超过 650KB，请分批导入');
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => setFile(String(reader.result).split(',')[1] ?? '');
                reader.readAsDataURL(f);
              }
            }}
          />
        </div>
        {preview.data && (
          <>
            <Alert
              title={preview.data.valid ? '预览通过，请确认整批写入' : '预览发现错误，请逐行修复'}
              type={preview.data.valid ? 'success' : 'error'}
            />
            <DataTable
              tableId="opening.preview"
              rowKey="row"
              columns={[
                { key: 'row', title: 'Excel 行', dataIndex: 'row', width: 90 },
                { key: 'account', title: '科目编码', dataIndex: 'account', width: 120 },
                { key: 'status', title: '处理', dataIndex: 'status', width: 100 },
                {
                  key: 'dimensions',
                  title: '项目 / 客供 / 部门 / 个人编码',
                  width: 250,
                  render: (_, r) =>
                    r.source
                      .slice(2, 6)
                      .map((v) => v || '—')
                      .join(' / '),
                },
                {
                  key: 'currency',
                  title: '币种',
                  width: 90,
                  render: (_, r) => r.source[6] || '本位币',
                },
                {
                  key: 'annual',
                  title: '年初本位币',
                  width: 140,
                  render: (_, r) => `${r.source[7] ?? ''} ${r.source[8] ?? ''}`,
                },
                {
                  key: 'activation',
                  title: '启用本位币（借正贷负）',
                  width: 180,
                  render: (_, r) => r.source[9],
                },
                {
                  key: 'foreign',
                  title: '外币启用余额',
                  width: 150,
                  render: (_, r) => r.source[10],
                },
                { key: 'quantity', title: '数量', width: 110, render: (_, r) => r.source[11] },
                {
                  key: 'ytd',
                  title: '账前累计借 / 贷',
                  width: 180,
                  render: (_, r) => `${r.source[12] ?? ''} / ${r.source[13] ?? ''}`,
                },
                { key: 'error', title: '逐行错误', dataIndex: 'error', width: 450 },
              ]}
              dataSource={preview.data.preview}
            />
          </>
        )}
      </Modal>
      <OpeningPrint job={printJob} onClose={() => setPrintJob(null)} />
    </div>
  );
}
