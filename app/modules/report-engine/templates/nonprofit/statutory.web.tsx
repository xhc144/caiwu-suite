import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form as AntForm,
  Input,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  type FormProps,
} from 'antd';
import { MoneyInput, MoneyText } from '@caiwu/ui';
import { activityRows, assetRows, liabilityRows, cashflowRows } from './forms';
import { balanceTargets } from './balance';
import {
  ConfigurationSchema,
  PreStartHistorySchema,
  ResourceSchema,
  balanceKey,
  exactSum,
  lineIdentity,
  sameLine,
  mappedRow,
  incomeIds,
  expenseIds,
  type ActualLine,
  type BalanceFact,
  type Configuration,
  type Resource,
  type Sources,
  type StatementRequest,
} from './model';
import { parseHistoryOpening, parseHistoryEntries } from './history-import';

type EditNotifications = {
  edit(id: string): void;
  finish(id: string): void;
  cancel(id: string): void;
  enter(id: string | null): void;
  settleCurrent(): void;
};
const EditContext = createContext<EditNotifications | null>(null);
function ConfigurationForm(props: Omit<FormProps, 'children'> & { children?: ReactNode }) {
  const context = useContext(EditContext),
    id = useId(),
    latest = useRef(context);
  latest.current = context;
  useEffect(() => () => latest.current?.cancel(id), [id]);
  return (
    <AntForm
      {...props}
      name={props.name ?? id}
      onValuesChange={(changed, values) => {
        context?.edit(id);
        props.onValuesChange?.(changed, values);
      }}
      onFinish={(values) => {
        context?.enter(id);
        try {
          return props.onFinish?.(values);
        } finally {
          context?.enter(null);
        }
      }}
    />
  );
}
function useConfigurationDraft() {
  const context = useContext(EditContext),
    id = useId(),
    latest = useRef(context);
  latest.current = context;
  useEffect(() => () => latest.current?.cancel(id), [id]);
  return { edit: () => context?.edit(id), commit: () => context?.finish(id) };
}
const Form = Object.assign(ConfigurationForm, {
  Item: AntForm.Item,
  List: AntForm.List,
  useForm: AntForm.useForm,
  useWatch: AntForm.useWatch,
});

type Props = {
  sources: Sources;
  request: StatementRequest;
  initial: Configuration;
  previousConfiguration?: Configuration;
  periods: { period: number; label: string }[];
  onRequestChange(r: StatementRequest): void;
  onSave(c: Configuration): Promise<void>;
  onGenerate(r: StatementRequest): Promise<void>;
  onDirtyChange?(dirty: boolean): void;
  onSaveReady?(save: () => Promise<void>): void;
  onDraftChange?(draft: Configuration): void;
};
const kinds = [
  { value: 'unrestricted', label: '非限定性' },
  { value: 'restricted', label: '限定性' },
];
const rowLabels = new Map(
  [...cashflowRows, ...assetRows, ...liabilityRows, ...activityRows].map((r) => [r.id, r.label]),
);
const options = (ids: readonly string[]) =>
  ids.map((value) => ({
    value,
    label:
      rowLabels.get(value) ??
      {
        fixedAllowance: '固定资产减值准备',
        intangibleAllowance: '无形资产减值准备',
        investmentAllowance: '长期投资减值准备',
      }[value] ??
      value,
  }));
const friendly = (e: ActualLine) =>
  `${e.date} ${e.displayNo} 第${e.lineNo}行 ${e.accountCode} ${e.summary}`;

function comparativeDetailOptions(
  current: Configuration,
  previous: Configuration | undefined,
  through: number,
) {
  const configurations = [{ configuration: current, through }];
  if (previous && previous.bookId === current.bookId && previous.year === current.year - 1)
    configurations.push({ configuration: previous, through: through - 100 });
  const details = new Set(
    configurations.flatMap(({ configuration, through }) =>
      configuration.recognitions
        .filter(
          (r) =>
            r.row === 'activityCost' &&
            mappedRow(r.line.account, configuration.mappings) === 'activityCost' &&
            Math.floor(r.line.period / 100) === configuration.year &&
            r.line.period <= through,
        )
        .flatMap((r) =>
          r.allocations
            .filter((a) => a.detail && (a.debit !== 0 || a.credit !== 0))
            .map((a) => a.detail!),
        ),
    ),
  );
  return [...details]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((detail) => ({
      value: `detail:${detail}`,
      label: `业务组成：${detail}`,
    }));
}

