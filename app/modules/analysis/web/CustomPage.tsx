import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Alert, App, Button, Checkbox, Collapse, Input, Modal, Select, Space, Table } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  queryClient,
  showError,
  useHotkey,
  useAccounts,
  useDimensionItems,
  usePermission,
  useRequiredSession,
  useSubmission,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import { AccountSelect, DataTable, exportToExcel, PageContainer, PeriodPicker } from '@caiwu/ui';
import {
  ACCOUNT_FUNCTIONS,
  DefinitionInputSchema,
  UNIT_NAMES,
  type DefinitionInput,
} from '../custom';
import { api } from './api';
import { NoPermission, printTable, ReportError } from './common';
import ResultEditor, { type ResultDraft } from './ResultEditor';
import CopyDefinitionModal from './CopyDefinitionModal';
import { useLocalDraft } from './local-draft';
import { nextDefinitionProjectKey } from './definition-keys';

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
  const canPrint = usePermission('analysis.export');
  const rowsHost = useRef<HTMLDivElement>(null);
  const [selectedKey, setSelectedKey] = useState(initial.rows[0]!.key);
  const nextRowKey = useRef(nextDefinitionProjectKey(initial.rows));
  const deleteDialog = useRef<{ destroy: () => void } | null>(null);
  useEffect(
    () => () => {
      deleteDialog.current?.destroy();
      deleteDialog.current = null;
    },
    [],
  );
  const [deletePending, setDeletePending] = useState(false);
  const [recordsFocused, setRecordsFocused] = useState(false);
  const [draft, setDraft] = useState(initial),
    [saved, setSaved] = useState(initial);
  const [error, setError] = useState('');
  const { byId } = useAccounts();
  const [wizardAccount, setWizardAccount] = useState<number>();
  const [wizardFunction, setWizardFunction] = useState<string>('借方');
  const [wizardKind, setWizardKind] = useState<'money' | 'quantity' | 'foreign' | 'dimension'>(
    'money',
  );
  const [wizardCurrency, setWizardCurrency] = useState('');
  const [wizardDimension, setWizardDimension] = useState<
    'project' | 'partner' | 'department' | 'person'
  >('partner');
  const [wizardDimensionCode, setWizardDimensionCode] = useState<string>();
  const dimensionItems = useDimensionItems(wizardDimension);
  const [wizardRow, setWizardRow] = useState(initial.rows[0]!.key);
  const { submit, isSubmitting } = useSubmission();
  const mutation = useMutation(api.definitions.save.mutationOptions({ meta: { silent: true } }));
  const version = JSON.stringify(draft),
    latest = useRef(version);
  latest.current = version;
  const dirty = !saved.id || version !== JSON.stringify(saved);
  const recovery = useLocalDraft({
    kind: 'definition',
    identity: String(saved.id ?? 'new'),
    baseVersion: String(saved.revision),
    value: draft,
    dirty: dirty && version !== JSON.stringify(initial),
    busy: isSubmitting,
    parse: (v) => {
      const parsed = z
        .object({
          code: z.string().max(3),
          name: z.string().max(80),
          rows: z
            .array(
              z.object({
                key: z.number().int().min(1).max(9999),
                name: z.string().max(80),
                formula: z.string().max(1000),
                subtotal: z.boolean().default(false),
                unit: z.enum(['money', 'percent', 'number']).default('money'),
                decimalPlaces: z.union([z.literal(2), z.literal(6)]).optional(),
              }),
            )
            .min(1)
            .max(100),
        })
        .safeParse(v);
      return parsed.success
        ? {
            ...parsed.data,
            id: initial.id,
            expectedRevision: initial.expectedRevision,
            revision: initial.revision,
          }
        : undefined;
    },
    restore: setDraft,
  });
  const save = () => {
    if (recovery.blocked || deleteDialog.current) return Promise.resolve(false);
    return submit(async () => {
      if (recovery.blocked || deleteDialog.current) return false;
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
        recovery.clear();
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
  };
  useUnsavedChanges({
    title: `自定义分析定义：${draft.name || '新表'}`,
    dirty,
    version,
    save,
    discard: () => {
      recovery.clear();
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
              recovery.clear();
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
  const focusRow = (key: number) => {
    setSelectedKey(key);
    window.setTimeout(
      () =>
        rowsHost.current?.querySelector<HTMLInputElement>(`[data-row-key="${key}"] input`)?.focus(),
      0,
    );
  };
  const writeBlocked = isSubmitting || recovery.blocked;
  const editingDisabled = writeBlocked || deletePending;
  const editingDisabledRef = useRef(writeBlocked);
  editingDisabledRef.current = writeBlocked;
  const selectedRow = draft.rows.find((r) => r.key === selectedKey) ?? draft.rows[0]!;
  const append = (copy?: DefinitionInput['rows'][number]) => {
    if (editingDisabled || draft.rows.length >= 100) return;
    const nextKey = nextDefinitionProjectKey(draft.rows, nextRowKey.current);
    if (nextKey > 9999) {
      setError('项目编号已达到上限，不能继续增加');
      return;
    }
    nextRowKey.current = nextKey + 1;
    setDraft((d) => ({
      ...d,
      rows: [
        ...d.rows,
        copy
          ? {
              ...copy,
              key: nextKey,
              name: `${copy.name.slice(0, 78)}副本`,
            }
          : {
              key: nextKey,
              name: '',
              formula: '',
              unit: 'money',
              subtotal: false,
            },
      ],
    }));
    focusRow(nextKey);
  };
  const removeRow = (key: number) => {
    if (editingDisabled || deleteDialog.current || draft.rows.length <= 1) return;
    let focusKey = selectedRow.key;
    setDeletePending(true);
    deleteDialog.current = modal.confirm({
      title: `删除项目${key}？`,
      content: '请检查其他公式对该编号的引用，保存时会验证。',
      okText: '删除项目',
      cancelText: '取消',
      afterClose: () => {
        deleteDialog.current = null;
        setDeletePending(false);
        focusRow(focusKey);
      },
      onOk: () => {
        if (editingDisabledRef.current)
          return Promise.reject(new Error('当前正在保存或等待草稿恢复，请稍后再删除'));
        const index = draft.rows.findIndex((r) => r.key === key);
        const next = draft.rows[index + 1] ?? draft.rows[index - 1];
        setDraft((d) => ({ ...d, rows: d.rows.filter((r) => r.key !== key) }));
        if (next) focusKey = next.key;
      },
    });
  };
  const selectRecord = (position: 'first' | 'last' | 'previous' | 'next') => {
    if (editingDisabled) return;
    const current = Math.max(
      0,
      draft.rows.findIndex((r) => r.key === selectedRow.key),
    );
    const index =
      position === 'first'
        ? 0
        : position === 'last'
          ? draft.rows.length - 1
          : Math.max(
              0,
              Math.min(draft.rows.length - 1, current + (position === 'previous' ? -1 : 1)),
            );
    focusRow(draft.rows[index]!.key);
  };
  const printDefinition = () =>
    submit(async () => {
      if (!canPrint || recovery.blocked) return;
      await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('trend'), staleTime: 0 });
      await printTable(
        `${draft.code || '未编号'} ${draft.name || '未命名'}－分析定义稿`,
        '这是当前分析定义稿，列出项目和公式，不是分析结果。',
        ['编号', '项目', '公式', '单位', '小计'],
        draft.rows.map((r) => [
          r.key,
          r.name,
          r.formula,
          UNIT_NAMES[r.unit ?? 'money'],
          r.subtotal ? '是' : '否',
        ]),
      );
    });
  const exportDefinition = () =>
    submit(async () => {
      if (!canPrint || recovery.blocked) return;
      await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('trend'), staleTime: 0 });
      await exportToExcel({
        fileName: `${draft.code || '未编号'}-${draft.name || '未命名'}-分析定义稿`,
        sheetName: '分析定义稿',
        title: `${draft.code || '未编号'} ${draft.name || '未命名'}（定义稿，非分析结果）`,
        rows: draft.rows,
        columns: [
          { title: '编号', value: (r) => r.key },
          { title: '项目', value: (r) => r.name },
          { title: '公式', value: (r) => r.formula },
          { title: '单位', value: (r) => UNIT_NAMES[r.unit ?? 'money'] },
          { title: '小计', value: (r) => (r.subtotal ? '是' : '否') },
          { title: '小数位数', value: (r) => r.decimalPlaces ?? 2 },
        ],
      });
    });
  // 忙碌/确认期间由操作函数拒绝修改，仍吞掉窗口级组合键，避免触发浏览器书签等动作。
  const editKeys = { allowInInput: false };
  useHotkey('Ctrl+A', () => append(), editKeys);
  useHotkey('Ctrl+K', () => append(selectedRow));
  useHotkey('Ctrl+D', () => removeRow(selectedRow.key));
  useHotkey('Ctrl+Home', () => selectRecord('first'), { enabled: !editingDisabled });
  useHotkey('Ctrl+End', () => selectRecord('last'), { enabled: !editingDisabled });
  useHotkey('Ctrl+ArrowUp', () => selectRecord('previous'), { enabled: !editingDisabled });
  useHotkey('Ctrl+ArrowDown', () => selectRecord('next'), { enabled: !editingDisabled });
  useHotkey('ArrowUp', () => selectRecord('previous'), {
    enabled: !editingDisabled && recordsFocused,
    allowInInput: false,
  });
  useHotkey('ArrowDown', () => selectRecord('next'), {
    enabled: !editingDisabled && recordsFocused,
    allowInInput: false,
  });
  useHotkey('Ctrl+P', () => {
    if (canPrint && !editingDisabled) void printDefinition().catch(showError);
  });
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
          {canPrint && (
            <Button
              disabled={editingDisabled}
              onClick={() => void printDefinition().catch(showError)}
            >
              打印当前定义稿
            </Button>
          )}
          {canPrint && (
            <Button
              disabled={editingDisabled}
              onClick={() => void exportDefinition().catch(showError)}
            >
              另存定义 Excel
            </Button>
          )}
          <Button
            type="primary"
            disabled={recovery.blocked}
            loading={isSubmitting}
            onClick={() => void save()}
          >
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
          disabled={isSubmitting || recovery.blocked}
          style={{ width: 100 }}
          onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
        />
        <label htmlFor="definition-name">分析名称</label>
        <Input
          id="definition-name"
          aria-label="分析名称"
          value={draft.name}
          maxLength={80}
          disabled={isSubmitting || recovery.blocked}
          style={{ width: 280 }}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        <span>
          {saved.id ? `已保存版本 ${saved.revision}` : '新建分析表'}；
          {dirty ? '有未保存修改' : '已保存'}
        </span>
      </Space>
      {recovery.notice}
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
                  数量函数在名称前加S，例如 S借方("1403")；外币加W并填写币种，例如
                  W余额("100202","USD")；辅助加F并指定类型和编码，例如
                  F余额("1122",2,"C001")。辅助类型1项目、2客供、3部门、4个人。数量项目可选择六位小数，外币以所选原币为单位。
                </p>
                <p>
                  年初为该年首个启用月份的总账期初；经营口径排除当年损益结转。启用前缺来源的外币、数量累计会明确说明。其他旧版函数名称仍需原函数表核对。
                </p>
              </>
            ),
          },
        ]}
      />
      <Space wrap>
        <span>函数向导</span>
        <Select
          aria-label="向导取数类型"
          value={wizardKind}
          onChange={setWizardKind}
          disabled={isSubmitting || recovery.blocked}
          options={[
            { value: 'money', label: '本币金额' },
            { value: 'quantity', label: '数量' },
            { value: 'foreign', label: '外币金额' },
            { value: 'dimension', label: '辅助金额' },
          ]}
        />
        <Select
          aria-label="向导目标项目"
          value={draft.rows.some((r) => r.key === wizardRow) ? wizardRow : draft.rows[0]!.key}
          disabled={isSubmitting || recovery.blocked}
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
          disabled={isSubmitting || recovery.blocked}
          options={ACCOUNT_FUNCTIONS.map((value) => ({ value, label: value }))}
          onChange={setWizardFunction}
        />
        <AccountSelect
          aria-label="向导科目"
          leafOnly={false}
          includeDisabled
          value={wizardAccount}
          onChange={setWizardAccount}
          disabled={isSubmitting || recovery.blocked}
          style={{ width: 240 }}
        />
        {wizardKind === 'foreign' && (
          <Input
            aria-label="向导币种编码"
            placeholder="币种编码，如USD"
            value={wizardCurrency}
            disabled={isSubmitting || recovery.blocked}
            onChange={(e) => setWizardCurrency(e.target.value)}
            style={{ width: 130 }}
          />
        )}
        {wizardKind === 'dimension' && (
          <>
            <Select
              aria-label="向导辅助类型"
              value={wizardDimension}
              disabled={isSubmitting || recovery.blocked}
              options={[
                { value: 'project', label: '项目' },
                { value: 'partner', label: '客供' },
                { value: 'department', label: '部门' },
                { value: 'person', label: '个人' },
              ]}
              onChange={(v) => {
                setWizardDimension(v);
                setWizardDimensionCode(undefined);
              }}
            />
            <Select
              aria-label="向导辅助编码"
              value={wizardDimensionCode}
              disabled={isSubmitting || recovery.blocked}
              style={{ width: 180 }}
              options={dimensionItems.items
                .filter((i) => i.isLeaf)
                .map((i) => ({ value: i.code, label: `${i.code} ${i.name}` }))}
              onChange={setWizardDimensionCode}
            />
          </>
        )}
        <Button
          disabled={
            isSubmitting ||
            !wizardAccount ||
            (wizardKind === 'foreign' && !/^[A-Za-z0-9_-]{1,20}$/.test(wizardCurrency)) ||
            (wizardKind === 'dimension' && !wizardDimensionCode)
          }
          onClick={() => {
            const code = byId.get(wizardAccount!)?.code;
            if (!code) return;
            const index = Math.max(
              0,
              draft.rows.findIndex((r) => r.key === wizardRow),
            );
            const current = draft.rows[index]!.formula;
            const prefix = { money: '', quantity: 'S', foreign: 'W', dimension: 'F' }[wizardKind];
            const args =
              wizardKind === 'foreign'
                ? `,"${wizardCurrency}"`
                : wizardKind === 'dimension'
                  ? `,${{ project: 1, partner: 2, department: 3, person: 4 }[wizardDimension]},"${wizardDimensionCode}"`
                  : '';
            changeRow(index, {
              formula: `${current}${current.trim() ? ' + ' : ''}${prefix}${wizardFunction}("${code}"${args})`,
              ...(wizardKind === 'quantity' ? { unit: 'number', decimalPlaces: 6 } : {}),
            });
          }}
        >
          追加函数
        </Button>
      </Space>
      <Button
        disabled={isSubmitting || recovery.blocked || draft.rows.length >= 100}
        onClick={() => append()}
      >
        增加项目
      </Button>
      <p>
        当前记录：项目{selectedRow.key}
        。Ctrl+A增加、Ctrl+K复制、Ctrl+D删除；Ctrl+Home/End及↑/↓选择记录（输入框外），也可用Ctrl+↑/↓；Ctrl+P打印定义稿。输入框内Ctrl+A仍为全选文本。
      </p>
      <div
        ref={rowsHost}
        tabIndex={-1}
        aria-label="分析定义项目记录"
        onFocusCapture={() => setRecordsFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setRecordsFocused(false);
        }}
      >
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          scroll={{ x: 1200, y: 420 }}
          dataSource={draft.rows.map((r, index) => ({ ...r, index }))}
          onRow={(r) => ({
            onFocus: () => setSelectedKey(r.key),
            onClick: () => setSelectedKey(r.key),
          })}
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
                  disabled={isSubmitting || recovery.blocked}
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
                  disabled={isSubmitting || recovery.blocked}
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
                  disabled={isSubmitting || recovery.blocked}
                  options={Object.entries(UNIT_NAMES).map(([value, label]) => ({ value, label }))}
                  onChange={(unit) =>
                    changeRow(r.index, {
                      unit,
                      decimalPlaces: unit === 'number' ? (r.decimalPlaces ?? 2) : 2,
                    })
                  }
                />
              ),
            },
            {
              title: '小数位数',
              width: 110,
              render: (_, r) => (
                <Select
                  aria-label={`项目${r.key}小数位数`}
                  value={r.decimalPlaces ?? 2}
                  disabled={isSubmitting || recovery.blocked || r.unit !== 'number'}
                  options={[
                    { value: 2, label: '两位' },
                    { value: 6, label: '六位' },
                  ]}
                  onChange={(decimalPlaces) => changeRow(r.index, { decimalPlaces })}
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
                  disabled={isSubmitting || recovery.blocked}
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
                    disabled={isSubmitting || recovery.blocked || draft.rows.length >= 100}
                    onClick={() => append(r)}
                  >
                    复制行
                  </Button>
                  <Button
                    aria-label={`项目${r.key}上移`}
                    disabled={isSubmitting || recovery.blocked || r.index === 0}
                    onClick={() => move(r.index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    aria-label={`项目${r.key}下移`}
                    disabled={isSubmitting || recovery.blocked || r.index === draft.rows.length - 1}
                    onClick={() => move(r.index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    danger
                    disabled={isSubmitting || recovery.blocked || draft.rows.length === 1}
                    onClick={() => removeRow(r.key)}
                  >
                    删除行
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </div>
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
  const [copying, setCopying] = useState(false);
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
      extra={
        <Space>
          <Link to="/m/analysis/methods">结构、比较与趋势分析</Link>
          <Link to="/m/analysis/results">已保存分析结果</Link>
        </Space>
      }
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
            {canEdit && <Button onClick={() => setCopying(true)}>从账套复制分析表</Button>}
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
          {copying && (
            <CopyDefinitionModal
              onClose={() => setCopying(false)}
              onCopied={() => void query.refetch()}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
