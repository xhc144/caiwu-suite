import { useRef, useState } from 'react';
import { Alert, App, Button, Checkbox, Collapse, Input, Modal, Select, Space, Table } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  queryClient,
  showError,
  useHotkey,
  useAccounts,
  usePermission,
  useRequiredSession,
  useSubmission,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import { AccountSelect, DataTable, PageContainer, PeriodPicker } from '@caiwu/ui';
import {
  ACCOUNT_FUNCTIONS,
  DefinitionInputSchema,
  UNIT_NAMES,
  type DefinitionInput,
} from '../custom';
import { api } from './api';
import { NoPermission, ReportError } from './common';
import ResultEditor, { type ResultDraft } from './ResultEditor';

type Draft = DefinitionInput & { revision: number };
const blank = (): Draft => ({
  code: '',
  name: '',
  expectedRevision: 0,
  revision: 0,
  rows: [{ key: 1, name: '', formula: '', subtotal: false, unit: 'money' }],
});
function DefinitionEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: Draft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { modal } = App.useApp();
  const [draft, setDraft] = useState(initial),
    [saved, setSaved] = useState(initial);
  const [error, setError] = useState('');
  const { byId } = useAccounts();
  const [wizardAccount, setWizardAccount] = useState<number>();
  const [wizardFunction, setWizardFunction] = useState<string>('借方');
  const [wizardRow, setWizardRow] = useState(initial.rows[0]!.key);
  const { submit, isSubmitting } = useSubmission();
  const mutation = useMutation(api.definitions.save.mutationOptions({ meta: { silent: true } }));
  const version = JSON.stringify(draft),
    latest = useRef(version);
  latest.current = version;
  const dirty = !saved.id || version !== JSON.stringify(saved);
  const save = () =>
    submit(async () => {
      const parsed = DefinitionInputSchema.safeParse(draft);
      if (!parsed.success) {
        setError(parsed.error.issues.map((i) => i.message).join('；'));
        return false;
      }
      const captured = version;
      try {
        const result = await mutation.mutateAsync({
          ...parsed.data,
          expectedRevision: saved.revision,
        });
        setSaved(result);
        if (latest.current === captured) setDraft(result);
        setError('');
        onSaved();
        return latest.current === captured;
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败，输入仍保留');
        showError(e);
        return false;
      }
    });
  useUnsavedChanges({
    title: `自定义分析定义：${draft.name || '新表'}`,
    dirty,
    version,
    save,
    discard: () => {
      setDraft(saved);
      onClose();
    },
  });
  useHotkey('Ctrl+S', () => {
    void save();
  });
  const close = () => {
    if (isSubmitting) return;
    if (!dirty) return onClose();
    const dialog = modal.confirm({
      title: '分析定义尚未保存',
      content: '保存失败时保留当前输入，请选择如何离开。',
      okText: '保存后关闭',
      cancelText: '继续编辑',
      onOk: async () => {
        if (await save()) onClose();
        else throw new Error('保存未完成');
      },
      footer: (_, { OkBtn, CancelBtn }) => (
        <>
          <Button
            onClick={() => {
              dialog.destroy();
              onClose();
            }}
          >
            放弃修改
          </Button>
          <CancelBtn />
          <OkBtn />
        </>
      ),
    });
  };
  const changeRow = (index: number, patch: Partial<DefinitionInput['rows'][number]>) =>
    setDraft((d) => ({ ...d, rows: d.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  const append = (copy?: DefinitionInput['rows'][number]) =>
    setDraft((d) => ({
      ...d,
      rows: [
        ...d.rows,
        copy
          ? {
              ...copy,
              key: Math.max(...d.rows.map((r) => r.key)) + 1,
              name: `${copy.name.slice(0, 78)}副本`,
            }
          : {
              key: Math.max(...d.rows.map((r) => r.key)) + 1,
              name: '',
              formula: '',
              unit: 'money',
              subtotal: false,
            },
      ],
    }));
  const move = (i: number, step: number) =>
    setDraft((d) => {
      const rows = [...d.rows];
      [rows[i], rows[i + step]] = [rows[i + step]!, rows[i]!];
      return { ...d, rows };
    });
  return (
    <Modal
      open
      title="自定义分析定义"
      width="95vw"
      onCancel={close}
      maskClosable={false}
      footer={
        <Space>
          <Button disabled={isSubmitting} onClick={close}>
            关闭定义
          </Button>
          <Button type="primary" loading={isSubmitting} onClick={() => void save()}>
            保存分析定义
          </Button>
        </Space>
      }
    >
      <Space wrap>
        <label htmlFor="definition-code">分析编号</label>
        <Input
          id="definition-code"
          aria-label="分析编号"
          value={draft.code}
          maxLength={3}
          disabled={isSubmitting}
          style={{ width: 100 }}
          onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
        />
        <label htmlFor="definition-name">分析名称</label>
        <Input
          id="definition-name"
          aria-label="分析名称"
          value={draft.name}
          maxLength={80}
          disabled={isSubmitting}
          style={{ width: 280 }}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        <span>
          {saved.id ? `已保存版本 ${saved.revision}` : '新建分析表'}；
          {dirty ? '有未保存修改' : '已保存'}
        </span>
      </Space>
      {error && <Alert type="error" title="分析定义未保存，输入仍保留" description={error} />}
      <Collapse
        items={[
          {
            key: 'guide',
            label: '函数指南与示例',
            children: (
              <>
                <p>
                  数字常量以元输入；支持 +、-、*、/
                  和括号。函数：借方、贷方、余额、期初、年初、累计借方、累计贷方；科目编码用英文引号括起，并包含下级科目。余额借正贷负，累计含期初本年累计。
                </p>
                <p>
                  例：借方("1122")；贷方("6001") - 借方("6602")；项目(1) + 项目(2)；项目(1) /
                  项目(2) *
                  100（单位选%）。项目编号固定，移动行不改变引用；删除被引用项目须先修改公式。小计标志仅加粗显示，小计金额须填写公式。
                </p>
                <p>
                  不执行脚本，不兼容未列出的旧版函数；年初为该年首个启用月份的总账期初，经营口径期初剔除当年以前月份的损益结转影响。
                </p>
              </>
            ),
          },
        ]}
      />
      <Space wrap>
        <span>函数向导</span>
        <Select
          aria-label="向导目标项目"
          value={draft.rows.some((r) => r.key === wizardRow) ? wizardRow : draft.rows[0]!.key}
          disabled={isSubmitting}
          style={{ width: 180 }}
          options={draft.rows.map((r) => ({
            value: r.key,
            label: `${r.key} ${r.name || '未命名项目'}`,
          }))}
          onChange={setWizardRow}
        />
        <Select
          aria-label="向导函数"
          value={wizardFunction}
          disabled={isSubmitting}
          options={ACCOUNT_FUNCTIONS.map((value) => ({ value, label: value }))}
          onChange={setWizardFunction}
        />
        <AccountSelect
          aria-label="向导科目"
          leafOnly={false}
          includeDisabled
          value={wizardAccount}
          onChange={setWizardAccount}
          disabled={isSubmitting}
          style={{ width: 240 }}
        />
        <Button
          disabled={isSubmitting || !wizardAccount}
          onClick={() => {
            const code = byId.get(wizardAccount!)?.code;
            if (!code) return;
            const index = Math.max(
              0,
              draft.rows.findIndex((r) => r.key === wizardRow),
            );
            const current = draft.rows[index]!.formula;
            changeRow(index, {
              formula: `${current}${current.trim() ? ' + ' : ''}${wizardFunction}("${code}")`,
            });
          }}
        >
          追加函数
        </Button>
      </Space>
      <Button disabled={isSubmitting || draft.rows.length >= 100} onClick={() => append()}>
        增加项目
      </Button>
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        scroll={{ x: 1200, y: 420 }}
        dataSource={draft.rows.map((r, index) => ({ ...r, index }))}
        columns={[
          { title: '编号', dataIndex: 'key', width: 70 },
          {
            title: '项目名称',
            width: 200,
            render: (_, r) => (
              <Input
                aria-label={`项目${r.key}名称`}
                value={r.name}
                maxLength={80}
                disabled={isSubmitting}
                onChange={(e) => changeRow(r.index, { name: e.target.value })}
              />
            ),
          },
          {
            title: '公式',
            width: 440,
            render: (_, r) => (
              <Input
                aria-label={`项目${r.key}公式`}
                value={r.formula}
                maxLength={1000}
                disabled={isSubmitting}
                onChange={(e) => changeRow(r.index, { formula: e.target.value })}
              />
            ),
          },
          {
            title: '单位',
            width: 110,
            render: (_, r) => (
              <Select
                aria-label={`项目${r.key}单位`}
                value={r.unit ?? 'money'}
                disabled={isSubmitting}
                options={Object.entries(UNIT_NAMES).map(([value, label]) => ({ value, label }))}
                onChange={(unit) => changeRow(r.index, { unit })}
              />
            ),
          },
          {
            title: '小计',
            width: 70,
            render: (_, r) => (
              <Checkbox
                aria-label={`项目${r.key}小计`}
                checked={r.subtotal}
                disabled={isSubmitting}
                onChange={(e) => changeRow(r.index, { subtotal: e.target.checked })}
              />
            ),
          },
          {
            title: '操作',
            width: 290,
            render: (_, r) => (
              <Space>
                <Button
                  disabled={isSubmitting || draft.rows.length >= 100}
                  onClick={() => append(r)}
                >
                  复制行
                </Button>
                <Button
                  aria-label={`项目${r.key}上移`}
                  disabled={isSubmitting || r.index === 0}
                  onClick={() => move(r.index, -1)}
                >
                  ↑
                </Button>
                <Button
                  aria-label={`项目${r.key}下移`}
                  disabled={isSubmitting || r.index === draft.rows.length - 1}
                  onClick={() => move(r.index, 1)}
                >
                  ↓
                </Button>
                <Button
                  danger
                  disabled={isSubmitting || draft.rows.length === 1}
                  onClick={() =>
                    modal.confirm({
                      title: `删除项目${r.key}？`,
                      content: '请检查其他公式对该编号的引用，保存时会验证。',
                      okText: '删除项目',
                      cancelText: '取消',
                      onOk: () =>
                        setDraft((d) => ({
                          ...d,
                          rows: d.rows.filter((item) => item.key !== r.key),
                        })),
                    })
                  }
                >
                  删除行
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </Modal>
  );
}
export default function CustomPage() {
  const canView = usePermission('analysis.view'),
    canEdit = usePermission('analysis.definition.edit');
  const session = useRequiredSession(),
    { modal } = App.useApp();
  const query = useQuery({ ...api.definitions.list.queryOptions(), enabled: canView });
  const [draft, setDraft] = useState<Draft>(),
    [result, setResult] = useState<ResultDraft>();
  const [periodFrom, setFrom] = useState(session.book.startPeriod),
    [periodTo, setTo] = useState(session.book.startPeriod);
  const [includeUnposted, setUnposted] = useState(false),
    [scope, setScope] = useState<'operating' | 'ledger'>('operating');
  const { submit, isSubmitting } = useSubmission();
  const remove = useMutation(
    api.definitions.remove.mutationOptions({
      onSuccess: () => {
        void query.refetch();
      },
    }),
  );
  const open = (id: number, copy = false) =>
    submit(async () => {
      const value = await queryClient.fetchQuery({
        ...api.definitions.get.queryOptions({ id }),
        staleTime: 0,
      });
      setDraft(
        copy
          ? {
              ...value,
              id: undefined,
              code: '',
              name: `${value.name.slice(0, 78)}副本`,
              revision: 0,
              expectedRevision: 0,
            }
          : value,
      );
    });
  const calculate = (definitionId: number) =>
    submit(async () => {
      const sheet = await queryClient.fetchQuery({
        ...api.definitions.calculate.queryOptions({
          definitionId,
          periodFrom,
          periodTo,
          scope,
          includeUnposted,
        }),
        staleTime: 0,
      });
      setResult({ revision: 0, name: `${sheet.title}-${periodFrom}-${periodTo}`, sheet });
    });
  return (
    <PageContainer
      title="自定义分析表"
      extra={<Link to="/m/analysis/results">已保存分析结果</Link>}
    >
      {!canView ? (
        <NoPermission />
      ) : (
        <>
          <Space wrap>
            <label>
              开始期间 <PeriodPicker value={periodFrom} onChange={(v) => v && setFrom(v)} />
            </label>
            <label>
              结束期间 <PeriodPicker value={periodTo} onChange={(v) => v && setTo(v)} />
            </label>
            <Select
              aria-label="自定义分析口径"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'operating', label: '经营分析（排除损益结转）' },
                { value: 'ledger', label: '原始总账' },
              ]}
            />
            <Checkbox checked={includeUnposted} onChange={(e) => setUnposted(e.target.checked)}>
              包含未过账
            </Checkbox>
            {canEdit && (
              <Button type="primary" onClick={() => setDraft(blank())}>
                新增分析表
              </Button>
            )}
            <Button loading={query.isFetching} onClick={() => void query.refetch()}>
              刷新列表
            </Button>
          </Space>
          <Alert
            type="info"
            title="选择分析表后定义项目或分析；计算结果可编辑、保存、重新打开。一次最多分析36个月。"
          />
          {query.isError && <ReportError error={query.error} retry={() => void query.refetch()} />}
          <DataTable
            tableId="analysis.custom"
            rowKey="id"
            loading={query.isFetching || isSubmitting}
            dataSource={query.data ?? []}
            locale={{ emptyText: '尚无自定义分析表，请新增并保存项目定义' }}
            columns={[
              { title: '编号', dataIndex: 'code', key: 'code', width: 100 },
              { title: '名称', dataIndex: 'name', key: 'name', width: 300 },
              {
                title: '操作',
                key: 'actions',
                width: 400,
                render: (_, r) => (
                  <Space wrap>
                    <Button
                      loading={isSubmitting}
                      onClick={() => void calculate(r.id).catch(showError)}
                    >
                      分析
                    </Button>
                    {canEdit && (
                      <>
                        <Button
                          disabled={isSubmitting}
                          onClick={() => void open(r.id).catch(showError)}
                        >
                          定义
                        </Button>
                        <Button
                          disabled={isSubmitting}
                          onClick={() => void open(r.id, true).catch(showError)}
                        >
                          复制分析表
                        </Button>
                        <Button
                          danger
                          loading={remove.isPending}
                          onClick={() =>
                            modal.confirm({
                              title: `删除 ${r.code} ${r.name}？`,
                              content: '已有保存结果时不能删除，请先处理对应结果。',
                              okText: '确认删除',
                              cancelText: '取消',
                              onOk: () =>
                                remove.mutateAsync({
                                  id: r.id,
                                  expectedRevision: r.revision,
                                  confirmed: true,
                                }),
                            })
                          }
                        >
                          删除分析表
                        </Button>
                      </>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          {draft && (
            <DefinitionEditor
              initial={draft}
              onClose={() => setDraft(undefined)}
              onSaved={() => void query.refetch()}
            />
          )}
          {result && <ResultEditor initial={result} onClose={() => setResult(undefined)} />}
        </>
      )}
    </PageContainer>
  );
}