/** 由公共报表页面挂载，保存和生成均交回同一个受控接口；没有本地JSON或凭证回写入口。 */
export function NonprofitConfigurationPanel({
  sources,
  request,
  initial,
  previousConfiguration,
  periods,
  onRequestChange,
  onSave,
  onGenerate,
  onDirtyChange,
  onSaveReady,
  onDraftChange,
}: Props) {
  const [c, setC] = useState(initial),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [working, setWorking] = useState(false);
  const editVersion = useRef(0);
  const draft = useRef(c);
  const callbacks = useRef({ onSave, onDirtyChange, onDraftChange });
  callbacks.current = { onSave, onDirtyChange, onDraftChange };
  const saving = useRef<Promise<void> | null>(null);
  const pendingForms = useRef(new Set<string>()),
    activeForm = useRef<string | null>(null);
  const notifyDirty = () => {
    editVersion.current++;
    setSaved(false);
    callbacks.current.onDraftChange?.(draft.current);
    callbacks.current.onDirtyChange?.(true);
  };
  const notifications: EditNotifications = {
    edit: (id) => {
      pendingForms.current.add(id);
      notifyDirty();
    },
    finish: (id) => pendingForms.current.delete(id),
    cancel: (id) => pendingForms.current.delete(id),
    enter: (id) => {
      activeForm.current = id;
    },
    settleCurrent: () => {
      if (activeForm.current) pendingForms.current.delete(activeForm.current);
    },
  };
  const [editing, setEditing] = useState<{ kind: 'activity' | 'cash'; line: ActualLine } | null>(
    null,
  );
  const [balance, setBalance] = useState<{ fact: BalanceFact; label: string } | null>(null);
  const change = (next: Configuration) => {
    if (activeForm.current) notifications.finish(activeForm.current);
    if (JSON.stringify(next) === JSON.stringify(draft.current)) return;
    draft.current = next;
    notifyDirty();
    setC(next);
    setSaved(false);
    setError('');
  };
  const saveConfiguration = useCallback((): Promise<void> => {
    if (saving.current) return saving.current;
    const run = async () => {
      setWorking(true);
      setError('');
      try {
        if (pendingForms.current.size)
          throw new Error('请先确认或取消正在填写的来源表单，再保存全部来源配置');
        const parsed = ConfigurationSchema.safeParse(draft.current);
        if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('；'));
        const savingVersion = editVersion.current;
        await callbacks.current.onSave(parsed.data);
        if (editVersion.current !== savingVersion) {
          setSaved(false);
          throw new Error('已保存先前版本；保存期间又有编辑，请确认最新来源后再次保存');
        }
        setSaved(true);
        callbacks.current.onDirtyChange?.(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败，请检查来源资料后重试');
        throw e;
      } finally {
        setWorking(false);
      }
    };
    const promise = run().finally(() => {
      saving.current = null;
    });
    saving.current = promise;
    return promise;
  }, []);
  useEffect(() => {
    onSaveReady?.(saveConfiguration);
  }, [onSaveReady, saveConfiguration]);
  useEffect(() => {
    callbacks.current.onDraftChange?.(draft.current);
  }, []);
  const activity = sources.entries.filter(
    (e) =>
      e.closingKind !== 'pnl' &&
      [...incomeIds, ...expenseIds].includes(
        mappedRow(e.accountCode, c.mappings) as (typeof incomeIds)[number],
      ),
  );
  const cash = sources.entries.filter((e) =>
    c.cashScope.some((a) => a.account === e.accountCode && a.included),
  );
  const pending = activity.filter(
    (e) => !c.recognitions.some((r) => sameLine(r.line, lineIdentity(e))),
  );
  const pendingCash = cash.filter(
    (e) => !c.cashConfirmations.some((r) => sameLine(r.line, lineIdentity(e))),
  );
  const perform = async (action: () => Promise<void>) => {
    setWorking(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请检查来源资料后重试');
    } finally {
      setWorking(false);
    }
  };
  const periodChange = (key: 'from' | 'to', p: number) => {
    setSaved(false);
    onRequestChange({ ...request, [key]: p });
  };
  const lineTable = (rows: ActualLine[], kind: 'activity' | 'cash') => (
    <Table
      size="small"
      rowKey="lineId"
      dataSource={rows}
      pagination={{ pageSize: 6 }}
      scroll={{ x: 680 }}
      columns={[
        {
          title: '日期及凭证',
          key: 'voucher',
          render: (_, e) =>
            e.historicalSource ? (
              <span title={e.historicalSource}>
                {e.date} 启用前凭证{e.displayNo} 第{e.lineNo}行
              </span>
            ) : (
              <a href={`/m/voucher-entry/edit?id=${e.voucherId}`}>
                {e.date} {e.displayNo} 第{e.lineNo}行
              </a>
            ),
        },
        {
          title: '科目及摘要',
          key: 'account',
          render: (_, e) =>
            `${e.accountCode} ${sources.accounts.find((a) => a.id === e.accountId)?.name} ${e.summary}`,
        },
        { title: '借方', key: 'debit', render: (_, e) => <MoneyText value={e.debit} /> },
        { title: '贷方', key: 'credit', render: (_, e) => <MoneyText value={e.credit} /> },
        {
          title: '分类确认',
          key: 'confirm',
          render: (_, e) => {
            const confirmed = (kind === 'activity' ? c.recognitions : c.cashConfirmations).some(
              (a) => sameLine(a.line, lineIdentity(e)),
            );
            return (
              <Button onClick={() => setEditing({ kind, line: e })}>
                {confirmed ? '修改分配' : '逐笔确认'}
              </Button>
            );
          },
        },
      ]}
    />
  );
  return (
    <EditContext.Provider value={notifications}>
      <section aria-label="民非2026法定报表配置" style={{ minWidth: 0, padding: 12 }}>
        <Space wrap>
          <label>
            报表{' '}
            <Select
              aria-label="法定报表"
              style={{ width: 170 }}
              value={request.code}
              onChange={(code) => onRequestChange({ ...request, code })}
              options={[
                { value: '401', label: '资产负债表' },
                { value: '402', label: '业务活动表' },
                { value: '403', label: '年度现金流量表' },
              ]}
            />
          </label>
          <label>
            编报期{' '}
            <Select
              aria-label="编报期"
              style={{ width: 120 }}
              value={request.kind}
              onChange={(kind) => onRequestChange({ ...request, kind })}
              options={[
                { value: 'month', label: '月度' },
                { value: 'quarter', label: '季度' },
                { value: 'half', label: '半年度' },
                { value: 'interim', label: '其他中期' },
                { value: 'annual', label: '年度' },
              ]}
            />
          </label>
          <label>
            起始期间{' '}
            <Select
              aria-label="起始期间"
              value={request.from}
              style={{ width: 140 }}
              options={periods.map((p) => ({ value: p.period, label: p.label }))}
              onChange={(p) => periodChange('from', p)}
            />
          </label>
          <label>
            截止期间{' '}
            <Select
              aria-label="截止期间"
              value={request.to}
              style={{ width: 140 }}
              options={periods.map((p) => ({ value: p.period, label: p.label }))}
              onChange={(p) => periodChange('to', p)}
            />
          </label>
        </Space>
        <p>标准科目已按2026制度匹配。请核对资源限制、到期日、受托业务及现金范围；金额单位为元。</p>
        {c.year === 2026 && (
          <Alert
            type="info"
            title="2026年首次执行：业务活动表和现金流量表不要求填列上年比较数；资产负债表仍须填列新账年初余额。"
          />
        )}
        {error && <Alert type="error" title={error} closable onClose={() => setError('')} />}
        <Tabs
          items={[
            {
              key: 'basis',
              label: '制度及来源',
              children: (
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <label style={{ width: '100%' }}>
                    编制依据{' '}
                    <Input
                      aria-label="编制依据"
                      value={c.accountingBasis}
                      onChange={(e) => change({ ...c, accountingBasis: e.target.value })}
                    />
                  </label>
                  {(sources.historyMissing || c.preStartHistory) && (
                    <PreStartHistoryForm
                      sources={sources}
                      initial={c.preStartHistory}
                      onSave={(preStartHistory) => change({ ...c, preStartHistory })}
                    />
                  )}
                  <label style={{ width: '100%' }}>
                    新账年初或年结承接凭据{' '}
                    <Input
                      aria-label="年初凭据"
                      value={c.transitionOpeningReference}
                      onChange={(e) => change({ ...c, transitionOpeningReference: e.target.value })}
                    />
                  </label>
                  <label style={{ width: '100%' }}>
                    现金及现金等价物政策{' '}
                    <Input.TextArea
                      aria-label="现金范围政策"
                      value={c.cashPolicy}
                      onChange={(e) => change({ ...c, cashPolicy: e.target.value })}
                    />
                  </label>
                  <label style={{ width: '100%' }}>
                    政策变更依据（发生时填写）{' '}
                    <Input
                      value={c.policyChangeReference}
                      onChange={(e) =>
                        change({ ...c, policyChangeReference: e.target.value || undefined })
                      }
                    />
                  </label>
                  {c.year >= 2027 && (
                    <ComparativeConfigurationForm
                      sources={sources}
                      initial={c.comparison}
                      detailOptions={comparativeDetailOptions(c, previousConfiguration, request.to)}
                      periods={periods.filter((p) => Math.floor(p.period / 100) === c.year - 1)}
                      onSave={(comparison) => change({ ...c, comparison })}
                    />
                  )}
                  <p>自定义科目需逐项对应，不将未映射科目当作“不适用”。</p>
                  <AccountMappingForm
                    sources={sources}
                    onAdd={(m) =>
                      change({
                        ...c,
                        mappings: [...c.mappings.filter((x) => x.account !== m.account), m],
                      })
                    }
                  />
                </Space>
              ),
            },
            {
              key: 'resources',
              label: `资源与限制（${c.resources.length}批）`,
              children: (
                <>
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={c.resources}
                    pagination={{ pageSize: 5 }}
                    columns={[
                      { title: '资源批次', dataIndex: 'name' },
                      { title: '外部来源', dataIndex: 'sourceReference' },
                      {
                        title: '分类',
                        render: (_, r) =>
                          r.classification === 'restricted' ? '限定性' : '非限定性',
                      },
                      {
                        title: '年初余额',
                        render: (_, r) => <MoneyText value={r.openingBalance} />,
                      },
                    ]}
                  />
                  <ResourceForm
                    onSave={(resource) =>
                      change({
                        ...c,
                        resources: [...c.resources.filter((r) => r.id !== resource.id), resource],
                      })
                    }
                  />
                </>
              ),
            },
            {
              key: 'activity',
              label: (
                <span>
                  收入费用确认{' '}
                  <Tag color={pending.length ? 'orange' : 'green'}>尚有{pending.length}笔</Tag>
                </span>
              ),
              children: (
                <>
                  <p>逐笔核对资源取得、实际使用及限制；净额为零且存在借贷发生的分录仍须确认。</p>
                  {lineTable(activity, 'activity')}
                  <BatchRecognition
                    lines={pending}
                    resources={c.resources}
                    onConfirm={(rows) =>
                      change({
                        ...c,
                        recognitions: [
                          ...c.recognitions,
                          ...rows.map(({ line, resource, detail }) => ({
                            line: lineIdentity(line),
                            row: mappedRow(
                              line.accountCode,
                              c.mappings,
                            ) as Configuration['recognitions'][number]['row'],
                            allocations: [
                              {
                                resourceId: resource.id,
                                classification: resource.classification,
                                debit: line.debit,
                                credit: line.credit,
                                recognitionReference: '已逐笔核对取得和实际使用凭据',
                                ...(mappedRow(line.accountCode, c.mappings) === 'activityCost'
                                  ? { detail }
                                  : {}),
                                acquisitionReference: resource.acquisitionReference,
                                charitableTrust: false,
                                fundraisingCost: false,
                              },
                            ],
                          })),
                        ],
                      })
                    }
                  />
                </>
              ),
            },
            {
              key: 'balance',
              label: '年初与期末分析',
              children: (
                <>
                  <p>两时点分别核对到期、备抵及受托现金；往来按实际对象分向分析。</p>
                  <Table
                    rowKey={balanceKey}
                    size="small"
                    dataSource={sources.balances.filter((b) => b.opening !== 0 || b.closing !== 0)}
                    pagination={{ pageSize: 6 }}
                    columns={[
                      { title: '科目', render: (_, r) => `${r.accountCode} ${r.accountName}` },
                      {
                        title: '明细对象',
                        render: (_, r) =>
                          [
                            r.dimensions.partner &&
                              (sources.dimensionNames[`partner:${r.dimensions.partner}`] ??
                                '往来档案已变化'),
                            r.dimensions.person &&
                              (sources.dimensionNames[`person:${r.dimensions.person}`] ??
                                '个人档案已变化'),
                          ]
                            .filter(Boolean)
                            .join('、') || '本科目',
                      },
                      ...(['opening', 'closing'] as const).map((point) => ({
                        title: point === 'opening' ? '年初分析' : '期末分析',
                        key: point,
                        render: (_: unknown, r: Sources['balances'][number]) => {
                          const at =
                            point === 'opening' ? sources.openingDate : sources.closingDate;
                          const old = c.balanceFacts.find(
                            (f) => f.at === at && f.key === balanceKey(r),
                          );
                          return (
                            <Button
                              onClick={() =>
                                setBalance({
                                  label: `${at} ${r.accountCode} ${r.accountName}`,
                                  fact: old ?? {
                                    at,
                                    key: balanceKey(r),
                                    balance: r[point],
                                    allocations: [],
                                  },
                                })
                              }
                            >
                              <MoneyText value={r[point]} /> {old ? '已确认' : '核对分类'}
                            </Button>
                          );
                        },
                      })),
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'events',
              label: '净资产互转及调整',
              children: (
                <>
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={c.events}
                    pagination={{ pageSize: 4 }}
                    columns={[
                      { title: '发生日期', dataIndex: 'date' },
                      {
                        title: '事项',
                        render: (_, r) =>
                          ({
                            release: '限定转非限定',
                            restriction: '非限定转限定',
                            priorAdjustment: '以前年度调整',
                            directCapital: '注册资金直接计入',
                          })[r.kind],
                      },
                      { title: '来源凭据', dataIndex: 'sourceReference' },
                      { title: '金额', render: (_, r) => <MoneyText value={r.amount} /> },
                    ]}
                  />
                  <NetAssetEventForm
                    events={c.events}
                    sources={sources}
                    resources={c.resources}
                    onSave={(event) =>
                      change({
                        ...c,
                        events: [...c.events.filter((e) => e.id !== event.id), event],
                      })
                    }
                  />
                </>
              ),
            },
            {
              key: 'cash',
              label: (
                <span>
                  现金逐笔分类 <Tag>尚有{pendingCash.length}笔</Tag>
                </span>
              ),
              children: (
                <>
                  <CashScopeForm
                    sources={sources}
                    initial={c.cashScope}
                    onSave={(cashScope) => change({ ...c, cashScope })}
                  />
                  <p>
                    受限与受托资金分别排除；一笔可拆多项目，退款按原项目冲减，内部划转关联同一凭证的对应分录。
                  </p>
                  {lineTable(cash, 'cash')}
                </>
              ),
            },
          ]}
        />
        <Space
          wrap
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'var(--ant-color-bg-container,white)',
            padding: 12,
            zIndex: 1,
            width: '100%',
            borderTop: '1px solid #ddd',
          }}
        >
          <Button
            type="primary"
            loading={working}
            onClick={() => void saveConfiguration().catch(() => undefined)}
          >
            保存来源配置
          </Button>
          <Button
            disabled={!saved || working}
            onClick={() => void perform(() => onGenerate(request))}
          >
            生成所选报表
          </Button>
          <span>{saved ? '来源已保存，可生成' : '修改后请先保存来源'}</span>
        </Space>
        {editing && (
          <LineAllocationDrawer
            key={`${editing.kind}-${editing.line.lineId}`}
            kind={editing.kind}
            line={editing.line}
            resources={c.resources}
            initial={c}
            onClose={() => setEditing(null)}
            onSave={(value) => {
              change(value);
              setEditing(null);
            }}
          />
        )}
        {balance && (
          <BalanceAllocationDrawer
            value={balance}
            onClose={() => setBalance(null)}
            onSave={(fact) => {
              change({
                ...c,
                balanceFacts: [
                  ...c.balanceFacts.filter((f) => f.key !== fact.key || f.at !== fact.at),
                  fact,
                ],
              });
              setBalance(null);
            }}
          />
        )}
      </section>
    </EditContext.Provider>
  );
}

function PreStartHistoryForm({
  sources,
  initial,
  onSave,
}: {
  sources: Sources;
  initial: Configuration['preStartHistory'];
  onSave(h: NonNullable<Configuration['preStartHistory']>): void;
}) {
  const draft = useConfigurationDraft();
  const [basis, setBasis] = useState(initial?.basis ?? ''),
    [opening, setOpening] = useState(initial?.opening ?? []),
    [entries, setEntries] = useState(initial?.entries ?? []),
    [checked, setChecked] = useState(initial?.periods ?? []),
    [posted, setPosted] = useState(initial?.postedConfirmed ?? false),
    [error, setError] = useState('');
  const start = sources.book.startPeriod,
    january = Math.floor(start / 100) * 100 + 1;
  const months = Array.from({ length: start - january }, (_, i) => january + i);
  const load = async (file: File, kind: 'opening' | 'entries') => {
    try {
      if (file.size > 10_000_000) throw new Error('来源文件超过10MB，请按账套完整资料整理后再导入');
      const text = await file.text();
      if (kind === 'opening') setOpening(parseHistoryOpening(text, sources));
      else setEntries(parseHistoryEntries(text, sources));
      draft.edit();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '来源文件读取失败');
    }
  };
  return (
    <details open={sources.historyMissing}>
      <summary>导入年度年初与启用前逐笔来源</summary>
      <p>
        导入UTF-8 CSV，金额单位为元。年初列头：科目编码、往来编码、个人编码、年初余额、原始凭据。
      </p>
      <p>
        分录列头：日期、凭证编号、行号、原版本、科目编码、往来编码、个人编码、借方金额、贷方金额、结转类别、原始凭据。结转类别填写普通业务、损益结转或其他结转。无借贷的一侧填0。
      </p>
      <label>
        完整原账、年度年初及逐月核对依据
        <Input
          value={basis}
          onChange={(e) => {
            setBasis(e.target.value);
            draft.edit();
          }}
        />
      </label>
      <Space wrap>
        <label>
          年度年初来源
          <input
            aria-label="年度年初来源文件"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void load(file, 'opening');
            }}
          />
        </label>
        <label>
          启用前逐笔来源
          <input
            aria-label="启用前逐笔来源文件"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void load(file, 'entries');
            }}
          />
        </label>
      </Space>
      <p>
        已载入年初{opening.length}条、逐笔{entries.length}
        行。保存后逐科目、逐往来核对实际启用期初，再逐笔确认资源与现金分类。
      </p>
      <Checkbox.Group
        value={checked}
        onChange={(v) => {
          setChecked(v as number[]);
          draft.edit();
        }}
        options={months.map((p) => ({ value: p, label: `${p % 100}月资料已完整核对` }))}
      />
      <p>
        <Checkbox
          checked={posted}
          onChange={(e) => {
            setPosted(e.target.checked);
            draft.edit();
          }}
        >
          已核对年度年初及启用前全部已过账分录，未发生月份也有完整核对依据
        </Checkbox>
      </p>
      <Table
        size="small"
        rowKey={(r) => `${r.date}:${r.voucher}:${r.line}`}
        dataSource={entries}
        pagination={{ pageSize: 5 }}
        scroll={{ x: 600 }}
        columns={[
          { title: '日期', dataIndex: 'date' },
          { title: '原凭证', dataIndex: 'voucher' },
          { title: '行', dataIndex: 'line' },
          { title: '科目', dataIndex: 'account' },
          { title: '借方', render: (_, r) => <MoneyText value={r.debit} /> },
          { title: '贷方', render: (_, r) => <MoneyText value={r.credit} /> },
          { title: '原始凭据', dataIndex: 'sourceReference' },
        ]}
      />
      {error && <Alert type="error" title={error} />}
      <Button
        onClick={() => {
          const parsed = PreStartHistorySchema.safeParse({
            basis,
            postedConfirmed: posted,
            from: january,
            to: start - 1,
            periods: checked,
            opening,
            entries,
          });
          if (!parsed.success) {
            setError(parsed.error.issues.map((i) => i.message).join('；'));
            return;
          }
          onSave(parsed.data);
          draft.commit();
          setError('');
        }}
      >
        确认导入的启用前资料
      </Button>
    </details>
  );
}

function ResourceForm({ onSave }: { onSave(r: Resource): void }) {
  const [form] = Form.useForm();
  const [error, setError] = useState('');
  const cls = Form.useWatch('classification', form);
  return (
    <details>
      <summary>新增或更新资源批次</summary>
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => {
          const restriction =
            v.classification === 'restricted'
              ? {
                  authority: v.authority,
                  issuer: v.issuer,
                  sourceReference: v.sourceReference,
                  resourceReference: v.id,
                  specificClause: v.specificClause,
                  ...(v.time ? { time: { description: v.time } } : {}),
                  ...(v.purpose ? { purpose: { description: v.purpose } } : {}),
                }
              : undefined;
          const parsed = ResourceSchema.safeParse({
            id: v.id,
            name: v.name,
            classification: v.classification,
            sourceReference: v.sourceReference,
            acquisitionReference: v.acquisitionReference,
            openingBalance: v.openingBalance,
            openingReference: v.openingReference,
            unrestrictedBasis: v.unrestrictedBasis,
            restriction,
          });
          if (!parsed.success) {
            setError(parsed.error.issues.map((i) => i.message).join('；'));
            return;
          }
          onSave(parsed.data);
          setError('');
          form.resetFields();
        }}
      >
        {error && <Alert type="error" title={error} />}
        {(
          [
            ['id', '批次编号'],
            ['name', '资源名称'],
            ['sourceReference', '资源提供者原始文件'],
            ['acquisitionReference', '资源取得关联凭据'],
            ['openingReference', '年初资源分配依据'],
          ] as const
        ).map(([name, label]) => (
          <Form.Item key={name} name={name} label={label} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        ))}
        <Form.Item
          name="openingBalance"
          label="真实年初资源余额（元）"
          rules={[{ required: true }]}
        >
          <MoneyInput onFocus={(e) => e.currentTarget.select()} />
        </Form.Item>
        <Form.Item name="classification" label="外部限制分类" rules={[{ required: true }]}>
          <Select options={kinds} />
        </Form.Item>
        {cls === 'restricted' ? (
          <>
            <Form.Item name="authority" label="限制设置主体" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'assetProvider', label: '资产提供者' },
                  { value: 'lawOrRegulation', label: '国家有关法律、行政法规' },
                ]}
              />
            </Form.Item>
            <Form.Item name="issuer" label="提供者或法规名称" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item
              name="specificClause"
              label="比组织宗旨更具体明确的条款"
              rules={[{ required: true }]}
            >
              <Input.TextArea />
            </Form.Item>
            <Form.Item name="time" label="时间限制（如有）">
              <Input />
            </Form.Item>
            <Form.Item name="purpose" label="用途限制（如有）">
              <Input />
            </Form.Item>
          </>
        ) : (
          <Form.Item
            name="unrestrictedBasis"
            label="已核对文件未设外部时间、用途限制的依据"
            rules={[{ required: true }]}
          >
            <Input.TextArea />
          </Form.Item>
        )}
        <Button htmlType="submit">保存该资源批次</Button>
      </Form>
    </details>
  );
}
function LineAllocationDrawer({
  kind,
  line,
  resources,
  initial,
  onSave,
  onClose,
}: {
  kind: 'activity' | 'cash';
  line: ActualLine;
  resources: Resource[];
  initial: Configuration;
  onSave(c: Configuration): void;
  onClose(): void;
}) {
  const [form] = Form.useForm();
  const [error, setError] = useState('');
  const allocation = Form.useWatch('allocations', form) ?? [];
  const old =
    kind === 'activity'
      ? initial.recognitions.find((r) => r.line.lineId === line.lineId)
      : initial.cashConfirmations.find((r) => r.line.lineId === line.lineId);
  const difference =
    kind === 'activity'
      ? exactSum(allocation.map((a: { debit?: number }) => a?.debit ?? 0)) - line.debit
      : exactSum(allocation.map((a: { amount?: number }) => a?.amount ?? 0)) -
        (line.debit - line.credit);
  return (
    <Drawer
      open
      size={620}
      title={kind === 'activity' ? '收入费用资源分配' : '现金项目分配'}
      onClose={onClose}
      destroyOnHidden
    >
      <p>{friendly(line)}</p>
      <p>
        实际借方 <MoneyText value={line.debit} />
        ；贷方 <MoneyText value={line.credit} />
      </p>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ allocations: old?.allocations ?? [{}] }}
        onFinish={(v) => {
          try {
            const next = structuredClone(initial);
            if (kind === 'activity')
              next.recognitions = [
                ...next.recognitions.filter((r) => r.line.lineId !== line.lineId),
                {
                  line: lineIdentity(line),
                  row: mappedRow(
                    line.accountCode,
                    initial.mappings,
                  ) as Configuration['recognitions'][number]['row'],
                  allocations: v.allocations.map(
                    (a: Configuration['recognitions'][number]['allocations'][number]) => ({
                      ...a,
                      acquisitionReference: resources.find((r) => r.id === a.resourceId)
                        ?.acquisitionReference,
                    }),
                  ),
                },
              ];
            else
              next.cashConfirmations = [
                ...next.cashConfirmations.filter((r) => r.line.lineId !== line.lineId),
                { line: lineIdentity(line), allocations: v.allocations },
              ];
            onSave(ConfigurationSchema.parse(next));
          } catch (e) {
            setError(e instanceof Error ? e.message : '分配资料不完整');
          }
        }}
      >
        <Form.List name="allocations">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <fieldset key={f.key} style={{ marginBottom: 12 }}>
                  <legend>分配{f.name + 1}</legend>
                  {kind === 'activity' ? (
                    <>
                      <Form.Item
                        name={[f.name, 'resourceId']}
                        label="资源批次"
                        rules={[{ required: true }]}
                      >
                        <Select options={resources.map((r) => ({ value: r.id, label: r.name }))} />
                      </Form.Item>
                      <Form.Item
                        name={[f.name, 'classification']}
                        label="实际限制分类"
                        rules={[{ required: true }]}
                      >
                        <Select options={kinds} />
                      </Form.Item>
                      <Space>
                        <Form.Item
                          name={[f.name, 'debit']}
                          label="分配借方（元）"
                          rules={[{ required: true }]}
                        >
                          <MoneyInput onFocus={(e) => e.currentTarget.select()} />
                        </Form.Item>
                        <Form.Item
                          name={[f.name, 'credit']}
                          label="分配贷方（元）"
                          rules={[{ required: true }]}
                        >
                          <MoneyInput onFocus={(e) => e.currentTarget.select()} />
                        </Form.Item>
                      </Space>
                      <Form.Item
                        name={[f.name, 'recognitionReference']}
                        label="实际取得或使用凭据"
                        rules={[{ required: true }]}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item name={[f.name, 'detail']} label="业务活动成本组成名称（适用时）">
                        <Input />
                      </Form.Item>
                      <Form.Item name={[f.name, 'charitableTrust']} valuePropName="checked">
                        <Checkbox>设立慈善信托支出</Checkbox>
                      </Form.Item>
                      <Form.Item name={[f.name, 'fundraisingCost']} valuePropName="checked">
                        <Checkbox>募捐成本</Checkbox>
                      </Form.Item>
                    </>
                  ) : (
                    <>
                      <Form.Item
                        name={[f.name, 'row']}
                        label="现金流量项目"
                        rules={[{ required: true }]}
                      >
                        <Select
                          options={[
                            ...cashflowRows
                              .filter((r) => !r.section && !r.total)
                              .map((r) => ({ value: r.id, label: r.label })),
                            { value: 'internal', label: '现金范围内部划转' },
                            { value: 'excluded', label: '同科目受限或受托部分，不计入现金' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[f.name, 'amount']}
                        label="实际现金净流入（流出填负数，元）"
                        rules={[{ required: true }]}
                      >
                        <MoneyInput onFocus={(e) => e.currentTarget.select()} />
                      </Form.Item>
                      <Form.Item
                        name={[f.name, 'nature']}
                        label="特殊业务性质"
                        rules={[{ required: true }]}
                      >
                        <Select
                          options={[
                            { value: 'ordinary', label: '普通收支' },
                            { value: 'engineeringPayroll', label: '在建工程人员薪酬' },
                            { value: 'capitalizedInterest', label: '资本化借款利息' },
                            { value: 'financeLease', label: '融资租入固定资产租赁费' },
                            { value: 'disposal', label: '处置非流动资产' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[f.name, 'exclusionReason']}
                        label="不计入现金的具体性质（适用时）"
                      >
                        <Select
                          allowClear
                          options={[
                            { value: 'agency', label: '受托代理部分' },
                            { value: 'restricted', label: '不能随时用于支付的受限部分' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[f.name, 'sourceReference']}
                        label="分类原始凭据"
                        rules={[{ required: true }]}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name={[f.name, 'transferReference']}
                        label="内部划转对应单据编号（适用时）"
                      >
                        <Input />
                      </Form.Item>
                    </>
                  )}
                  <Button onClick={() => remove(f.name)}>移除此份分配</Button>
                </fieldset>
              ))}
              <Button onClick={() => add({})}>增加一份分配</Button>
            </>
          )}
        </Form.List>
        <p>
          分配与实际差额：
          <MoneyText value={difference} />
        </p>
        {error && <Alert type="error" title={error} />}
        <Button htmlType="submit" type="primary">
          确认本笔分配
        </Button>
      </Form>
    </Drawer>
  );
}
function BatchRecognition({
  lines,
  resources,
  onConfirm,
}: {
  lines: ActualLine[];
  resources: Resource[];
  onConfirm(rows: { line: ActualLine; resource: Resource; detail?: string }[]): void;
}) {
  const [selected, setSelected] = useState<number[]>([]),
    [resource, setResource] = useState<string>();
  const [detail, setDetail] = useState('');
  const rows = lines.filter((e) => selected.includes(e.lineId));
  return (
    <details>
      <summary>批量分配预览</summary>
      <p>只对选中的实际分录分配同一资源；每笔仍保留真实凭证及取得关联。</p>
      <Select
        aria-label="批量选择分录"
        mode="multiple"
        style={{ width: '100%' }}
        value={selected}
        onChange={setSelected}
        options={lines.map((e) => ({ value: e.lineId, label: friendly(e) }))}
      />
      <Select
        aria-label="批量资源"
        style={{ width: '100%', marginTop: 8 }}
        value={resource}
        onChange={setResource}
        options={resources.map((r) => ({ value: r.id, label: r.name }))}
      />
      <Input
        aria-label="批量业务活动成本组成"
        placeholder="业务活动成本须填写实际业务组成名称"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
      />
      <p>
        {rows.length}笔；借方合计
        <MoneyText value={exactSum(rows.map((e) => e.debit))} />
        ，贷方合计
        <MoneyText value={exactSum(rows.map((e) => e.credit))} />
        ；逐笔全额分配，差额0.00元。
      </p>
      <Button
        disabled={
          !resource ||
          !rows.length ||
          (rows.some((e) => e.accountCode.startsWith('5101')) && !detail.trim())
        }
        onClick={() => {
          onConfirm(
            rows.map((line) => ({
              line,
              resource: resources.find((r) => r.id === resource)!,
              detail,
            })),
          );
          setSelected([]);
        }}
      >
        已核对预览，确认所选分录
      </Button>
    </details>
  );
}
function BalanceAllocationDrawer({
  value,
  onSave,
  onClose,
}: {
  value: { fact: BalanceFact; label: string };
  onSave(f: BalanceFact): void;
  onClose(): void;
}) {
  const [form] = Form.useForm();
  return (
    <Drawer open size={560} title={value.label} onClose={onClose}>
      <p>
        实际有符号余额（元）：
        <MoneyText value={value.fact.balance} />
      </p>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          allocations: value.fact.allocations.length ? value.fact.allocations : [{}],
        }}
        onFinish={(v) => onSave({ ...value.fact, allocations: v.allocations })}
      >
        <Form.List name="allocations">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <fieldset key={f.key}>
                  <legend>余额分配{f.name + 1}</legend>
                  <Form.Item name={[f.name, 'row']} label="列报项目" rules={[{ required: true }]}>
                    <Select options={options([...balanceTargets, 'fixedNet', 'intangibleNet'])} />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'amount']}
                    label="实际分配余额（元，保持借贷符号）"
                    rules={[{ required: true }]}
                  >
                    <MoneyInput onFocus={(e) => e.currentTarget.select()} />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'sourceReference']}
                    label="合同、减值或托管凭据"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item name={[f.name, 'maturity']} label="合同到期日（长期项目必填）">
                    <Input type="date" />
                  </Form.Item>
                  <Form.Item name={[f.name, 'agency']} valuePropName="checked">
                    <Checkbox>属于受托代理货币资金</Checkbox>
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'cashIncluded']}
                    label="现金流量表范围（同科目混合资金时必选）"
                  >
                    <Select
                      allowClear
                      options={[
                        { value: true, label: '本组织可随时支付的现金' },
                        { value: false, label: '不计入可用现金' },
                      ]}
                    />
                  </Form.Item>
                  <Button onClick={() => remove(f.name)}>移除</Button>
                </fieldset>
              ))}
              <Button onClick={() => add({})}>拆分余额</Button>
            </>
          )}
        </Form.List>
        <Button type="primary" htmlType="submit">
          确认该时点余额分析
        </Button>
      </Form>
    </Drawer>
  );
}
function AccountMappingForm({
  sources,
  onAdd,
}: {
  sources: Sources;
  onAdd(m: Configuration['mappings'][number]): void;
}) {
  return (
    <details>
      <summary>调整自定义科目对应项目</summary>
      <Form layout="vertical" onFinish={(v) => onAdd(v as Configuration['mappings'][number])}>
        <Form.Item name="account" label="实际科目" rules={[{ required: true }]}>
          <Select
            showSearch
            options={sources.accounts
              .filter((a) => a.isLeaf)
              .map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))}
          />
        </Form.Item>
        <Form.Item name="row" label="法定报表项目" rules={[{ required: true }]}>
          <Select
            options={options([
              ...balanceTargets,
              ...incomeIds,
              ...expenseIds,
              'fixedAllowance',
              'intangibleAllowance',
              'investmentAllowance',
            ])}
          />
        </Form.Item>
        <Form.Item name="basis" label="科目用途及对应依据" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Button htmlType="submit">保存科目对应</Button>
      </Form>
    </details>
  );
}
function CashScopeForm({
  sources,
  initial,
  onSave,
}: {
  sources: Sources;
  initial: Configuration['cashScope'];
  onSave(v: Configuration['cashScope']): void;
}) {
  const edits = useContext(EditContext);
  const accounts = sources.accounts.filter(
    (a) =>
      a.isLeaf &&
      (a.isCash ||
        a.isBank ||
        ['1001', '1002', '1009', '1101', '1402', '1403'].includes(a.code.slice(0, 4))),
  );
  return (
    <details>
      <summary>核对现金及现金等价物范围</summary>
      <Form
        layout="vertical"
        initialValues={{ rows: initial }}
        onFinish={(v) => {
          onSave(v.rows);
          edits?.settleCurrent();
        }}
      >
        <Form.List name="rows">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <fieldset key={f.key}>
                  <legend>现金范围项目{f.name + 1}</legend>
                  <Form.Item
                    name={[f.name, 'account']}
                    label="实际科目"
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={accounts.map((a) => ({
                        value: a.code,
                        label: `${a.code} ${a.name}`,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name={[f.name, 'included']} valuePropName="checked">
                    <Checkbox>属于可随时用于支付的现金</Checkbox>
                  </Form.Item>
                  <Form.Item name={[f.name, 'restricted']} valuePropName="checked">
                    <Checkbox>受限资金</Checkbox>
                  </Form.Item>
                  <Form.Item name={[f.name, 'agency']} valuePropName="checked">
                    <Checkbox>受托代理资金</Checkbox>
                  </Form.Item>
                  <Form.Item name={[f.name, 'partitioned']} valuePropName="checked">
                    <Checkbox>同一科目含可用、受限或受托部分，分别分配</Checkbox>
                  </Form.Item>
                  <Form.Item name={[f.name, 'equivalent']} valuePropName="checked">
                    <Checkbox>现金等价物</Checkbox>
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'basis']}
                    label="范围核实原始凭据"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item name={[f.name, 'acquiredOn']} label="现金等价物取得日">
                    <Input type="date" />
                  </Form.Item>
                  <Form.Item name={[f.name, 'maturity']} label="现金等价物到期日">
                    <Input type="date" />
                  </Form.Item>
                  <Form.Item name={[f.name, 'riskBasis']} label="可转换已知现金及低风险依据">
                    <Input />
                  </Form.Item>
                  <Button onClick={() => remove(f.name)}>移除此项</Button>
                </fieldset>
              ))}
              <Button
                onClick={() =>
                  add({ included: false, restricted: false, agency: false, equivalent: false })
                }
              >
                增加范围科目
              </Button>
            </>
          )}
        </Form.List>
        <Button htmlType="submit">确认现金范围</Button>
      </Form>
    </details>
  );
}
function NetAssetEventForm({
  events,
  sources,
  resources,
  onSave,
}: {
  sources: Sources;
  resources: Resource[];
  events: Configuration['events'];
  onSave(e: Configuration['events'][number]): void;
}) {
  const [form] = Form.useForm();
  const [error, setError] = useState('');
  const kind = Form.useWatch('kind', form);
  return (
    <details>
      <summary>确认互转、以前年度调整或注册资金</summary>
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => {
          const resource = resources.find((r) => r.id === v.resourceId);
          if (!resource) return;
          const lines = sources.entries.filter((e) => (v.lineIds as number[]).includes(e.lineId));
          const originals = [
            ...(resource.restriction ? [resource.restriction] : []),
            ...events
              .filter(
                (e) => e.resourceId === resource.id && e.kind === 'restriction' && e.date <= v.date,
              )
              .map((e) => e.restriction!)
              .filter(Boolean),
          ];
          const releaseEvidence =
            v.kind === 'release'
              ? originals.map((rule) => ({
                  ...rule,
                  ...(rule.time ? { time: { ...rule.time, releaseReference: v.timeRelease } } : {}),
                  ...(rule.purpose
                    ? { purpose: { ...rule.purpose, releaseReference: v.purposeRelease } }
                    : {}),
                }))
              : undefined;
          const restriction =
            v.kind === 'release'
              ? releaseEvidence?.[0]
              : v.kind === 'restriction'
                ? {
                    authority: v.authority,
                    issuer: v.issuer,
                    sourceReference: v.sourceReference,
                    resourceReference: v.resourceId,
                    specificClause: v.specificClause,
                    ...(v.time ? { time: { description: v.time } } : {}),
                    ...(v.purpose ? { purpose: { description: v.purpose } } : {}),
                  }
                : undefined;
          const event = {
            id: v.id,
            kind: v.kind,
            date: v.date,
            resourceId: v.resourceId,
            lines: lines.map((e) => ({ line: lineIdentity(e), debit: e.debit, credit: e.credit })),
            amount: v.amount,
            sourceReference: v.sourceReference,
            originalPeriod: v.originalPeriod ? Number(v.originalPeriod) : undefined,
            restriction,
            releaseEvidence,
          };
          const parsed = ConfigurationSchema.shape.events.element.safeParse(event);
          if (!parsed.success) {
            setError(parsed.error.issues.map((i) => i.message).join('；'));
            return;
          }
          onSave(parsed.data);
          form.resetFields();
          setError('');
        }}
      >
        {error && <Alert type="error" title={error} />}
        <Form.Item name="id" label="事项编号" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="kind" label="事项性质" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'release', label: '限定性转为非限定性' },
              { value: 'restriction', label: '非限定性转为限定性' },
              { value: 'priorAdjustment', label: '以前年度净资产调整' },
              { value: 'directCapital', label: '注册资金直接计入净资产' },
            ]}
          />
        </Form.Item>
        <Form.Item name="date" label="实际发生日期" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="resourceId" label="资源批次" rules={[{ required: true }]}>
          <Select options={resources.map((r) => ({ value: r.id, label: r.name }))} />
        </Form.Item>
        <Form.Item name="lineIds" label="实际对应分录" rules={[{ required: true }]}>
          <Select
            mode="multiple"
            options={sources.entries
              .filter((e) => e.closingKind !== 'pnl')
              .map((e) => ({ value: e.lineId, label: friendly(e) }))}
          />
        </Form.Item>
        <Form.Item name="amount" label="真实事项金额（元）" rules={[{ required: true }]}>
          <MoneyInput onFocus={(e) => e.currentTarget.select()} />
        </Form.Item>
        <Form.Item name="sourceReference" label="原始依据" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        {kind === 'release' && (
          <>
            <Form.Item name="timeRelease" label="全部原时间限制已解除的依据（存在时间限制时必填）">
              <Input />
            </Form.Item>
            <Form.Item
              name="purposeRelease"
              label="全部原用途限制已解除的依据（存在用途限制时必填）"
            >
              <Input />
            </Form.Item>
          </>
        )}
        {kind === 'restriction' && (
          <>
            <Form.Item name="authority" label="外部限制来源" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'assetProvider', label: '资产提供者' },
                  { value: 'lawOrRegulation', label: '国家有关法律、行政法规' },
                ]}
              />
            </Form.Item>
            <Form.Item name="issuer" label="外部主体" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="specificClause" label="具体限制条款" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="time" label="时间限制">
              <Input />
            </Form.Item>
            <Form.Item name="purpose" label="用途限制">
              <Input />
            </Form.Item>
          </>
        )}
        {kind === 'priorAdjustment' && (
          <Form.Item
            name="originalPeriod"
            label="被调整的原年度期间（如202512）"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
        )}
        <Button htmlType="submit">确认实际净资产事项</Button>
      </Form>
    </details>
  );
}

function ComparativeConfigurationForm({
  sources,
  initial,
  detailOptions,
  periods,
  onSave,
}: {
  sources: Sources;
  initial: Configuration['comparison'];
  detailOptions: { value: string; label: string }[];
  periods: Props['periods'];
  onSave(c: NonNullable<Configuration['comparison']>): void;
}) {
  const [form] = Form.useForm(),
    [error, setError] = useState('');
  const cashDraft = useConfigurationDraft();
  const [cashRestatements, setCashRestatements] = useState(initial?.cashRestatements);
  return (
    <details>
      <summary>核对上年度可比口径及项目重列</summary>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ...initial, restatements: initial?.restatements ?? [] }}
        onFinish={(v) => {
          const input = JSON.parse(
            JSON.stringify({
              ...v,
              ...(cashRestatements === undefined ? {} : { cashRestatements }),
            }),
          ) as Record<string, unknown>;
          if (
            initial?.retrospectivePeriods === undefined &&
            Array.isArray(input.retrospectivePeriods) &&
            !input.retrospectivePeriods.length
          )
            delete input.retrospectivePeriods;
          const parsed = ConfigurationSchema.shape.comparison.unwrap().safeParse(input);
          if (!parsed.success) {
            setError(parsed.error.issues.map((i) => i.message).join('；'));
            return;
          }
          onSave(parsed.data);
          cashDraft.commit();
          setError('');
        }}
      >
        <p>
          上年度来源由本账套保存资料读取。没有重列时，确认相同编制口径即可；有重列须填写原发生期间、项目和凭据。
        </p>
        <p>
          业务组成选项来自本年及上年度对应期间的逐笔确认；未读取到真实组成时，请先核对上年保存的来源配置。
        </p>
        <Form.Item name="basis" label="上年可比项目及口径核对依据" rules={[{ required: true }]}>
          <Input.TextArea />
        </Form.Item>
        <Form.List name="retrospectivePeriods">
          {(fields, { add, remove }) => (
            <>
              <p>
                中期追溯须分别核对上年年初、可比期起点前月、可比期末及上年年末；未调整时点也填写全量核对依据。
              </p>
              {fields.map((f) => (
                <fieldset key={f.key}>
                  <legend>追溯时点核对{f.name + 1}</legend>
                  <Form.Item name={[f.name, 'at']} label="余额时点" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'opening', label: '年度年初' },
                        { value: 'closing', label: '期间末' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'period']}
                    label="上年核对期间"
                    rules={[{ required: true }]}
                  >
                    <Select options={periods.map((p) => ({ value: p.period, label: p.label }))} />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'basis']}
                    label="全量余额及未调整项目核对依据"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                  <Button onClick={() => remove(f.name)}>移除此时点核对</Button>
                </fieldset>
              ))}
              <Button onClick={() => add({})}>增加追溯时点核对</Button>
            </>
          )}
        </Form.List>
        <Form.List name="balanceAdjustments">
          {(fields, { add, remove }) => (
            <>
              <p>追溯底稿按原时点逐科目及往来明细借贷平衡；上年年末调整须由次年真实年初承接。</p>
              {fields.map((f) => (
                <fieldset key={f.key}>
                  <legend>追溯余额调整{f.name + 1}</legend>
                  <Form.Item name={[f.name, 'at']} label="原时点" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'opening', label: '上年度年初' },
                        { value: 'closing', label: '上年度期末' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name={[f.name, 'period']} label="上年原余额期间（中期追溯必填）">
                    <Select
                      allowClear
                      options={periods.map((p) => ({ value: p.period, label: p.label }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'key']}
                    label="实际科目及往来明细"
                    rules={[{ required: true }]}
                  >
                    <Select
                      options={sources.balances.map((b) => ({
                        value: balanceKey(b),
                        label: `${b.accountCode} ${b.accountName} ${sources.dimensionNames[`partner:${b.dimensions.partner}`] ?? ''} ${sources.dimensionNames[`person:${b.dimensions.person}`] ?? ''}`,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'originalBalance']}
                    label="上年原有符号余额（元）"
                    rules={[{ required: true }]}
                  >
                    <MoneyInput />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'delta']}
                    label="追溯有符号调整（元）"
                    rules={[{ required: true }]}
                  >
                    <MoneyInput />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'basis']}
                    label="逐明细追溯工作底稿及原始凭据"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                  <Button onClick={() => remove(f.name)}>移除此项余额调整</Button>
                </fieldset>
              ))}
              <Button onClick={() => add({})}>增加追溯余额调整</Button>
            </>
          )}
        </Form.List>
        <Form.List name="restatements">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <fieldset key={f.key}>
                  <legend>项目重列{f.name + 1}</legend>
                  <Form.Item name={[f.name, 'code']} label="报表" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: '402', label: '业务活动表' },
                        { value: '403', label: '现金流量表' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'row']}
                    label="真实明细项目"
                    rules={[{ required: true }]}
                  >
                    <Select
                      showSearch={{
                        filterOption: (text, option) => String(option?.label ?? '').includes(text),
                      }}
                      options={[
                        ...options([
                          ...incomeIds,
                          ...expenseIds,
                          'charitableTrust',
                          'fundraisingCost',
                          'priorAdjustment',
                        ]),
                        ...detailOptions,
                        ...cashflowRows
                          .filter((r) => !r.section && !r.total)
                          .filter(
                            (r) =>
                              ![...incomeIds, ...expenseIds].includes(
                                r.id as (typeof incomeIds)[number],
                              ),
                          )
                          .map((r) => ({ value: r.id, label: r.label })),
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'period']}
                    label="上年实际发生期间"
                    rules={[{ required: true }]}
                  >
                    <Select options={periods.map((p) => ({ value: p.period, label: p.label }))} />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'amount']}
                    label="重列调整金额（增加填正数，减少填负数，元）"
                    rules={[{ required: true }]}
                  >
                    <MoneyInput onFocus={(e) => e.currentTarget.select()} />
                  </Form.Item>
                  <Form.Item
                    name={[f.name, 'basis']}
                    label="原始凭据及重列依据"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                  <Button onClick={() => remove(f.name)}>移除此项重列</Button>
                </fieldset>
              ))}
              <Button onClick={() => add({})}>增加明细项目重列</Button>
            </>
          )}
        </Form.List>
        {error && <Alert type="error" title={error} />}
        <Button htmlType="submit">确认上年比较口径</Button>
      </Form>
      <HistoricalCashRestatements
        sources={sources}
        value={cashRestatements ?? []}
        onChange={(v) => {
          setCashRestatements(v);
          cashDraft.edit();
        }}
      />
    </details>
  );
}

function HistoricalCashRestatements({
  sources,
  value,
  onChange,
}: {
  sources: Sources;
  value: NonNullable<Configuration['comparison']>['cashRestatements'];
  onChange(v: NonNullable<NonNullable<Configuration['comparison']>['cashRestatements']>): void;
}) {
  const edits = useContext(EditContext);
  const snapshots = value ?? [];
  const [editing, setEditing] = useState<{
    index: number;
    fact: BalanceFact;
    label: string;
  } | null>(null);
  const update = (index: number, patch: Partial<(typeof snapshots)[number]>) =>
    onChange(snapshots.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  return (
    <details>
      <summary>核对历史现金范围及混合资金各部分</summary>
      <p>
        按上年原时点资料分别录入重列后的可用、受限及受托部分。余额调整仍须在追溯底稿中借贷平衡，确认后再保存上年比较口径。
      </p>
      {snapshots.map((snapshot, index) => (
        <fieldset key={snapshot.at}>
          <legend>{snapshot.at === 'opening' ? '上年度年初' : '上年度年末'}现金范围重列</legend>
          <label>
            该时点原始依据
            <Input
              value={snapshot.basis}
              onChange={(e) => update(index, { basis: e.target.value })}
            />
          </label>
          <label>
            该时点重列现金政策
            <Input
              value={snapshot.cashPolicy}
              onChange={(e) => update(index, { cashPolicy: e.target.value })}
            />
          </label>
          <CashScopeForm
            key={`${snapshot.at}-scope`}
            sources={sources}
            initial={snapshot.cashScope}
            onSave={(cashScope) => update(index, { cashScope })}
          />
          <Table
            size="small"
            rowKey="key"
            pagination={false}
            dataSource={snapshot.balanceFacts}
            columns={[
              { title: '原时点', dataIndex: 'at' },
              {
                title: '科目及往来',
                render: (_, f) => {
                  const b = sources.balances.find((b) => balanceKey(b) === f.key);
                  const code = f.key.split(':')[0]!;
                  return `${code} ${sources.accounts.find((a) => a.code === code)?.name ?? ''} ${b ? (sources.dimensionNames[`partner:${b.dimensions.partner}`] ?? '') : ''} ${b ? (sources.dimensionNames[`person:${b.dimensions.person}`] ?? '') : ''}`;
                },
              },
              { title: '重列后余额', render: (_, f) => <MoneyText value={f.balance} /> },
              {
                title: '逐部分分配',
                render: (_, fact) => (
                  <Button onClick={() => setEditing({ index, fact, label: '历史混合资金' })}>
                    修改可用及排除部分
                  </Button>
                ),
              },
            ]}
          />
          <Form
            layout="vertical"
            onFinish={(v: { key: string; balance: number }) => {
              edits?.settleCurrent();
              const year = Math.floor(sources.to / 100) - 1;
              setEditing({
                index,
                label: '历史混合资金',
                fact: {
                  key: v.key,
                  at: `${year}-${snapshot.at === 'opening' ? '01-01' : '12-31'}`,
                  balance: v.balance,
                  allocations: [],
                },
              });
            }}
          >
            <Form.Item name="key" label="原科目及往来明细" rules={[{ required: true }]}>
              <Select
                options={sources.balances.map((b) => ({
                  value: balanceKey(b),
                  label: `${b.accountCode} ${b.accountName} ${sources.dimensionNames[`partner:${b.dimensions.partner}`] ?? ''} ${sources.dimensionNames[`person:${b.dimensions.person}`] ?? ''}`,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="balance"
              label="原时点按底稿重列后的实际余额（元）"
              rules={[{ required: true }]}
            >
              <MoneyInput />
            </Form.Item>
            <Button htmlType="submit">增加原时点混合资金分配</Button>
          </Form>
          <Button onClick={() => onChange(snapshots.filter((_, i) => i !== index))}>
            移除此时点现金重列
          </Button>
        </fieldset>
      ))}
      <Space wrap>
        {(['opening', 'closing'] as const)
          .filter((at) => !snapshots.some((s) => s.at === at))
          .map((at) => (
            <Button
              key={at}
              onClick={() =>
                onChange([
                  ...snapshots,
                  { at, basis: '', cashPolicy: '', cashScope: [], balanceFacts: [] },
                ])
              }
            >
              {at === 'opening' ? '补录上年度年初现金范围重列' : '补录上年度年末现金范围重列'}
            </Button>
          ))}
      </Space>
      {editing && (
        <BalanceAllocationDrawer
          value={editing}
          onClose={() => setEditing(null)}
          onSave={(fact) => {
            update(editing.index, {
              balanceFacts: [
                ...snapshots[editing.index]!.balanceFacts.filter((f) => f.key !== fact.key),
                fact,
              ],
            });
            setEditing(null);
          }}
        />
      )}
    </details>
  );
}
